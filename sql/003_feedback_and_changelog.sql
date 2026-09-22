-- ============================================
-- FEEDBACK: bug reports / suggestions clients type in the About tab.
-- Visible only to admins of the SAME company that submitted them — same
-- privacy boundary as patients, so this scales safely if another company
-- ever starts using PULSE.
-- ============================================
create table feedback (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  submitted_by uuid references auth.users(id) on delete set null default auth.uid(),
  message text not null,
  photo_url text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz default now()
);

alter table feedback enable row level security;
create policy "Submit feedback for your own org" on feedback
  for insert with check ( is_org_member(org_id) and submitted_by = auth.uid() );
create policy "Admins view their org's feedback" on feedback
  for select using ( is_org_admin(org_id) );
create policy "Admins update their org's feedback" on feedback
  for update using ( is_org_admin(org_id) ) with check ( is_org_admin(org_id) );
create policy "Admins delete their org's feedback" on feedback
  for delete using ( is_org_admin(org_id) );

-- Storage bucket for feedback photos. Private (not publicly listable) —
-- access is only ever through a signed URL the app requests on your
-- behalf, scoped to the same org rules as the feedback table itself.
insert into storage.buckets (id, name, public)
values ('feedback-photos', 'feedback-photos', false)
on conflict (id) do nothing;

-- Uploaded files are stored at "<org_id>/<filename>" — these policies read
-- that first path segment back out as the org id to check against, the
-- same way every other org-scoped table does it.
create policy "Submit photos for your own org" on storage.objects
  for insert with check (
    bucket_id = 'feedback-photos'
    and is_org_member((storage.foldername(name))[1]::uuid)
  );
create policy "Admins view their org's feedback photos" on storage.objects
  for select using (
    bucket_id = 'feedback-photos'
    and is_org_admin((storage.foldername(name))[1]::uuid)
  );

-- ============================================
-- CHANGELOG: your running "what's new" list, shown in the About tab.
-- Not org-scoped — it's PULSE's own release notes, the same for everyone
-- who uses the app. Anyone logged in can read it; only an admin can post
-- or edit an entry.
-- ============================================
create table changelog (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  media_url text,
  released_at date not null default current_date,
  posted_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz default now()
);

alter table changelog enable row level security;
create policy "Anyone logged in can read the changelog" on changelog
  for select using ( auth.uid() is not null );
create policy "Admins post changelog entries" on changelog
  for insert with check ( exists (select 1 from memberships where user_id = auth.uid() and role = 'admin') );
create policy "Admins edit changelog entries" on changelog
  for update using ( exists (select 1 from memberships where user_id = auth.uid() and role = 'admin') );
create policy "Admins delete changelog entries" on changelog
  for delete using ( exists (select 1 from memberships where user_id = auth.uid() and role = 'admin') );
