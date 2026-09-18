-- Manager profiles (name + phone, filled in by the manager themselves after
-- accepting their invite — Supabase Auth only asks for a password), store
-- settings (country/state, for auto-generating the public holiday calendar),
-- tiered overtime with per-category override protection, and which manager
-- started a claim race.
--
-- Safe to run more than once.

create table if not exists manager_profiles (
  user_id uuid primary key,
  name text,
  phone text,
  phone_e164 text,
  updated_at timestamptz not null default now()
);

-- Country/state drive the auto-generated public holiday calendar (date-holidays
-- covers 200+ countries with state/province-level rules — real gazetted dates,
-- not hand-rolled ones). Single row, id fixed to 'current'.
create table if not exists store_settings (
  id text primary key default 'current',
  country text,
  state text,
  updated_at timestamptz not null default now()
);

insert into store_settings (id, country, state)
select 'current', 'AU', 'WA'
where not exists (select 1 from store_settings);

-- Which manager started this race — for the "Hey it's [Name]" message and
-- any future manager-scoped routing.
alter table shift_claim_races add column if not exists started_by uuid;

-- ── Overtime, pulled out of time_loadings into its own tiered structure ────
--
-- "First 3 hours of overtime at 1.5x, everything past that at 2x" needs more
-- than one flat percentage per employment category — tier_order 1 always
-- starts at hours_into_overtime = 0 (the moment overtime begins); a second
-- tier at hours_into_overtime = 3 takes over for hours 3+ into overtime, etc.
create table if not exists overtime_tiers (
  id uuid primary key default gen_random_uuid(),
  employment_category text not null check (employment_category in ('ft_pt', 'casual')),
  tier_order smallint not null,
  hours_into_overtime numeric not null check (hours_into_overtime >= 0),
  percentage numeric(6, 2) not null check (percentage > 0)
);

-- Migrate the existing flat overtime rows (from 20260919) into a single tier
-- each, then retire them from time_loadings.
insert into overtime_tiers (employment_category, tier_order, hours_into_overtime, percentage)
select tl.employment_category, 1, 0, tl.percentage
from time_loadings tl
where tl.is_overtime = true
  and not exists (
    select 1 from overtime_tiers ot
    where ot.employment_category = tl.employment_category and ot.tier_order = 1
  );

delete from time_loadings where is_overtime = true;
alter table time_loadings drop column if exists is_overtime;

-- Which named rate category a time_loadings row belongs to, so overtime's
-- override checklist can refer to "Sunday" without caring that it's really
-- two rows (before 9am + ordinary) per employment category.
alter table time_loadings add column if not exists category_group text;
update time_loadings set category_group = case
  when is_public_holiday then 'public_holiday'
  when label ilike '%sunday%' then 'sunday'
  when label ilike '%saturday%' then 'saturday'
  when label ilike '%evening%' then 'evening'
  when label ilike '%before%' then 'before_open'
  else 'weekday'
end
where category_group is null;

-- Whether overtime is allowed to override a given rate category. No row for
-- a category = overtime competes normally (the higher percentage wins, same
-- as everything else). A row with overridable = false means that category's
-- rate always wins over overtime for those hours, whichever number is
-- bigger — Sunday rates historically aren't replaced by overtime here.
create table if not exists overtime_overrides (
  category_group text primary key,
  label text not null,
  overridable boolean not null default false
);

insert into overtime_overrides (category_group, label, overridable)
select 'sunday', 'Sunday Rates', false
where not exists (select 1 from overtime_overrides);
