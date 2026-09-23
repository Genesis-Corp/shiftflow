-- Multi-slot claim races: a shift can now need more than one person (e.g.
-- two checkout staff for a busy Saturday), set via the "How many staff"
-- dropdown on Cover Shift. Every tier keeps working exactly as it already
-- did — asking, batching, escalating — the only change is that the race
-- doesn't close until slots_needed winners have said yes instead of 1.
--
-- Safe to run more than once.

alter table shift_claim_races
  add column if not exists slots_needed int not null default 1 check (slots_needed >= 1);

-- Which of the race's slots this recipient filled (1-based), set only when
-- outcome = 'won'. Assigned atomically inside the claim functions below —
-- slot 1 gets the original open shift; slot 2+ gets its own new shift row
-- (see raceService.ts's onRaceWon), since one `shifts` row only ever models
-- one person's assignment.
alter table shift_claim_recipients
  add column if not exists slot_index int;

-- ---------------------------------------------------------------------------
-- claim_shift_race — the staff-reply path (immediate/sequential/gather's
-- post-window degrade). Dropped first: CREATE OR REPLACE cannot change a
-- function's return type, and this one now returns shift_claim_recipients
-- rows instead of shift_claim_races rows (a race with slots_needed > 1 has
-- no single "the winner" row to hand back).
-- ---------------------------------------------------------------------------
drop function if exists claim_shift_race(uuid, uuid);

create function claim_shift_race(p_race_id uuid, p_staff_id uuid)
returns setof shift_claim_recipients
language plpgsql
as $$
declare
  v_needed int;
  v_filled int;
  v_claimed shift_claim_recipients;
begin
  -- Row lock on the race serialises concurrent claims for it — the same
  -- guarantee the old single-UPDATE version got from folding everything
  -- into one statement's WHERE clause, just expressed explicitly now that
  -- filling a slot takes more than one statement (count, then claim, then
  -- maybe close the race).
  select slots_needed into v_needed from shift_claim_races
    where id = p_race_id and status = 'active' and expires_at > now()
    for update;

  if v_needed is null then
    return; -- not active, expired, or doesn't exist — nothing to claim
  end if;

  select count(*) into v_filled from shift_claim_recipients
    where race_id = p_race_id and outcome = 'won';

  if v_filled >= v_needed then
    return; -- already full — this reply is too late
  end if;

  update shift_claim_recipients
    set outcome = 'won', responded_at = now(), slot_index = v_filled + 1
    where race_id = p_race_id and staff_id = p_staff_id and outcome is null
    returning * into v_claimed;

  if v_claimed.id is null then
    return; -- this staff member has no unresolved recipient row on this race
  end if;

  -- That was the last slot — close the race exactly as the single-winner
  -- version always did.
  if v_filled + 1 >= v_needed then
    update shift_claim_races set status = 'claimed', claimed_at = now()
      where id = p_race_id;
  end if;

  return next v_claimed;
  return;
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_shift_race_recipient — the manager-pick path (gather tier, once the
-- window closes and she's texted a list). Claims by recipient id, since the
-- manager already identified exactly who via the option number in
-- managerReply.ts — not by staff_id/race like the staff-reply path, which
-- matters when several of her races are awaiting a pick at once. If the
-- race still needs more people after this pick, it stays 'awaiting_pick'
-- rather than closing, so she can just reply with another number.
-- ---------------------------------------------------------------------------
drop function if exists claim_shift_race_recipient(uuid, uuid);

create function claim_shift_race_recipient(p_race_id uuid, p_recipient_id uuid)
returns setof shift_claim_recipients
language plpgsql
as $$
declare
  v_needed int;
  v_filled int;
  v_claimed shift_claim_recipients;
begin
  select slots_needed into v_needed from shift_claim_races
    where id = p_race_id and status = 'awaiting_pick'
    for update;

  if v_needed is null then
    return;
  end if;

  select count(*) into v_filled from shift_claim_recipients
    where race_id = p_race_id and outcome = 'won';

  if v_filled >= v_needed then
    return;
  end if;

  update shift_claim_recipients
    set outcome = 'won', responded_at = now(), slot_index = v_filled + 1
    where id = p_recipient_id and race_id = p_race_id and outcome is null
    returning * into v_claimed;

  if v_claimed.id is null then
    return;
  end if;

  if v_filled + 1 >= v_needed then
    update shift_claim_races set status = 'claimed', claimed_at = now()
      where id = p_race_id;
  end if;

  return next v_claimed;
  return;
end;
$$;
