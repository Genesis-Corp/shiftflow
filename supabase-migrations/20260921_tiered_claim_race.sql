-- Wires up the three-tier cover-request design that src/lib/coverTiers.ts
-- already defines and tests (immediate / gather / sequential) into the live
-- claim race, which today ignores tier entirely and always blasts everyone
-- at once, first reply wins.
--
--   immediate  — batches of 2, first yes wins each batch, escalates on
--                5-minute silence or both declining.
--   gather     — everyone asked "are you available?" at once; replies are
--                gathered for a window, then the manager who started the
--                race is texted a numbered list and picks by replying with
--                a number. Degrades to first-yes-wins if nobody's available
--                when the window closes.
--   sequential — one person at a time (cheapest first), a step each.
--
-- Safe to run more than once.

alter table shift_claim_races add column if not exists tier text not null default 'immediate';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shift_claim_races_tier_check') then
    alter table shift_claim_races add constraint shift_claim_races_tier_check
      check (tier in ('immediate', 'gather', 'sequential'));
  end if;
end $$;

-- 'awaiting_pick' = gather tier, window closed, waiting on the manager's
-- numbered reply. Existing statuses (active/claimed/expired/cancelled) are
-- unchanged.
alter table shift_claim_races drop constraint if exists shift_claim_races_status_check;
alter table shift_claim_races add constraint shift_claim_races_status_check
  check (status in ('active', 'claimed', 'expired', 'cancelled', 'awaiting_pick'));

-- Immediate tier: which batch (0-based, ranked pairs) is currently live, and
-- when it times out.
alter table shift_claim_races add column if not exists current_batch smallint;
alter table shift_claim_races add column if not exists batch_deadline timestamptz;

-- Gather tier: when the collection window closes.
alter table shift_claim_races add column if not exists gather_deadline timestamptz;

-- Sequential tier: which ranked candidate (0-based) is currently being
-- asked, and when their step times out.
alter table shift_claim_races add column if not exists sequential_index smallint;
alter table shift_claim_races add column if not exists step_deadline timestamptz;

-- Set once the manager's outcome-only text (immediate/sequential) has gone
-- out, so it's never sent twice for the same race.
alter table shift_claim_races add column if not exists manager_notified_at timestamptz;

-- Gather tier: set once the window has closed with nobody available and the
-- race has switched to first-yes-wins for whoever hasn't declined. Without
-- this marker, re-running the lazy advance step (every page poll) would
-- re-send the same "are you available" offer blast every time, since
-- nothing else about the race's state changes once it degrades.
alter table shift_claim_races add column if not exists degraded_at timestamptz;

-- Gather tier: a staff member's yes/no answer to "are you available?" — kept
-- separate from `outcome`, since answering "available" does not by itself
-- win the shift; only the manager's pick (or a post-window degrade) does.
alter table shift_claim_recipients add column if not exists is_available boolean;

-- Gather tier: the number this recipient was assigned on the manager's
-- numbered list, so their reply ("2") maps back to a specific person.
alter table shift_claim_recipients add column if not exists option_number smallint;

-- What this shift would cost with this person on it, captured at race-start
-- time — needed later (batch advance, manager's numbered list) when only the
-- database row is available, not the original in-memory candidate list.
alter table shift_claim_recipients add column if not exists shift_cost numeric;
