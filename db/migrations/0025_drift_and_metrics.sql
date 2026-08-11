-- ============================================================================
-- 0025 — drift cards (C4) and the measurement behind the bar (C5)
--
-- Two things that keep the flywheel turning after week one, and one of them is
-- the only number in the product that is allowed to embarrass us.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY EVERY METRIC RUN IS KEPT, INCLUDING THE BAD ONES.
--
-- C5 says the property that makes the "% smarter" bar credible is that the
-- number can go down. That property lives here as much as in the arithmetic: a
-- table that stores only the current score, or only improvements, cannot express
-- a regression no matter how honest the code computing it is. Storing the whole
-- history — with the fingerprint of the golden set each run was measured
-- against — is what lets anyone check later whether the number rose because
-- extraction improved or because the exam got easier.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── The golden set (C5) ────────────────────────────────────────────────────
--
-- Held out and frozen. Platform-scoped rather than tenant-scoped, gated by
-- `is_platform_operator()` from 0020: it is our measuring instrument, not any
-- agency's data, and a tenant who could read it could — eventually — have
-- extraction tuned against it, at which point it measures memorisation.
create table golden_examples (
  id uuid primary key default gen_random_uuid(),
  -- §11's stratification: Berlin catering / event services / décor rental.
  stratum text not null,
  source_kind text not null default 'web_page',
  -- The raw source, kept so a run is reproducible years later. A metric whose
  -- inputs are gone cannot be re-derived, which makes every past number an
  -- assertion rather than a measurement.
  source_text text not null,
  /* The label: [{ itemKey, field, value }]. */
  expected jsonb not null,
  frozen_at timestamptz,
  created_at timestamptz not null default now()
);

create index golden_examples_stratum_idx on golden_examples (stratum);

comment on table golden_examples is
  'The held-out set the C5 number is measured against. Frozen at first import and never added to — see the note in src/metrics/f1.ts about why a rising score means nothing without the fingerprint.';

create table metric_runs (
  id uuid primary key default gen_random_uuid(),

  precision numeric(5,4) not null check (precision between 0 and 1),
  recall numeric(5,4) not null check (recall between 0 and 1),
  f1 numeric(5,4) not null check (f1 between 0 and 1),
  true_positives integer not null,
  false_positives integer not null,
  false_negatives integer not null,

  example_count integer not null,
  -- Which exam this was. Without it, "0.71 → 0.88" and "we removed the hard
  -- examples" are indistinguishable from outside.
  set_fingerprint text not null,
  -- The x-axis of the story: how much owner feedback existed at the time.
  confirmed_candidates integer not null default 0,

  measured_at timestamptz not null default now()
);

create index metric_runs_recent_idx on metric_runs (measured_at desc);

-- Deliberately no delete policy and no update policy below. A history that can be
-- edited is not a history, and the one edit anybody would ever be tempted to make
-- is removing the run where the number went down.
comment on table metric_runs is
  'Every measurement, including regressions. Append-only by policy: the only edit anyone would want to make is deleting a bad run.';

-- ─── Drift (C4) ─────────────────────────────────────────────────────────────
--
-- Brand identity is not static. Prices move with inflation and with the owner's
-- own creative decisions, so a catalogue confirmed in March is wrong by
-- September unless something notices.
--
-- A drift row is deliberately *not* a candidate. A candidate says "here is
-- something we think you sell"; a drift card says "the thing you already
-- confirmed no longer matches your website". The second is a thirty-second
-- decision about three numbers, and routing it through the candidate queue would
-- turn it into a re-onboarding — which is the failure mode C4 exists to avoid.
create type drift_status as enum ('open', 'accepted', 'dismissed');

create table catalogue_drift (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  catalog_item_id uuid not null references catalog_items(id) on delete cascade,

  field text not null,
  -- What the confirmed catalogue says today.
  current_value text not null,
  -- What the re-crawl read.
  observed_value text not null,
  -- Where it was read, verbatim, so the owner verifies by glance rather than by
  -- opening her own website and hunting.
  source_url text not null default '',
  excerpt text not null default '',

  status drift_status not null default 'open',
  detected_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references users(id) on delete set null,

  constraint drift_decided_consistently
    check ((status = 'open') = (decided_at is null))
);

-- One open card per item and field. A weekly re-crawl that finds the same
-- unchanged difference must not stack up seven identical cards by Sunday — that
-- is how a useful nudge becomes something the owner learns to ignore.
create unique index catalogue_drift_open_idx
  on catalogue_drift (agency_id, catalog_item_id, field)
  where status = 'open';

create index catalogue_drift_agency_idx on catalogue_drift (agency_id, status, detected_at desc);

comment on table catalogue_drift is
  'A confirmed catalogue value that no longer matches the source. Three items, thirty seconds — not a re-onboarding.';

-- ─── Per-tenant re-crawl cadence ────────────────────────────────────────────
--
-- Weekly is the §11 default, as a setting rather than a constant so it can be
-- tuned on evidence rather than on a guess made today.
alter table agencies add column if not exists recrawl_interval_days smallint not null default 7
  check (recrawl_interval_days between 0 and 365);

comment on column agencies.recrawl_interval_days is
  'C4 cadence. 0 disables re-crawling for this tenant.';

-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table catalogue_drift enable row level security;
alter table catalogue_drift force row level security;

create policy catalogue_drift_select on catalogue_drift
  for select to app_user using (public.is_agency_member(agency_id));
create policy catalogue_drift_insert on catalogue_drift
  for insert to app_user with check (public.is_agency_member(agency_id));
create policy catalogue_drift_update on catalogue_drift
  for update to app_user
  using (public.is_agency_member(agency_id))
  with check (public.is_agency_member(agency_id));

do $$
declare
  t text;
begin
  foreach t in array array['golden_examples', 'metric_runs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);

    execute format($p$
      create policy %I on %I for select to app_user
      using (public.is_platform_operator())
    $p$, t || '_select', t);

    execute format($p$
      create policy %I on %I for insert to app_user
      with check (public.is_platform_operator())
    $p$, t || '_insert', t);
  end loop;
end $$;

-- `golden_examples` gets an update policy so a set can be corrected *before* it is
-- frozen. `metric_runs` gets none, on purpose.
create policy golden_examples_update on golden_examples
  for update to app_user
  using (public.is_platform_operator() and frozen_at is null)
  with check (public.is_platform_operator());

grant select, insert, update on catalogue_drift to app_user;
grant select, insert on golden_examples, metric_runs to app_user;
grant update on golden_examples to app_user;

-- ─── Freezing ───────────────────────────────────────────────────────────────
--
-- One-way. After this the update policy above can never match again, because it
-- requires `frozen_at is null` — so the freeze is enforced by the same mechanism
-- that enforces tenancy rather than by a convention someone can forget.
create or replace function public.freeze_golden_set()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  update public.golden_examples set frozen_at = now() where frozen_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.freeze_golden_set() to app_user;

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
