-- ShiftFlow — Claim Race + security migration
-- Run this in the Supabase SQL editor AFTER supabase-schema.sql.
-- Safe to re-run: every statement is idempotent.

-- ---------------------------------------------------------------------------
-- 1. Staff additions: normalised phone + SMS opt-out
-- ---------------------------------------------------------------------------
alter table staff add column if not exists phone_e164 text;
alter table staff add column if not exists sms_opt_out boolean not null default false;

comment on column staff.phone_e164 is
  'Phone normalised to E.164 (+614XXXXXXXX). NULL means the number is missing or unparseable; staff cannot be included in a claim race.';

-- Best-effort backfill of existing AU mobile numbers.
-- Handles: 0433821798 / 0433 821 798 / +61 433 821 798 / 61433821798 / 433821798
update staff
set phone_e164 = '+61' || substring(regexp_replace(phone, '[^0-9]', '', 'g') from 2)
where phone_e164 is null
  and phone is not null
  and regexp_replace(phone, '[^0-9]', '', 'g') ~ '^04[0-9]{8}$';

update staff
set phone_e164 = '+' || regexp_replace(phone, '[^0-9]', '', 'g')
where phone_e164 is null
  and phone is not null
  and regexp_replace(phone, '[^0-9]', '', 'g') ~ '^614[0-9]{8}$';

update staff
set phone_e164 = '+61' || regexp_replace(phone, '[^0-9]', '', 'g')
where phone_e164 is null
  and phone is not null
  and regexp_replace(phone, '[^0-9]', '', 'g') ~ '^4[0-9]{8}$';

create index if not exists staff_phone_e164_idx on staff (phone_e164);

-- ---------------------------------------------------------------------------
-- 2. Claim races
-- ---------------------------------------------------------------------------
create table if not exists shift_claim_races (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references shifts(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'claimed', 'expired', 'cancelled')),
  winner_staff_id uuid references staff(id) on delete set null,
  mode text not null check (mode in ('console', 'redirect', 'live')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  cancelled_at timestamptz
);

create index if not exists shift_claim_races_shift_idx  on shift_claim_races (shift_id);
create index if not exists shift_claim_races_status_idx on shift_claim_races (status);

-- Only one live race per shift. Partial unique index: completed races are free
-- to accumulate, but a second 'active' race for the same shift is impossible.
create unique index if not exists shift_claim_races_one_active_per_shift
  on shift_claim_races (shift_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- 3. Race recipients (one row per staff member contacted)
-- ---------------------------------------------------------------------------
create table if not exists shift_claim_recipients (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references shift_claim_races(id) on delete cascade,
  staff_id uuid not null references staff(id) on delete cascade,
  claim_code text not null,
  rank integer,
  computed_score integer,
  phone_e164 text,
  send_status text not null default 'queued'
    check (send_status in ('queued', 'sent', 'failed', 'skipped_no_phone', 'skipped_opted_out')),
  send_error text,
  provider_sid text,
  outcome text check (outcome in ('won', 'lost', 'declined', 'no_response')),
  responded_at timestamptz,
  response_body text,
  created_at timestamptz not null default now(),
  unique (race_id, staff_id)
);

create index if not exists shift_claim_recipients_race_idx  on shift_claim_recipients (race_id);
create index if not exists shift_claim_recipients_phone_idx on shift_claim_recipients (phone_e164);

-- A claim code only has to be unique among recipients still in play. Once a
-- race resolves every recipient gets an outcome, releasing the code for reuse.
create unique index if not exists shift_claim_recipients_live_code
  on shift_claim_recipients (claim_code) where outcome is null;

-- ---------------------------------------------------------------------------
-- 4. SMS audit log (every message in and out, including console-mode ones)
-- ---------------------------------------------------------------------------
create table if not exists sms_messages (
  id uuid primary key default gen_random_uuid(),
  race_id uuid references shift_claim_races(id) on delete set null,
  staff_id uuid references staff(id) on delete set null,
  direction text not null check (direction in ('out', 'in')),
  kind text,                       -- offer | covered | winner | too_late | declined_ack | inbound
  to_phone text,
  from_phone text,
  body text not null,
  mode text,
  intended_for text,               -- in redirect mode: who it WOULD have gone to
  provider_sid text,
  status text,                     -- queued | sent | failed | simulated | received
  error text,
  created_at timestamptz not null default now()
);

create index if not exists sms_messages_race_idx    on sms_messages (race_id, created_at desc);
create index if not exists sms_messages_created_idx on sms_messages (created_at desc);

-- Twilio retries a webhook it believes failed. A unique provider_sid makes the
-- second delivery a no-op instead of a duplicate broadcast.
create unique index if not exists sms_messages_provider_sid_uniq
  on sms_messages (provider_sid) where provider_sid is not null;

-- ---------------------------------------------------------------------------
-- 5. Atomic claim
--    Returns the race row ONLY to the first caller. Postgres serialises the
--    UPDATE at row level, so simultaneous replies cannot both win.
-- ---------------------------------------------------------------------------
create or replace function claim_shift_race(p_race_id uuid, p_staff_id uuid)
returns shift_claim_races
language sql
as $$
  update shift_claim_races
  set winner_staff_id = p_staff_id,
      status          = 'claimed',
      claimed_at      = now()
  where id = p_race_id
    and status = 'active'
    and winner_staff_id is null
    and expires_at > now()
  returning *;
$$;

-- ---------------------------------------------------------------------------
-- 6. Row Level Security
--    The anon key ships to every browser, so it must not be able to read staff
--    phone numbers or write anything. All API routes use the service-role key,
--    which bypasses RLS entirely.
-- ---------------------------------------------------------------------------
alter table departments            enable row level security;
alter table staff                  enable row level security;
alter table staff_departments      enable row level security;
alter table shifts                 enable row level security;
alter table availability_templates enable row level security;
alter table reliability_incidents  enable row level security;
alter table shift_claim_races      enable row level security;
alter table shift_claim_recipients enable row level security;
alter table sms_messages           enable row level security;

-- No policies are created. With RLS enabled and zero policies, anon and
-- authenticated are denied everything by default; service_role still bypasses.
-- Add narrower policies here if you later introduce real user logins.
