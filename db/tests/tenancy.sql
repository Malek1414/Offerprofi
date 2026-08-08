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

select 'ALL DATABASE ASSERTIONS PASSED' as result;
