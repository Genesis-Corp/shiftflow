-- Request Day Off / Leave forms: a manager uploads whatever the staff
-- member handed them (photo, PDF, scanned form — any file type, never
-- parsed, just kept on file), tied to a date range. That range excludes
-- them from claim-race eligibility for any shift falling inside it, the
-- same way a birthday already does — see eligibility.ts.
--
-- Safe to run more than once.

create table if not exists staff_leave (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete cascade,
  leave_type text not null check (leave_type in ('day_off', 'leave')),
  start_date date not null,
  end_date date not null,
  file_path text,
  file_name text,
  notes text,
  created_at timestamptz not null default now(),
  constraint staff_leave_date_order check (end_date >= start_date)
);

alter table staff_leave enable row level security;

-- Private bucket — these are the staff member's own paperwork, not
-- something to expose publicly. The app only ever reads/writes it through
-- the service-role key, same as every other table.
insert into storage.buckets (id, name, public)
select 'leave-forms', 'leave-forms', false
where not exists (select 1 from storage.buckets where id = 'leave-forms');
