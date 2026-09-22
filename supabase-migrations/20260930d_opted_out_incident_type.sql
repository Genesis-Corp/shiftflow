-- Adds 'opted_out_sms' as a valid reliability_incidents.incident_type, so a
-- STOP reply can be logged the same way a no-show or a late arrival is —
-- see RELIABILITY_DELTAS in shiftUtils.ts (-30%) and the insert added to
-- raceService.ts's handling of an inbound STOP.
--
-- Safe to run more than once.

alter table reliability_incidents drop constraint if exists reliability_incidents_incident_type_check;
alter table reliability_incidents add constraint reliability_incidents_incident_type_check
  check (incident_type in ('no_show', 'no_answer', 'rejected', 'covered', 'late', 'opted_out_sms'));
