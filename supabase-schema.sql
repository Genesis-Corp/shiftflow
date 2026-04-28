-- ShiftFlow Database Schema
-- Run this in your Supabase SQL editor to create all required tables.

-- 1. Departments
create table if not exists departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  requires_supervisor boolean not null default false,
  created_at timestamptz default now()
);

-- 2. Staff
create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  age_group text not null check (age_group in ('junior', 'senior')),
  role_type text not null check (role_type in ('department_only', 'all_rounder', 'potential_all_rounder')),
  reliability_score integer not null default 50 check (reliability_score between 0 and 100),
  active boolean not null default true,
  phone text,
  created_at timestamptz default now()
);

-- 3. Staff ↔ Department assignments
create table if not exists staff_departments (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete cascade,
  department_id uuid not null references departments(id) on delete cascade,
  training_level text not null default 'trained' check (training_level in ('supervised', 'trained', 'advanced')),
  unique(staff_id, department_id)
);

-- 4. Shifts
create table if not exists shifts (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  start_time time not null,
  end_time time not null,
  department_id uuid not null references departments(id) on delete cascade,
  required_role text not null default 'any' check (required_role in ('junior', 'senior', 'any')),
  status text not null default 'open' check (status in ('open', 'covered', 'cancelled')),
  assigned_staff_id uuid references staff(id) on delete set null,
  has_break boolean not null default false,
  break_duration_minutes integer not null default 0,
  notes text,
  created_at timestamptz default now()
);

-- 5. Availability templates (weekly recurring)
create table if not exists availability_templates (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete cascade,
  day_of_week integer not null check (day_of_week between 0 and 6), -- 0 = Sunday
  start_time time not null,
  end_time time not null,
  available boolean not null default true,
  unique(staff_id, day_of_week)
);

-- 6. Reliability incidents
create table if not exists reliability_incidents (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete cascade,
  incident_type text not null check (incident_type in ('no_show', 'no_answer', 'rejected', 'covered')),
  shift_id uuid references shifts(id) on delete set null,
  date date not null,
  notes text,
  created_at timestamptz default now()
);

-- Row Level Security (optional, enable when ready for production)
-- alter table staff enable row level security;
-- alter table departments enable row level security;
-- etc.
