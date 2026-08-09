-- ============================================================================
-- 0005 — signup, tenant bootstrap and login lookup (F0.6, F0.7, D29a)
--
-- Everything here is SECURITY DEFINER, and for one reason that is worth stating
-- plainly because it looks alarming otherwise:
--
--   At signup and at login there is no identity yet. `app.current_user_id` is
--   unset, `public.current_user_id()` returns NULL, and every RLS policy in 0002
--   correctly denies. The rows still have to be written and read.
--
-- The alternative would be for the application to hold a role that bypasses RLS.
-- That is strictly worse: a credential that can read every tenant would exist, and
-- the whole tenancy guarantee would rest on nobody ever reusing it. Instead the
-- privileged surface is these four functions, each of which does exactly one thing
-- and takes no parameter that could widen it.
--
-- None of them accepts, computes or compares a password. Hashing lives in
-- src/auth/password.ts, where the cost parameters can be raised without a migration
-- and where a plaintext password cannot end up in the statement log.
-- ============================================================================

-- ─── Signup + tenant bootstrap ──────────────────────────────────────────────
--
-- One transaction, four rows: the user, the agency, the owner membership, the slug
-- reservation. Partial success here would be the worst outcome available — an agency
-- with no owner is unreachable, an owner with no agency cannot be onboarded, and a
-- slug reserved for neither is permanently burned. plpgsql gives it atomicity for
-- free; the point of writing it as one function is that no caller can do three of
-- the four.
--
-- The alias email is passed in rather than derived here, so that the `{DOMAIN}`
-- placeholder (still open question #1) lives in application config and a rename is
-- not a migration.
create or replace function public.bootstrap_agency(
  email_input text,
  password_hash_input text,
  owner_name_input text,
  agency_name_input text,
  slug_input text,
  alias_email_input text
)
returns table (user_id uuid, agency_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_user uuid;
  new_agency uuid;
begin
  if coalesce(email_input, '') = '' or coalesce(password_hash_input, '') = '' then
    raise exception 'bootstrap_agency requires an email and a password hash';
  end if;
  if coalesce(slug_input, '') = '' or coalesce(alias_email_input, '') = '' then
    raise exception 'bootstrap_agency requires a slug and an alias address';
  end if;
  -- The application hashes; a value that is not one of our hashes means a caller has
  -- been wired up wrongly, and storing it would create an account nobody can log in
  -- to and nobody can diagnose.
  if password_hash_input not like 'scrypt$%' then
    raise exception 'password_hash does not look like an application-produced hash';
  end if;

  insert into users (email, password_hash, display_name)
  values (lower(email_input), password_hash_input, owner_name_input)
  returning id into new_user;

  insert into agencies (name, owner_display_name)
  values (agency_name_input, owner_name_input)
  returning id into new_agency;

  -- 'owner', not 'member'. F6.15 excludes members from billing, channel connections
  -- and guardrail configuration, so the first account must be the one that can do
  -- them — otherwise a solo agency locks itself out of its own settings.
  insert into agency_members (agency_id, user_id, role, accepted_at)
  values (new_agency, new_user, 'owner', now());

  insert into agency_slugs (agency_id, slug, alias_email)
  values (new_agency, lower(slug_input), lower(alias_email_input));

  return query select new_user, new_agency;
end $$;

-- ─── Slug availability ──────────────────────────────────────────────────────
--
-- Returns only the taken ones, from a caller-supplied list. It cannot be used to
-- enumerate tenants: you have to already know the slug to learn that it exists, and
-- slugs are public by design — they go in an Instagram bio.
create or replace function public.slugs_taken(candidates text[])
returns table (slug text)
language sql
security definer
set search_path = public
as $$
  select s.slug from agency_slugs s where s.slug = any (candidates);
$$;

-- ─── Login lookup ───────────────────────────────────────────────────────────
--
-- Returns the row whether or not the password will match, because the *application*
-- must do the comparison and must do it in constant time. A function that only
-- returned a row for correct credentials would make the query duration itself the
-- answer.
--
-- Returning no row for an unknown email is unavoidable; the application compensates
-- by hashing a dummy password anyway, so an absent account costs the same wall-clock
-- time as a wrong password (src/auth/login.ts).
create or replace function public.find_user_for_login(email_input text)
returns table (id uuid, password_hash text, display_name text)
language sql
security definer
set search_path = public
as $$
  select u.id, u.password_hash, u.display_name
    from users u
   where u.email = lower(email_input);
$$;

-- Rehash-on-login (see needsRehash in src/auth/password.ts). Narrow on purpose: it
-- takes a user id the caller has just authenticated, and can only write this column.
create or replace function public.update_password_hash(target_user uuid, password_hash_input text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if password_hash_input not like 'scrypt$%' then
    raise exception 'password_hash does not look like an application-produced hash';
  end if;
  update users set password_hash = password_hash_input where id = target_user;
end $$;

grant execute on function public.bootstrap_agency(text, text, text, text, text, text) to app_user;
grant execute on function public.slugs_taken(text[]) to app_user;
grant execute on function public.find_user_for_login(text) to app_user;
grant execute on function public.update_password_hash(uuid, text) to app_user;

-- ─── The agencies a user belongs to ─────────────────────────────────────────
--
-- Not SECURITY DEFINER. This runs *after* login, with an identity set, so RLS does
-- the filtering — which is the arrangement the rest of the product uses and the one
-- a reviewer should see everywhere outside this file.
create or replace function public.my_agencies()
returns table (agency_id uuid, name text, role member_role, slug text)
language sql
stable
as $$
  select a.id, a.name, m.role, s.slug
    from agencies a
    join agency_members m on m.agency_id = a.id
    left join agency_slugs s on s.agency_id = a.id
   where m.user_id = public.current_user_id()
   order by a.created_at;
$$;

grant execute on function public.my_agencies() to app_user;
