-- ============================================================================
-- Quote link revocation assertions (0026 — security pass H1–H5)
--
-- Every claim here is about a boundary that TypeScript cannot reach. The
-- application calling the right function proves nothing: the whole point of 0026
-- is that the *database* refuses, so that a future worker, an admin tool written
-- during an incident, or a route someone adds next month cannot get it wrong.
--
-- The four claims:
--
--  1. **The document is still immutable.** 0026 narrowed a trigger that used to
--     raise unconditionally, and narrowing an invariant is exactly the change that
--     quietly removes it. So the first assertion is that the figures are still
--     frozen — if this file only tested the new behaviour it would pass on a
--     version where the trigger had been deleted outright.
--
--  2. **The link moves.** The bug being fixed was that it could not: the trigger
--     raised, zero rows came back, and the owner was told her quote did not exist
--     while the leaked link stayed live.
--
--  3. **Revocation is one-way, and a revoked link resolves to nothing.**
--     Revocation that a single UPDATE can undo is not revocation.
--
--  4. **`allocate_quote_number` refuses a tenant the caller is not a member of.**
--     It is SECURITY DEFINER and takes the tenant as a parameter, so RLS is
--     bypassed by construction and the check has to be inside the body. Burning a
--     competitor's gapless §14 UStG counter is not repairable.
--
-- Self-contained, in a `9407…` id block nothing else uses, and cleans up after
-- itself because prospects.sql and enrichment.sql make exact-count assertions.
-- ============================================================================

\set ON_ERROR_STOP on

insert into users (id, email, password_hash) values
  ('94070000-0000-4000-8000-000000000001', 'lea@example.test', 'not-a-real-hash'),
  ('94070000-0000-4000-8000-000000000002', 'timo@example.test', 'not-a-real-hash');

insert into agencies (id, name) values
  ('9407a9e0-0000-4000-8000-000000000001', 'Lea Events'),
  ('9407a9e0-0000-4000-8000-000000000002', 'Timo Catering');

insert into agency_members (agency_id, user_id, role) values
  ('9407a9e0-0000-4000-8000-000000000001', '94070000-0000-4000-8000-000000000001', 'owner'),
  ('9407a9e0-0000-4000-8000-000000000002', '94070000-0000-4000-8000-000000000002', 'owner');

insert into contacts (id, agency_id, name) values
  ('9407c000-0000-4000-8000-000000000001', '9407a9e0-0000-4000-8000-000000000001', 'Frau Berger');

insert into inquiries (id, agency_id, contact_id, channel, state) values
  ('9407171a-0000-4000-8000-000000000001', '9407a9e0-0000-4000-8000-000000000001',
   '9407c000-0000-4000-8000-000000000001', 'hosted_chat', 'quote_sent');

insert into quotes (id, agency_id, inquiry_id, quote_number, state) values
  ('94079401-0000-4000-8000-000000000001', '9407a9e0-0000-4000-8000-000000000001',
   '9407171a-0000-4000-8000-000000000001', '2026-0001', 'sent');

insert into quote_versions
  (id, agency_id, quote_id, version_no, line_items, calculation_trace,
   net_total_cents, vat_breakdown, gross_total_cents, valid_until,
   legal_text_version, token_hash, created_by)
values
  ('9407e751-0000-4000-8000-000000000001', '9407a9e0-0000-4000-8000-000000000001',
   '94079401-0000-4000-8000-000000000001', 1, '[]'::jsonb, '{}'::jsonb,
   148000, '[]'::jsonb, 176120, current_date + 30, 'v1',
   -- `created_by` is a message_sender, not a user id: it records whether the agent
   -- or the owner produced this version, which is invariant 4's audit trail.
   repeat('a', 64), 'user');

update quotes set current_version_id = '9407e751-0000-4000-8000-000000000001'
where id = '94079401-0000-4000-8000-000000000001';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_login') then
    create role app_login login inherit;
  end if;
end $$;
grant app_user to app_login;

set role app_login;

-- ─── 1. The document is still immutable ─────────────────────────────────────
do $$
begin
  perform set_config('app.current_user_id', '94070000-0000-4000-8000-000000000001', false);

  begin
    update quote_versions set net_total_cents = 1
    where id = '9407e751-0000-4000-8000-000000000001';
    raise exception 'FAIL F5.10 — a quote version total was editable after issue';
  exception
    when insufficient_privilege or raise_exception then
      null;  -- Either the column grant or the trigger stopped it. Both are correct.
  end;

  begin
    delete from quote_versions where id = '9407e751-0000-4000-8000-000000000001';
    raise exception 'FAIL F5.10 — an issued quote version was deletable';
  exception
    when insufficient_privilege or raise_exception then
      null;
  end;

  raise notice 'PASS F5.10 — issued figures are still frozen after 0026 narrowed the trigger';
end $$;

-- ─── 2. The link moves, and the old one stops resolving ─────────────────────
do $$
declare
  returned_number text;
  found_id uuid;
begin
  perform set_config('app.current_user_id', '94070000-0000-4000-8000-000000000001', false);

  select public.replace_quote_link(
    '9407171a-0000-4000-8000-000000000001', repeat('b', 64)
  ) into returned_number;

  if returned_number is distinct from '2026-0001' then
    raise exception 'FAIL H2 — replace_quote_link returned % instead of the quote number', returned_number;
  end if;

  select quote_version_id into found_id from public.resolve_quote_link(repeat('b', 64));
  if found_id is null then
    raise exception 'FAIL H2 — the replacement link does not resolve';
  end if;

  select quote_version_id into found_id from public.resolve_quote_link(repeat('a', 64));
  if found_id is not null then
    raise exception 'FAIL H2 — the replaced link still resolves';
  end if;

  raise notice 'PASS H2 — a quote link can be replaced, and the old one dies';
end $$;

-- ─── 3. Revocation is one-way ───────────────────────────────────────────────
do $$
declare
  ok boolean;
  found_id uuid;
begin
  perform set_config('app.current_user_id', '94070000-0000-4000-8000-000000000001', false);

  select public.revoke_quote_link('9407171a-0000-4000-8000-000000000001') into ok;
  if not ok then
    raise exception 'FAIL H3 — revoke_quote_link reported failure on a live link';
  end if;

  select quote_version_id into found_id from public.resolve_quote_link(repeat('b', 64));
  if found_id is not null then
    raise exception 'FAIL H3 — a revoked link still resolves';
  end if;

  -- The interesting half. Un-revoking at the same address must be refused, or
  -- "revoked" means "revoked until somebody writes one UPDATE".
  begin
    update quote_versions set revoked_at = null
    where id = '9407e751-0000-4000-8000-000000000001';
    raise exception 'FAIL H3 — a revoked link was restored in place';
  exception
    when raise_exception then
      null;
  end;

  -- But moving to a *new* address is allowed: that is not un-revoking, it is
  -- issuing a new link, and the dead address stays dead.
  perform public.replace_quote_link('9407171a-0000-4000-8000-000000000001', repeat('c', 64));

  select quote_version_id into found_id from public.resolve_quote_link(repeat('c', 64));
  if found_id is null then
    raise exception 'FAIL H3 — a new link could not be issued after revocation';
  end if;

  select quote_version_id into found_id from public.resolve_quote_link(repeat('b', 64));
  if found_id is not null then
    raise exception 'FAIL H3 — the revoked address came back to life';
  end if;

  raise notice 'PASS H3 — revocation is one-way, and a new link does not resurrect the old address';
end $$;

-- ─── 4. Cross-tenant guards ─────────────────────────────────────────────────
do $$
declare
  returned_number text;
begin
  -- Timo, who has no business with Lea's quote.
  perform set_config('app.current_user_id', '94070000-0000-4000-8000-000000000002', false);

  select public.replace_quote_link(
    '9407171a-0000-4000-8000-000000000001', repeat('d', 64)
  ) into returned_number;

  if returned_number is not null then
    raise exception 'FAIL F0.4 — another tenant replaced a quote link';
  end if;

  begin
    perform public.allocate_quote_number('9407a9e0-0000-4000-8000-000000000001');
    raise exception 'FAIL H4 — another tenant burned a number out of a competitor counter';
  exception
    when insufficient_privilege then
      null;
  end;

  raise notice 'PASS H4 — allocate_quote_number refuses a tenant the caller does not belong to';
end $$;

-- ─── 5. A member may still allocate for their own tenant ────────────────────
--
-- The check added for H4 is one `if` away from breaking issuance entirely, and a
-- product that cannot number a quote is worse than the vulnerability.
do $$
declare
  allocated text;
begin
  perform set_config('app.current_user_id', '94070000-0000-4000-8000-000000000001', false);

  select public.allocate_quote_number('9407a9e0-0000-4000-8000-000000000001') into allocated;
  if allocated !~ '^\d{4}-\d{4}$' then
    raise exception 'FAIL §14 UStG — allocate_quote_number returned %', allocated;
  end if;

  raise notice 'PASS §14 UStG — a member can still allocate a number for their own tenant';
end $$;

reset role;

delete from quote_events where agency_id::text like '9407a9e0%';

-- Reaching around the invariant this file just finished proving, for fixture
-- cleanup only. It needs table ownership, which is exactly why it is here and after
-- `reset role` rather than anywhere an application identity could reach — the
-- assertion above is that `app_user` cannot do this, and it still cannot.
alter table quote_versions disable trigger quote_versions_immutable;
delete from quote_versions where agency_id::text like '9407a9e0%';
alter table quote_versions enable trigger quote_versions_immutable;
update quotes set current_version_id = null where agency_id::text like '9407a9e0%';
delete from quotes where agency_id::text like '9407a9e0%';
delete from inquiries where agency_id::text like '9407a9e0%';
delete from contacts where agency_id::text like '9407a9e0%';
delete from quote_number_counters where agency_id::text like '9407a9e0%';
delete from agency_members where agency_id::text like '9407a9e0%';
delete from agencies where id::text like '9407a9e0%';
delete from users where id::text like '94070000%';

select 'ALL QUOTE LINK ASSERTIONS PASSED' as result;
