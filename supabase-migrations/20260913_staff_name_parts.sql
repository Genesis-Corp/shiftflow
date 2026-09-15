-- Store the staff member's first and last name separately.
--
-- The availability sheet lists them in two columns ("Md Mozammal | Hossain",
-- "Isaac | Di Stefano"), and those splits cannot be recovered reliably from the
-- combined name. `name` stays as the display name so nothing else has to change.
--
-- Safe to run more than once. Not required for Capture/Upload to work — the
-- app checks for these columns at runtime (see hasNameColumns() in
-- src/lib/staffNames.ts) and stores names combined until this has been run.

alter table staff add column if not exists first_name text;
alter table staff add column if not exists last_name text;

-- Backfill existing rows from the combined name (first word = first name).
update staff
set first_name = split_part(name, ' ', 1),
    last_name  = nullif(trim(substring(name from position(' ' in name))), '')
where first_name is null and last_name is null;
