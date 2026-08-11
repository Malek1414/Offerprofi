-- ============================================================================
-- 0024 — candidates, and the verdicts that are the whole point
--
-- `src/onboarding/candidates.ts` has had the candidate *types* since Phase 2 —
-- `CatalogueCandidate`, `ConfirmedCatalogItem`, `RejectedCandidate`, and a
-- `confirmCandidate` that refuses to run without a named human. What it has never
-- had is anywhere to put them, so a candidate lived for the length of one request
-- and an owner who closed the tab lost the lot.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE VERDICT IS THE PRODUCT, NOT THE CANDIDATE.
--
-- §4 is emphatic and it is the load-bearing idea in the whole enrichment design:
-- a scraped page with no verdict attached is text, not knowledge. Storing more
-- text makes retrieval noisier and noisier retrieval raises fabrication risk, so
-- "scrape more, get smarter" has those two goals pulling against each other.
--
-- What breaks the tie is that every confirm, edit and reject is a labelled
-- example, produced free by the best-qualified labeller alive for that data:
--
--     we read <h3> as the item name        → the owner renamed it
--     we read "18,50 p.P." as per-unit     → the owner corrected it to per-person
--
-- `candidate_verdicts` is where that sentence becomes a row. It stores what was
-- read *and* what the owner made of it, because either one alone is useless: the
-- correction without the original says nothing about how to read better, and the
-- original without the correction is the naive design again.
-- ─────────────────────────────────────────────────────────────────────────────

create type candidate_status as enum ('unconfirmed', 'confirmed', 'rejected');

create table catalogue_candidates (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,

  -- 'onboarding_upload' | 'enrichment_crawl' | 'manual'. Text rather than an enum
  -- because Phase C adds origins and a migration per origin is friction with no
  -- payoff.
  origin text not null default 'onboarding_upload',

  name text not null,
  description text not null default '',
  unit text not null default '',
  unit_price_cents bigint not null default 0,
  -- Same domain as catalog_items.vat_rate, and constrained here rather than only
  -- there. A candidate carrying 19.5 would pass extraction, survive review, and
  -- fail at the moment of confirmation — which is the worst place to discover it,
  -- because the owner has already done the work of deciding.
  vat_rate smallint check (vat_rate is null or vat_rate in (0, 7, 19)),
  quantity_driver quantity_driver not null default 'flat',

  -- F2.6. How many of the uploaded quotes contained this item, out of how many.
  -- An item in all three of her past quotes is her core offering; one appearing
  -- once may have been a favour for a friend, and pricing future weddings off it
  -- would be wrong.
  frequency integer not null default 1,
  quote_count integer not null default 1,

  -- ─── What C3 sorts on ─────────────────────────────────────────────────────
  -- The existing thresholds apply: >=0.8 on a required field and >=0.75 overall
  -- puts a candidate in the confident group that gets one bulk gesture; below 0.5
  -- is always individual and never guessed. This column is what makes "owner
  -- attention is spent only where the model is uncertain" a query rather than an
  -- intention.
  confidence numeric(4,3) not null default 0,

  -- Where each value was read from, verbatim. The C3 evidence panel cites this,
  -- and the verdict below is unwriteable without it.
  source_refs jsonb not null default '[]'::jsonb,

  status candidate_status not null default 'unconfirmed',
  -- Set on confirmation. The one link from a candidate into the live catalogue,
  -- and the reason that link cannot be forged: it is written by the function
  -- below, which requires a named human.
  catalog_item_id uuid references catalog_items(id) on delete set null,

  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references users(id) on delete set null,

  -- Nothing enters the live catalogue unconfirmed, stated as a constraint rather
  -- than trusted to the application. A decided candidate names who decided and
  -- when; an undecided one has neither.
  constraint candidates_decided_consistently
    check ((status = 'unconfirmed') = (decided_at is null)),
  constraint candidates_decided_by_a_human
    check (status = 'unconfirmed' or decided_by is not null),
  constraint candidates_only_confirmed_are_live
    check (catalog_item_id is null or status = 'confirmed')
);

create index catalogue_candidates_queue_idx
  on catalogue_candidates (agency_id, status, confidence desc);

comment on table catalogue_candidates is
  'A proposal. Never priced against, never shown to a customer, never active until a named human confirms it.';

create table candidate_verdicts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  candidate_id uuid not null references catalogue_candidates(id) on delete cascade,

  verdict text not null check (verdict in ('confirmed', 'edited', 'rejected')),

  -- ─── The training signal ──────────────────────────────────────────────────
  -- `read_as` is what extraction proposed. `corrected_to` is what the owner made
  -- of it, and is null for a plain confirm or a reject — which is itself signal:
  -- "we read it this way and nobody had to touch it" is the strongest positive
  -- example there is.
  read_as jsonb not null,
  corrected_to jsonb,
  confidence_before numeric(4,3) not null,
  -- Which of the six §11 fields the correction touched, so the shared layer can
  -- be asked "how often is the unit wrong on a PDF menu?" without reparsing every
  -- verdict ever recorded.
  corrected_fields text[] not null default '{}',

  language text not null default 'de',
  -- Rejections are retained rather than deleted (F2.8, negative signal).
  -- Extraction that keeps proposing something the owner has thrown out three
  -- times is worse than extraction that proposes nothing, and the only way to
  -- know is to remember.
  reason text,

  decided_by uuid not null references users(id) on delete restrict,
  decided_at timestamptz not null default now(),

  -- Null until the pattern observation has been written to the shared layer.
  -- Nullable on purpose: the sidecar is allowed to be down (§4, "on outage:
  -- degrade to baseline"), and a verdict that could not be forwarded must still
  -- be recorded here and forwarded later rather than lost or blocking the owner.
  observed_at timestamptz
);

create index candidate_verdicts_pending_idx on candidate_verdicts (observed_at)
  where observed_at is null;
create index candidate_verdicts_agency_idx on candidate_verdicts (agency_id, decided_at desc);

comment on table candidate_verdicts is
  'Every confirm, edit and reject, with what was read alongside what the owner made of it. This is the flywheel — see §4.';

-- `on delete restrict` on decided_by, not `set null`. A verdict whose author has
-- been deleted is an audit record that can no longer answer the one question it
-- exists to answer, and F2.8 requires that a confirmed fact name the human who
-- confirmed it. Deleting the user has to be blocked, or handled deliberately.

-- ─── RLS ────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array['catalogue_candidates', 'candidate_verdicts'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);

    execute format($p$
      create policy %I on %I for select to app_user
      using (public.is_agency_member(agency_id))
    $p$, t || '_select', t);

    execute format($p$
      create policy %I on %I for insert to app_user
      with check (public.is_agency_member(agency_id))
    $p$, t || '_insert', t);

    execute format($p$
      create policy %I on %I for update to app_user
      using (public.is_agency_member(agency_id))
      with check (public.is_agency_member(agency_id))
    $p$, t || '_update', t);
  end loop;
end $$;

-- Deliberately no delete policy on candidate_verdicts. F2.8 retains rejections as
-- negative signal, and a training record that can be quietly removed is one that
-- will be, the first time somebody is tidying up.
create policy catalogue_candidates_delete on catalogue_candidates
  for delete to app_user using (public.is_agency_member(agency_id));

grant select, insert, update on catalogue_candidates, candidate_verdicts to app_user;
grant delete on catalogue_candidates to app_user;

-- ─── Confirming ─────────────────────────────────────────────────────────────
--
-- `security invoker`, so the identity doing this is a real logged-in member and
-- RLS is the gate. There is no service-role path into the live catalogue, and
-- that absence is the enforcement — CLAUDE.md §7: nothing enters the live
-- catalogue unconfirmed.
--
-- One statement's worth of work in one transaction: write the catalogue item,
-- mark the candidate, record the verdict. Split across three round trips, a
-- process killed in the middle leaves a live catalogue item that no verdict
-- explains, and the flywheel quietly loses an example every time a deploy lands
-- at the wrong moment.
create or replace function public.confirm_candidate(
  p_candidate_id uuid,
  p_edits jsonb,
  p_corrected_fields text[]
)
returns table (catalog_item_id uuid, verdict_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  c record;
  v_user uuid := public.current_user_id();
  v_item uuid;
  v_verdict uuid;
  v_name text;
  v_description text;
  v_unit text;
  v_price bigint;
  v_vat smallint;
  v_driver quantity_driver;
begin
  if v_user is null then
    raise exception 'confirm_candidate requires an authenticated user (F2.8)';
  end if;

  select * into c from public.catalogue_candidates where id = p_candidate_id;
  if c.id is null then
    raise exception 'confirm_candidate: no such candidate %', p_candidate_id;
  end if;
  if c.status <> 'unconfirmed' then
    raise exception 'confirm_candidate: candidate % was already decided', p_candidate_id;
  end if;

  -- The owner's values win over the extractor's, always. CLAUDE.md §7:
  -- owner-supplied values are confidence 1.0.
  v_name        := coalesce(p_edits->>'name', c.name);
  v_description := coalesce(p_edits->>'description', c.description);
  v_unit        := coalesce(p_edits->>'unit', c.unit);
  v_price       := coalesce((p_edits->>'unitPriceCents')::bigint, c.unit_price_cents);
  v_vat         := coalesce((p_edits->>'vatRate')::smallint, c.vat_rate, 19::smallint);
  v_driver      := coalesce((p_edits->>'quantityDriver')::quantity_driver, c.quantity_driver);

  insert into public.catalog_items
    (agency_id, name, description, unit, unit_price_cents, floor_price_cents,
     vat_rate, quantity_driver, active, confirmed_by, confirmed_at)
  values
    (c.agency_id, v_name, v_description, v_unit, v_price,
     -- D8: the floor defaults to the list price, so no-discounting is the
     -- out-of-box behaviour and permitting one is a deliberate later act.
     coalesce((p_edits->>'floorPriceCents')::bigint, v_price),
     v_vat, v_driver, true,
     -- F2.8, and `active_items_must_be_confirmed` in 0001 refuses the row without
     -- it. The constraint is why this function cannot be written carelessly: an
     -- active catalogue item that names nobody is rejected by the database, not
     -- by a reviewer noticing.
     v_user, now())
  returning id into v_item;

  update public.catalogue_candidates
  set status = 'confirmed', catalog_item_id = v_item,
      decided_at = now(), decided_by = v_user
  where id = p_candidate_id;

  insert into public.candidate_verdicts
    (agency_id, candidate_id, verdict, read_as, corrected_to, confidence_before,
     corrected_fields, decided_by)
  values
    (c.agency_id, p_candidate_id,
     case when p_corrected_fields = '{}' then 'confirmed' else 'edited' end,
     jsonb_build_object(
       'name', c.name, 'description', c.description, 'unit', c.unit,
       'unitPriceCents', c.unit_price_cents, 'vatRate', c.vat_rate,
       'quantityDriver', c.quantity_driver, 'sourceRefs', c.source_refs
     ),
     case when p_corrected_fields = '{}' then null else p_edits end,
     c.confidence, coalesce(p_corrected_fields, '{}'), v_user)
  returning id into v_verdict;

  return query select v_item, v_verdict;
end;
$$;

comment on function public.confirm_candidate is
  'The only route from a candidate into the live catalogue. security invoker: there is no service-role path, and that absence is the enforcement.';

create or replace function public.reject_candidate(
  p_candidate_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  c record;
  v_user uuid := public.current_user_id();
  v_verdict uuid;
begin
  if v_user is null then
    raise exception 'reject_candidate requires an authenticated user';
  end if;

  select * into c from public.catalogue_candidates where id = p_candidate_id;
  if c.id is null then
    raise exception 'reject_candidate: no such candidate %', p_candidate_id;
  end if;

  update public.catalogue_candidates
  set status = 'rejected', decided_at = now(), decided_by = v_user
  where id = p_candidate_id;

  -- A rejection is as much signal as a confirmation, so it carries the same
  -- `read_as` payload. "We proposed this and she threw it out" is what stops the
  -- next extraction proposing it again.
  insert into public.candidate_verdicts
    (agency_id, candidate_id, verdict, read_as, confidence_before, decided_by, reason)
  values
    (c.agency_id, p_candidate_id, 'rejected',
     jsonb_build_object(
       'name', c.name, 'description', c.description, 'unit', c.unit,
       'unitPriceCents', c.unit_price_cents, 'vatRate', c.vat_rate,
       'quantityDriver', c.quantity_driver, 'sourceRefs', c.source_refs
     ),
     c.confidence, v_user, nullif(btrim(coalesce(p_reason, '')), ''))
  returning id into v_verdict;

  return v_verdict;
end;
$$;

-- ─── The bulk gesture ───────────────────────────────────────────────────────
--
-- "Alle 24 übernehmen". C3's governing principle is that owner attention is spent
-- only where the model is uncertain and everything else is one tap, and the loop
-- dies if owners disengage — so this exists for the confident group.
--
-- It is a loop over `confirm_candidate` rather than a bulk INSERT, on purpose:
-- one verdict per candidate is what the flywheel eats, and a set-based version
-- that wrote one aggregate row would confirm 24 items while producing one
-- training example. Twenty-four cheap round trips inside one transaction is the
-- correct trade.
create or replace function public.confirm_candidates_bulk(p_candidate_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  id uuid;
  n integer := 0;
begin
  foreach id in array p_candidate_ids loop
    -- Skip rather than fail on an already-decided candidate. Two devices, or a
    -- double tap on a slow connection, must not turn the whole gesture into an
    -- error after it has already confirmed nineteen of them.
    begin
      perform public.confirm_candidate(id, '{}'::jsonb, '{}');
      n := n + 1;
    exception
      when others then
        if sqlerrm not like '%already decided%' then raise; end if;
    end;
  end loop;
  return n;
end;
$$;

grant execute on function public.confirm_candidate(uuid, jsonb, text[]) to app_user;
grant execute on function public.reject_candidate(uuid, text) to app_user;
grant execute on function public.confirm_candidates_bulk(uuid[]) to app_user;

-- ─── Coverage assertion ─────────────────────────────────────────────────────
do $$
declare
  unprotected text;
begin
  select string_agg(c.relname, ', ')
  into unprotected
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid
  where n.nspname = 'public'
    and c.relkind = 'r'
    and a.attname = 'agency_id'
    and not c.relrowsecurity;

  if unprotected is not null then
    raise exception 'Tables carry agency_id but have no RLS: %', unprotected;
  end if;
end $$;
