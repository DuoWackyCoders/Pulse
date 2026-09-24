-- ============================================
-- TEAMMATES: lets a company admin add a second (or third...) person to
-- their company, and see who's already on it.
--
-- Inviting only works if that person has ALREADY signed up for PULSE with
-- that exact email — there's no way for the app to safely send its own
-- invite email or read someone's email address directly (auth.users isn't
-- exposed to the app at all; these functions are the one deliberate,
-- narrow window into it, and only for an org's own admin, about people
-- already IN that org or being added to it).
-- ============================================

-- Returns: 'added', 'not_found' (nobody's signed up with that email yet),
-- or 'already_member'. Raises an error if the caller isn't that company's
-- admin — checked directly here rather than relying on the RLS insert
-- policy alone, so a clear reason comes back instead of a generic
-- permission failure.
create or replace function invite_teammate(target_org_id uuid, teammate_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
  existing_role text;
begin
  if not is_org_admin(target_org_id) then
    raise exception 'Only an admin of this company can invite someone.';
  end if;

  select id into target_user_id from auth.users where lower(email) = lower(teammate_email) limit 1;
  if target_user_id is null then
    return 'not_found';
  end if;

  select role into existing_role from memberships where org_id = target_org_id and user_id = target_user_id;
  if existing_role is not null then
    return 'already_member';
  end if;

  insert into memberships (org_id, user_id, role) values (target_org_id, target_user_id, 'provider');
  return 'added';
end;
$$;

grant execute on function invite_teammate(uuid, text) to authenticated;

-- Returns each member's id, email, and role — memberships alone doesn't
-- have anywhere to show a person's email from (same auth.users boundary
-- as above), so this fills that in for the admin viewing their own team.
create or replace function list_org_members(target_org_id uuid)
returns table(user_id uuid, email text, role text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_org_admin(target_org_id) then
    raise exception 'Only an admin can view company members.';
  end if;
  return query
    select m.user_id, u.email::text, m.role
    from memberships m
    join auth.users u on u.id = m.user_id
    where m.org_id = target_org_id
    order by m.role, u.email;
end;
$$;

grant execute on function list_org_members(uuid) to authenticated;

-- ============================================
-- "VIEWING AS" a teammate: lets an admin add or edit a patient/schedule
-- day on a teammate's behalf while viewing the app as them, so it's
-- correctly attributed to that teammate, not the admin.
--
-- The existing insert rules for patients and schedule_days only ever let
-- someone create a row assigned to THEMSELVES (assigned_to = auth.uid()) —
-- deliberately, from when this was first built, so a technician can add
-- their own data without an admin's involvement. That's still true here;
-- this only ADDS a second way in, just for an org's own admin, and only
-- ever pointed at an actual member of that same (non-suspended) org —
-- never an arbitrary person.
-- ============================================
create or replace function user_is_org_member(check_org_id uuid, check_user_id uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from memberships where org_id = check_org_id and user_id = check_user_id);
$$;

drop policy "Add a customer to your own org, assigned to yourself" on patients;
create policy "Add a customer to your own org, assigned to yourself" on patients
  for insert with check (
    (is_org_member_active(org_id) and assigned_to = auth.uid())
    or (is_org_admin_active(org_id) and user_is_org_member(org_id, assigned_to))
  );

drop policy "Add your own schedule day" on schedule_days;
create policy "Add your own schedule day" on schedule_days
  for insert with check (
    (is_org_member_active(org_id) and assigned_to = auth.uid())
    or (is_org_admin_active(org_id) and user_is_org_member(org_id, assigned_to))
  );
