-- ============================================================================
-- Candidate and verdict assertions (0024 — C2, C3, F2.8)
--
-- Two claims, and neither can be tested from TypeScript:
--
--  1. **Nothing enters the live catalogue unconfirmed**, and every live price
--     traces to a named person. This is a CLAUDE.md §7 rule, and the enforcement
--     is that `confirm_candidate` is `security invoker` with no service-role
--     alternative — so what needs proving is the absence of a second route.
--
--  2. **Every decision produces exactly one training example.** §4 makes the
--     verdict the product rather than the candidate, and the bulk gesture is the
--     place that most easily breaks it: a set-based implementation would confirm
--     twenty-four items while producing one row, and the flywheel would quietly
--     lose twenty-three examples per tap.
--
-- Self-contained, with its own tenants — db/test.sh runs files in glob order and
-- this one runs first. Fixture ids are in a `ca11…` block nothing else uses.
-- ============================================================================

\set ON_ERROR_STOP on

insert into users (id, email, password_hash) values
  ('ca110000-0000-4000-8000-000000000001', 'sofia@example.test', 'not-a-real-hash'),
  ('ca110000-0000-4000-8000-000000000002', 'jonas@example.test', 'not-a-real-hash');

insert into agencies (id, name) values
  ('ca11a9e0-0000-4000-8000-000000000001', 'Sofia Catering'),
  ('ca11a9e0-0000-4000-8000-000000000002', 'Jonas Eventtechnik');

insert into agency_members (agency_id, user_id, role) values
  ('ca11a9e0-0000-4000-8000-000000000001', 'ca110000-0000-4000-8000-000000000001', 'owner'),
  ('ca11a9e0-0000-4000-8000-000000000002', 'ca110000-0000-4000-8000-000000000002', 'owner');

insert into catalogue_candidates
  (id, agency_id, name, unit, unit_price_cents, quantity_driver, confidence, source_refs)
values
  ('ca11ca11-0000-4000-8000-000000000001', 'ca11a9e0-0000-4000-8000-000000000001',
   'Fingerfood-Menü', 'Person', 1850, 'per_guest', 0.94,
   '[{"assetId":"menu.pdf","page":2,"excerpt":"Fingerfood-Menü ab 12 Personen 18,50 € p.P."}]'::jsonb),
  ('ca11ca11-0000-4000-8000-000000000002', 'ca11a9e0-0000-4000-8000-000000000001',
   'Getränkepauschale', 'Person', 1200, 'per_guest', 0.88, '[]'::jsonb),
  ('ca11ca11-0000-4000-8000-000000000003', 'ca11a9e0-0000-4000-8000-000000000001',
   'Menü ab 12 Pers.', 'Stück', 1850, 'per_item', 0.41, '[]'::jsonb);

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_login') then
    create role app_login login inherit;
  end if;
end $$;
grant app_user to app_login;

set role app_login;

-- ─── Nothing enters the live catalogue unconfirmed ──────────────────────────

do $$
declare
  live int;
begin
  perform set_config('app.current_user_id', 'ca110000-0000-4000-8000-000000000001', false);

  select count(*) into live from catalog_items;
  if live <> 0 then
    raise exception 'FAIL §7 — % catalogue items exist before anyone confirmed anything', live;
  end if;
  raise notice 'PASS §7 — importing candidates puts nothing in the live catalogue';
end $$;

do $$
begin
  -- No identity: the case a background worker would present. `confirm_candidate`
  -- must refuse rather than fall back to a system actor, because the value of
  -- F2.8 is that every live price traces to a person.
  perform set_config('app.current_user_id', '', false);

  begin
    perform public.confirm_candidate('ca11ca11-0000-4000-8000-000000000001', '{}'::jsonb, '{}');
    raise exception 'FAIL F2.8 — a candidate was confirmed with no user identity';
  exception
    when others then
      if sqlerrm like 'FAIL F2.8%' then raise; end if;
  end;

  raise notice 'PASS F2.8 — confirmation without a named human is refused';
end $$;

-- ─── A plain confirmation ───────────────────────────────────────────────────

do $$
declare
  result record;
  item record;
  v record;
begin
  perform set_config('app.current_user_id', 'ca110000-0000-4000-8000-000000000001', false);

  select * into result
  from public.confirm_candidate('ca11ca11-0000-4000-8000-000000000001', '{}'::jsonb, '{}');

  select * into item from catalog_items where id = result.catalog_item_id;
  if item.id is null then
    raise exception 'FAIL C3 — confirmation produced no catalogue item';
  end if;
  if item.unit_price_cents <> 1850 then
    raise exception 'FAIL C3 — the confirmed price is % rather than 1850', item.unit_price_cents;
  end if;
  -- D8: the floor defaults to the list price, so refusing to discount is the
  -- out-of-box behaviour and allowing one is a deliberate later act.
  if item.floor_price_cents <> 1850 then
    raise exception 'FAIL D8 — the floor defaulted to % rather than the list price',
      item.floor_price_cents;
  end if;

  select * into v from candidate_verdicts where candidate_id = 'ca11ca11-0000-4000-8000-000000000001';
  if v.verdict <> 'confirmed' then
    raise exception 'FAIL §4 — an untouched confirmation was recorded as %', v.verdict;
  end if;
  -- "We read it this way and nobody had to touch it" is the strongest positive
  -- example there is, so `corrected_to` being null is the signal, not a gap.
  if v.corrected_to is not null then
    raise exception 'FAIL §4 — an untouched confirmation recorded a correction';
  end if;
  if v.read_as->>'name' <> 'Fingerfood-Menü' then
    raise exception 'FAIL §4 — the verdict did not record what was read';
  end if;
  if v.confidence_before <> 0.940 then
    raise exception 'FAIL §4 — the verdict recorded confidence % rather than 0.94', v.confidence_before;
  end if;

  raise notice 'PASS §4 — a confirmation records what was read and who decided';
end $$;

-- ─── An edit is the interesting signal ──────────────────────────────────────

do $$
declare
  v record;
  item record;
begin
  perform set_config('app.current_user_id', 'ca110000-0000-4000-8000-000000000001', false);

  -- The example from §4: we read "18,50 p.P." as a per-item price; the owner
  -- corrects it to per-person and renames it.
  perform public.confirm_candidate(
    'ca11ca11-0000-4000-8000-000000000003',
    '{"name":"Fingerfood-Menü klein","quantityDriver":"per_guest"}'::jsonb,
    array['name', 'quantityDriver']
  );

  select * into v from candidate_verdicts where candidate_id = 'ca11ca11-0000-4000-8000-000000000003';

  if v.verdict <> 'edited' then
    raise exception 'FAIL §4 — a corrected confirmation was recorded as %', v.verdict;
  end if;
  if v.read_as->>'quantityDriver' <> 'per_item' then
    raise exception 'FAIL §4 — the verdict lost what extraction originally proposed';
  end if;
  if v.corrected_to->>'quantityDriver' <> 'per_guest' then
    raise exception 'FAIL §4 — the verdict lost what the owner corrected it to';
  end if;
  -- Both halves, or the row is useless: the correction without the original says
  -- nothing about how to read better, and the original without the correction is
  -- the naive design again.
  if not (v.corrected_fields @> array['name','quantityDriver']) then
    raise exception 'FAIL §4 — the verdict did not name which fields were corrected';
  end if;

  select * into item from catalog_items
  where agency_id = 'ca11a9e0-0000-4000-8000-000000000001' and name = 'Fingerfood-Menü klein';
  if item.id is null then
    raise exception 'FAIL C3 — the owner edit did not reach the live catalogue';
  end if;
  if item.quantity_driver <> 'per_guest' then
    raise exception 'FAIL §7 — the extractor value beat the owner value';
  end if;

  raise notice 'PASS §4 — an edit records both what was read and what it was corrected to';
end $$;

-- ─── A rejection is retained, not deleted ───────────────────────────────────

do $$
declare
  v record;
begin
  perform set_config('app.current_user_id', 'ca110000-0000-4000-8000-000000000001', false);

  perform public.reject_candidate('ca11ca11-0000-4000-8000-000000000002', 'Bieten wir nicht mehr an');

  select * into v from candidate_verdicts where candidate_id = 'ca11ca11-0000-4000-8000-000000000002';
  if v.verdict <> 'rejected' then
    raise exception 'FAIL F2.8 — a rejection was not recorded';
  end if;
  -- Extraction that keeps proposing something the owner has thrown out three
  -- times is worse than extraction that proposes nothing.
  if v.read_as->>'name' <> 'Getränkepauschale' then
    raise exception 'FAIL F2.8 — a rejection did not retain what was proposed';
  end if;

  if exists (select 1 from catalog_items where name = 'Getränkepauschale') then
    raise exception 'FAIL §7 — a rejected candidate reached the live catalogue';
  end if;

  raise notice 'PASS F2.8 — rejections are retained as negative signal';
end $$;

-- ─── The bulk gesture produces one example per item ─────────────────────────

do $$
declare
  ids uuid[];
  confirmed int;
  verdicts int;
begin
  perform set_config('app.current_user_id', 'ca110000-0000-4000-8000-000000000001', false);

  insert into catalogue_candidates (agency_id, name, unit, unit_price_cents, confidence)
  select 'ca11a9e0-0000-4000-8000-000000000001', 'Leistung ' || n, 'Stück', 1000 + n, 0.9
  from generate_series(1, 24) n;

  select array_agg(id) into ids
  from catalogue_candidates
  where agency_id = 'ca11a9e0-0000-4000-8000-000000000001'
    and status = 'unconfirmed' and name like 'Leistung %';

  confirmed := public.confirm_candidates_bulk(ids);
  if confirmed <> 24 then
    raise exception 'FAIL C3 — the bulk gesture confirmed % of 24', confirmed;
  end if;

  select count(*) into verdicts
  from candidate_verdicts where candidate_id = any (ids);

  -- The one that matters. A set-based bulk confirm would pass the count above
  -- and fail here, having confirmed 24 items while producing 1 training example.
  if verdicts <> 24 then
    raise exception 'FAIL §4 — 24 confirmations produced % verdicts, not 24', verdicts;
  end if;

  -- Pressing it twice, or on two devices, must not turn the gesture into an
  -- error after it has already confirmed nineteen of them.
  if public.confirm_candidates_bulk(ids) <> 0 then
    raise exception 'FAIL C3 — a repeated bulk confirmation re-confirmed decided candidates';
  end if;

  raise notice 'PASS C3 — one tap, 24 items, 24 training examples, and idempotent';
end $$;

-- ─── Tenant isolation ───────────────────────────────────────────────────────

do $$
declare
  visible int;
begin
  perform set_config('app.current_user_id', 'ca110000-0000-4000-8000-000000000002', false);

  select count(*) into visible from catalogue_candidates;
  if visible <> 0 then
    raise exception 'FAIL F0.4 — another tenant sees % candidates', visible;
  end if;

  select count(*) into visible from candidate_verdicts;
  if visible <> 0 then
    raise exception 'FAIL F0.4 — another tenant sees % verdicts', visible;
  end if;

  raise notice 'PASS F0.4 — candidates and verdicts are tenant-isolated';
end $$;

reset role;

-- Clean up: prospects.sql and enrichment.sql make exact-count assertions, and a
-- fixture left behind here would fail a test that has nothing to do with this one.
delete from candidate_verdicts where agency_id::text like 'ca11a9e0%';
delete from catalogue_candidates where agency_id::text like 'ca11a9e0%';
delete from catalog_items where agency_id::text like 'ca11a9e0%';
delete from agency_members where agency_id::text like 'ca11a9e0%';
delete from agencies where id::text like 'ca11a9e0%';
delete from users where id::text like 'ca110000%';

select 'ALL CANDIDATE ASSERTIONS PASSED' as result;
