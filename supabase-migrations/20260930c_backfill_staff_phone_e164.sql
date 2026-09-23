-- One-time data fix: staff.phone_e164 (the +61 form SMS sending actually
-- uses — see src/lib/phone.ts toE164AU) was never populated by the
-- availability-sheet upload path (src/lib/staffSync.ts), only by the manual
-- Staff form and CSV import. It stored the sheet's mobile number as a
-- display string ("0491 570 156") in `phone`, and never derived `phone_e164`
-- from it at all — so any staff member created or updated only through that
-- upload has always had phone_e164 null, and has never been reachable by
-- the claim race, no matter how many times their real number was on file.
--
-- src/lib/staffSync.ts now derives phone_e164 on every future sync; this
-- backfills every row already sitting without one (or with a stale one) from
-- whatever's currently in `phone`, mirroring toE164AU()'s AU-mobile rules:
--   04xxxxxxxx / 4xxxxxxxx / 61xxxxxxxxx / +61xxxxxxxxx (any punctuation)
--   -> +614xxxxxxxx
-- A number that doesn't fit any of those (a landline, something unreadable)
-- is left/set to null rather than guessed at — same as the app would do.
--
-- Safe to run more than once.

with digits as (
  select id, regexp_replace(phone, '\D', '', 'g') as d
  from staff
  where phone is not null and phone <> ''
),
computed as (
  select
    id,
    case
      when d ~ '^614\d{8}$' then '+' || d
      when d ~ '^04\d{8}$'  then '+61' || substring(d from 2)
      when d ~ '^4\d{8}$'   then '+61' || d
      else null
    end as new_phone_e164
  from digits
)
update staff s
set phone_e164 = computed.new_phone_e164
from computed
where s.id = computed.id
  and (s.phone_e164 is null or s.phone_e164 !~ '^\+614\d{8}$')
  and s.phone_e164 is distinct from computed.new_phone_e164;
