-- ShiftFlow — Claim Race PATCH
--
-- Run this ONLY if you already created shift_claim_races, shift_claim_recipients
-- and sms_messages from the abbreviated snippet in chat. It brings those tables
-- up to what the application code expects.
--
-- It adds things only; no table is dropped and no data is deleted. Safe to
-- re-run. If you have NOT created those tables yet, ignore this file and run
-- supabase-claim-race.sql instead.

-- ---------------------------------------------------------------------------
-- 1. Missing columns
-- ---------------------------------------------------------------------------
alter table shift_claim_races
  add column if not exists cancelled_at timestamptz;

alter table shift_claim_recipients
  add column if not exists computed_score integer,
  add column if not exists send_error     text,
  add column if not exists provider_sid   text,
  add column if not exists response_body  text,
  add column if not exists created_at     timestamptz not null default now();

alter table sms_messages
  add column if not exists kind         text,
  add column if not exists mode         text,
  add column if not exists intended_for text;

alter table staff
  add column if not exists phone_e164  text,
  add column if not exists sms_opt_out boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. Tighten nullability to match the application's assumptions.
--    Skipped automatically if existing rows would violate it, so this cannot
--    fail on a database that already has data.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from shift_claim_races where created_at is null) then
    alter table shift_claim_races alter column created_at set not null;
    alter table shift_claim_races alter column created_at set default now();
  end if;

  if not exists (select 1 from sms_messages where body is null) then
    alter table sms_messages alter column body set not null;
  end if;

  if not exists (select 1 from sms_messages where created_at is null) then
    alter table sms_messages alter column created_at set not null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Missing CHECK constraints
--    Added NOT VALID then validated, so a bad existing row reports itself
--    instead of silently blocking the migration.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shift_claim_races_mode_check') then
    alter table shift_claim_races add constraint shift_claim_races_mode_check
      check (mode in ('console', 'redirect', 'live')) not valid;
    alter table shift_claim_races validate constraint shift_claim_races_mode_check;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'shift_claim_recipients_send_status_check') then
    alter table shift_claim_recipients add constraint shift_claim_recipients_send_status_check
      check (send_status in ('queued', 'sent', 'failed', 'skipped_no_phone', 'skipped_opted_out')) not valid;
    alter table shift_claim_recipients validate constraint shift_claim_recipients_send_status_check;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'shift_claim_recipients_outcome_check') then
    alter table shift_claim_recipients add constraint shift_claim_recipients_outcome_check
      check (outcome in ('won', 'lost', 'declined', 'no_response')) not valid;
    alter table shift_claim_recipients validate constraint shift_claim_recipients_outcome_check;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Missing indexes
--    The one-active-race-per-shift index is the important one: without it two
--    managers clicking at the same moment start two races for the same shift.
--    The unique indexes you already created (claim_code where outcome is null,
--    and provider_sid) are equivalent to the reference schema's, so they are
--    deliberately not recreated under different names.
-- ---------------------------------------------------------------------------
create index if not exists shift_claim_races_shift_idx  on shift_claim_races (shift_id);
create index if not exists shift_claim_races_status_idx on shift_claim_races (status);
create unique index if not exists shift_claim_races_one_active_per_shift
  on shift_claim_races (shift_id) where status = 'active';

create index if not exists shift_claim_recipients_race_idx  on shift_claim_recipients (race_id);
create index if not exists shift_claim_recipients_phone_idx on shift_claim_recipients (phone_e164);

create index if not exists sms_messages_race_idx    on sms_messages (race_id, created_at desc);
create index if not exists sms_messages_created_idx on sms_messages (created_at desc);

create index if not exists staff_phone_e164_idx on staff (phone_e164);

-- ---------------------------------------------------------------------------
-- 5. The atomic claim — the single most important piece.
--    Returns a row ONLY to the first caller. Postgres serialises the UPDATE at
--    row level, so two simultaneous YES replies cannot both win.
--    Without this function every claim fails with "function does not exist".
--
--    SETOF is essential. A function declared `returns shift_claim_races`
--    returns ONE ROW OF NULLS when the UPDATE matches nothing, which arrives
--    at the client as a truthy object — so every late replier would be told
--    they won. SETOF returns zero rows instead.
-- ---------------------------------------------------------------------------
-- Dropped first: CREATE OR REPLACE cannot change a function's return type,
-- so replacing an earlier non-SETOF version would fail without this.
drop function if exists claim_shift_race(uuid, uuid);

create function claim_shift_race(p_race_id uuid, p_staff_id uuid)
returns setof shift_claim_races
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
-- 6. Backfill phone_e164 from existing AU mobile numbers
-- ---------------------------------------------------------------------------
update staff
set phone_e164 = '+61' || substring(regexp_replace(phone, '[^0-9]', '', 'g') from 2)
where phone_e164 is null and phone is not null
  and regexp_replace(phone, '[^0-9]', '', 'g') ~ '^04[0-9]{8}$';

update staff
set phone_e164 = '+' || regexp_replace(phone, '[^0-9]', '', 'g')
where phone_e164 is null and phone is not null
  and regexp_replace(phone, '[^0-9]', '', 'g') ~ '^614[0-9]{8}$';

update staff
set phone_e164 = '+61' || regexp_replace(phone, '[^0-9]', '', 'g')
where phone_e164 is null and phone is not null
  and regexp_replace(phone, '[^0-9]', '', 'g') ~ '^4[0-9]{8}$';

-- ---------------------------------------------------------------------------
-- 7. Row Level Security
--    The anon key ships to every browser. Until this runs, anyone who opens
--    devtools on the deployed app can read and write staff names and mobile
--    numbers. API routes use the service-role key, which bypasses RLS.
--    With RLS on and no policies, anon and authenticated are denied everything.
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
