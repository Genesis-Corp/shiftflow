-- Staff: birthday, employment type and an informational pay rate, all sourced
-- from the staff CSV import (mobile # and department were already covered).
--
-- employment_type only changes behavior for 'salary' — a salaried person
-- never enters the claim race, since covering a shift doesn't change what
-- they're paid. pay_rate is deliberately NOT used to cost a shift — only
-- staff_wages.base_hourly_rate (the Wage Matrix) is, because a CSV pay rate
-- can be stale or differ from what the matrix says. It's kept for reference.
--
-- Departments: a color (for the Shifts roster) and a single default
-- department, so a CSV row whose department doesn't match anything on file
-- still lands the new staff member somewhere instead of nowhere.
--
-- Safe to run more than once.

alter table staff add column if not exists birthday date;
alter table staff add column if not exists employment_type text;
alter table staff add column if not exists pay_rate numeric(10, 2);

alter table staff drop constraint if exists staff_employment_type_check;
alter table staff add constraint staff_employment_type_check
  check (employment_type is null or employment_type in ('casual', 'part_time', 'full_time', 'salary'));

alter table departments add column if not exists color text;
alter table departments add column if not exists is_default boolean not null default false;

-- Only one department can be the default — a plain unique index over the
-- rows where it's true means "true" can only ever appear once.
drop index if exists departments_single_default;
create unique index departments_single_default on departments (is_default) where is_default;
