-- Message Board: manager broadcasts ("urgent"/"general" updates) sent to all
-- staff, a set of departments, or a hand-picked list — separate from the
-- shift-offer SMS flow, so it gets its own table rather than overloading
-- shift_claim_races. Each row is one send: who sent it, what it said, who it
-- targeted, and how many actually went out vs were skipped (no phone number
-- on file, or opted out).
--
-- Safe to run more than once.

create table if not exists message_board_posts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  manager_name text,
  urgency text not null check (urgency in ('urgent', 'general')),
  body text not null,
  target_type text not null check (target_type in ('all', 'departments', 'custom')),
  target_department_ids uuid[],
  target_staff_ids uuid[],
  recipient_count int not null default 0,
  sent_count int not null default 0,
  failed_count int not null default 0,
  skipped_count int not null default 0
);

create index if not exists message_board_posts_created_idx
  on message_board_posts (created_at desc);

alter table message_board_posts enable row level security;
-- No policies, matching every other table in this app (see
-- 20260922_rls_new_tables.sql) — anon and authenticated are denied
-- everything by default; only the service-role key API routes use can
-- read or write.
