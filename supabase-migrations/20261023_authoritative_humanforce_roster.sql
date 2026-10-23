-- Humanforce CSV is the authoritative roster for each successfully read date.
-- Requires 20260915_automation_runs.sql. Safe to run more than once.
-- Excluded departments remain outside sync, as in the existing importer.
create table if not exists public.humanforce_roster_snapshots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  roster_date date not null,
  old_shifts jsonb not null,
  related_records jsonb not null default '{}',
  source_shifts jsonb not null,
  run_id uuid references public.automation_runs(id) on delete set null
);
alter table public.humanforce_roster_snapshots enable row level security;
revoke all on public.humanforce_roster_snapshots from public, anon, authenticated;
grant select, insert, update on public.humanforce_roster_snapshots to service_role;

create or replace function public.replace_humanforce_roster(
  p_date date, p_shifts jsonb, p_flags jsonb, p_expected jsonb, p_dry_run boolean default true
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  item jsonb;
  current_rows jsonb;
  old_rows jsonb;
  related jsonb := '{}';
  saved_rows jsonb;
  keep_ids uuid[] := '{}';
  remove_ids uuid[] := '{}';
  new_rows jsonb := '[]';
  matched_id uuid;
  added integer := 0;
  removed integer := 0;
  depts integer := 0;
  audit_id uuid;
  snapshot_id uuid;
  flags jsonb := p_flags;
  person uuid;
  dept uuid;
  start_min numeric;
  end_min numeric;
begin
  if p_date is null or p_dry_run is null or jsonb_typeof(p_shifts) is distinct from 'array'
     or jsonb_typeof(p_flags) is distinct from 'array' or jsonb_typeof(p_expected) is distinct from 'array'
     or jsonb_array_length(p_shifts) > 1000 or jsonb_array_length(p_expected) > 1000 then
    raise exception 'Invalid replacement request';
  end if;
  -- Readiness probe is deliberately read-only, even on a populated database.
  if p_dry_run and p_date = '2000-01-01' and p_shifts = '[]' and p_expected = '[]' then
    return jsonb_build_object('replacement_ready', true);
  end if;
  if jsonb_array_length(p_shifts) = 0 then
    flags := flags || '[{"department":null,"kind":"empty_read","message":"Empty source; roster replacement blocked."}]'::jsonb;
  end if;
  if jsonb_array_length(flags) > 0 then
    return jsonb_build_object('can_apply', false, 'shifts_created', 0, 'shifts_deleted', 0,
      'departments_applied', 0, 'flags', flags, 'run_id', null, 'snapshot_id', null);
  end if;
  -- Serialize with normal shift writes and prevent staff/dept changes during
  -- validation. Any error rolls back the snapshot, deletions, inserts and audit.
  lock table public.shifts in share row exclusive mode;
  lock table public.staff, public.departments in share mode;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]') into current_rows
    from public.shifts s where s.date = p_date;
  if current_rows is distinct from (
    select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]')
      from jsonb_populate_recordset(null::public.shifts, p_expected) s
  ) then
    raise exception 'Roster changed during reconciliation; retry with a fresh preview';
  end if;
  for item in select value from jsonb_array_elements(p_shifts) loop
    person := (item->>'staff_id')::uuid;
    dept := (item->>'department_id')::uuid;
    if not exists (select 1 from public.staff where id = person and active)
      or not exists (select 1 from public.departments where id = dept and
        lower(regexp_replace(trim(name), '\s+', ' ', 'g')) not in
        ('cleaning','direct filling','direct ordering','payroll officer','store cashier')) then
      raise exception 'Unknown/inactive staff or invalid department; replacement blocked';
    end if;
    if coalesce(item->>'start_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]:00$'
      or coalesce(item->>'end_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]:00$'
      or coalesce(item->>'break_duration_minutes','') !~ '^[0-9]+$'
      or jsonb_typeof(item->'has_break') is distinct from 'boolean' then
      raise exception 'Invalid shift fields';
    end if;
    start_min := extract(epoch from (item->>'start_time')::time) / 60;
    end_min := extract(epoch from (item->>'end_time')::time) / 60;
    if end_min <= start_min then end_min := end_min + 1440; end if;
    if end_min - start_min > 960 or (item->>'break_duration_minutes')::int not between 0 and 60
      or (item->>'has_break')::boolean is distinct from ((item->>'break_duration_minutes')::int > 0) then
      raise exception 'Invalid shift duration/break';
    end if;
    select s.id into matched_id from public.shifts s
      where s.date = p_date and s.assigned_staff_id = person and s.department_id = dept
        and s.start_time = (item->>'start_time')::time and s.end_time = (item->>'end_time')::time
        and s.status = 'covered' and s.has_break = (item->>'has_break')::boolean
        and s.break_duration_minutes = (item->>'break_duration_minutes')::int
        and not (s.id = any(keep_ids)) order by s.id limit 1;
    if matched_id is not null then keep_ids := array_append(keep_ids, matched_id);
    else new_rows := new_rows || jsonb_build_array(item); end if;
  end loop;
  -- Compare only the new source, never a source row against obsolete shifts.
  if exists (
    with ranges as (
      select ordinality, value->>'staff_id' as person,
        extract(epoch from (value->>'start_time')::time) / 60 as a,
        extract(epoch from (value->>'end_time')::time) / 60 +
          case when (value->>'end_time')::time <= (value->>'start_time')::time then 1440 else 0 end as b
      from jsonb_array_elements(p_shifts) with ordinality
    ) select 1 from ranges x join ranges y on x.person = y.person and x.ordinality < y.ordinality
      where x.a < y.b and y.a < x.b
  ) then raise exception 'Overlapping source assignments; replacement blocked'; end if;
  select coalesce(array_agg(s.id), '{}'), coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]')
    into remove_ids, old_rows from public.shifts s join public.departments d on d.id = s.department_id
    where s.date = p_date and not (s.id = any(keep_ids)) and
      lower(regexp_replace(trim(d.name), '\s+', ' ', 'g')) not in
      ('cleaning','direct filling','direct ordering','payroll officer','store cashier');
  removed := cardinality(remove_ids);
  select count(distinct value->>'department_id') into depts from jsonb_array_elements(p_shifts);
  if p_dry_run then
    return jsonb_build_object('can_apply', true, 'shifts_created', 0, 'shifts_deleted', 0,
      'proposed_shifts', jsonb_array_length(new_rows), 'proposed_deletions', removed,
      'departments_applied', 0, 'flags', flags, 'run_id', null, 'snapshot_id', null);
  end if;
  if removed > 0 or jsonb_array_length(new_rows) > 0 then
    -- Preserve FK-linked history that DELETE would cascade or detach.
    lock table public.reliability_incidents in share row exclusive mode;
    select coalesce(jsonb_agg(to_jsonb(r)), '[]') into saved_rows
      from public.reliability_incidents r where r.shift_id = any(remove_ids);
    related := jsonb_build_object('reliability_incidents', saved_rows);
    if to_regclass('public.shift_claim_races') is not null then
      execute 'lock table public.shift_claim_races in share row exclusive mode';
      execute 'select coalesce(jsonb_agg(to_jsonb(r)), ''[]'') from public.shift_claim_races r where r.shift_id = any($1)'
        into saved_rows using remove_ids;
      related := related || jsonb_build_object('shift_claim_races', saved_rows);
      if to_regclass('public.shift_claim_recipients') is not null then
        execute 'lock table public.shift_claim_recipients in share row exclusive mode';
        execute 'select coalesce(jsonb_agg(to_jsonb(r)), ''[]'') from public.shift_claim_recipients r
          where r.race_id in (select id from public.shift_claim_races where shift_id = any($1))'
          into saved_rows using remove_ids;
        related := related || jsonb_build_object('shift_claim_recipients', saved_rows);
      end if;
    end if;
    if to_regclass('public.shift_extend_requests') is not null then
      execute 'lock table public.shift_extend_requests in share row exclusive mode';
      execute 'select coalesce(jsonb_agg(to_jsonb(r)), ''[]'') from public.shift_extend_requests r
        where r.shift_id = any($1) or r.existing_shift_id = any($1)'
        into saved_rows using remove_ids;
      related := related || jsonb_build_object('shift_extend_requests', saved_rows);
    end if;
    insert into public.humanforce_roster_snapshots(roster_date,old_shifts,related_records,source_shifts)
      values(p_date,old_rows,related,p_shifts) returning id into snapshot_id;
    delete from public.shifts where id = any(remove_ids);
    for item in select value from jsonb_array_elements(new_rows) loop
      insert into public.shifts(date,start_time,end_time,department_id,required_role,status,
        assigned_staff_id,has_break,break_duration_minutes,notes)
      values(p_date,(item->>'start_time')::time,(item->>'end_time')::time,(item->>'department_id')::uuid,
        'any','covered',(item->>'staff_id')::uuid,(item->>'has_break')::boolean,
        (item->>'break_duration_minutes')::int,'Imported from Humanforce CSV');
      added := added + 1;
    end loop;
  end if;
  insert into public.automation_runs(roster_date,source,shifts_created,departments_applied,flags)
    values(p_date,'humanforce',added,depts,flags) returning id into audit_id;
  update public.humanforce_roster_snapshots set run_id = audit_id where id = snapshot_id;
  return jsonb_build_object('can_apply', true, 'shifts_created', added, 'shifts_deleted', removed,
    'departments_applied', depts, 'flags', flags, 'run_id', audit_id, 'snapshot_id', snapshot_id);
end;
$$;
revoke all on function public.replace_humanforce_roster(date,jsonb,jsonb,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.replace_humanforce_roster(date,jsonb,jsonb,jsonb,boolean) to service_role;
