-- Two independent fixes to the cover-shift flow:
--
-- 1. excluded_staff_id: who a reopened shift was just pulled from, so they
--    don't turn right back up as an eligible candidate for the exact shift
--    they called in sick for. Nulled out again whenever the shift is
--    assigned to someone for real, so it never lingers into a later,
--    unrelated reopening of the same shift row.
--
-- 2. Stale open shifts: previously-open shifts nobody ever covered used to
--    sit around forever. The app now sweeps them on every shift list read
--    (see /api/shifts), deleting anything still 'open' whose date has
--    rolled into the past — never today's, however far into the day it
--    is, so an in-progress shift stays coverable.
--
-- Safe to run more than once.

alter table shifts add column if not exists excluded_staff_id uuid references staff(id) on delete set null;
