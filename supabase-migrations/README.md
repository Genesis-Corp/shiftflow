# Database setup

Both files are safe to run more than once, and safe to run in either order.

1. **`../supabase-schema.sql`** — creates every table. Run it on a project that
   has not been set up yet (or after switching to a different Supabase project).
   It uses `create table if not exists`, so it leaves existing data alone.

2. **`20260913_staff_name_parts.sql`** — adds `staff.first_name` and
   `staff.last_name` for the availability sheet's two name columns, and fills
   them in for staff who are already stored. Run it on a project created before
   those columns existed.

Until step 2 has run, syncing a sheet still works — names are stored combined
and the sync says the migration is outstanding.

Paste the file's contents into the Supabase SQL editor (Dashboard → SQL Editor →
New query) and run it.

## If the app shows a database error

Free Supabase projects pause after a week of inactivity, and every page will
report that the database could not be reached until the project is resumed from
the Supabase dashboard. Also check that the deployment's
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` point at the
project you are actually using.
