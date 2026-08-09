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

-- ─── F0.11 / X6: a model call is costed, and the cost is the owning tenant's ──

set role app_login;

do $$
declare
  run_id uuid;
begin
  perform set_config('app.current_user_id', '', false);

  -- Written from the customer path, with no identity, like every model call this
  -- product makes.
  select public.record_agent_run(
    'aaaaaaaa-0000-0000-0000-000000000001', 'extraction', 'claude-opus-5', null,
    'sha256:0123456789abcdef0123456789abcdef', 'sha256:fedcba9876543210fedcba9876543210',
    1843, 412, 2310, 1.951500) into run_id;

  if run_id is null then
    raise exception 'F0.11: record_agent_run returned no id';
  end if;
end $$;

reset role;

do $$
declare
  cost numeric;
  visible int;
begin
  select ar.cost_cents into cost from agent_runs ar where ar.purpose = 'extraction';
  -- The figure open question #3 is answered with. If micro-cents ever round on the
  -- way in, this is where it shows up rather than in a pricing decision next year.
  if cost <> 1.951500 then
    raise exception 'X6: cost_cents round-tripped as % rather than 1.951500', cost;
  end if;
  raise notice 'PASS X6 — a model call is costed to the cent it actually cost';

  -- The definer function inserts; it does not widen who may read. Tenant B's rows
  -- are counted from tenant A's identity and must be zero.
  perform set_config('app.current_user_id', '11111111-0000-0000-0000-000000000002', false);
  set local role app_user;
  select count(*) into visible from agent_runs
   where agency_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if visible <> 0 then
    raise exception 'F0.4: another tenant read % agent_runs rows', visible;
  end if;
  raise notice 'PASS F0.4 — agent_runs is not readable across tenants';
end $$;

-- ─── F3.3 / F3.5: an extraction is stored, and I2 survives the round trip ────

-- Looked up here, before dropping to app_login: RLS correctly hides chat_sessions
-- from a caller with no identity, so reading it inside the block below would bind
-- null and the whole section would test nothing.
do $$
begin
  perform set_config(
    'test.inquiry_id',
    (select cs.inquiry_id::text from public.chat_sessions cs
      where cs.session_token_hash = 'hash-session-1'),
    false);
end $$;

set role app_login;

do $$
declare
  target uuid := current_setting('test.inquiry_id')::uuid;
  other_agency uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
begin
  perform set_config('app.current_user_id', '', false);

  perform public.record_event_brief(
    'aaaaaaaa-0000-0000-0000-000000000001', target,
    '{"guestCount": {"value": 80, "confidence": 0.85}, "language": "de"}'::jsonb,
    '{"name": "Sarah Brandt", "email": "sarah@example.de"}'::jsonb,
    0.75, 0.68,
    '[{"field_path": "guestCount", "value": 80, "confidence": 1.4, "source_ref": "msg_1"}]'::jsonb);

  -- A later turn corrects the count. Extractions append; the brief is replaced.
  perform public.record_event_brief(
    'aaaaaaaa-0000-0000-0000-000000000001', target,
    '{"guestCount": {"value": 95, "confidence": 0.9}, "language": "de"}'::jsonb,
    '{"name": "Sarah Brandt", "email": "sarah@example.de"}'::jsonb,
    1.0, 0.88,
    '[{"field_path": "guestCount", "value": 95, "confidence": 0.9, "source_ref": "msg_4"}]'::jsonb);

  -- A definer function runs as its owner, so nothing but this check stands between
  -- a mismatched pair and one tenant's extraction landing on another's inquiry.
  begin
    perform public.record_event_brief(
      other_agency, target, '{}'::jsonb, '{}'::jsonb, 0, 0);
    raise exception 'I2/F0.4: an inquiry accepted a brief from another agency';
  exception when others then
    if sqlerrm like '%does not belong to agency%' then
      raise notice 'PASS F0.4 — a brief cannot be written onto another tenant''s inquiry';
    else
      raise;
    end if;
  end;
end $$;

reset role;

do $$
declare
  target uuid;
  brief jsonb;
  contact jsonb;
  history int;
  stored_confidence numeric;
begin
  select cs.inquiry_id into target
    from chat_sessions cs where cs.session_token_hash = 'hash-session-1';

  select eb.brief_json, eb.contact_json into brief, contact
    from event_briefs eb where eb.inquiry_id = target;

  if brief -> 'guestCount' ->> 'value' <> '95' then
    raise exception 'F3.5: the brief was not replaced by the later turn';
  end if;
  raise notice 'PASS F3.5 — a later extraction replaces the brief';

  -- I2 through the database: the two halves came in as two parameters and are
  -- still two columns. A name in brief_json is the failure this checks for.
  if brief::text like '%Sarah%' then
    raise exception 'I2: contact data reached brief_json';
  end if;
  if contact ->> 'name' is null then
    raise exception 'I2: contact_json lost the name it was given';
  end if;
  raise notice 'PASS I2 — brief and contact are still separate columns after a round trip';

  -- Provenance is append-only: "80 until message four said 95" is the history the
  -- conflict rule in §4.10 is written against.
  select count(*) into history from extractions
   where inquiry_id = target and field_path = 'guestCount';
  if history <> 2 then
    raise exception 'F3.3: expected 2 provenance rows, found %', history;
  end if;
  raise notice 'PASS F3.3 — provenance rows accumulate rather than being overwritten';

  select confidence into stored_confidence from extractions
   where inquiry_id = target and field_path = 'guestCount' and value_json::text = '80';
  if stored_confidence <> 1 then
    raise exception 'F3.3: a confidence of 1.4 stored as % instead of being clamped',
      stored_confidence;
  end if;
  raise notice 'PASS F3.3 — an out-of-range confidence is clamped, not rejected';
end $$;

-- ─── 0010: the qualifying loop's context read and its one state move ────────

set role app_login;

do $$
declare
  target uuid := current_setting('test.inquiry_id')::uuid;
  other_agency uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  ctx record;
  resulting inquiry_state;
begin
  perform set_config('app.current_user_id', '', false);

  select * into ctx
    from public.conversation_context('aaaaaaaa-0000-0000-0000-000000000001', target, 10);

  if ctx.brief_json -> 'guestCount' ->> 'value' <> '95' then
    raise exception 'Phase B: conversation_context did not return the stored request';
  end if;

  -- I2 again, on the way out. The two halves came back in two columns, and the
  -- realistic way this breaks is a read that helpfully merges them.
  if ctx.brief_json::text like '%Sarah%' then
    raise exception 'I2: contact data came back inside brief_json';
  end if;
  if ctx.contact_json ->> 'name' is null then
    raise exception 'I2: contact_json came back empty';
  end if;
  raise notice 'PASS I2 — the context read keeps request and contact apart';

  if jsonb_array_length(ctx.messages) <> 2 then
    raise exception 'Phase B: expected 2 inbound messages, got %',
      jsonb_array_length(ctx.messages);
  end if;
  if ctx.messages -> 0 ->> 'text' <> 'Wir heiraten im Juni.' then
    raise exception 'Phase B: the transcript came back newest-first';
  end if;
  raise notice 'PASS Phase B — the transcript tail comes back oldest first';

  -- A definer function runs as its owner. Without this check it is a cross-tenant
  -- read primitive, and the thing it reads is a customer's whole enquiry.
  begin
    perform * from public.conversation_context(other_agency, target, 10);
    raise exception 'F0.4: conversation_context served another tenant''s inquiry';
  exception when others then
    if sqlerrm like '%does not belong to agency%' then
      raise notice 'PASS F0.4 — conversation_context refuses a mismatched pair';
    else
      raise;
    end if;
  end;

  begin
    perform public.record_agent_progress(other_agency, target, 'qualifying');
    raise exception 'F0.4: record_agent_progress moved another tenant''s inquiry';
  exception when others then
    if sqlerrm like '%does not belong to agency%' then
      raise notice 'PASS F0.4 — record_agent_progress refuses a mismatched pair';
    else
      raise;
    end if;
  end;

  -- INVARIANT 1 at the storage layer. There is no third outcome, and the attempt to
  -- express one fails loudly rather than being ignored.
  begin
    perform public.record_agent_progress(
      'aaaaaaaa-0000-0000-0000-000000000001', target, 'declined');
    raise exception 'I1: the agent was allowed to record an outcome other than the two';
  exception when others then
    if sqlerrm like '%Invariant 1%' then
      raise notice 'PASS I1 — the agent has exactly two outcomes, and no third is expressible';
    else
      raise;
    end if;
  end;

  -- new → acknowledged → extracting → qualifying, one legal edge at a time.
  resulting := public.record_agent_progress(
    'aaaaaaaa-0000-0000-0000-000000000001', target, 'qualifying');
  if resulting <> 'qualifying' then
    raise exception 'Phase B: expected qualifying, got %', resulting;
  end if;
  raise notice 'PASS Phase B — the agent walks an inquiry to qualifying';

  resulting := public.record_agent_progress(
    'aaaaaaaa-0000-0000-0000-000000000001', target, 'escalated', 'qualify_timeout');
  if resulting <> 'escalated' then
    raise exception 'I1: escalation did not take, got %', resulting;
  end if;

  -- And it stays escalated. Handing a thread back to the agent is a human's call;
  -- an agent that could take it back would undo Invariant 5 one turn later.
  resulting := public.record_agent_progress(
    'aaaaaaaa-0000-0000-0000-000000000001', target, 'qualifying');
  if resulting <> 'escalated' then
    raise exception 'I5: the agent pulled an escalated inquiry back to itself';
  end if;
  raise notice 'PASS I5 — an escalated thread stays with the human';
end $$;

reset role;

do $$
declare
  target uuid := current_setting('test.inquiry_id')::uuid;
  paused boolean;
  reason text;
  transitions int;
begin
  select i.automation_paused, i.escalation_reason into paused, reason
    from inquiries i where i.id = target;

  if not paused then
    raise exception 'I5: escalation left automation running';
  end if;
  if reason is distinct from 'qualify_timeout' then
    raise exception 'Phase B: the escalation reason was not recorded, got %', reason;
  end if;
  raise notice 'PASS I5 — escalation pauses the agent and records why';

  -- X4: every edge is auditable. new→acknowledged→extracting→qualifying→escalated.
  select count(*) into transitions from audit_log
   where entity_id = target and action = 'inquiry.state_changed';
  if transitions <> 4 then
    raise exception 'X4: expected 4 audited transitions, found %', transitions;
  end if;
  raise notice 'PASS X4 — every state edge the agent took is in the audit log';
end $$;

-- ─── 0011: she presses send, and two documents exist ────────────────────────
--
-- Uses the *second* session's inquiry, which is still in `new` — the first was
-- escalated by the 0010 assertions above, and an escalated thread staying
-- escalated is itself asserted there.

do $$
begin
  perform set_config(
    'test.send_inquiry_id',
    (select cs.inquiry_id::text from public.chat_sessions cs
      where cs.session_token_hash = 'hash-session-2'),
    false);
end $$;

set role app_login;

do $$
declare
  target uuid := current_setting('test.send_inquiry_id')::uuid;
  other_agency uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  agency uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  sent record;
  doc record;
  found record;
  links int;
begin
  perform set_config('app.current_user_id', '', false);

  -- A request needs something to summarise.
  perform public.record_event_brief(
    agency, target,
    '{"headcount": {"value": 40, "confidence": 0.9}, "language": "de"}'::jsonb,
    '{"name": "Nina Vogel", "email": "nina@example.de"}'::jsonb,
    1.0, 0.9);

  select * into found from public.inquiry_for_session(agency, 'hash-session-2');
  if found.inquiry_id is distinct from target then
    raise exception 'Phase D: the session did not resolve to its inquiry';
  end if;
  raise notice 'PASS Phase D — a live session resolves to its inquiry without writing';

  begin
    perform * from public.send_request_to_owner(other_agency, target, 'h-x', 'h-y');
    raise exception 'F0.4: a request was sent on another tenant''s inquiry';
  exception when others then
    if sqlerrm like '%does not belong to agency%' then
      raise notice 'PASS F0.4 — send_request_to_owner refuses a mismatched pair';
    else
      raise;
    end if;
  end;

  select * into sent from public.send_request_to_owner(
    agency, target, 'hash-customer-token', 'hash-owner-token');
  if sent.state <> 'sent_to_owner' then
    raise exception 'Phase D: expected sent_to_owner, got %', sent.state;
  end if;
  if sent.already_sent then
    raise exception 'Phase D: a first send reported itself as a repeat';
  end if;
  raise notice 'PASS Phase D — sending walks the inquiry to sent_to_owner';

  -- Pressing send twice is one send. Two requests in his tray for one event is
  -- worse than a button that appears to do nothing the second time.
  select * into sent from public.send_request_to_owner(
    agency, target, 'hash-second-attempt', 'hash-second-attempt-owner');
  if not sent.already_sent then
    raise exception 'Phase D: the second press created a second send';
  end if;
  raise notice 'PASS Phase D — sending twice is sending once';

  -- ── THE PRICE-LEAK RULE, AT THE ROW ──────────────────────────────────────
  -- Her document is built from a row that has nulls where his has contact
  -- details, so the component cannot render what it was never handed. When the
  -- price suggestion lands (Phase B2) it goes in exactly the same place.
  select * into doc from public.resolve_request_link('hash-customer-token');
  if doc.audience <> 'customer' then
    raise exception 'Phase D: the customer token resolved to the % document', doc.audience;
  end if;
  if doc.contact_json is not null then
    raise exception 'I2/Phase D: contact details were returned for the customer''s token';
  end if;
  if doc.brief_json -> 'headcount' ->> 'value' <> '40' then
    raise exception 'Phase D: the customer''s document lost the request';
  end if;
  raise notice 'PASS Phase D — the customer''s row carries no contact details';

  select * into doc from public.resolve_request_link('hash-owner-token');
  if doc.audience <> 'owner' then
    raise exception 'Phase D: the owner token resolved to the % document', doc.audience;
  end if;
  if doc.contact_json ->> 'name' is null then
    raise exception 'Phase D: the owner''s document has no way to reach her';
  end if;
  raise notice 'PASS Phase D — the owner''s row does';

  -- A token that never existed resolves to nothing, and says nothing about why.
  -- Anything else is a hint to whoever is guessing.
  if exists (select 1 from public.resolve_request_link('hash-never-minted')) then
    raise exception 'Phase D: an unknown token resolved to something';
  end if;
  raise notice 'PASS Phase D — an unknown token is an empty answer';
end $$;

reset role;

do $$
declare
  target uuid := current_setting('test.send_inquiry_id')::uuid;
  visible int;
  links int;
begin
  -- Counted here rather than inside the app_login block above: RLS correctly hides
  -- these rows from a caller with no identity, so the count there would be zero for
  -- the right reason and the assertion would prove nothing.
  select count(*) into links from request_links where inquiry_id = target;
  if links <> 2 then
    raise exception 'Phase D: expected exactly 2 links, found %', links;
  end if;
  raise notice 'PASS Phase D — one send, two documents, and no more';

  -- Revocation, from a seat that can write it: nothing revokes a link yet, and the
  -- column exists so that during an incident it is an update rather than a
  -- migration. Asserting it now is what makes that true when it is needed.
  update request_links set revoked_at = now() where token_hash = 'hash-owner-token';
  if exists (select 1 from public.resolve_request_link('hash-owner-token')) then
    raise exception 'Phase D: a revoked token still resolves';
  end if;
  raise notice 'PASS Phase D — a revoked token is the same empty answer as an unknown one';

  -- F0.4 on the new table, from the other tenant's seat.
  perform set_config('app.current_user_id',
    (select u.id::text from users u where u.email = 'markus@example.test'), false);
  set local role app_user;
  select count(*) into visible from request_links;
  if visible <> 0 then
    raise exception 'F0.4: another tenant read % request_links rows', visible;
  end if;
  raise notice 'PASS F0.4 — request_links is not readable across tenants';
end $$;

-- ─── 0012: the catalogue read the price suggestion uses ─────────────────────
--
-- Three items, because the assertion is about which ones come back: one confirmed
-- and active, one confirmed but retired, one never confirmed. Inserted as the
-- owner of the database — a member seat would work too, but the point here is the
-- definer function's filtering, not the policy underneath it.

insert into catalog_items
  (agency_id, name, unit, unit_price_cents, floor_price_cents, cost_cents,
   quantity_driver, active, confirmed_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Buffet Klassik', 'Person',
   7850, 6500, null, 'per_guest', true, now()),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Servicekraft', 'Stunde',
   3900, 3200, 2400, 'per_hour', true, now()),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Eingestelltes Menü', 'Person',
   6000, 6000, null, 'per_guest', false, now()),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Fremdes Buffet', 'Person',
   9900, 9900, null, 'per_guest', true, now());

set role app_login;

do $$
declare
  agency uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  rows_seen int;
  costed record;
begin
  perform set_config('app.current_user_id', '', false);

  -- F2.8, the rule that nothing unconfirmed is ever used, applied to pricing: a
  -- suggestion built from a candidate the owner never approved is exactly the use
  -- that rule forbids.
  select count(*) into rows_seen from public.catalogue_for_pricing(agency);
  if rows_seen = 0 then
    raise exception 'Phase B2: the pricing read returned nothing for a tenant with a catalogue';
  end if;

  if exists (
    select 1 from public.catalogue_for_pricing(agency) c
      join catalog_items ci on ci.id = c.id
     where ci.confirmed_at is null or not ci.active
  ) then
    raise exception 'F2.8/Phase B2: an unconfirmed or inactive item reached the pricing read';
  end if;
  raise notice 'PASS F2.8 — only confirmed, active items reach the price suggestion';

  if rows_seen <> 2 then
    raise exception 'Phase B2: expected 2 confirmed active items, got %', rows_seen;
  end if;

  -- Cost is nullable and stays null until someone fills it in. Defaulting it to
  -- zero would report every un-costed line as pure profit, which is the one way
  -- this feature could mislead the person it is built for.
  select * into costed from public.catalogue_for_pricing(agency)
   where name = 'Buffet Klassik';
  if costed.cost_cents is not null then
    raise exception 'Phase B2: an unfilled cost came back as % instead of null', costed.cost_cents;
  end if;

  select * into costed from public.catalogue_for_pricing(agency) where name = 'Servicekraft';
  if costed.cost_cents <> 2400 then
    raise exception 'Phase B2: a recorded cost came back as %', costed.cost_cents;
  end if;
  raise notice 'PASS Phase B2 — a recorded cost is returned, an unfilled one stays null';

  -- Another tenant's catalogue is another tenant's. The function is definer, so
  -- nothing but the argument scopes it.
  if exists (
    select 1 from public.catalogue_for_pricing('bbbbbbbb-0000-0000-0000-000000000002') c
      join catalog_items ci on ci.id = c.id
     where ci.agency_id = agency
  ) then
    raise exception 'F0.4: catalogue_for_pricing crossed tenants';
  end if;
  raise notice 'PASS F0.4 — the pricing read is scoped to the agency it is asked about';
end $$;

reset role;

-- ─── 0013: the two WhatsApp mitigations ─────────────────────────────────────
--
-- These are the assertions that protect the agency's own phone number — the one
-- their livelihood runs through. The provider is unofficial (N3) and Meta's
-- enforcement keys on the traffic pattern, so "we only message people who
-- messaged us" and "no more than N new conversations a day" have to be properties
-- of the schema, not rules in a code review.

insert into whatsapp_accounts (id, agency_id, provider_account_id, display_phone, daily_new_thread_cap)
values ('cccccccc-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001',
        'unipile-acct-1', '+4922100000', 2);

set role app_login;

do $$
declare
  agency uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  gate record;
  inbound record;
begin
  perform set_config('app.current_user_id', '', false);

  -- MITIGATION 1. Nobody has written to us from this number.
  select * into gate from public.may_send_to_thread(agency, '+4915100000001');
  if gate.allowed then
    raise exception 'MITIGATION 1: a send was permitted to a number that never wrote to us';
  end if;
  if gate.reason <> 'no_inbound_message' then
    raise exception 'MITIGATION 1: expected no_inbound_message, got %', gate.reason;
  end if;
  raise notice 'PASS mitigation 1 — no inbound message, no send';

  -- She opens the thread herself, via the wa.me deep link.
  select * into inbound from public.record_whatsapp_inbound(
    'unipile-acct-1', '+4915100000001', 'customer', 'chat-1');
  if inbound.agency_id <> agency then
    raise exception 'Phase E: the account resolved to the wrong tenant';
  end if;
  if not inbound.is_new_thread then
    raise exception 'Phase E: the first inbound did not open a thread';
  end if;

  select * into gate from public.may_send_to_thread(agency, '+4915100000001');
  if not gate.allowed then
    raise exception 'Phase E: a send was refused after she wrote to us: %', gate.reason;
  end if;
  raise notice 'PASS mitigation 1 — an inbound message is what grants permission';

  -- A second inbound is the same thread, and keeps the time it was opened.
  select * into inbound from public.record_whatsapp_inbound(
    'unipile-acct-1', '+4915100000001', 'customer', 'chat-1');
  if inbound.is_new_thread then
    raise exception 'Phase E: a second message from the same number opened a second thread';
  end if;

  -- MITIGATION 2, the cap. Two is the fixture's limit; this is the third.
  perform public.record_whatsapp_inbound('unipile-acct-1', '+4915100000002', 'customer', 'chat-2');
  perform public.record_whatsapp_inbound('unipile-acct-1', '+4915100000003', 'customer', 'chat-3');

  select * into gate from public.may_send_to_thread(agency, '+4915100000003');
  if gate.allowed then
    raise exception 'MITIGATION 2: the daily new-thread cap did not hold';
  end if;
  if gate.reason <> 'daily_cap_reached' then
    raise exception 'MITIGATION 2: expected daily_cap_reached, got %', gate.reason;
  end if;
  raise notice 'PASS mitigation 2 — the daily new-thread cap holds';

  -- The owner's own thread is not a new customer contact. He linked the account;
  -- the cap exists to stop us spraying strangers, not to stop him being told.
  perform public.record_whatsapp_inbound('unipile-acct-1', '+4922100000', 'owner', 'chat-owner');
  select * into gate from public.may_send_to_thread(agency, '+4922100000');
  if not gate.allowed then
    raise exception 'Phase E: the owner could not be notified on his own thread: %', gate.reason;
  end if;
  raise notice 'PASS Phase E — the owner''s own thread is not capped';

  -- An unknown account is silence, not an exception: Unipile retries forever.
  select * into inbound from public.record_whatsapp_inbound(
    'unipile-acct-nobody', '+4915100000009', 'customer', 'chat-x');
  if inbound.agency_id is not null then
    raise exception 'Phase E: an unknown provider account resolved to a tenant';
  end if;
  raise notice 'PASS Phase E — an unknown account is ignored, not an error';
end $$;

reset role;

-- MITIGATION 2, the kill switch. Flipped from a psql prompt, which is exactly how
-- it would be flipped at 2am, and the point of it being a column.
update whatsapp_accounts
   set sending_paused = true, paused_reason = 'meta_warning'
 where provider_account_id = 'unipile-acct-1';

set role app_login;

do $$
declare
  gate record;
begin
  perform set_config('app.current_user_id', '', false);

  select * into gate from public.may_send_to_thread(
    'aaaaaaaa-0000-0000-0000-000000000001', '+4915100000001');
  if gate.allowed then
    raise exception 'MITIGATION 2: the kill switch did not stop an established thread';
  end if;
  if gate.reason <> 'meta_warning' then
    raise exception 'MITIGATION 2: expected the operator''s reason, got %', gate.reason;
  end if;
  raise notice 'PASS mitigation 2 — the kill switch stops even an established thread';
end $$;

reset role;

do $$
declare
  visible int;
begin
  -- F0.4 on the new tables.
  perform set_config('app.current_user_id',
    (select u.id::text from users u where u.email = 'markus@example.test'), false);
  set local role app_user;
  select count(*) into visible from whatsapp_threads;
  if visible <> 0 then
    raise exception 'F0.4: another tenant read % whatsapp_threads rows', visible;
  end if;
  select count(*) into visible from whatsapp_accounts;
  if visible <> 0 then
    raise exception 'F0.4: another tenant read % whatsapp_accounts rows', visible;
  end if;
  raise notice 'PASS F0.4 — WhatsApp accounts and threads are not readable across tenants';
end $$;

-- ─── 0014: the caterer's confirmed facts ────────────────────────────────────

insert into agency_facts (agency_id, key, value, confirmed_by_user_id, confirmed_at)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'min_order',
        'Mindestbestellung ab 20 Personen.',
        '11111111-1111-1111-1111-111111111111', now());

-- A candidate: extracted from his documents, not yet reviewed.
insert into agency_facts (agency_id, key, value)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'delivery_radius_km',
        'Lieferung im Umkreis von 40 km.');

do $$
begin
  -- F2.8, applied to facts. A model telling a customer "we deliver up to 50km"
  -- because it read that off a 2019 PDF he had forgotten about is the failure
  -- this constraint exists to prevent.
  insert into agency_facts (agency_id, key, value, confirmed_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'bad_fact', 'x', now());
  raise exception 'F2.8: a fact was confirmed with no human attached';
exception
  when check_violation then
    raise notice 'PASS F2.8 — a confirmed fact must name the human who confirmed it';
end $$;

set role app_login;

do $$
declare
  live int;
begin
  perform set_config('app.current_user_id', '', false);

  select count(*) into live
    from public.facts_for_agent('aaaaaaaa-0000-0000-0000-000000000001');
  if live <> 1 then
    raise exception 'F2.8/Phase C: expected 1 confirmed fact, the agent can see %', live;
  end if;

  if exists (
    select 1 from public.facts_for_agent('aaaaaaaa-0000-0000-0000-000000000001')
     where value like '%40 km%'
  ) then
    raise exception 'F2.8/Phase C: an unconfirmed fact reached the agent';
  end if;
  raise notice 'PASS F2.8 — only facts the owner confirmed reach a customer conversation';

  if exists (select 1 from public.facts_for_agent('bbbbbbbb-0000-0000-0000-000000000002')) then
    raise exception 'F0.4: facts_for_agent crossed tenants';
  end if;
  raise notice 'PASS F0.4 — facts are scoped to the agency they belong to';
end $$;

reset role;

-- ─── 0015: retrieval, and a small golden set ────────────────────────────────
--
-- The plan asks for ~20 questions against one caterer's documents before Phase C
-- is called done. This is the start of that set, and it lives here rather than in
-- vitest because the ranking *is* SQL — a TypeScript test would be asserting
-- against a mock of the thing under test.
--
-- Each case is a question someone would really ask, and the assertion is that the
-- right chunk comes back first.

insert into knowledge_documents (id, agency_id, source_name, body_text)
values ('eeeeeeee-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001',
        'Angebot Müller Juni 2025.pdf', 'siehe chunks');

insert into knowledge_chunks (agency_id, document_id, ordinal, body_text, context_prefix)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-00000000000a', 0,
   'Buffet Klassik, 60 Gäste, drei Gänge, 72 EUR pro Person. Vorspeisenvariation, '
   'zwei Hauptgänge, Dessertbuffet.',
   'Aus dem Angebot für die Hochzeit Müller, Juni 2025, Abschnitt Menü.'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-00000000000a', 1,
   'Servicepersonal: vier Kräfte über sechs Stunden, 42 EUR pro Stunde.',
   'Aus dem Angebot für die Hochzeit Müller, Juni 2025, Abschnitt Personal.'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-00000000000a', 2,
   'Auf Wunsch bauen wir eine Paella Station mit zwei Pfannen auf.',
   'Aus dem Angebot für die Hochzeit Müller, Juni 2025, Abschnitt Extras.');

set role app_login;

do $$
declare
  agency uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  top record;
  hits int;
begin
  perform set_config('app.current_user_id', '', false);

  -- 1. German stemming: "veganer" is not in the text, but "Hauptgängen" stems to
  --    the same lexeme as "Hauptgänge".
  select * into top from public.search_knowledge(agency, 'wie viele Hauptgängen', 1);
  if top.body_text not like '%Hauptgänge%' then
    raise exception 'Phase C: stemming failed, got %', top.body_text;
  end if;
  raise notice 'PASS Phase C — German stemming finds an inflected form';

  -- 2. The question uses a word that appears only in the *prefix*, not the chunk.
  --    This is the whole point of Contextual Retrieval: the chunk about staff
  --    never says "Hochzeit", and without the sticky note it is unfindable.
  select * into top from public.search_knowledge(agency, 'Personal Hochzeit', 1);
  if top.body_text not like '%Servicepersonal%' then
    raise exception 'Phase C: the context prefix is not searchable, got %', top.body_text;
  end if;
  raise notice 'PASS Phase C — a chunk is found by the context it was filed under';

  -- 3. Hyphenation, which stemming cannot solve: she writes "Paella-Station",
  --    the document says "Paella Station". No shared lexeme; trigram catches it.
  select * into top from public.search_knowledge(agency, 'Paella-Station', 1);
  if top.body_text not like '%Paella%' then
    raise exception 'Phase C: trigram did not bridge the hyphen, got %', top.body_text;
  end if;
  raise notice 'PASS Phase C — trigram bridges a hyphen stemming cannot';

  -- 4. A question about nothing in the corpus returns nothing, rather than the
  --    least-bad chunk. A confidently irrelevant snippet is worse than silence.
  select count(*) into hits from public.search_knowledge(agency, 'Feuerwerk Drohnenshow', 5);
  if hits <> 0 then
    raise exception 'Phase C: an unrelated question matched % chunks', hits;
  end if;
  raise notice 'PASS Phase C — an unrelated question returns nothing, not the least-bad chunk';

  -- 5. F0.4. The definer is scoped by its argument and nothing else.
  select count(*) into hits
    from public.search_knowledge('bbbbbbbb-0000-0000-0000-000000000002', 'Buffet', 5);
  if hits <> 0 then
    raise exception 'F0.4: search_knowledge returned another tenant''s chunks';
  end if;
  raise notice 'PASS F0.4 — retrieval is scoped to the agency it is asked about';
end $$;

reset role;

-- ─── Owner onboarding writes: owner-only and document-deduplicated ─────────

insert into users (id, email, password_hash)
values ('33333333-3333-3333-3333-333333333333', 'team@example.test', 'not-a-real-hash');
insert into agency_members (agency_id, user_id, role)
values ('aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'member');

set role app_login;

do $$
begin
  perform set_config('app.current_user_id', '33333333-3333-3333-3333-333333333333', false);

  begin
    insert into brand_profiles (agency_id, color_primary, confirmed_at)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '#123456', clock_timestamp());
    raise exception 'F6.15: a member changed the agency brand';
  exception
    when insufficient_privilege then
      raise notice 'PASS F6.15 — only an owner may change the agency brand';
  end;

  begin
    insert into knowledge_documents (agency_id, source_name, sha256, body_text)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'member.pdf', repeat('a', 64), 'forbidden');
    raise exception 'F6.15: a member changed the onboarding knowledge base';
  exception
    when insufficient_privilege then
      raise notice 'PASS F6.15 — only an owner may change onboarding knowledge';
  end;

  perform set_config('app.current_user_id', '11111111-1111-1111-1111-111111111111', false);
  insert into brand_profiles (agency_id, color_primary, confirmed_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '#2F6F4F', clock_timestamp());

  insert into knowledge_documents (agency_id, source_name, sha256, body_text)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'owner.pdf', repeat('b', 64), 'allowed');

  begin
    insert into knowledge_documents (agency_id, source_name, sha256, body_text)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'duplicate.pdf', repeat('b', 64), 'duplicate');
    raise exception 'Phase C UI: a duplicate document was stored twice';
  exception
    when unique_violation then
      raise notice 'PASS Phase C UI — identical uploads are deduplicated per agency';
  end;
end $$;

reset role;

select 'ALL DATABASE ASSERTIONS PASSED' as result;
