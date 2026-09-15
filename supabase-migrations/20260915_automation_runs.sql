-- Records of unattended roster imports (e.g. the Humanforce PDF pipeline),
-- so a manager can see what an automated run did and whether anything in it
-- needs a look, without having to have been watching when it ran.
--
-- Required for the Humanforce automation feature — run this before pointing
-- the automation script at /api/automation/roster-pdf.
--
-- RLS is currently disabled project-wide (see earlier rollback), and every
-- access to this table goes through the service-role client, so no policy
-- is added here — matches every other table right now.

create table if not exists automation_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  roster_date date not null,
  source text not null default 'humanforce',
  departments_applied int not null default 0,
  shifts_created int not null default 0,
  -- Array of { department: string | null, kind: string, message: string }.
  flags jsonb not null default '[]'::jsonb,
  acknowledged_at timestamptz
);

-- The banner only ever queries "not yet acknowledged, newest first" — a
-- partial index keeps that fast without indexing rows nobody looks up again.
create index if not exists automation_runs_unacknowledged_idx
  on automation_runs (created_at desc)
  where acknowledged_at is null;
