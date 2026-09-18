-- Replaces the per-staff manual hourly rate with the actual award structure
-- from Farmer Jack's 2026 Wage Table: every rate on that sheet is just one
-- number (the adult ordinary Mon-Fri rate) multiplied by an age-based
-- percentage and a time-of-week/employment-type percentage. Checked against
-- the sheet cell by cell — it holds throughout.
--
-- staff_wages (the old per-person rate table) is left in place but the app
-- stops reading and writing it — nothing here drops it.
--
-- Safe to run more than once.

alter table staff add column if not exists commencement_date date;

-- The one number that changes each award cycle (indexed each 1 July).
-- Single row, id fixed to 'current' so there's only ever one.
create table if not exists wage_base_rate (
  id text primary key default 'current',
  adult_hourly_rate numeric(10, 2) not null check (adult_hourly_rate > 0),
  updated_at timestamptz not null default now()
);

insert into wage_base_rate (id, adult_hourly_rate)
select 'current', 28.69
where not exists (select 1 from wage_base_rate);

-- Age brackets: what percentage of the adult rate someone on this birthday
-- is paid. The 20-21 bracket is the one place service length also matters
-- (under vs at-least 6 months) — everyone else's min_service_months is null.
create table if not exists age_brackets (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  min_age numeric,             -- null = no lower bound
  max_age numeric,             -- null = no upper bound; exclusive when set
  min_service_months numeric,  -- null = no service requirement
  percentage numeric(6, 2) not null check (percentage > 0),
  sort_order smallint not null
);

insert into age_brackets (label, min_age, max_age, min_service_months, percentage, sort_order)
select * from (values
  ('Under 16',                              null::numeric, 16::numeric,   null::numeric, 45::numeric,  1),
  ('16 to 17',                               16::numeric,   17::numeric,   null::numeric, 50::numeric,  2),
  ('17 to 18',                               17::numeric,   18::numeric,   null::numeric, 60::numeric,  3),
  ('18 to 19',                               18::numeric,   19::numeric,   null::numeric, 70::numeric,  4),
  ('19 to 20',                               19::numeric,   20::numeric,   null::numeric, 80::numeric,  5),
  ('20 to 21 (under 6 months service)',      20::numeric,   21::numeric,   0::numeric,    90::numeric,  6),
  ('20 to 21 (6 months service or more)',    20::numeric,   21::numeric,   6::numeric,    100::numeric, 7),
  ('Adult (21+)',                            21::numeric,   null::numeric, null::numeric, 100::numeric, 8)
) as seed(label, min_age, max_age, min_service_months, percentage, sort_order)
where not exists (select 1 from age_brackets);

-- Time-of-week loadings, split by employment category (full/part-time vs
-- casual pay different percentages for the same bracket). Public holiday
-- and overtime rows aren't matched by day/time — is_public_holiday applies
-- whenever the shift date is in public_holidays; is_overtime applies to the
-- portion of a single shift past 9 hours.
create table if not exists time_loadings (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  employment_category text not null check (employment_category in ('ft_pt', 'casual')),
  days smallint[] not null default '{}',  -- 0 = Sunday .. 6 = Saturday
  start_time time not null default '00:00',
  end_time time not null default '24:00',
  percentage numeric(6, 2) not null check (percentage > 0),
  is_public_holiday boolean not null default false,
  is_overtime boolean not null default false
);

insert into time_loadings (label, employment_category, days, start_time, end_time, percentage, is_public_holiday, is_overtime)
select * from (values
  ('Before 7am (Mon-Sat)',   'ft_pt',  array[1,2,3,4,5,6]::smallint[], '00:00'::time, '07:00'::time, 146::numeric, false, false),
  ('Weekday ordinary',       'ft_pt',  array[1,2,3,4,5]::smallint[],   '07:00'::time, '18:00'::time, 100::numeric, false, false),
  ('Weekday evening',        'ft_pt',  array[1,2,3,4,5]::smallint[],   '18:00'::time, '23:00'::time, 122::numeric, false, false),
  ('Saturday ordinary',      'ft_pt',  array[6]::smallint[],           '07:00'::time, '23:00'::time, 122::numeric, false, false),
  ('Sunday before 9am',      'ft_pt',  array[0]::smallint[],           '00:00'::time, '09:00'::time, 195::numeric, false, false),
  ('Sunday ordinary',        'ft_pt',  array[0]::smallint[],           '09:00'::time, '23:00'::time, 150::numeric, false, false),
  ('Public holiday',         'ft_pt',  '{}'::smallint[],               '00:00'::time, '24:00'::time, 220::numeric, true,  false),
  ('Overtime (after 9h)',    'ft_pt',  '{}'::smallint[],               '00:00'::time, '24:00'::time, 150::numeric, false, true),

  ('Before 7am (Mon-Sat)',   'casual', array[1,2,3,4,5,6]::smallint[], '00:00'::time, '07:00'::time, 170::numeric, false, false),
  ('Weekday ordinary',       'casual', array[1,2,3,4,5]::smallint[],   '07:00'::time, '18:00'::time, 122::numeric, false, false),
  ('Weekday evening',        'casual', array[1,2,3,4,5]::smallint[],   '18:00'::time, '23:00'::time, 146::numeric, false, false),
  ('Saturday ordinary',      'casual', array[6]::smallint[],           '07:00'::time, '23:00'::time, 146::numeric, false, false),
  ('Sunday before 9am',      'casual', array[0]::smallint[],           '00:00'::time, '09:00'::time, 220::numeric, false, false),
  ('Sunday ordinary',        'casual', array[0]::smallint[],           '09:00'::time, '23:00'::time, 170::numeric, false, false),
  ('Public holiday',         'casual', '{}'::smallint[],               '00:00'::time, '24:00'::time, 245::numeric, true,  false),
  ('Overtime (after 9h)',    'casual', '{}'::smallint[],               '00:00'::time, '24:00'::time, 170::numeric, false, true)
) as seed(label, employment_category, days, start_time, end_time, percentage, is_public_holiday, is_overtime)
where not exists (select 1 from time_loadings);

-- Empty to start — add WA public holiday dates as they're gazetted each
-- year. A shift on a date in here is costed at the public-holiday rate
-- regardless of what day of the week it falls on.
create table if not exists public_holidays (
  date date primary key,
  name text not null
);
