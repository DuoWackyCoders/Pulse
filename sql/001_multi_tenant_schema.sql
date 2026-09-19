-- ============================================
-- PULSE multi-tenant schema
-- Run once in the Supabase SQL Editor. Safe to re-read here for reference;
-- this file documents what's already live in the database, it isn't run
-- automatically by anything in the app.
-- ============================================

-- ============================================
-- ORGANIZATIONS: the company/tenant boundary
-- ============================================
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz default now()
);

-- ============================================
-- MEMBERSHIPS: who belongs to which company, and their role
-- ============================================
create table memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'provider')),
  created_at timestamptz default now(),
  unique (org_id, user_id)
);

-- Helper functions RLS policies below rely on. "security definer" means
-- these run with elevated trust internally, which is the standard safe way
-- to let a policy check a table (memberships) without that check itself
-- getting tangled in the very same row-level security it's enforcing.
create or replace function is_org_admin(check_org_id uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from memberships
    where org_id = check_org_id and user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function is_org_member(check_org_id uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from memberships where org_id = check_org_id and user_id = auth.uid()
  );
$$;

alter table organizations enable row level security;
create policy "See orgs you belong to" on organizations
  for select using ( is_org_member(id) );
create policy "Create your own org" on organizations
  for insert with check ( auth.uid() = created_by );
create policy "Admins can rename their org" on organizations
  for update using ( is_org_admin(id) );

alter table memberships enable row level security;
create policy "See memberships in your orgs" on memberships
  for select using ( is_org_member(org_id) );
create policy "Join your own new org, or be added by an admin" on memberships
  for insert with check (
    (user_id = auth.uid() and exists (select 1 from organizations o where o.id = org_id and o.created_by = auth.uid()))
    or is_org_admin(org_id)
  );
create policy "Admins manage roles; members can leave" on memberships
  for update using ( is_org_admin(org_id) );
create policy "Admins remove members; members remove themselves" on memberships
  for delete using ( is_org_admin(org_id) or user_id = auth.uid() );

-- ============================================
-- PATIENTS: org-owned, visible to admins (all) or the assigned provider (own)
-- ============================================
create table patients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  assigned_to uuid references auth.users(id) on delete set null default auth.uid(),
  name text, address text, dob text, coordinator text, provider text,
  last_visit_date date, lat double precision, lng double precision,
  group_label text, manual_group boolean default false, geocode_failed boolean default false,
  extra jsonb default '{}'::jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

alter table patients enable row level security;
create policy "View allowed customers" on patients
  for select using ( is_org_admin(org_id) or assigned_to = auth.uid() );
create policy "Add a customer to your own org, assigned to yourself" on patients
  for insert with check ( is_org_member(org_id) and assigned_to = auth.uid() );
create policy "Update allowed customers" on patients
  for update
  using ( is_org_admin(org_id) or assigned_to = auth.uid() )
  with check ( is_org_admin(org_id) or assigned_to = auth.uid() );
create policy "Delete allowed customers" on patients
  for delete using ( is_org_admin(org_id) or assigned_to = auth.uid() );

-- ============================================
-- SCHEDULE_DAYS: same org + assignment pattern as patients
-- ============================================
create table schedule_days (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  assigned_to uuid references auth.users(id) on delete set null default auth.uid(),
  visit_date date not null,
  stops jsonb not null default '[]'::jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (org_id, assigned_to, visit_date)
);

alter table schedule_days enable row level security;
create policy "View allowed schedule days" on schedule_days
  for select using ( is_org_admin(org_id) or assigned_to = auth.uid() );
create policy "Add your own schedule day" on schedule_days
  for insert with check ( is_org_member(org_id) and assigned_to = auth.uid() );
create policy "Update allowed schedule days" on schedule_days
  for update
  using ( is_org_admin(org_id) or assigned_to = auth.uid() )
  with check ( is_org_admin(org_id) or assigned_to = auth.uid() );
create policy "Delete allowed schedule days" on schedule_days
  for delete using ( is_org_admin(org_id) or assigned_to = auth.uid() );

-- ============================================
-- START_ADDRESSES & USER_SETTINGS: personal, not org-owned
-- (your home base and your theme are yours, regardless of which company)
-- ============================================
create table start_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label text, address text, lat double precision, lng double precision,
  created_at timestamptz default now()
);
alter table start_addresses enable row level security;
create policy "Manage your own addresses" on start_addresses
  for all using ( auth.uid() = user_id ) with check ( auth.uid() = user_id );

create table user_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  theme text default 'light',
  group_size_max integer default 20,
  home_address_id uuid references start_addresses(id) on delete set null,
  standard_work_days jsonb default '[true,true,true,true,true]'::jsonb,
  extra_columns jsonb default '[]'::jsonb,
  practitioner_name text, practitioner_phone text, practitioner_email text,
  updated_at timestamptz default now()
);
alter table user_settings enable row level security;
create policy "Manage your own settings" on user_settings
  for all using ( auth.uid() = user_id ) with check ( auth.uid() = user_id );
