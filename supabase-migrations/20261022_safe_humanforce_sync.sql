-- Requires 20260915_automation_runs.sql. Apply before enabling the Windows job.
-- Additions and audit are atomic. Never updates/deletes shifts, people or incidents.
create or replace function public.apply_humanforce_sync(
  p_date date, p_shifts jsonb, p_flags jsonb, p_dry_run boolean default true
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  item jsonb;
  added integer := 0;
  applied_depts uuid[] := '{}';
  run_id uuid;
  flags jsonb := p_flags;
  person uuid;
  dept uuid;
begin
  if p_date is null or p_dry_run is null or jsonb_typeof(p_shifts) is distinct from 'array'
     or jsonb_typeof(p_flags) is distinct from 'array' or jsonb_array_length(p_shifts) > 1000 then
    raise exception 'Invalid sync request';
  end if;
  if p_dry_run then
    return jsonb_build_object('shifts_created', 0, 'departments_applied', 0, 'flags', flags, 'run_id', null);
  end if;
  -- Manual shift writes and other imports wait until candidate rechecks finish.
  lock table public.shifts in share row exclusive mode;
  for item in select value from jsonb_array_elements(p_shifts) loop
    person := (item->>'staff_id')::uuid;
    dept := (item->>'department_id')::uuid;
    if not exists (select 1 from public.staff where id = person and active)
      or not exists (select 1 from public.departments where id = dept)
      or exists (select 1 from public.shifts where date = p_date and
        (assigned_staff_id = person or (department_id = dept and assigned_staff_id is null))) then
      flags := flags || jsonb_build_array(jsonb_build_object('department', null, 'kind', 'warning',
        'message', 'Concurrent change or duplicate detected; review candidate: ' || coalesce(person::text, 'unknown')));
      continue;
    end if;
    if (item->>'start_time')::time = (item->>'end_time')::time
      or (item->>'break_duration_minutes')::integer not between 0 and 60
      or (item->>'has_break')::boolean is distinct from ((item->>'break_duration_minutes')::integer > 0) then
      raise exception 'Invalid shift times/break';
    end if;
    insert into public.shifts (date, start_time, end_time, department_id, required_role, status,
      assigned_staff_id, has_break, break_duration_minutes, notes)
    values (p_date, (item->>'start_time')::time, (item->>'end_time')::time, dept, 'any', 'covered',
      person, (item->>'has_break')::boolean, (item->>'break_duration_minutes')::integer, 'Imported from Humanforce CSV');
    added := added + 1;
    if not (dept = any(applied_depts)) then applied_depts := array_append(applied_depts, dept); end if;
  end loop;
  insert into public.automation_runs (roster_date, source, shifts_created, departments_applied, flags)
    values (p_date, 'humanforce', added, cardinality(applied_depts), flags) returning id into run_id;
  return jsonb_build_object('shifts_created', added, 'departments_applied', cardinality(applied_depts),
    'flags', flags, 'run_id', run_id);
end;
$$;
revoke all on function public.apply_humanforce_sync(date, jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.apply_humanforce_sync(date, jsonb, jsonb, boolean) to service_role;
