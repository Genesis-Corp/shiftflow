-- School term/holiday calendar — a "School Holidays" tab next to Public
-- Holidays. Unlike public holidays, there's no maintained library (like
-- date-holidays) or public API for individual school terms, so this is
-- entered manually per term rather than generated. Stored as the holiday
-- date ranges themselves (the gaps between terms), not the term dates,
-- since the one question the app's availability logic needs answered is
-- "is this weekday a school holiday or not" — any weekday that falls
-- outside every stored range, and isn't a public holiday, counts as a
-- school day, and juniors are treated as unavailable before 3pm on it.
--
-- Safe to run more than once.

create table if not exists school_holidays (
  id uuid primary key default gen_random_uuid(),
  start_date date not null,
  end_date date not null,
  name text not null,
  created_at timestamptz not null default now(),
  constraint school_holidays_valid_range check (end_date >= start_date)
);

alter table school_holidays enable row level security;

-- Seeded with Western Australian public school term breaks, 2026-2029 —
-- confirmed (not provisional) dates from
-- https://www.education.wa.edu.au/future-term-dates as of this migration.
-- 2030 onward isn't seeded: those years are still marked provisional on
-- that page, so add them once gazetted.
insert into school_holidays (start_date, end_date, name)
select * from (values
  ('2026-04-03'::date, '2026-04-19'::date, 'Term 1 holidays 2026'),
  ('2026-07-04'::date, '2026-07-19'::date, 'Term 2 holidays 2026'),
  ('2026-09-26'::date, '2026-10-11'::date, 'Term 3 holidays 2026'),
  ('2026-12-18'::date, '2027-01-31'::date, 'Summer holidays 2026/27'),
  ('2027-04-10'::date, '2027-04-25'::date, 'Term 1 holidays 2027'),
  ('2027-07-03'::date, '2027-07-18'::date, 'Term 2 holidays 2027'),
  ('2027-09-25'::date, '2027-10-10'::date, 'Term 3 holidays 2027'),
  ('2027-12-17'::date, '2028-02-01'::date, 'Summer holidays 2027/28'),
  ('2028-04-08'::date, '2028-04-23'::date, 'Term 1 holidays 2028'),
  ('2028-07-01'::date, '2028-07-16'::date, 'Term 2 holidays 2028'),
  ('2028-09-23'::date, '2028-10-08'::date, 'Term 3 holidays 2028'),
  ('2028-12-15'::date, '2029-01-30'::date, 'Summer holidays 2028/29'),
  ('2029-03-30'::date, '2029-04-15'::date, 'Term 1 holidays 2029'),
  ('2029-06-30'::date, '2029-07-15'::date, 'Term 2 holidays 2029'),
  ('2029-09-22'::date, '2029-10-07'::date, 'Term 3 holidays 2029')
) as seed(start_date, end_date, name)
where not exists (select 1 from school_holidays);
