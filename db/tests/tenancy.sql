-- ============================================================================
-- Tenancy and invariant assertions (FEATURE_INVENTORY F0.8, F2.8, invariant I1)
--
-- These cannot run in vitest: they assert behaviour of the *database* — row level
-- security, check constraints, state-transition triggers — none of which exists in
-- TypeScript. A passing TypeScript suite says nothing about whether one agency can
-- read another's inquiries, and that is the failure that would end the product.
--
-- Run with db/test.sh, which applies the migrations to a scratch database first.
-- Every assertion raises on failure, so a non-zero exit means a real problem.
-- ============================================================================

\set ON_ERROR_STOP on

-- ─── Fixtures: two tenants who must never see each other ────────────────────

insert into users (id, email, password_hash) values
  ('11111111-1111-1111-1111-111111111111', 'lisa@example.test', 'not-a-real-hash'),
  ('22222222-2222-2222-2222-222222222222', 'markus@example.test', 'not-a-real-hash');

insert into agencies (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Lisa Meier Hochzeiten'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Markus Events');

insert into agency_members (agency_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'owner');

insert into contacts (agency_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Lisa customer'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Markus customer');

insert into inquiries (id, agency_id, channel) values
  ('11110000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'hosted_chat'),
  ('22220000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000002', 'hosted_chat');

-- A login role that inherits app_user. The application connects as something like
-- this; it is emphatically not the superuser, who bypasses RLS entirely and would
-- make every assertion below pass for the wrong reason.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_login') then
    create role app_login login inherit;
  end if;
end $$;
grant app_user to app_login;

-- ─── F0.8: tenant isolation ─────────────────────────────────────────────────

set role app_login;

do $$
declare
  visible int;
  name_seen text;
begin
  -- As Lisa.
  perform set_config('app.current_user_id', '11111111-1111-1111-1111-111111111111', false);

  select count(*) into visible from contacts;
  if visible <> 1 then
    raise exception 'F0.8: Lisa should see exactly her 1 contact, saw %', visible;
  end if;

  select name into name_seen from contacts;
  if name_seen <> 'Lisa customer' then
    raise exception 'F0.8: Lisa saw the wrong tenant''s contact: %', name_seen;
  end if;

  select count(*) into visible from inquiries;
  if visible <> 1 then
    raise exception 'F0.8: Lisa should see 1 inquiry, saw %', visible;
  end if;

  select count(*) into visible from agencies;
  if visible <> 1 then
    raise exception 'F0.8: Lisa should see 1 agency, saw %', visible;
  end if;

  -- As Markus. The mirror case matters: a policy that returns nothing to everyone
  -- would pass a one-sided test while being completely broken.
  perform set_config('app.current_user_id', '22222222-2222-2222-2222-222222222222', false);

  select name into name_seen from contacts;
  if name_seen <> 'Markus customer' then
    raise exception 'F0.8: Markus saw the wrong tenant''s contact: %', name_seen;
  end if;

  raise notice 'PASS F0.8 — tenants are isolated in both directions';
end $$;

-- ─── F0.8: no identity means no rows, not an error ──────────────────────────

do $$
declare
  visible int;
begin
  perform set_config('app.current_user_id', '', false);

  select count(*) into visible from contacts;
  if visible <> 0 then
    raise exception 'F0.8: an unauthenticated connection saw % contacts', visible;
  end if;

  select count(*) into visible from users;
  if visible <> 0 then
    raise exception 'F0.8: an unauthenticated connection saw % users', visible;
  end if;

  raise notice 'PASS F0.8 — no identity fails closed';
end $$;

reset role;

-- ─── Invariant 1: the system may never decline a customer ───────────────────

do $$
begin
  if 'declined_by_system' = any(enum_range(null::inquiry_state)::text[]) then
    raise exception 'INVARIANT 1: a declined_by_system state exists. It must not.';
  end if;
  raise notice 'PASS I1 — no system-decline state exists';
end $$;

-- Walk to a state from which an owner decline is legal, so that the *identity*
-- requirement is what gets tested rather than the transition rules.
update inquiries set state = 'acknowledged'   where id = '11110000-0000-0000-0000-00000000000a';
update inquiries set state = 'extracting'     where id = '11110000-0000-0000-0000-00000000000a';
update inquiries set state = 'qualifying'     where id = '11110000-0000-0000-0000-00000000000a';
update inquiries set state = 'escalated'      where id = '11110000-0000-0000-0000-00000000000a';
update inquiries set state = 'owner_handling' where id = '11110000-0000-0000-0000-00000000000a';

do $$
begin
  update inquiries
     set state = 'declined_by_owner'
   where id = '11110000-0000-0000-0000-00000000000a'
     and assigned_user_id is null;
  raise exception 'INVARIANT 1: a decline was recorded with no human attached';
exception
  when others then
    if sqlerrm like 'INVARIANT 1:%' then
      raise;
    end if;
    raise notice 'PASS I1 — decline without a named human blocked: %', sqlerrm;
end $$;

do $$
declare
  final_state text;
begin
  update inquiries
     set state = 'declined_by_owner',
         assigned_user_id = '11111111-1111-1111-1111-111111111111'
   where id = '11110000-0000-0000-0000-00000000000a';

  select state into final_state from inquiries where id = '11110000-0000-0000-0000-00000000000a';
  if final_state <> 'declined_by_owner' then
    raise exception 'I1: a human decline should be permitted, state is %', final_state;
  end if;
  raise notice 'PASS I1 — a decline by a named human is permitted';
end $$;

-- ─── F2.8: nothing enters the live catalogue unconfirmed ────────────────────

do $$
begin
  insert into catalog_items (agency_id, name, unit_price_cents, floor_price_cents, active)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'Unconfirmed item', 100, 100, true);
  raise exception 'F2.8: an unconfirmed item became active';
exception
  when check_violation then
    raise notice 'PASS F2.8 — an unconfirmed item cannot be active';
end $$;

-- ─── X4: every state change is audited ──────────────────────────────────────

do $$
declare
  entries int;
begin
  select count(*) into entries from audit_log where entity = 'inquiry';
  if entries < 5 then
    raise exception 'X4: expected an audit row per transition, found %', entries;
  end if;
  raise notice 'PASS X4 — % inquiry transitions audited', entries;
end $$;

-- ─── F5.1: quote numbers are gapless and per-tenant ─────────────────────────

do $$
declare
  a1 text; a2 text; b1 text;
begin
  a1 := public.allocate_quote_number('aaaaaaaa-0000-0000-0000-000000000001');
  a2 := public.allocate_quote_number('aaaaaaaa-0000-0000-0000-000000000001');
  b1 := public.allocate_quote_number('bbbbbbbb-0000-0000-0000-000000000002');

  if a1 = a2 then
    raise exception 'F5.1: the same quote number was issued twice: %', a1;
  end if;
  if b1 <> a1 then
    -- Numbering restarts per tenant, so the first number of each agency matches.
    raise exception 'F5.1: numbering is not per-tenant (% vs %)', a1, b1;
  end if;
  raise notice 'PASS F5.1 — numbering is sequential and per-tenant (%, %, %)', a1, a2, b1;
end $$;

-- ─── F1.4: the public slug surface leaks nothing and enumerates nothing ─────
--
-- Run with **no identity at all** — no `app.current_user_id` — because that is the
-- real condition on `/a/{slug}`. A customer is not a user of the platform.

insert into agency_slugs (agency_id, slug, alias_email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'lisa-test', 'anfragen-lisa-test@in.example.invalid'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'markus-test', 'anfragen-markus-test@in.example.invalid');

update agencies set suspended_at = now()
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';

set role app_login;

do $$
declare
  direct int;
  resolved int;
  resolved_name text;
begin
  -- No identity: this is the real condition on `/a/{slug}`, and an earlier block in
  -- this file left one set.
  perform set_config('app.current_user_id', '', false);

  -- The tenant table itself stays shut to an anonymous caller. If this ever returns
  -- a row, the SECURITY DEFINER function has stopped being the only public path and
  -- every column on agency_slugs is readable by anyone with the URL.
  select count(*) into direct from agency_slugs;
  if direct <> 0 then
    raise exception 'F1.4: agency_slugs is directly readable with no identity (% rows)', direct;
  end if;
  raise notice 'PASS F1.4 — agency_slugs is not readable without an identity';

  select count(*), max(name) into resolved, resolved_name
    from public.resolve_public_agency('lisa-test');
  if resolved <> 1 then
    raise exception 'F1.4: an active slug did not resolve anonymously (% rows)', resolved;
  end if;
  raise notice 'PASS F1.4 — an active slug resolves with no identity (%)', resolved_name;

  -- Suspended and nonexistent must be the same answer. Distinguishing them would
  -- let a stranger enumerate which agencies exist on the platform, and the slug is
  -- guessable by design — it goes in an Instagram bio.
  select count(*) into resolved from public.resolve_public_agency('markus-test');
  if resolved <> 0 then
    raise exception 'F1.4: a suspended agency is still publicly resolvable';
  end if;

  select count(*) into resolved from public.resolve_public_agency('no-such-agency');
  if resolved <> 0 then
    raise exception 'F1.4: a nonexistent slug returned a row';
  end if;
  raise notice 'PASS F1.4 — suspended and nonexistent are indistinguishable';
end $$;

-- ─── F1.1 / F1.5 / F1.8: a chat turn is written down, and replay is a no-op ──
--
-- Still with no identity. This is the customer's path.

-- The writes run as the customer does — app_login, no identity. The *assertions*
-- cannot: RLS correctly hides messages and disclosure_records from a caller with no
-- membership, so counting them here would read 0 whether or not the rows exist and
-- the test would pass for the wrong reason. Writes below, checks after `reset role`.

do $$
declare
  first_inquiry uuid;
  replay_inquiry uuid;
  second_inquiry uuid;
  is_new boolean;
begin
  perform set_config('app.current_user_id', '', false);

  select r.inquiry_id into first_inquiry
    from public.record_inbound_chat_turn(
      'aaaaaaaa-0000-0000-0000-000000000001', 'hash-session-1', now() + interval '14 days',
      'ext-msg-1', 'Wir heiraten im Juni.', 'v1', 'de', 'sie', 'Ich bin der KI-Assistent.') r;

  select r.inquiry_id, r.is_new_inquiry into replay_inquiry, is_new
    from public.record_inbound_chat_turn(
      'aaaaaaaa-0000-0000-0000-000000000001', 'hash-session-1', now() + interval '14 days',
      'ext-msg-2', 'Und Catering?') r;

  if replay_inquiry <> first_inquiry then
    raise exception 'F1.5: a second turn on the same session got a different inquiry';
  end if;
  if is_new then
    raise exception 'F1.5: a second turn on the same session started a new inquiry';
  end if;
  raise notice 'PASS F1.5 — a returning session keeps its inquiry';

  -- Replay: the customer's phone re-POSTs a turn whose response never arrived, and
  -- passes the disclosure again because it believes this is still the first turn.
  select r.inquiry_id into replay_inquiry
    from public.record_inbound_chat_turn(
      'aaaaaaaa-0000-0000-0000-000000000001', 'hash-session-1', now() + interval '14 days',
      'ext-msg-2', 'Und Catering?', 'v1', 'de', 'sie', 'Ich bin der KI-Assistent.') r;

  if replay_inquiry <> first_inquiry then
    raise exception 'F1.1: replay produced a different inquiry';
  end if;

  -- A different session is a different customer and must not join the thread.
  select r.inquiry_id into second_inquiry
    from public.record_inbound_chat_turn(
      'aaaaaaaa-0000-0000-0000-000000000001', 'hash-session-2', now() + interval '14 days',
      'ext-msg-3', 'Ganz andere Anfrage.') r;

  if second_inquiry = first_inquiry then
    raise exception 'F1.5: a different session joined an existing inquiry';
  end if;
  raise notice 'PASS F1.5 — a different session gets its own inquiry';
end $$;

reset role;

do $$
declare
  first_inquiry uuid;
  msgs int;
  discs int;
  not_new int;
begin
  select cs.inquiry_id into first_inquiry
    from chat_sessions cs where cs.session_token_hash = 'hash-session-1';

  select count(*) into msgs from messages where inquiry_id = first_inquiry;
  if msgs <> 2 then
    raise exception 'F1.1: replay created a duplicate message (% rows, expected 2)', msgs;
  end if;
  raise notice 'PASS F1.1 — replaying a turn creates no second inquiry and no second message';

  -- I6: disclosed once, recorded once, even though the replay passed it again.
  select count(*) into discs from disclosure_records where inquiry_id = first_inquiry;
  if discs <> 1 then
    raise exception 'I6: expected exactly one disclosure record, found %', discs;
  end if;
  raise notice 'PASS I6 — the disclosure is recorded exactly once per inquiry';

  -- I1 at the storage layer: `record_inbound_chat_turn` has no argument that can
  -- set any state but new, so no caller can persist a turn as already refused.
  select count(*) into not_new from inquiries i
    join chat_sessions cs on cs.inquiry_id = i.id
   where cs.session_token_hash in ('hash-session-1', 'hash-session-2')
     and i.state <> 'new';
  if not_new <> 0 then
    raise exception 'I1: a persisted chat turn landed in a state other than new';
  end if;
  raise notice 'PASS I1 — a persisted chat turn can only land in state new';
end $$;

select 'ALL DATABASE ASSERTIONS PASSED' as result;
