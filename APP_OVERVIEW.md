# ShiftFlow — App Overview

ShiftFlow is Farmer Jack's shift-management tool: staff, departments, the
weekly roster, and the SMS system that fills a shift when someone can't make
it. This doc walks every page and workflow as a manager encounters them. For
setup/testing rather than usage, see `AUTH.md` and `CLAIM_RACE.md`.

Everything here requires a signed-in manager — see **Settings & Access**
below for how accounts get created.

## Pages at a glance

| Page | Route | What it's for |
|---|---|---|
| Dashboard | `/` | Store-wide stats, who needs attention, open shifts |
| Shifts | `/shifts` | Create/edit/cancel shifts, three views, roster import |
| Cover Shift | `/cover-shift` | Run the SMS claim race for an open shift |
| Availability | `/availability` | Weekly availability templates, time off |
| Staff | `/staff` | Add/edit staff, training, CSV import, availability-sheet sync |
| Departments | `/departments` | Departments, colors, supervisor requirement |
| Reliability | `/reliability` | Incident log, reliability scores |
| Settings | `/settings` | Manager invites, store config, wages, overtime |

---

## Staff

**Add/Edit staff** (`/staff`, "Add Staff Member" modal): name, age group
(senior 18+ / junior under-18), phone, birthday, employment type
(casual/part-time/full-time/salary), commencement date. Commencement date
only matters for 20–21 year olds, where pay steps from 90% to 100% of the
adult rate at 6 months' service — everything else about pay is computed
automatically from birthday + employment type + the store's base rate.

**Role type is never set by hand.** It's a read-only badge computed live from
the departments a person is trained in:

- **Department Only** — the default, fewer than the thresholds below
- **Potential All Rounder** — trained/advanced in 1–2 departments, plus at
  least one more it's *supervised* in
- **All Rounder** — trained or advanced in 3+ departments

Each assigned department gets a training level — **Supervised**, **Trained**,
or **Advanced** (advanced counts the same as trained for role-type purposes,
it's just a stronger mark) — and one department can be flagged as that
person's default (star icon). Picking a department that `requires_supervisor`
is blocked for junior staff (age group junior).

**CSV import** auto-detects three formats: a "full staff sheet" (`First
Name`/`Last Name`/`Employment Type`/`Default Department`/`Birth
Date`/`Mobile`, matched and updated by name), the raw "availability sheet"
export (`NAME`/`MOBILE #` + one column per weekday), or a plain standard
format (`name, age_group, phone, departments, birthday, employment_type,
commencement_date`). A blank `Default Department` on import falls back to
whichever department is flagged **default** on the Departments page.

**Availability-sheet photo/PDF sync** is the other way staff data gets in —
built for the printed sheet the store already uses. Capture a photo, upload
an image, or upload a PDF; it's read by AI vision into a grid, then compared
against current staff records and shown as a **preview before anything
saves**:

- New staff, field-level changes, and people no longer on the sheet are each
  broken out separately
- Anyone no longer listed can be archived (checked by default) — archiving
  never deletes, and they're **automatically reinstated** if they reappear on
  a later sheet
- Unreadable cells are left unchanged rather than guessed at, and flagged
  under "Needs a look"
- The raw parsed grid is downloadable as CSV so misreads can be fixed by hand
  and re-uploaded

Only name, mobile number, and weekly availability come from the sheet —
department training, reliability, and role type are untouched by a sync.
Mobile numbers are converted to the `+61...` SMS-ready format automatically
regardless of which of these paths they came in through.

**Reveal rate**: an eye icon under each name computes that person's live
ordinary hourly rate (age bracket × time loading × the store's base rate) —
nothing per-person is stored, so it always reflects the current award
settings. Salaried staff show nothing here.

**Archive vs delete**: Archive keeps everything (departments, availability,
history) and can be reinstated instantly. Permanent delete is only reachable
from inside the Archive view and is irreversible.

---

## Departments

Each department has a name, a color (12 presets or a custom hex), and two
checkboxes:

- **Requires Supervisor** — juniors can't be assigned here without a senior
  also on shift; also locks the department out of a junior's training
  options on the Staff page
- **Excluded from Claim Race** — won't appear as a department option when
  starting a claim race from Cover Shift

One department can be flagged **default** (star icon) — that's the fallback
used when a CSV import or sheet sync doesn't specify a department for a new
staff member. Clicking a department card shows everyone assigned to it, with
their reliability and a 7-dot Sun–Sat availability strip.

---

## Shifts

Three views, toggled at the top of `/shifts`:

- **List** — every upcoming shift, grouped by date then department, colored
  by department
- **Daily Timeline** — one day at a time, a row per staff member (plus an
  "Unassigned" row for open shifts), each shift a horizontal bar positioned
  by time of day
- **Past** — same grouping as List, for shifts already gone, most recent
  first

**Create a shift**: date, start/end time, department, required role
(any/senior/junior). The server enforces a minimum shift length and
auto-computes whether a break is required (shifts over 5.5 hours get one) —
every new shift starts as **open**.

**Edit a shift**: same fields, plus assigning a staff member (trained staff
sorted first) — picking someone marks it **covered**, clearing the
assignment reopens it. A cancelled shift stays cancelled from this form. A
separate quick "adjust times" modal handles just a start/end time tweak.

**Called in sick**: reopens every shift that person has *today* (a split
shift across two departments counts as one incident), excludes them from
re-claiming it via Cover Shift, and logs one `no_show` reliability incident.

**Statuses**: `open` (needs covering), `covered`, `cancelled`. Open shifts
that are no longer realistically coverable (under 3 hours to the end of the
shift) are swept off the list automatically. A 🎁 next to an assigned name
means it's their birthday.

**Bulk roster import**: upload a screenshot/PDF of a day's roster (read by
vision into rows) or a shift-definition CSV. The scanned-roster path always
shows a preview — new/matched/unmatched entries, and an option to log
no-shows — before anything is written; the plain CSV shift-import path
writes directly. See **Automation** below for the unattended version of this.

---

## Availability & Time Off

`/availability` has two views over one underlying weekly template per staff
member (day, start/end time, available or not):

- **Editor** — pick a person, tick days on/off with times, or bulk-apply a
  quick preset (6–2, 9–5, 2–10) across Mon–Fri
- **Matrix Overview** — everyone × Sun–Sat at a glance: a green badge with
  their hours if available that day, a red outline if not (no template row,
  or explicitly marked unavailable)

This is the same data the Staff page's photo/PDF sheet sync writes into — a
manager scans the printed sheet from Staff, and the result shows up here.

**Time Off**, a separate section on the same page: request a day off, or
upload a leave form (Farmer Jack's own template or a plain "request day off"
form). A photo/PDF is read automatically for the staff name(s), leave type
and date range to prefill the entry — but the read is only ever a
convenience; the uploaded file itself is always kept as the record, and it's
the saved date range that actually excludes that person from claim races,
not the OCR read.

---

## Cover Shift — the SMS Claim Race

This is the core workflow: an open shift needs a person, and ShiftFlow finds
one by text message. See `CLAIM_RACE.md` for testing/setup detail — this is
the functional summary.

**Who's eligible** — computed fresh every time, never trusted from what the
browser last showed:

- Salaried staff are never candidates
- Junior staff are excluded from anything starting before 3pm on a real
  school day (weekends and seeded school holidays don't count)
- Anyone on leave for that date, or whose department is flagged "excluded
  from claim race," is out
- Whoever it's their birthday is excluded store-wide, any department
- Remaining candidates are ranked cheapest-first (using the same live rate
  the Staff page's "reveal rate" shows), reliability breaking ties; anyone
  who no-showed or called in sick in the last 3 days is pushed to the bottom
  regardless of cost

**How it's asked** depends entirely on how much notice there is when the
manager presses Start — the manager never picks the method:

| Tier | Lead time | How it works |
|---|---|---|
| **Immediate** | under 30 min, or already started | 2 people at a time, first YES wins, 5 min before moving to the next 2 |
| **Gather** | 30 min – 48 hours | everyone eligible texted at once, replies collected for a window (5–120 min, sized by notice), manager picks from who said yes |
| **Sequential** | 48+ hours | one person at a time, cheapest first, 4 hours to answer |

**Every reply resolves one of four ways**: `YES <code>` (wins it outright in
Immediate/Sequential, or marks "available" for the manager to pick from in
Gather), `NO` (declines, moves on immediately), silence (times out the same
as a decline), or `STOP` (opts out — see below). In Gather tier, once the
window closes the manager gets a numbered list by text and replies with a
number to pick.

**Winning a shift** covers it, notifies everyone else it's filled, and
credits the winner's reliability (+10% of their remaining headroom to 100).

**Opting out (`STOP`)** is a real, honored opt-out — required by the Spam
Act and largely enforced by Twilio/the carriers regardless of what the app
does. It:

- Marks that person unreachable by SMS (shown on their staff summary, and on
  the Dashboard's Needs Attention list)
- Logs an **"Opted Out"** reliability incident at **−30%** — the heaviest hit
  of any incident type
- Is reversible two ways: the person texts `START` (or `UNSTOP`/`SUBSCRIBE`)
  themselves, or a manager clears it from the staff summary popup. Neither
  restores the reliability points — like every other incident, it's a mark
  on the record, not something that auto-reverses.

**SMS modes** — set via environment config, shown as a banner rather than a
setting on the page: **console** (nothing actually sent, logged only),
**redirect**/test (real texts sent, but every one redirected to one test
number), **live** (real texts to real phones). An allowlist restricts who
can ever receive a text, in every mode including live. Quiet hours (set on
Settings) defer non-urgent texts — a genuine Immediate-tier no-show still
gets through regardless.

---

## Reliability

`/reliability` tracks attendance and contact behaviour as a 0–100 score per
person, moved by incidents:

| Incident | Effect | Logged how |
|---|---|---|
| No Show | −15% | manually, or automatically via "Called in sick" |
| No Answer | −5% | manually |
| Rejected | −3% | manually |
| Late | −5% | manually, with arrival time |
| Covered (claimed via SMS) | +10% | automatically on a claim-race win |
| Opted Out (SMS) | −30% | automatically on a `STOP` reply |

Every percentage is relative — a bad incident shrinks the *current* score by
that percentage (50 → 43 on a no-show, not straight to 35), so a repeat
pattern compounds down faster than a single incident. A good outcome grows
the *remaining headroom* to 100 the same way, so someone starting low gains
more per good shift than someone already near the top.

The page flags anyone under 40, or with 2+ no-shows, in a dedicated
callout, and lists every incident in a filterable log.

---

## Wages & Overtime

Every rate in the app is computed, never stored per person:

```
rate = adult base rate × age bracket % × time-of-week %
```

Time-of-week rules never stack with each other (the higher one wins);
neither do age brackets. A single shift past 9 hours pays overtime on the
excess, at tiered rates (e.g. 150% for the first 3 hours over, 200% after)
that either compete against or are overridden by the time-of-week rate,
depending on a per-category checkbox in Settings.

- **Base rate**: entered once (Settings → Wages), or read from a photo/PDF/CSV
  of an award wage table — the scan only ever returns a figure to preview,
  never saves directly.
- **Public holidays**: auto-generated from the store's country/state once
  set in Settings.
- **School holidays**: auto-generated where a maintained calendar exists for
  the store's region; otherwise read from a screenshot/PDF of the
  government's term-dates page (again previewed before anything applies) —
  this is what the junior before-3pm claim-race restriction checks against.

---

## Dashboard

Landing page: total/active staff, department count, today's shifts, open
shifts needing cover. Below that:

- **Needs Attention** — active staff missing a phone number, opted out of
  SMS, under the reliability threshold, over the 38-hour weekly cap, or with
  nothing rostered this week
- **High Achievers** — anyone over 80 reliability, ranked
- **Quick Actions** and a short list of the next open shifts

---

## Settings & Access

No public sign-up. The very first account is created via a one-time
"bootstrap" form on `/login` (disables itself the moment one account
exists); every account after that comes from an **invite** sent from
Settings — an email with a link to set their own password. Nobody's
password ever passes through the app. First sign-in, a manager fills in
their own name and mobile number (validated to a real AU mobile) before
they can do anything else.

Settings also holds:

- The manager list (last signed in / never signed in), with instant removal
- **Store settings**: country/state (drives public- and school-holiday
  generation) and quiet hours (defers non-urgent SMS)
- A read-only mirror of the incident log
- The full wages card: base rate, overtime tiers and overrides, public
  holidays, school holidays

---

## Automation

Two unattended, token-authenticated (no manager session) pipelines, separate
from anything a manager clicks through:

- **`automation/roster-pdf`** — takes a whole-store roster PDF (e.g.
  exported from an external rostering system) for one date, reads it the
  same way the manual roster scan does, and **applies every department it
  can match immediately** — no preview, since nobody's watching. Anything it
  can't confidently apply (an unmatched name, an unreadable time) becomes a
  flag instead of a guess, and every run is recorded.
- **`automation/flags`** — the after-the-fact review surface for those
  flagged runs; a manager acknowledges them from here (or the in-app
  banner it feeds).

---

## Import / export reference

| Route | Input | Preview first? |
|---|---|---|
| Staff CSV (`/api/import`) | 3 auto-detected CSV shapes | No — saves directly |
| Availability-sheet scan (Staff page) | Photo / PDF | **Yes** |
| Roster scan (Shifts page) | Photo / PDF of a day's roster | **Yes** |
| Shift-definition CSV (`import-shifts`) | CSV of open shifts | No — saves directly |
| Wage base rate scan | Photo / PDF / CSV | **Yes** |
| School-terms scan | Photo / PDF of a gov't term-dates page | **Yes** |
| Leave form scan | Photo / PDF of a leave form | Convenience only — file is always kept as the record either way |
| Roster PDF automation | Server-to-server, token auth | No — applies what it can, flags the rest |
| Export (`/api/export`) | — | Staff or shifts as CSV |

---

## Related docs

- `AUTH.md` — account setup and environment variables
- `CLAIM_RACE.md` — testing the SMS claim race step by step
