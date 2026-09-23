-- Extending someone's shift EARLIER (their new start time is before their
-- rostered start time) means asking someone who isn't at the store yet —
-- unlike extending LATER, which a manager can just ask in person since the
-- person is already on shift. So an earlier extension goes through an SMS
-- confirmation instead of applying instantly; this table holds that pending
-- ask. A later-only extension still applies immediately, exactly as before,
-- and never creates a row here.
--
-- Safe to run more than once.

create table if not exists shift_extend_requests (
  id uuid primary key default gen_random_uuid(),
  -- The open shift being folded into staff_id's existing shift. Once
  -- confirmed, existing_shift_id is updated to the merged range and
  -- shift_id itself is deleted — same as the immediate-apply path.
  shift_id uuid not null references shifts(id) on delete cascade,
  staff_id uuid not null references staff(id) on delete cascade,
  existing_shift_id uuid not null references shifts(id) on delete cascade,
  proposed_start_time time not null,
  proposed_end_time time not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'declined', 'expired', 'cancelled')),
  started_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  expires_at timestamptz not null
);

create index if not exists shift_extend_requests_staff_idx
  on shift_extend_requests (staff_id, status);

-- At most one live ask per open shift at a time — clicking "Extend their
-- shift" again while one is already pending is a duplicate text, not a
-- second independent request.
create unique index if not exists shift_extend_requests_one_pending_per_shift
  on shift_extend_requests (shift_id) where status = 'pending';

alter table shift_extend_requests enable row level security;
-- No policies, matching every other table in this app — anon and
-- authenticated are denied everything by default; only the service-role key
-- API routes use can read or write.
