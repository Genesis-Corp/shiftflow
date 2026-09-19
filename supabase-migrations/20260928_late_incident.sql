-- "Late" reliability incident — a staff member showed up after their shift
-- started, logged with the time they actually arrived (read off a spinning
-- wheel time picker on mobile, same as every other time field in the app).
-- Worth -5 reliability, same weight as a no-answer — see
-- RELIABILITY_DELTAS in shiftUtils.ts.
--
-- Safe to run more than once.

alter table reliability_incidents drop constraint if exists reliability_incidents_incident_type_check;
alter table reliability_incidents add constraint reliability_incidents_incident_type_check
  check (incident_type in ('no_show', 'no_answer', 'rejected', 'covered', 'late'));

alter table reliability_incidents add column if not exists late_time time;
