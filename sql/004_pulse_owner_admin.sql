-- ============================================
-- PULSE-OWNER ADMIN LAYER ("Master Pulse")
-- A privileged view completely separate from any one company's admin role
-- — only for you, the person running PULSE itself, not any company's
-- owner. It can suspend a company, shut the whole site down for
-- maintenance, and see feedback across every company — but deliberately
-- CANNOT see patient data, schedules, or anything else that belongs to a
-- company. That boundary is enforced at the database level, the same way
-- every other boundary in this app is, not just by hiding a button.
-- ============================================

-- Who is a Pulse owner. Deliberately has NO insert/update/delete policy —
-- the only way a row is ever added here is you, running SQL directly in
-- the Supabase SQL Editor (see the very bottom of this file). No bug in
-- the app, and no compromised app account, can ever grant this to anyone.
create table pulse_owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);
alter table pulse_owners enable row level security;

create or replace function is_pulse_owner()
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from pulse_owners where user_id = auth.uid());
$$;

create policy "Pulse owners can see the owners list" on pulse_owners
  for select using ( is_pulse_owner() );

-- Lets a Pulse owner suspend a company (locks its members out everywhere
-- below, without deleting anything) and see every company that exists.
alter table organizations add column suspended boolean not null default false;
alter table organizations add column suspended_reason text;

create policy "Pulse owners view every organization" on organizations
  for select using ( is_pulse_owner() );
create policy "Pulse owners suspend or reinstate organizations" on organizations
  for update using ( is_pulse_owner() ) with check ( is_pulse_owner() );

create policy "Pulse owners view every membership" on memberships
  for select using ( is_pulse_owner() );

-- Same feedback table from sql/003 — this ADDS a policy letting a Pulse
-- owner see and resolve EVERY company's feedback, alongside (not instead
-- of) the existing per-company admin policies.
create policy "Pulse owners view all feedback" on feedback
  for select using ( is_pulse_owner() );
create policy "Pulse owners update any feedback" on feedback
  for update using ( is_pulse_owner() ) with check ( is_pulse_owner() );

-- The sitewide "kill switch" and its message — one row, always the same
-- id, so the app just reads/updates that single row.
create table platform_settings (
  id text primary key default 'main',
  maintenance_mode boolean not null default false,
  maintenance_message text not null default 'PULSE is temporarily down for maintenance — please check back soon.',
  updated_at timestamptz default now()
);
insert into platform_settings (id) values ('main');
alter table platform_settings enable row level security;

create policy "Anyone logged in can check maintenance status" on platform_settings
  for select using ( auth.uid() is not null );
create policy "Pulse owners control platform settings" on platform_settings
  for update using ( is_pulse_owner() ) with check ( is_pulse_owner() );

-- ============================================
-- Enforce a suspended company's lockout at the database itself. These
-- REPLACE the "an org admin can touch anything in their org / a provider
-- can touch their own assigned rows" checks on patients, schedule_days,
-- and feedback with versions that also require the company not be
-- suspended — so suspending a company locks out its admin too, instantly,
-- everywhere, even through a direct API call that never goes through the
-- app's own screens.
-- ============================================
create or replace function is_org_member_active(check_org_id uuid)
returns boolean language sql security definer set search_path = public as $$
  select is_org_member(check_org_id)
    and not coalesce((select suspended from organizations where id = check_org_id), true);
$$;

create or replace function is_org_admin_active(check_org_id uuid)
returns boolean language sql security definer set search_path = public as $$
  select is_org_admin(check_org_id)
    and not coalesce((select suspended from organizations where id = check_org_id), true);
$$;

drop policy "View allowed customers" on patients;
create policy "View allowed customers" on patients
  for select using ( is_org_admin_active(org_id) or (assigned_to = auth.uid() and is_org_member_active(org_id)) );
drop policy "Add a customer to your own org, assigned to yourself" on patients;
create policy "Add a customer to your own org, assigned to yourself" on patients
  for insert with check ( is_org_member_active(org_id) and assigned_to = auth.uid() );
drop policy "Update allowed customers" on patients;
create policy "Update allowed customers" on patients
  for update
  using ( is_org_admin_active(org_id) or (assigned_to = auth.uid() and is_org_member_active(org_id)) )
  with check ( is_org_admin_active(org_id) or (assigned_to = auth.uid() and is_org_member_active(org_id)) );
drop policy "Delete allowed customers" on patients;
create policy "Delete allowed customers" on patients
  for delete using ( is_org_admin_active(org_id) or (assigned_to = auth.uid() and is_org_member_active(org_id)) );

drop policy "View allowed schedule days" on schedule_days;
create policy "View allowed schedule days" on schedule_days
  for select using ( is_org_admin_active(org_id) or (assigned_to = auth.uid() and is_org_member_active(org_id)) );
drop policy "Add your own schedule day" on schedule_days;
create policy "Add your own schedule day" on schedule_days
  for insert with check ( is_org_member_active(org_id) and assigned_to = auth.uid() );
drop policy "Update allowed schedule days" on schedule_days;
create policy "Update allowed schedule days" on schedule_days
  for update
  using ( is_org_admin_active(org_id) or (assigned_to = auth.uid() and is_org_member_active(org_id)) )
  with check ( is_org_admin_active(org_id) or (assigned_to = auth.uid() and is_org_member_active(org_id)) );
drop policy "Delete allowed schedule days" on schedule_days;
create policy "Delete allowed schedule days" on schedule_days
  for delete using ( is_org_admin_active(org_id) or (assigned_to = auth.uid() and is_org_member_active(org_id)) );

drop policy "Submit feedback for your own org" on feedback;
create policy "Submit feedback for your own org" on feedback
  for insert with check ( is_org_member_active(org_id) and submitted_by = auth.uid() );
drop policy "Admins view their org's feedback" on feedback;
create policy "Admins view their org's feedback" on feedback
  for select using ( is_org_admin_active(org_id) );
drop policy "Admins update their org's feedback" on feedback;
create policy "Admins update their org's feedback" on feedback
  for update using ( is_org_admin_active(org_id) ) with check ( is_org_admin_active(org_id) );
drop policy "Admins delete their org's feedback" on feedback;
create policy "Admins delete their org's feedback" on feedback
  for delete using ( is_org_admin_active(org_id) );

-- ============================================
-- LAST STEP — run this separately, AFTER everything above succeeds.
-- Uncomment it, put in the exact email you log into PULSE with, then run
-- just this part on its own. This is the ONLY way Master Pulse access is
-- ever granted — it can never be done from inside the app itself.
-- ============================================
-- insert into pulse_owners (user_id)
-- select id from auth.users where email = 'your-email@example.com';
