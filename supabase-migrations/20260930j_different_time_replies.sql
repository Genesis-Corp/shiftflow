-- "Different time" replies: a staff member who can work, just not the exact
-- times asked ("yes but only til 8", "can do 7-9"). Their reply is sent to
-- the manager, numbered like a pick-list option, to accept or decline — see
-- raceService.ts's handleDifferentTime / resolveDifferentTime.
--
-- pending  -> waiting on the manager
-- accepted -> they got the shift
-- declined -> told the specific time is needed
--
-- The reply text itself is the existing response_body column.
--
-- Safe to run more than once.

alter table shift_claim_recipients add column if not exists different_time_status text;
alter table shift_claim_recipients drop constraint if exists shift_claim_recipients_different_time_status_check;
alter table shift_claim_recipients add constraint shift_claim_recipients_different_time_status_check
  check (different_time_status in ('pending', 'accepted', 'declined'));

notify pgrst, 'reload schema';
