-- ============================================================================
-- 0021 — the enrichment queue, the spend ledger and the crawl cache (C1)
--
-- Three tables that only make sense together: something has to decide *what*
-- work happens (the queue), *whether it may cost money* (the ledger), and
-- *whether it has already been done* (the cache). Split them across three
-- systems and the second question can no longer be answered atomically with the
-- first, which is the whole failure this migration exists to prevent.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ORCHESTRATION LIVES IN POSTGRES. NOT ASTRA, NOT COGNEE, NOT n8n (C1, D33).
--
-- The obvious alternative is a workflow tool — n8n is already in the stack and
-- draws these boxes for you. It is the wrong place, for a reason that is not
-- aesthetic:
--
--   * The cap and the spend must commit together. A queue outside the database
--     can only *ask* the database whether there is budget, act on the answer,
--     and write the result back — three round trips with two windows in which a
--     crashed worker leaves money spent and unrecorded, or recorded and unspent.
--     Here `charge_enrichment` locks the row, tests the cap and writes the
--     charge in one transaction, and `enrichment_jobs_within_budget` is a CHECK
--     constraint, so the only way to exceed a cap is to abort.
--   * A job's state and the rows it produced are the same transaction. A worker
--     killed halfway leaves neither a half-written prospect nor a job that
--     claims success over rows that were rolled back.
--   * D33: pgvector is already here (D29). A third store buys nothing today.
--
-- n8n observes this queue — it fires on candidate-confirmed for the C5 metric,
-- it can post an escalation to Slack. It never orchestrates it. If n8n is down,
-- enrichment keeps running; if this table is down, nothing was going to run
-- anyway, because the prospects live here too.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ─────────────────────────────────────────────────────────────────────────────
-- MONEY IS AN INTEGER NUMBER OF MICRO-CENTS, EVERYWHERE, WITH NO EXCEPTIONS.
--
-- Same argument as src/agent/cost.ts, and the same units, deliberately: one
-- Tavily credit is $0.008, which is 0.8 of a cent, which is a figure that does
-- not survive being summed a few thousand times in a float. A cap enforced
-- against a total that drifts is not a cap. Every column below that holds money
-- is `bigint` micro-cents, every arithmetic operation on it is integer, and the
-- only place a decimal point appears is `formatMicroCents` at the point of
-- display.
--
-- `bigint` rather than `integer` because `integer` tops out at about $21.47 of
-- micro-cents. No single charge will approach that, but a `sum()` over a year of
-- the ledger would, and a column whose type is only correct until the product
-- succeeds is a column that will be migrated at the worst possible moment.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Everything here is **platform-scoped**, like `prospects`: no `agency_id`, and
-- therefore not in the 0002 tenant-table list at all. The gate is
-- `is_platform_operator()` from 0020. See that migration for why prospect data
-- is not tenant data and why membership of an agency is the wrong question to
-- ask about it.

-- ─── Job state ──────────────────────────────────────────────────────────────
--
-- Five states, and the two terminal-but-not-successful ones are deliberately
-- different from each other:
--
--   'failed'  — something broke. A network reset, a 500, an unparseable page.
--               Retryable unless `failure_permanent`, and `stop_reason` says
--               what broke.
--   'capped'  — nothing broke. The money ran out, or the page budget did. This
--               is a policy outcome, not an error, and retrying it immediately
--               would produce the identical outcome at the identical cost.
--
-- Collapsing them into one state loses the only distinction an operator
-- actually acts on: a wall of 'failed' jobs that are really 'we set the cap too
-- low' is a wall nobody reads.
create type enrichment_job_state as enum (
  'queued',     -- waiting, and `next_attempt_at` has to have passed
  'leased',     -- a worker holds it until `lease_expires_at`
  'succeeded',
  'failed',     -- see stop_reason; retryable unless failure_permanent
  'capped'      -- see stop_reason; hit a budget or a page cap and stopped
);

-- ─── A NOTE ON 'capped', SO IT IS NOT MISREAD AS A REFUSAL (I1) ─────────────
--
-- 0020 makes this argument for 'suppressed' and it has to be made again here,
-- because "the software stopped and said no" is exactly the shape invariant 1
-- forbids. It is not that, twice over:
--
--   1. Invariant 1 governs *inquiries* — a person who has approached the product
--      and must never be turned away by code. A prospect is a business on a list
--      we built, who has approached nobody. Nothing here is a decision about a
--      customer.
--   2. Even inside enrichment, hitting a cap does not decline anyone. It stops
--      *our* spending on *our* research. The prospect is untouched, the operator
--      sees the job and the reason, and raising the cap resumes it.
--
-- The parallel is `budget_exhausted` in src/agent/client.ts: a full meter ends
-- in a human, never in a refusal. This ends in an operator.

create table enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references prospects(id) on delete cascade,

  -- 'enrich' for the first pass (C1), 'recrawl' for the scheduled drift check
  -- (C4). Text rather than an enum for the same reason `prospect_sources.kind`
  -- is: Phase C will add kinds, and a migration per kind is friction with no
  -- payoff.
  kind text not null default 'enrich',
  state enrichment_job_state not null default 'queued',
  -- Higher runs first. Exists so a hand-triggered "enrich this one now, I am
  -- about to email them" beats a backlog of ten thousand imports.
  priority smallint not null default 0,

  -- ─── The lease ────────────────────────────────────────────────────────────
  --
  -- Not a boolean `locked` flag, because a worker that is killed between
  -- claiming and finishing would hold that flag forever and the job would need a
  -- human to notice. A lease *expires*, so the pathological case resolves itself
  -- in `lease_expires_at` seconds with no intervention. `leased_by` is for the
  -- log — knowing which host stalled is the difference between fixing a machine
  -- and re-running a job.
  leased_by text,
  leased_at timestamptz,
  lease_expires_at timestamptz,

  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  -- Backoff. Always set, so the claim query never has to special-case null.
  next_attempt_at timestamptz not null default now(),

  -- ─── The per-run cap ──────────────────────────────────────────────────────
  --
  -- 25,000,000 µ¢ = 25¢. Sized against what a run actually does: two Tavily
  -- searches (~1.6¢), a handful of page fetches (fractions of a cent), and one
  -- or two Sonnet extractions (~2.7¢ each at the list rates in
  -- src/agent/cost.ts). A normal run lands near 7¢, so the default is roughly
  -- 3.5x headroom — enough that a slightly unusual site does not trip it, small
  -- enough that a redirect loop on a hostile site stops before it matters.
  budget_micro_cents bigint not null default 25000000 check (budget_micro_cents >= 0),
  spent_micro_cents bigint not null default 0 check (spent_micro_cents >= 0),

  -- Breadth, capped separately from money. A site that serves a 200-byte page
  -- per URL would cost almost nothing and could still be crawled forever, so
  -- the page count needs its own ceiling; money alone does not bound it.
  pages_fetched integer not null default 0 check (pages_fetched >= 0),
  max_pages integer not null default 12 check (max_pages > 0),

  -- Why a terminal job ended. Read by an operator, so it is written for one.
  stop_reason text,
  -- 'the DNS name does not resolve' versus 'the connection reset'. Retrying the
  -- first forever is how a queue turns into a bill — 0020 makes the same
  -- distinction on `upload_jobs` and for the same reason.
  failure_permanent boolean not null default false,
  -- What the run produced: urls considered, pages fetched, candidate ids. Not
  -- the candidates themselves — those are per-tenant rows under RLS (C2).
  result_json jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,

  -- ─── The cap, as a constraint rather than as a convention ─────────────────
  --
  -- This is the load-bearing line of the whole migration. `charge_enrichment`
  -- tests the cap before it writes, but a function is only as good as the fact
  -- that everyone goes through it. This constraint means that a hand-written
  -- UPDATE at a psql prompt, a future function nobody remembers to review, and a
  -- bug in the charge path all fail the same way: the transaction aborts and no
  -- money is recorded as spent. There is no code path, present or future, that
  -- can put this table over its own limit.
  constraint enrichment_jobs_within_budget
    check (spent_micro_cents <= budget_micro_cents),
  constraint enrichment_jobs_within_pages
    check (pages_fetched <= max_pages),

  -- A terminal job that cannot say why is a job an operator can see and cannot
  -- act on. Same rule as `upload_jobs_failure_has_reason` in 0020.
  constraint enrichment_jobs_terminal_has_reason
    check (state not in ('failed', 'capped') or stop_reason is not null),

  -- A lease belongs to exactly one state. Without this, a job could sit in
  -- 'queued' carrying a stale `lease_expires_at`, and the claim query — which
  -- reads that column — would quietly skip it forever.
  constraint enrichment_jobs_lease_matches_state
    check ((state = 'leased') = (lease_expires_at is not null))
);

-- ─── Enqueue is idempotent, structurally ────────────────────────────────────
--
-- One live job per prospect per kind. A partial unique index rather than a
-- check in the application, because the caller that enqueues is a loop over an
-- import of ten thousand rows and "did I already queue this one" is a question
-- that must not cost a round trip or be answerable wrongly under concurrency.
-- Terminal jobs are outside the index, so a prospect can be re-enriched next
-- week without deleting its history.
create unique index enrichment_jobs_live_idx on enrichment_jobs (prospect_id, kind)
  where state in ('queued', 'leased');

-- The claim query's index. Covers both arms of its WHERE: work that is due, and
-- leases that have expired.
create index enrichment_jobs_claim_idx
  on enrichment_jobs (state, priority desc, next_attempt_at)
  where state in ('queued', 'leased');
create index enrichment_jobs_prospect_idx on enrichment_jobs (prospect_id, created_at desc);

comment on table enrichment_jobs is
  'C1 — the enrichment work queue. Claimed with a lease under `for update skip locked`; its budget is a CHECK constraint, not a convention.';

-- ─── The per-prospect lifetime cap ──────────────────────────────────────────
--
-- The per-run cap alone does not bound anything: C4 re-crawls weekly, so a
-- prospect whose site defeats the extractor would burn a fresh 25¢ every week
-- forever and no single run would ever look wrong. This is the ceiling that
-- notices.
--
-- A separate table rather than two more columns on `prospects` because
-- `prospects` is B3's table and is written by the import path; a cap that lives
-- on it would be re-set, silently, by the next import of the same business.
create table enrichment_prospect_budget (
  prospect_id uuid primary key references prospects(id) on delete cascade,
  -- 100,000,000 µ¢ = $1.00 across the entire life of the prospect, including
  -- every re-crawl. At the rates above that is roughly fourteen full runs.
  cap_micro_cents bigint not null default 100000000 check (cap_micro_cents >= 0),
  spent_micro_cents bigint not null default 0 check (spent_micro_cents >= 0),
  first_spend_at timestamptz,
  last_spend_at timestamptz,

  constraint enrichment_prospect_budget_within_cap
    check (spent_micro_cents <= cap_micro_cents)
);

comment on table enrichment_prospect_budget is
  'C1 — lifetime spend ceiling per prospect, across every run. The per-run cap cannot bound a weekly re-crawl; this can.';

-- ─── The ledger ─────────────────────────────────────────────────────────────
--
-- Append-only, and deliberately *not* the thing the cap is enforced against.
--
-- The temptation is to make this table the single source of truth and enforce
-- the cap with `sum(micro_cents) + new <= cap`. That is one aggregate over a
-- growing table on every charge, and — worse — it cannot be made atomic without
-- locking the whole partition, so two concurrent charges both read the same
-- under-cap sum and both proceed. 0018 makes the same argument about `select
-- count(*)`: a total you read and then act on is stale by the time you act.
--
-- So the counters on the two tables above are the enforcement, and this is the
-- explanation. Exactly the relationship `agent_runs` has to
-- `model_spend_budget`: one is the invoice, the other can say no.
create table enrichment_spend (
  id bigserial primary key,
  -- Nulled rather than cascaded when a job row is pruned: the money was still
  -- spent, and a ledger that forgets charges to keep its foreign keys tidy is
  -- not a ledger.
  job_id uuid references enrichment_jobs(id) on delete set null,
  -- Cascaded, though, because 0020's `erase_prospect` must actually erase. A
  -- spend row surviving the prospect it was spent on would be an orphan that a
  -- GDPR Art. 17 response could not honestly account for.
  prospect_id uuid not null references prospects(id) on delete cascade,

  kind text not null check (kind in ('tavily_search', 'crawl_fetch', 'model_call', 'other')),
  micro_cents bigint not null check (micro_cents >= 0),
  -- What was bought. A URL, a query, a model id. The answer to "what did this
  -- prospect actually cost us and on what", which is open question #3 asked
  -- about the sales side instead of the product side.
  detail text not null default '',
  spent_at timestamptz not null default now()
);

create index enrichment_spend_prospect_idx on enrichment_spend (prospect_id, spent_at desc);
create index enrichment_spend_job_idx on enrichment_spend (job_id);

comment on table enrichment_spend is
  'C1 — append-only record of every micro-cent spent on enrichment. The invoice; the caps live on enrichment_jobs and enrichment_prospect_budget.';

-- ─── The crawl cache ────────────────────────────────────────────────────────
--
-- ─────────────────────────────────────────────────────────────────────────────
-- KEYED ON (normalised url, content hash), AND HISTORY IS KEPT ON PURPOSE.
--
-- The single-row-per-URL design is cheaper and wrong. C4 — drift cards — has to
-- answer "what changed since the version the owner confirmed", and that
-- sentence is unwriteable if the previous version was overwritten by the fetch
-- that noticed the change. So a row per (url, content) pair, and "current" is
-- the one with the newest `last_checked_at`.
--
-- The hash is over *extracted text*, not raw bytes; src/enrichment/crawl.ts
-- explains why at length. Briefly: a CSRF nonce, a rotating ad slot or a
-- rendered timestamp changes the bytes on every single fetch, so a byte hash
-- would never hit and the cache would exist without ever working.
--
-- Note what re-crawling an unchanged page costs once this hits: one conditional
-- HTTP request (or none, inside the freshness window) and no extraction, no
-- model call, no candidate churn. The model call is ~2.7¢ and the page fetch is
-- a fraction of one, so the cache is not a latency optimisation — it is most of
-- the cost of the weekly re-crawl of every prospect.
-- ─────────────────────────────────────────────────────────────────────────────
create table crawl_cache (
  url_norm text not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),

  http_status integer not null,
  content_type text not null default '',
  byte_size integer not null default 0 check (byte_size >= 0),

  -- For the conditional request. Sending `If-None-Match` and getting a 304 is
  -- the politest possible re-crawl: it costs the prospect's server nothing and
  -- tells us the content is unchanged without transferring it.
  etag text,
  last_modified text,

  -- Enough of the page to cite as evidence in the C3 confirmation UI without a
  -- second fetch. Full bytes, when they are kept at all, go to the object store
  -- under `object_key`.
  text_excerpt text not null default '',
  extract_json jsonb not null default '{}'::jsonb,
  object_key text,

  first_fetched_at timestamptz not null default clock_timestamp(),
  -- ─── clock_timestamp(), not now() ─────────────────────────────────────────
  --
  -- `now()` is the *transaction* timestamp: every row written inside one
  -- transaction gets the identical value. This column decides which version of a
  -- page is the current one, so two versions recorded in one transaction would
  -- tie, `order by last_checked_at desc limit 1` would return an arbitrary one of
  -- them, and the next conditional request would be built from a stale ETag —
  -- costing a full fetch and a full extraction of a page we already had.
  -- `clock_timestamp()` advances within a transaction and makes the order real.
  last_checked_at timestamptz not null default clock_timestamp(),
  -- And the tiebreaker, so the ordering is total rather than merely usually
  -- unambiguous. Insertion order, which is the right answer whenever two rows
  -- somehow share a microsecond.
  seq bigserial not null,
  fetch_count integer not null default 1 check (fetch_count > 0),

  primary key (url_norm, content_hash)
);

-- "What is the current version of this URL, and what conditional headers do I
-- send?" — one index scan, newest first.
create index crawl_cache_current_idx on crawl_cache (url_norm, last_checked_at desc, seq desc);
-- For `prune_crawl_cache`.
create index crawl_cache_age_idx on crawl_cache (last_checked_at);

comment on table crawl_cache is
  'C1 — one row per (normalised URL, content hash). History is kept because C4 drift cards diff against the version the owner confirmed.';

-- ─── RLS ────────────────────────────────────────────────────────────────────
--
-- Operator-scoped, exactly as 0020 gates prospects: one connection role, one
-- identity mechanism, and a logged-in caterer reaches none of it because no
-- policy below can ever be true for them.
--
-- The functions further down are `security invoker`, not `security definer`.
-- That is a deliberate difference from 0018, whose meters are definer because
-- they are keyed by agency but are not *about* an agency and a tenant must not
-- be able to reset its own meter. These are about prospects, prospect data is
-- operator data, and the operator gate already answers the question correctly.
-- Making them definer would create a second, weaker path to the same rows that
-- the RLS policies below no longer guard — which is how a gate becomes
-- decorative. The consequence is that the enrichment worker runs under a real
-- platform-operator identity through `withUser`, and that is a feature: the
-- claim is attributable.
do $$
declare
  t text;
begin
  foreach t in array array[
    'enrichment_jobs', 'enrichment_prospect_budget', 'enrichment_spend', 'crawl_cache'
  ] loop
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

    execute format($p$
      create policy %I on %I for update to app_user
      using (public.is_platform_operator())
      with check (public.is_platform_operator())
    $p$, t || '_update', t);

    execute format($p$
      create policy %I on %I for delete to app_user
      using (public.is_platform_operator())
    $p$, t || '_delete', t);
  end loop;
end $$;

grant select, insert, update, delete on
  enrichment_jobs, enrichment_prospect_budget, enrichment_spend, crawl_cache
  to app_user;
grant usage, select on sequence enrichment_spend_id_seq to app_user;
grant usage, select on sequence crawl_cache_seq_seq to app_user;


-- ─── Enqueue ────────────────────────────────────────────────────────────────
--
-- `on conflict do nothing` against the partial unique index, so enqueuing a
-- prospect that already has live work is a no-op that returns the existing job
-- rather than an error. An import loop must be safe to re-run — the same
-- argument 0020 makes about a nervous user uploading the same file twice.
create or replace function public.enqueue_enrichment_job(
  p_prospect_id uuid,
  p_kind text default 'enrich',
  p_priority smallint default 0,
  p_budget_micro_cents bigint default null,
  p_max_pages integer default null
)
returns table (job_id uuid, created boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.enrichment_jobs
    (prospect_id, kind, priority, budget_micro_cents, max_pages)
  values (
    p_prospect_id,
    p_kind,
    p_priority,
    coalesce(p_budget_micro_cents, 25000000),
    coalesce(p_max_pages, 12)
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is not null then
    -- The lifetime ceiling is created with the first job rather than with the
    -- prospect, so a prospect nobody ever enriches carries no budget row at all.
    insert into public.enrichment_prospect_budget (prospect_id)
    values (p_prospect_id)
    on conflict (prospect_id) do nothing;

    return query select v_id, true;
    return;
  end if;

  -- Already live. Hand back the existing job so the caller can log a job id
  -- either way; a caller that has to distinguish reads `created`.
  return query
    select j.id, false
    from public.enrichment_jobs j
    where j.prospect_id = p_prospect_id
      and j.kind = p_kind
      and j.state in ('queued', 'leased')
    limit 1;
end;
$$;

comment on function public.enqueue_enrichment_job is
  'C1 — queue enrichment for a prospect. Idempotent against the live-job unique index, so an import loop is safe to re-run.';


-- ─── Claim, with a lease ────────────────────────────────────────────────────
--
-- ─────────────────────────────────────────────────────────────────────────────
-- `for update skip locked` IS WHY TWO WORKERS CAN RUN AT ALL.
--
-- Two properties, and they are different from each other:
--
--   1. **No double-claim.** The UPDATE moves the row out of 'queued' in the same
--      statement that selected it, so a second worker's SELECT no longer matches
--      it. This holds even single-threaded, and it is what the db/tests
--      assertion exercises.
--   2. **No convoy.** Without SKIP LOCKED, worker B's SELECT would *block* on
--      the row worker A has locked, wait for A's whole transaction — which
--      includes network fetches — and then discover the row is no longer
--      eligible. Every worker would serialise behind the slowest one. SKIP
--      LOCKED makes B step over the locked row and take the next.
--
-- `attempts` is incremented on claim, not on failure, and that is the point: a
-- worker that is killed after claiming never gets to report anything, and a
-- counter incremented only on a reported failure would let such a job be
-- reclaimed forever. Incrementing on claim means an attempt is counted the
-- moment it is made, whatever happens next.
--
-- Expired leases are re-claimable by the same query. That is the recovery path
-- for a dead worker, and it needs no scheduler, no watchdog and nobody noticing.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.claim_enrichment_jobs(
  p_worker text,
  p_lease_seconds integer,
  p_limit integer default 1
)
returns setof enrichment_jobs
language sql
security invoker
set search_path = public
as $$
  with candidate as (
    select j.id
    from public.enrichment_jobs j
    where (j.state = 'queued' and j.next_attempt_at <= now())
       or (j.state = 'leased' and j.lease_expires_at <= now())
    order by j.priority desc, j.next_attempt_at
    limit greatest(p_limit, 0)
    for update skip locked
  )
  update public.enrichment_jobs j
  set state = 'leased',
      leased_by = p_worker,
      leased_at = now(),
      lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 1)),
      attempts = j.attempts + 1,
      updated_at = now()
  from candidate c
  where j.id = c.id
  returning j.*;
$$;

comment on function public.claim_enrichment_jobs is
  'C1 — take up to p_limit jobs under a lease. SKIP LOCKED so workers do not convoy; attempts increments on claim so a worker that dies still burns one.';


-- ─── Keeping a lease alive ──────────────────────────────────────────────────
--
-- A run that legitimately takes longer than its lease — a slow site, a large
-- PDF — must not be stolen mid-flight, and lengthening every lease to cover the
-- worst case would make a genuinely dead worker's job sit idle for that long.
-- A heartbeat costs one UPDATE and resolves both.
create or replace function public.heartbeat_enrichment_job(
  p_job_id uuid,
  p_worker text,
  p_lease_seconds integer
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ok boolean;
begin
  update public.enrichment_jobs j
  set lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 1)),
      updated_at = now()
  where j.id = p_job_id
    and j.state = 'leased'
    -- The worker name is part of the WHERE, so a worker whose lease already
    -- expired and was taken by somebody else cannot extend a lease it no longer
    -- holds and start writing over the new owner's work.
    and j.leased_by = p_worker
  returning true into v_ok;

  return coalesce(v_ok, false);
end;
$$;

comment on function public.heartbeat_enrichment_job is
  'C1 — extend a lease the caller still holds. Returns false once the lease has been taken by another worker, which is the signal to stop.';


-- ─── Finishing ──────────────────────────────────────────────────────────────

create or replace function public.complete_enrichment_job(
  p_job_id uuid,
  p_result jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ok boolean;
begin
  update public.enrichment_jobs j
  set state = 'succeeded',
      -- Cleared, or `enrichment_jobs_lease_matches_state` refuses the row.
      leased_by = null,
      lease_expires_at = null,
      result_json = coalesce(p_result, '{}'::jsonb),
      stop_reason = null,
      finished_at = now(),
      updated_at = now()
  where j.id = p_job_id and j.state = 'leased'
  returning true into v_ok;

  return coalesce(v_ok, false);
end;
$$;

comment on function public.complete_enrichment_job is
  'C1 — mark a leased job done. Returns false if the lease was lost, so a worker whose job was reclaimed does not overwrite the new owner.';


-- ─── Failing, with a reason and a backoff ───────────────────────────────────
--
-- The retry decision is here rather than in the worker because a worker that
-- crashes cannot make it, and because "is this the last attempt" has to be
-- decided against the same `attempts` value the claim wrote.
--
-- The *delay* comes in as a parameter, computed by `backoffSeconds` in
-- src/enrichment/queue.ts. Deliberately: exponential backoff with jitter is
-- arithmetic worth unit-testing at a hundred inputs, and plpgsql is a poor place
-- to do that. The database decides *whether* to retry; TypeScript decides *when*.
create or replace function public.fail_enrichment_job(
  p_job_id uuid,
  p_reason text,
  p_permanent boolean default false,
  p_retry_after_seconds integer default 60
)
returns table (state enrichment_job_state, attempts integer, next_attempt_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_attempts integer;
  v_max integer;
  v_terminal boolean;
begin
  select j.attempts, j.max_attempts into v_attempts, v_max
  from public.enrichment_jobs j
  where j.id = p_job_id and j.state = 'leased'
  for update;

  if v_attempts is null then
    -- Not ours any more, or never was. Say nothing and change nothing.
    return;
  end if;

  v_terminal := p_permanent or v_attempts >= v_max;

  return query
  update public.enrichment_jobs j
  set state = case when v_terminal then 'failed'::enrichment_job_state
                   else 'queued'::enrichment_job_state end,
      -- A reason is kept on the retry path too. Three transient failures
      -- followed by a success is a fact worth having when the same site fails
      -- permanently next month.
      stop_reason = coalesce(nullif(p_reason, ''), 'unspecified failure'),
      failure_permanent = p_permanent,
      leased_by = null,
      lease_expires_at = null,
      next_attempt_at = now() + make_interval(secs => greatest(p_retry_after_seconds, 0)),
      finished_at = case when v_terminal then now() else null end,
      updated_at = now()
  where j.id = p_job_id
  returning j.state, j.attempts, j.next_attempt_at;
end;
$$;

comment on function public.fail_enrichment_job is
  'C1 — record why a job failed and either re-queue it behind a backoff or make it terminal. The delay is computed by src/enrichment/queue.ts.';


-- ─── Charging the ledger ────────────────────────────────────────────────────
--
-- ─────────────────────────────────────────────────────────────────────────────
-- BOTH CAPS ARE TESTED BEFORE EITHER IS CHARGED.
--
-- src/agent/budget.ts charges its paid meters widest-first and stops at the
-- first refusal, which leaves the wider meter charged for a call that never
-- happened. That is accepted there, because those meters are contended across
-- every request in the product and locking them would serialise the whole
-- system for the sake of a rounding error.
--
-- It is not accepted here, and it does not have to be. The job row is already
-- this worker's own, the prospect budget row is touched only by work on that
-- prospect, and both are locked in a fixed order — job, then budget — so two
-- workers can never take them in opposite orders and deadlock. Inside those
-- locks both caps are tested and only then are both written, so a refusal
-- charges nothing at all.
--
-- The refusal also *is* the record. Marking the job 'capped' in the same
-- statement that refuses the charge is what makes "a run that hits its cap
-- stops and records why" true even when the worker is killed one instruction
-- later. Same principle as 0018: the test and the write are one statement.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The page count rides along on 'crawl_fetch' rather than living in its own
-- function, because a fetch that is refused on breadth and a fetch that is
-- refused on money must stop the run identically, and two functions is two
-- places for that to drift.
create or replace function public.charge_enrichment(
  p_job_id uuid,
  p_kind text,
  p_micro_cents bigint,
  p_detail text default ''
)
returns table (
  charged boolean,
  refused text,
  run_spent bigint,
  run_remaining bigint,
  prospect_spent bigint,
  prospect_remaining bigint
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_prospect uuid;
  v_run_spent bigint;
  v_run_cap bigint;
  v_pages integer;
  v_max_pages integer;
  v_p_spent bigint;
  v_p_cap bigint;
  v_amount bigint;
  v_refused text;
  v_is_page boolean;
begin
  if p_micro_cents is null or p_micro_cents < 0 then
    raise exception 'charge_enrichment: micro_cents must be a non-negative integer, got %', p_micro_cents;
  end if;
  v_amount := p_micro_cents;
  v_is_page := (p_kind = 'crawl_fetch');

  -- Lock order: job first, always. See the block above.
  select j.prospect_id, j.spent_micro_cents, j.budget_micro_cents, j.pages_fetched, j.max_pages
    into v_prospect, v_run_spent, v_run_cap, v_pages, v_max_pages
  from public.enrichment_jobs j
  where j.id = p_job_id and j.state = 'leased'
  for update;

  if v_prospect is null then
    -- No lease, no spending. A worker whose job was reclaimed must not be able
    -- to keep charging against it — that is how one prospect's budget gets spent
    -- twice over by two workers who each think they own the run.
    return query select false, 'no_lease'::text, 0::bigint, 0::bigint, 0::bigint, 0::bigint;
    return;
  end if;

  insert into public.enrichment_prospect_budget (prospect_id)
  values (v_prospect)
  on conflict (prospect_id) do nothing;

  select b.spent_micro_cents, b.cap_micro_cents into v_p_spent, v_p_cap
  from public.enrichment_prospect_budget b
  where b.prospect_id = v_prospect
  for update;

  -- Widest first, so the reported reason is the one an operator has to act on:
  -- raising a run cap for a prospect whose lifetime budget is gone would change
  -- nothing.
  if v_p_spent + v_amount > v_p_cap then
    v_refused := 'prospect_budget';
  elsif v_run_spent + v_amount > v_run_cap then
    v_refused := 'run_budget';
  elsif v_is_page and v_pages + 1 > v_max_pages then
    v_refused := 'page_cap';
  end if;

  if v_refused is not null then
    update public.enrichment_jobs j
    set state = 'capped',
        stop_reason = format(
          '%s reached on %s (needed %s µ¢; run %s/%s, prospect %s/%s, pages %s/%s)',
          v_refused, p_kind, v_amount,
          v_run_spent, v_run_cap, v_p_spent, v_p_cap, v_pages, v_max_pages),
        leased_by = null,
        lease_expires_at = null,
        finished_at = now(),
        updated_at = now()
    where j.id = p_job_id;

    return query select
      false, v_refused,
      v_run_spent, greatest(v_run_cap - v_run_spent, 0),
      v_p_spent, greatest(v_p_cap - v_p_spent, 0);
    return;
  end if;

  update public.enrichment_jobs j
  set spent_micro_cents = j.spent_micro_cents + v_amount,
      pages_fetched = j.pages_fetched + (case when v_is_page then 1 else 0 end),
      updated_at = now()
  where j.id = p_job_id;

  update public.enrichment_prospect_budget b
  set spent_micro_cents = b.spent_micro_cents + v_amount,
      first_spend_at = coalesce(b.first_spend_at, now()),
      last_spend_at = now()
  where b.prospect_id = v_prospect;

  insert into public.enrichment_spend (job_id, prospect_id, kind, micro_cents, detail)
  values (p_job_id, v_prospect, p_kind, v_amount, coalesce(p_detail, ''));

  return query select
    true, null::text,
    v_run_spent + v_amount, v_run_cap - (v_run_spent + v_amount),
    v_p_spent + v_amount, v_p_cap - (v_p_spent + v_amount);
end;
$$;

comment on function public.charge_enrichment is
  'C1 — test both caps, then charge both, then write the ledger row, all in one transaction. A refusal marks the job capped with the reason, so a killed worker still leaves the record.';


-- ─── The crawl cache ────────────────────────────────────────────────────────

-- What the crawler needs before it fetches: the newest known version of this
-- URL, its validators, and how long ago we looked. Returns no row for a URL
-- never seen, which the caller reads as "fetch it unconditionally".
create or replace function public.crawl_cache_lookup(p_url_norm text)
returns table (
  content_hash text,
  http_status integer,
  etag text,
  last_modified text,
  text_excerpt text,
  extract_json jsonb,
  object_key text,
  last_checked_at timestamptz,
  fetch_count integer
)
language sql
security invoker
stable
set search_path = public
as $$
  select c.content_hash, c.http_status, c.etag, c.last_modified, c.text_excerpt,
         c.extract_json, c.object_key, c.last_checked_at, c.fetch_count
  from public.crawl_cache c
  where c.url_norm = p_url_norm
  order by c.last_checked_at desc, c.seq desc
  limit 1;
$$;

comment on function public.crawl_cache_lookup is
  'C1 — the newest cached version of a URL, with the validators for a conditional request. No row means never fetched.';

-- Record a fetch, and say whether anything actually changed.
--
-- `changed` is the return value the caller cares about, because it is the one
-- that decides whether the expensive half of the pipeline runs at all. False
-- means: same content hash as the newest row we had, so no extraction, no model
-- call, no candidate churn — the fetch cost a fraction of a cent and saved
-- several.
create or replace function public.record_crawl_fetch(
  p_url_norm text,
  p_content_hash text,
  p_http_status integer,
  p_content_type text default '',
  p_byte_size integer default 0,
  p_etag text default null,
  p_last_modified text default null,
  p_text_excerpt text default '',
  p_extract jsonb default '{}'::jsonb,
  p_object_key text default null
)
returns table (changed boolean, first_seen boolean, fetch_count integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_previous text;
  v_known boolean;
  v_count integer;
begin
  select c.content_hash into v_previous
  from public.crawl_cache c
  where c.url_norm = p_url_norm
  order by c.last_checked_at desc, c.seq desc
  limit 1;

  select true into v_known
  from public.crawl_cache c
  where c.url_norm = p_url_norm and c.content_hash = p_content_hash;

  insert into public.crawl_cache as c (
    url_norm, content_hash, http_status, content_type, byte_size,
    etag, last_modified, text_excerpt, extract_json, object_key
  )
  values (
    p_url_norm, p_content_hash, p_http_status, coalesce(p_content_type, ''),
    greatest(coalesce(p_byte_size, 0), 0), p_etag, p_last_modified,
    coalesce(p_text_excerpt, ''), coalesce(p_extract, '{}'::jsonb), p_object_key
  )
  on conflict (url_norm, content_hash) do update
    -- clock_timestamp() for the same reason as the column default: a touch and an
    -- insert in one transaction must be orderable against each other.
    set last_checked_at = clock_timestamp(),
        fetch_count = c.fetch_count + 1,
        http_status = excluded.http_status,
        -- Validators are refreshed; a server may issue a new ETag for identical
        -- content, and sending a stale one back would defeat the 304.
        etag = coalesce(excluded.etag, c.etag),
        last_modified = coalesce(excluded.last_modified, c.last_modified)
  returning c.fetch_count into v_count;

  return query select
    -- A page seen for the first time counts as changed: there is nothing to
    -- reuse, so the pipeline has to run.
    v_previous is distinct from p_content_hash,
    not coalesce(v_known, false),
    v_count;
end;
$$;

comment on function public.record_crawl_fetch is
  'C1 — upsert a crawl result and report whether the content changed. False is the cheap path: no extraction and no model call.';

-- Housekeeping, in the shape 0018 established. Never deletes the newest version
-- of a URL: that row is what the next conditional request is built from, and
-- dropping it would turn every re-crawl after a prune into a full fetch and a
-- full extraction.
create or replace function public.prune_crawl_cache(p_before timestamptz)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.crawl_cache c
  where c.last_checked_at < p_before
    and exists (
      select 1 from public.crawl_cache newer
      where newer.url_norm = c.url_norm
        -- The same composite key `crawl_cache_lookup` orders by. Comparing only
        -- the timestamp would refuse to prune two rows that share one, and those
        -- are exactly the rows whose ordering nobody can reason about.
        and (newer.last_checked_at, newer.seq) > (c.last_checked_at, c.seq)
    );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.prune_crawl_cache is
  'C1 — drop superseded cache versions. Keeps the newest row for every URL, because that is what the next conditional request is built from.';

grant execute on function public.enqueue_enrichment_job(uuid, text, smallint, bigint, integer) to app_user;
grant execute on function public.claim_enrichment_jobs(text, integer, integer) to app_user;
grant execute on function public.heartbeat_enrichment_job(uuid, text, integer) to app_user;
grant execute on function public.complete_enrichment_job(uuid, jsonb) to app_user;
grant execute on function public.fail_enrichment_job(uuid, text, boolean, integer) to app_user;
grant execute on function public.charge_enrichment(uuid, text, bigint, text) to app_user;
grant execute on function public.crawl_cache_lookup(text) to app_user;
grant execute on function public.record_crawl_fetch(
  text, text, integer, text, integer, text, text, text, jsonb, text) to app_user;
grant execute on function public.prune_crawl_cache(timestamptz) to app_user;


-- ─── Coverage assertions ────────────────────────────────────────────────────
-- 0002 asserts this over the tables that existed then and 0020 repeats it. It is
-- repeated again because the guarantee is only as current as its last restatement.
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

-- And the platform mirror, extended with this migration's tables. These
-- deliberately have no `agency_id`, so the assertion above cannot see them: a
-- missing operator gate here would make the enrichment queue and every cached
-- page readable by every logged-in caterer, and nothing else would notice.
do $$
declare
  unprotected text;
begin
  select string_agg(c.relname, ', ')
  into unprotected
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname in (
      'prospects', 'prospect_sources', 'platform_operators',
      'enrichment_jobs', 'enrichment_prospect_budget', 'enrichment_spend', 'crawl_cache'
    )
    and not c.relrowsecurity;

  if unprotected is not null then
    raise exception 'Platform tables have no RLS: %', unprotected;
  end if;
end $$;

-- The cap, asserted as a schema property rather than trusted as a review
-- outcome. A future migration that drops these constraints — to "simplify", or
-- to make a backfill easier — removes the only thing that makes the budget
-- unconditional, and it must not be able to do so quietly.
do $$
declare
  missing text;
begin
  select string_agg(expected.name, ', ')
  into missing
  from (values
    ('enrichment_jobs_within_budget'),
    ('enrichment_jobs_within_pages'),
    ('enrichment_prospect_budget_within_cap')
  ) as expected(name)
  where not exists (
    select 1 from pg_constraint where conname = expected.name
  );

  if missing is not null then
    raise exception 'Spend caps are no longer enforced by constraint: %', missing;
  end if;
end $$;
