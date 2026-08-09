-- ============================================================================
-- Signup, tenant bootstrap and session assertions (F0.6, F0.7, D29a).
--
-- These cannot be written in Vitest. Every property below is a property of the
-- *database* — atomicity of the bootstrap, what a SECURITY DEFINER function is
-- willing to do, and whether a revoked session actually stops resolving. A TypeScript
-- test could only assert that we called the right SQL, which is not the question.
-- ============================================================================

\set ON_ERROR_STOP on

do $$
declare
  lisa uuid;
  lisa_agency uuid;
  markus uuid;
  markus_agency uuid;
  session_token text := 'a-token-hash-for-lisa';
  resolved uuid;
  before_count integer;
  after_count integer;
  visible integer;
begin
  -- ─── bootstrap_agency writes all four rows, or none ───────────────────────

  select user_id, agency_id into lisa, lisa_agency
    from public.bootstrap_agency(
      'lisa@example.de', 'scrypt$65536$8$1$c2FsdA$aGFzaA', 'Lisa Meier',
      'Lisa Meier Hochzeiten', 'lisa-meier', 'anfragen-lisa-meier@in.example.invalid');

  assert lisa is not null, 'bootstrap_agency returned no user';
  assert lisa_agency is not null, 'bootstrap_agency returned no agency';
  assert (select count(*) from users where id = lisa) = 1, 'user row missing';
  assert (select count(*) from agencies where id = lisa_agency) = 1, 'agency row missing';
  assert (select count(*) from agency_slugs where agency_id = lisa_agency) = 1,
    'slug reservation missing';

  -- The first account must be an owner. F6.15 excludes members from billing,
  -- channel connections and guardrail config; a solo agency created as 'member'
  -- would be locked out of its own settings on day one.
  assert (select role from agency_members
           where agency_id = lisa_agency and user_id = lisa) = 'owner',
    'the founding account is not an owner';

  -- ─── Partial success is impossible ────────────────────────────────────────
  --
  -- A duplicate slug must leave no user behind. Otherwise a retry with a different
  -- slug hits a duplicate email instead, and the owner is wedged: neither value
  -- works and nothing explains why.

  select count(*) into before_count from users;
  begin
    perform public.bootstrap_agency(
      'markus@example.de', 'scrypt$65536$8$1$c2FsdA$aGFzaA', 'Markus',
      'Markus Events', 'lisa-meier', 'anfragen-lisa-meier-2@in.example.invalid');
    assert false, 'a duplicate slug was accepted';
  exception when unique_violation then
    null;
  end;
  select count(*) into after_count from users;
  assert before_count = after_count,
    format('a failed bootstrap left %s orphaned user row(s)', after_count - before_count);

  -- The same, for a duplicate email.
  select count(*) into before_count from agencies;
  begin
    perform public.bootstrap_agency(
      'lisa@example.de', 'scrypt$65536$8$1$c2FsdA$aGFzaA', 'Lisa again',
      'Zweite Agentur', 'zweite-agentur', 'anfragen-zweite-agentur@in.example.invalid');
    assert false, 'a duplicate email was accepted';
  exception when unique_violation then
    null;
  end;
  select count(*) into after_count from agencies;
  assert before_count = after_count, 'a failed bootstrap left an orphaned agency';

  -- ─── The function refuses a hash the application did not produce ──────────
  --
  -- Storing a plaintext password because a caller was wired up wrongly would create
  -- an account nobody can log in to and nobody can diagnose.
  begin
    perform public.bootstrap_agency(
      'plaintext@example.de', 'hunter2', 'Nope', 'Nope GmbH', 'nope-gmbh',
      'anfragen-nope@in.example.invalid');
    assert false, 'a plaintext password was accepted as a hash';
  exception when others then
    assert sqlerrm like '%application-produced hash%',
      format('wrong error for a plaintext password: %s', sqlerrm);
  end;

  -- ─── Sessions ─────────────────────────────────────────────────────────────

  perform public.create_user_session(lisa, session_token, now() + interval '7 days');
  select public.resolve_user_session(session_token) into resolved;
  assert resolved = lisa, 'a live session did not resolve to its user';

  -- Revocation takes effect on the next call, not at expiry. This is the whole
  -- reason the table exists rather than a self-contained signed token: someone
  -- leaves a three-person agency and their access stops that afternoon.
  perform public.revoke_user_session(session_token);
  select public.resolve_user_session(session_token) into resolved;
  assert resolved is null, 'a revoked session still resolved';

  -- An expired session is refused, and refused the same way — an attacker must not
  -- be able to tell a valid-but-expired token from one that never existed.
  perform public.create_user_session(lisa, 'expired-token', now() + interval '1 second');
  perform pg_sleep(1.2);
  select public.resolve_user_session('expired-token') into resolved;
  assert resolved is null, 'an expired session still resolved';

  select public.resolve_user_session('never-existed') into resolved;
  assert resolved is null, 'an unknown token resolved to something';

  -- Refusing to mint a session that is already dead. A clock-skewed caller would
  -- otherwise create rows that can never be used and never be explained.
  begin
    perform public.create_user_session(lisa, 'already-dead', now() - interval '1 hour');
    assert false, 'an already-expired session was created';
  exception when others then
    assert sqlerrm like '%already expired%', format('wrong error: %s', sqlerrm);
  end;

  -- ─── Slug availability leaks nothing beyond what the caller already knew ──

  assert (select count(*) from public.slugs_taken(array['lisa-meier'])) = 1,
    'slugs_taken did not report a taken slug';
  assert (select count(*) from public.slugs_taken(array['frei-1', 'frei-2'])) = 0,
    'slugs_taken reported a free slug as taken';

  -- ─── Login lookup returns the row regardless of the password ──────────────
  --
  -- Because the *application* must do the comparison, in constant time. A function
  -- that only returned a row for correct credentials would make its own duration
  -- the answer.
  assert (select count(*) from public.find_user_for_login('lisa@example.de')) = 1,
    'find_user_for_login did not find a real user';
  assert (select count(*) from public.find_user_for_login('LISA@EXAMPLE.DE')) = 1,
    'find_user_for_login is case-sensitive — one mailbox would become two accounts';
  assert (select count(*) from public.find_user_for_login('stranger@example.de')) = 0,
    'find_user_for_login invented a user';

  -- ─── my_agencies is RLS-scoped, not SECURITY DEFINER ─────────────────────
  --
  -- The one function in 0005 that runs with an identity, so it is the one that must
  -- prove it cannot see another tenant.
  select user_id, agency_id into markus, markus_agency
    from public.bootstrap_agency(
      'markus2@example.de', 'scrypt$65536$8$1$c2FsdA$aGFzaA', 'Markus',
      'Markus Corporate Events', 'markus-events',
      'anfragen-markus-events@in.example.invalid');

  perform set_config('app.current_user_id', lisa::text, true);
  select count(*) into visible from public.my_agencies();
  assert visible = 1, format('Lisa saw %s agencies, expected 1', visible);
  assert (select agency_id from public.my_agencies()) = lisa_agency,
    'Lisa saw the wrong agency';

  perform set_config('app.current_user_id', markus::text, true);
  assert (select agency_id from public.my_agencies()) = markus_agency,
    'Markus saw the wrong agency';

  -- No identity: no agencies. Failing closed on an absent identity is the point.
  perform set_config('app.current_user_id', '', true);
  select count(*) into visible from public.my_agencies();
  assert visible = 0, format('an unauthenticated caller saw %s agencies', visible);

  raise notice 'signup, bootstrap and session assertions passed';
end $$;
