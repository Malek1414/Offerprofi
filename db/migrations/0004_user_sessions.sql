-- ============================================================================
-- 0004 — staff sessions (D29a)
--
-- Needed because D15 moved to plain Postgres and the platform no longer supplies
-- auth. Agency staff only; customers have no accounts (D11) and reach everything
-- through tokenised links, which `chat_sessions` already covers.
--
-- Database-backed rather than a self-contained signed token. A stateless token
-- cannot be withdrawn before it expires, and the case that matters is ordinary:
-- someone leaves a three-person agency and their access has to stop that afternoon,
-- not next Tuesday. Revocation is the whole reason this table exists.
-- ============================================================================

create table user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  -- SHA-256 of the token. The raw value lives only in the customer's cookie, so a
  -- leaked backup yields no usable sessions — same reasoning as the password column
  -- next door.
  token_hash text not null unique,
  expires_at timestamptz not null,
  -- Set on sign-out or when an owner removes a member. Checked on every request, so
  -- revocation takes effect on the next call rather than at expiry.
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Recorded for the account-activity view an owner may want, and for incident
  -- response. Not used for authorisation: a changing IP is a train journey, not an
  -- attack, and logging someone out for it would be user-hostile.
  user_agent text,
  ip inet
);

create index user_sessions_user_idx on user_sessions (user_id);
-- The lookup on every authenticated request: by hash, still valid.
create index user_sessions_live_idx on user_sessions (token_hash)
  where revoked_at is null;

alter table user_sessions enable row level security;
alter table user_sessions force row level security;

grant select, insert, update, delete on user_sessions to app_user;

-- A user may see and end their own sessions, and nobody else's. Session *creation*
-- happens before there is an identity to check against, so it is done by the login
-- endpoint through a SECURITY DEFINER function rather than a policy.
create policy user_sessions_select_self on user_sessions
  for select to app_user
  using (user_id = public.current_user_id());

create policy user_sessions_revoke_self on user_sessions
  for update to app_user
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id());

-- ─── Login ──────────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER because at this moment the caller is nobody: they have proved a
-- password to the application, but `app.current_user_id` is not set yet and every
-- policy would deny. The function is deliberately narrow — it takes an already
-- verified user id and writes exactly one row.
--
-- **It does not verify the password.** Hashing belongs in the application
-- (src/auth/password.ts), where the parameters can be raised without a migration.
-- Passing a plaintext password into SQL would also put it in the statement log.
create or replace function public.create_user_session(
  target_user uuid,
  token_hash text,
  expires_at timestamptz,
  user_agent text default null,
  ip inet default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if target_user is null or token_hash is null or expires_at is null then
    raise exception 'create_user_session requires a user, a token hash and an expiry';
  end if;
  if expires_at <= clock_timestamp() then
    raise exception 'refusing to create a session that is already expired';
  end if;

  insert into user_sessions (user_id, token_hash, expires_at, user_agent, ip)
  values (target_user, token_hash, expires_at, user_agent, ip)
  returning id into new_id;

  return new_id;
end $$;

-- Resolve a token to a user. Also SECURITY DEFINER, and for the same reason: it
-- runs to *establish* the identity that RLS will then use.
--
-- Returns nothing for an expired or revoked session rather than raising, so the
-- caller treats "no such session" and "session ended" identically — telling an
-- attacker which of the two it was gives them a valid-token oracle.
--
-- **`clock_timestamp()`, not `now()`.** `now()` is the *transaction* timestamp: it is
-- fixed at the moment the transaction opened and does not advance while it runs. For
-- an expiry check that is the wrong clock — inside a long transaction a session that
-- died minutes ago would still resolve, and the window is exactly as long as the
-- slowest request. `clock_timestamp()` reads the wall clock at the moment of the
-- comparison, which is the question actually being asked: is this session valid *now*.
create or replace function public.resolve_user_session(token_hash_input text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  found_user uuid;
begin
  update user_sessions
     set last_seen_at = clock_timestamp()
   where token_hash = token_hash_input
     and revoked_at is null
     and expires_at > clock_timestamp()
  returning user_id into found_user;

  return found_user;
end $$;

-- Sign-out, and the owner-removes-a-member path.
create or replace function public.revoke_user_session(token_hash_input text)
returns void
language sql
security definer
set search_path = public
as $$
  update user_sessions
     set revoked_at = now()
   where token_hash = token_hash_input
     and revoked_at is null;
$$;

create or replace function public.revoke_all_user_sessions(target_user uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update user_sessions
     set revoked_at = now()
   where user_id = target_user
     and revoked_at is null;
  get diagnostics affected = row_count;
  return affected;
end $$;

grant execute on function public.create_user_session(uuid, text, timestamptz, text, inet) to app_user;
grant execute on function public.resolve_user_session(text) to app_user;
grant execute on function public.revoke_user_session(text) to app_user;
grant execute on function public.revoke_all_user_sessions(uuid) to app_user;
