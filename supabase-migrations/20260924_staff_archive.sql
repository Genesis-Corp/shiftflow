-- Staff archive: a reversible alternative to deleting someone from the
-- system when they leave. Deleting outright meant the next roster or CSV
-- upload that still listed them (an old spreadsheet, a sheet someone forgot
-- to update) had no record to match against and silently re-created them
-- as a brand new hire. Archiving keeps the row — and everything attached
-- to it (department links, availability, shift and reliability history) —
-- so future uploads match the existing person instead of duplicating them,
-- and bringing someone back who's returned to the store is one click
-- instead of re-entering them from scratch.
--
-- Safe to run more than once.

alter table staff add column if not exists archived boolean not null default false;
alter table staff add column if not exists archived_at timestamptz;
