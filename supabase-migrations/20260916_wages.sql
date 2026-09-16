-- Wage rates and penalty loadings, so the Cover Shift flow can show a manager
-- what each available person would cost for a given shift and let them pick
-- on price as well as suitability.
--
-- Required for the wage table on the Managers page.
--
-- RLS is disabled project-wide right now and every access goes through the
-- service-role client, so no policies are added here — same as every other
-- table in this schema.

-- One rate per person. The rate stored is what they actually get paid, so a
-- casual's rate already includes their casual loading — the penalty rules
-- below are applied on top of this, never a second casual loading.
create table if not exists staff_wages (
  staff_id uuid primary key references staff(id) on delete cascade,
  base_hourly_rate numeric(10, 2) not null check (base_hourly_rate >= 0),
  updated_at timestamptz not null default now()
);

-- When a loading applies and how much. Two rules covering the same minute do
-- not stack: the higher multiplier wins, which is how the award reads (a
-- Saturday evening is paid the Saturday rate, not Saturday x evening).
create table if not exists penalty_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Days of week this applies to, 0 = Sunday .. 6 = Saturday.
  days smallint[] not null default '{}',
  start_time time not null default '00:00',
  end_time time not null default '24:00',
  multiplier numeric(4, 2) not null check (multiplier > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- PLACEHOLDER RATES — these are ordinary General Retail Award shapes, not
-- Farmer Jack's actual agreement. Check every one against the real agreement
-- on the Managers page before anybody picks a shift on price: a wrong
-- multiplier here produces a wrong cost, and the whole point of showing cost
-- is that someone acts on it.
insert into penalty_rules (name, days, start_time, end_time, multiplier)
select * from (values
  ('Saturday',         array[6]::smallint[],         '00:00'::time, '24:00'::time, 1.25),
  ('Sunday',           array[0]::smallint[],         '00:00'::time, '24:00'::time, 1.50),
  ('Weekday evening',  array[1,2,3,4,5]::smallint[], '18:00'::time, '24:00'::time, 1.25)
) as seed(name, days, start_time, end_time, multiplier)
where not exists (select 1 from penalty_rules);
