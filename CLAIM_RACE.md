# Claim Race — setup and testing

When a shift needs covering, a **claim race** texts every eligible staff member
at once. The first to reply `YES <code>` gets the shift; everyone else is
immediately told it has been covered.

## Testing ladder

Work down this list. Each rung is strictly safer than the one below it, and the
first two need no Twilio account at all.

### 1. Unit tests — no network, no database

```bash
npm test
```

Covers AU phone normalisation, reply parsing, claim-code generation, Twilio
signature validation (against Twilio's own published example), single-segment
message lengths, and the case you cannot produce by hand: **two staff replying
YES in the same instant**.

### 2. Console mode — nothing leaves the building

```
SMS_MODE=console
```

Start a race from the Cover Shift page. No texts are sent. Instead:

- Every message appears in the **Message log** on the race panel, exactly as it
  would be received.
- Each recipient gets a **Reply YES** / **Reply NO** button that fires the real
  inbound handler — the same code path the Twilio webhook uses.

Click "Reply YES" as one staff member and watch the shift flip to covered and
the "now covered" messages queue for everyone else. Zero cost, zero risk.

### 3. Twilio trial account

A trial account can only send to numbers you have verified. Verify your own
mobile and nothing else: even a bug that tries to text thirty people fails on
the twenty-nine that aren't yours.

### 4. Redirect mode — the real end-to-end test

```
SMS_MODE=redirect
SMS_TEST_NUMBER=+61433821798
```

Messages are genuinely sent through Twilio, but every recipient is rewritten to
`SMS_TEST_NUMBER` and prefixed with who it was for:

```
[TEST -> Dave Smith] Farmer Jack's: shift available Mon 15 Sep 09:00-17:00,
Bakery. Reply YES 4F7K to claim it - first reply wins. Reply STOP to opt out.
```

Ten candidates means ten texts to your phone, each with a **different real
claim code**. Reply `YES 4F7K` from your own handset and the full production
path runs: Twilio webhook, signature validation, atomic claim, broadcast.

This works only because claim codes are per-recipient — every reply arrives
from the same number, so caller ID cannot identify the "sender".

### 5. Live

```
SMS_MODE=live
```

Do a decoy shift with only yourself first, then one colleague who is expecting
it, then open it up. Keep `SMS_ALLOWLIST` populated until the last moment.

## Safety rails (always on, not just in testing)

| Rail | Effect |
|---|---|
| `SMS_ALLOWLIST` | Enforced in every mode, live included. No message reaches a number outside it. |
| `SMS_MAX_RECIPIENTS` | A race above this size is refused. Caps the blast radius. |
| `SMS_QUIET_HOURS` | Races outside these hours are refused unless explicitly forced. |
| Confirmation dialog | Lists every name and number before anything is sent. |
| Mode banner | Always visible, so a test race is never mistaken for a real one. |
| `sms_messages` | Every message in and out is logged, including console-mode ones. |

Use Vercel's per-environment variables so a preview deploy *structurally*
cannot text staff:

- Development → `console`
- Preview → `redirect`
- Production → `redirect` at first, then `live`

## Australian specifics

- `TWILIO_FROM_NUMBER` must be an Australian **mobile** number (`+614…`).
  Australian local/landline numbers cannot carry SMS. Twilio does not offer
  short codes in Australia.
- Buying an AU mobile number requires an approved **Regulatory Bundle** with a
  physical Australian street address (a PO Box is rejected). Allow ~3 business
  days.
- The ACMA **SMS Sender ID Register** (in force since 1 July 2026) applies to
  *alphanumeric* sender IDs only. This app sends from a numeric long code, so
  no ACMA registration is required. An alphanumeric sender would also be unable
  to receive replies, which is why it is not an option here.
- Messages identify the business and offer `STOP`, per the Spam Act 2003.

## How a race resolves

The winner is decided by a single conditional UPDATE in Postgres
(`claim_shift_race` in `supabase-claim-race.sql`):

```sql
update shift_claim_races
set winner_staff_id = $1, status = 'claimed', claimed_at = now()
where id = $2 and status = 'active' and winner_staff_id is null
  and expires_at > now()
returning *;
```

Postgres serialises this at row level, so of two simultaneous replies exactly
one gets a row back. Read-then-write would hand the shift to two people.

A `YES` that arrives after the race is won always gets an answer
("sorry, already covered") rather than silence — silence after an explicit
action is how someone ends up turning up to a shift that isn't theirs.

## Reliability scoring

Only the **winner** is scored automatically (`covered`, +10). Declines and
silence are deliberately *not* scored: turning down an optional extra shift
should not quietly damage someone's record. The manual buttons on the Cover
Shift page remain for judgement calls.

## Setup

1. Run `supabase-schema.sql`, then `supabase-claim-race.sql`, in the Supabase
   SQL editor. The second one enables RLS — after it runs, the anon key can no
   longer read staff data, which is the point.
2. Set the environment variables from `.env.local.example`.
3. Check the Staff page for anyone flagged **No mobile** — they cannot be
   included in a race.
