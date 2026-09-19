-- A department (e.g. Admin Office) can be marked as never coverable by a
-- claim race — it just drops out of the Department picker on the Cover
-- Shift page's manual search, so a manager can't start one for it by
-- mistake. Shifts can still be created for the department as normal.
--
-- Safe to run more than once.

alter table departments add column if not exists excluded_from_claim_race boolean not null default false;
