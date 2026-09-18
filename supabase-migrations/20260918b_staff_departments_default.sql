-- Which of a staff member's departments is their "home" one, so a CSV
-- import can record it directly: whatever department someone is rostered
-- for on the sheet becomes their default department, not just one they're
-- trained in. A person can still be added to further departments by hand
-- afterwards without disturbing which one is default.
--
-- Safe to run more than once.

alter table staff_departments add column if not exists is_default boolean not null default false;

-- Only one default department per staff member.
drop index if exists staff_departments_single_default;
create unique index staff_departments_single_default on staff_departments (staff_id) where is_default;
