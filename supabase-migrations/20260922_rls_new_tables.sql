-- Row Level Security for every table created this session that never got it.
--
-- The original schema (supabase-schema.sql, supabase-claim-race.sql) enables
-- RLS with zero policies on every table it creates — the anon key ships to
-- every browser, so with RLS on and no policies, anon and authenticated are
-- denied everything by default, and only the service-role key (used by every
-- API route) can read or write. wage_base_rate, age_brackets, time_loadings,
-- public_holidays (20260919) and manager_profiles, store_settings,
-- overtime_tiers, overtime_overrides (20260920) were added without it —
-- meaning, until this runs, anyone with the anon key can read manager phone
-- numbers and wage data straight out of Supabase's REST API, bypassing the
-- app entirely.
--
-- Safe to run more than once.

alter table wage_base_rate     enable row level security;
alter table age_brackets       enable row level security;
alter table time_loadings      enable row level security;
alter table public_holidays    enable row level security;
alter table manager_profiles   enable row level security;
alter table store_settings     enable row level security;
alter table overtime_tiers     enable row level security;
alter table overtime_overrides enable row level security;

-- No policies are added, matching every other table in this app — anon and
-- authenticated are denied everything by default; service_role still
-- bypasses RLS entirely, which is how every API route reads and writes.
