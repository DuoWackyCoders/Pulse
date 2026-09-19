-- ============================================
-- Fixes a chicken-and-egg RLS problem in the "set up your company" screen:
-- creating an organization, then immediately asking the database to read
-- that row back (so the app can use its new ID), fails Row Level Security's
-- SELECT check — at that exact moment the creator isn't a member of the
-- org yet, so the database correctly won't show it to them.
--
-- This bundles "create the company" and "make the caller its admin" into
-- one atomic, all-or-nothing action, so there's no in-between moment where
-- that conflict can happen. security definer lets it run with the
-- database's own trusted permissions internally, while auth.uid() still
-- correctly attributes both new rows to whoever actually called it.
-- ============================================
create or replace function create_organization(org_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
begin
  insert into organizations (name, created_by) values (org_name, auth.uid()) returning id into new_org_id;
  insert into memberships (org_id, user_id, role) values (new_org_id, auth.uid(), 'admin');
  return new_org_id;
end;
$$;

grant execute on function create_organization(text) to authenticated;
