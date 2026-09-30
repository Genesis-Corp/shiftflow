-- Adds 'sick' as a valid reliability_incidents.incident_type. Calling in sick
-- used to be logged as a 'no_show', which lumped a notified absence in with
-- someone simply not turning up (and docked their reliability score -15% for
-- it). A sick call is now its own incident type with no score change — see
-- RELIABILITY_DELTAS in shiftUtils.ts.
--
-- Also reclassifies the sick calls already logged as no-shows. Those were all
-- written by the Shifts page's "called in sick" button, whose notes always
-- start with "Called in sick". This does NOT give back the -15% each one took
-- off the person's score — that compounded with every incident since, so it
-- can't be cleanly reversed here; adjust anyone affected by hand if needed.
--
-- Safe to run more than once.

alter table reliability_incidents drop constraint if exists reliability_incidents_incident_type_check;
alter table reliability_incidents add constraint reliability_incidents_incident_type_check
  check (incident_type in ('no_show', 'sick', 'no_answer', 'rejected', 'covered', 'late', 'opted_out_sms'));

update reliability_incidents
set incident_type = 'sick'
where incident_type = 'no_show' and notes like 'Called in sick%';
