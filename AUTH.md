# Authentication

Every page and every API route (except Twilio's webhook) now requires a
signed-in manager. No new environment variables — this reuses
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY`, which were already required.

## Creating the first account

There is no seeded account and no dashboard step required. Visit `/login` on
the deployment — since no account exists yet, it shows **"set up the first
account"** instead of a sign-in form. Enter your email and a password (8+
characters) and you're in.

That bootstrap form (`/api/auth/bootstrap`) permanently disables itself the
moment one account exists — it checks live against Supabase Auth on every
call, not a cached flag, so it can't be tricked into running twice. Every
account after the first is created only through an invite (below).

## Adding more managers

From the **Managers** page (visible once signed in): enter an email, click
**Send invite**. Supabase emails them a link to set their own password —
nobody's password is ever typed into this app or shared over chat. They
appear in the list as "Invited, hasn't signed in yet" until they complete it.

Removing a manager (trash icon) revokes their access immediately. You can't
remove your own account from the UI — that's deliberate, so a solo manager
can't lock themselves out by mis-click. Do that from the Supabase dashboard
directly if it's ever needed.

## How it's enforced (two layers, not one)

**`src/middleware.ts`** runs on every request. For a page (`/staff`,
`/cover-shift`, ...), no session means a redirect to `/login?next=<path>`.
For anything under `/api/`, middleware does *not* redirect — a 307 there
would make a `fetch()` call silently follow the redirect and receive the
login page's HTML with a 200 status instead of a 401, which `fetchJson()`
(and therefore every page's error banner) has no way to detect. Confirmed by
testing directly: middleware behavior differs from a hunch on this one,
verified with a real build.

**`requireUser()`** (`src/lib/auth.ts`) is called at the top of every
protected API route independently. This is the real boundary, not a backup —
a request crafted to hit `/api/staff` directly (curl, a script, or the
`NEXT_PUBLIC_SUPABASE_ANON_KEY` extracted from the public bundle, which is
unavoidably public by design) is refused with a clean `401 {"error":"Not
signed in"}` regardless of what middleware did or didn't catch.

`/api/sms/inbound` is the one deliberate exception — Twilio has no user
session, and is verified instead by its own HMAC signature check
(`validateTwilioSignature`), not by being logged in.

## One thing this doesn't fix by itself

This gates the *app*. It does not, on its own, restrict what the
`NEXT_PUBLIC_SUPABASE_ANON_KEY` can do if someone extracts it from the public
JS bundle and queries Supabase directly, bypassing this app entirely — that
requires Row Level Security to be enabled on the database, which is currently
off (see the branch-reconciliation note in the project history). Auth and RLS
are two different locks; this document only covers the first one.
