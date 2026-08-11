-- ============================================================================
-- Enrichment queue, ledger and crawl cache assertions (0021 — C1)
--
-- Four claims, and every one of them is a property of the *database* that a
-- Vitest suite could only pretend to check:
--
--  1. **The operator gate holds on the new tables.** They carry no `agency_id`,
--     so the coverage assertion in 0002 cannot see them at all. If the policies
--     are wrong, every logged-in caterer can read our lead pipeline and every
--     page we have ever cached.
--  2. **A claimed job cannot be claimed again.** The lease is the only thing
--     stopping two workers spending one prospect's budget twice.
--  3. **The spend cap is unconditional.** Not "the function checks it" —
--     `enrichment_jobs_within_budget` is a CHECK constraint, and this asserts
--     that a direct UPDATE cannot get past it either.
--  4. **A run that hits its cap stops and records why**, in the same transaction
--     that refused the charge, so a worker killed one instruction later still
--     leaves the record.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THIS FILE CLEANS UP AFTER ITSELF, AND THAT IS NOT TIDINESS.
--
-- db/test.sh runs these files in glob order, which puts this one *first*.
-- prospects.sql then asserts that an operator sees exactly two prospects — so a
-- prospect left behind here would fail a test in another file, for a reason
-- nobody reading that file could possibly guess. Self-contained has to mean both
-- directions: depend on nothing, and leave nothing.
-- ─────────────────────────────────────────────────────────────────────────────
-- ============================================================================

\set ON_ERROR_STOP on

-- ─── Fixtures ───────────────────────────────────────────────────────────────
--
-- Deliberately different ids and emails from every other file here. Rolf is the
-- operator; Sabine is a perfectly ordinary logged-in user who is not one.

insert into users (id, email, password_hash) values
  ('11111111-aaaa-0000-0000-000000000001', 'rolf@platform.test', 'not-a-real-hash'),
  ('11111111-aaaa-0000-0000-000000000002', 'sabine@tenant.test', 'not-a-real-hash');

insert into platform_operators (user_id, reason) values
  ('11111111-aaaa-0000-0000-000000000001', 'runs enrichment');

insert into prospects (id, business_name, city, dedupe_key) values
  ('11111111-bbbb-0000-0000-000000000001', 'Enrich Normal',  'Berlin',  'enrich-normal.test'),
  ('11111111-bbbb-0000-0000-000000000002', 'Enrich Lifetime','Berlin',  'enrich-lifetime.test'),
  ('11111111-bbbb-0000-0000-000000000003', 'Enrich Pages',   'Potsdam', 'enrich-pages.test'),
  ('11111111-bbbb-0000-0000-000000000004', 'Enrich RunCap',  'Potsdam', 'enrich-runcap.test');

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_login') then
    create role app_login login inherit;
  end if;
end $$;
grant app_user to app_login;

set role app_login;

-- ─── The operator gate ──────────────────────────────────────────────────────

do $$
declare
  visible int;
begin
  -- Seed one row of each kind as the operator, so there is something to fail to see.
  perform set_config('app.current_user_id', '11111111-aaaa-0000-0000-000000000001', false);
  perform public.enqueue_enrichment_job('11111111-bbbb-0000-0000-000000000001');
  perform public.record_crawl_fetch(
    'https://enrich-normal.test/menu', repeat('a', 64), 200, 'text/html', 120);

  -- As Sabine: logged in, not an operator, no membership of anything.
  perform set_config('app.current_user_id', '11111111-aaaa-0000-0000-000000000002', false);

  select count(*) into visible from enrichment_jobs;
  if visible <> 0 then
    raise exception 'FAIL C1 — a non-operator can see % enrichment jobs', visible;
  end if;

  select count(*) into visible from crawl_cache;
  if visible <> 0 then
    raise exception 'FAIL C1 — a non-operator can see % cached pages', visible;
  end if;

  select count(*) into visible from enrichment_spend;
  if visible <> 0 then
    raise exception 'FAIL C1 — a non-operator can see % spend rows', visible;
  end if;

  -- A gate that only covers reads is not a gate: a row she can insert is a row
  -- she can then select back.
  begin
    insert into crawl_cache (url_norm, content_hash, http_status)
    values ('https://injected.test/', repeat('b', 64), 200);
    raise exception 'FAIL C1 — a non-operator wrote to the crawl cache';
  exception
    when insufficient_privilege then null;
  end;

  raise notice 'PASS C1 — the enrichment tables are unreachable from a tenant identity';
end $$;

do $$
declare
  visible int;
begin
  -- No identity at all. Must be the most locked-down case, not the least.
  perform set_config('app.current_user_id', '', false);
  select count(*) into visible from enrichment_jobs;
  if visible <> 0 then
    raise exception 'FAIL C1 — an unauthenticated connection sees % enrichment jobs', visible;
  end if;
  raise notice 'PASS C1 — no identity means no enrichment data, not all of it';
end $$;

-- ─── Enqueue is idempotent ──────────────────────────────────────────────────

do $$
declare
  first_id uuid;
  second_id uuid;
  was_created boolean;
  live int;
begin
  perform set_config('app.current_user_id', '11111111-aaaa-0000-0000-000000000001', false);

  select job_id into first_id from public.enqueue_enrichment_job(
    '11111111-bbbb-0000-0000-000000000002');

  -- The same prospect again, as an import loop that died halfway would do.
  select job_id, created into second_id, was_created
    from public.enqueue_enrichment_job('11111111-bbbb-0000-0000-000000000002');

  if second_id <> first_id or was_created then
    raise exception 'FAIL C1 — re-enqueuing a prospect created a second live job';
  end if;

  select count(*) into live from enrichment_jobs
  where prospect_id = '11111111-bbbb-0000-0000-000000000002' and state in ('queued', 'leased');
  if live <> 1 then
    raise exception 'FAIL C1 — % live jobs for one prospect', live;
  end if;

  raise notice 'PASS C1 — enqueue is idempotent, so an import is safe to re-run';
end $$;

-- ─── The lease ──────────────────────────────────────────────────────────────

do $$
declare
  claimed record;
  again record;
  count_second int;
begin
  perform set_config('app.current_user_id', '11111111-aaaa-0000-0000-000000000001', false);

  select * into claimed
  from public.claim_enrichment_jobs('worker-a', 60, 10)
  where prospect_id = '11111111-bbbb-0000-0000-000000000001';

  if claimed.id is null then
    raise exception 'FAIL C1 — nothing was claimable';
  end if;
  if claimed.state <> 'leased' or claimed.leased_by <> 'worker-a' then
    raise exception 'FAIL C1 — a claimed job is % held by %', claimed.state, claimed.leased_by;
  end if;
  if claimed.attempts <> 1 then
    -- Counted on claim, not on failure: a worker killed after claiming never
    -- reports anything, and a counter that moved only on a reported failure
    -- would let such a job be reclaimed forever.
    raise exception 'FAIL C1 — a claimed job has % attempts, expected 1', claimed.attempts;
  end if;

  -- The double-claim guarantee. The UPDATE moved the row out of 'queued' in the
  -- same statement that selected it, so a second worker's SELECT cannot match it.
  select count(*) into count_second
  from public.claim_enrichment_jobs('worker-b', 60, 10)
  where id = claimed.id;
  if count_second <> 0 then
    raise exception 'FAIL C1 — a leased job was claimed a second time';
  end if;

  -- A heartbeat from a worker that does not hold the lease changes nothing.
  if public.heartbeat_enrichment_job(claimed.id, 'worker-b', 60) then
    raise exception 'FAIL C1 — a worker extended a lease it does not hold';
  end if;
  if not public.heartbeat_enrichment_job(claimed.id, 'worker-a', 60) then
    raise exception 'FAIL C1 — the lease holder could not extend its own lease';
  end if;

  -- Now the recovery path: the worker vanished, the lease ran out. This is the
  -- entire argument for a lease over a boolean `locked` column — it repairs
  -- itself, with no watchdog and nobody noticing.
  update enrichment_jobs set lease_expires_at = now() - interval '1 second'
  where id = claimed.id;

  select * into again
  from public.claim_enrichment_jobs('worker-c', 60, 10)
  where id = claimed.id;

  if again.id is null then
    raise exception 'FAIL C1 — an abandoned job was not reclaimable';
  end if;
  if again.attempts <> 2 or again.leased_by <> 'worker-c' then
    raise exception 'FAIL C1 — reclaim left attempts=% held by %', again.attempts, again.leased_by;
  end if;

  raise notice 'PASS C1 — a lease prevents a double claim and expires into recovery';
end $$;

-- ─── Charging, and the cap ──────────────────────────────────────────────────

do $$
declare
  job uuid;
  charge record;
  ledger_rows int;
begin
  perform set_config('app.current_user_id', '11111111-aaaa-0000-0000-000000000001', false);

  select job_id into job from public.enqueue_enrichment_job(
    '11111111-bbbb-0000-0000-000000000004', 'enrich', 0::smallint, 1000000::bigint, 12);
  perform public.claim_enrichment_jobs('worker-a', 60, 10);

  select * into charge from public.charge_enrichment(job, 'tavily_search', 800000, 'a query');
  if not charge.charged then
    raise exception 'FAIL C1 — an affordable charge was refused: %', charge.refused;
  end if;
  if charge.run_spent <> 800000 or charge.run_remaining <> 200000 then
    raise exception 'FAIL C1 — after 800000 the run reads %/% ', charge.run_spent, charge.run_remaining;
  end if;

  select count(*) into ledger_rows from enrichment_spend where job_id = job;
  if ledger_rows <> 1 then
    raise exception 'FAIL C1 — a charge wrote % ledger rows', ledger_rows;
  end if;

  -- One micro-cent past the cap. The refusal and the record are one statement.
  select * into charge from public.charge_enrichment(job, 'model_call', 200001, 'an extraction');
  if charge.charged then
    raise exception 'FAIL C1 — a charge exceeded the run budget';
  end if;
  if charge.refused <> 'run_budget' then
    raise exception 'FAIL C1 — the run cap refused with %', charge.refused;
  end if;

  if (select state from enrichment_jobs where id = job) <> 'capped' then
    raise exception 'FAIL C1 — a capped run did not stop';
  end if;
  if (select stop_reason from enrichment_jobs where id = job) is null then
    raise exception 'FAIL C1 — a capped run did not record why';
  end if;
  if (select spent_micro_cents from enrichment_jobs where id = job) <> 800000 then
    raise exception 'FAIL C1 — a refused charge still moved the total';
  end if;

  -- The cap is a constraint, not a convention. A hand-written UPDATE at a psql
  -- prompt is the case this defends against, because it is the one that will
  -- actually happen at three in the morning.
  begin
    update enrichment_jobs set spent_micro_cents = budget_micro_cents + 1 where id = job;
    raise exception 'FAIL C1 — a direct UPDATE put a run over its budget';
  exception
    when check_violation then null;
  end;

  -- And no spending at all once the lease is gone, which is what stops two
  -- workers each spending one prospect's budget.
  select * into charge from public.charge_enrichment(job, 'other', 1, 'after the cap');
  if charge.charged or charge.refused <> 'no_lease' then
    raise exception 'FAIL C1 — a job with no lease was charged (refused=%)', charge.refused;
  end if;

  raise notice 'PASS C1 — the run cap refuses, records why, and cannot be written around';
end $$;

do $$
declare
  job uuid;
  charge record;
begin
  perform set_config('app.current_user_id', '11111111-aaaa-0000-0000-000000000001', false);

  select job_id into job from public.enqueue_enrichment_job(
    '11111111-bbbb-0000-0000-000000000002', 'recrawl');
  perform public.claim_enrichment_jobs('worker-a', 60, 10);

  -- The lifetime ceiling, which is the only thing that bounds a weekly re-crawl.
  update enrichment_prospect_budget set cap_micro_cents = 500
  where prospect_id = '11111111-bbbb-0000-0000-000000000002';

  select * into charge from public.charge_enrichment(job, 'tavily_search', 800000, 'q');
  if charge.charged then
    raise exception 'FAIL C1 — a charge exceeded the prospect lifetime cap';
  end if;
  -- Widest first: raising a run cap for a prospect whose lifetime budget is gone
  -- would change nothing, so the reason shown has to be the outer one.
  if charge.refused <> 'prospect_budget' then
    raise exception 'FAIL C1 — the lifetime cap refused with %', charge.refused;
  end if;

  raise notice 'PASS C1 — the per-prospect lifetime cap refuses before the per-run one';
end $$;

do $$
declare
  job uuid;
  charge record;
  i int;
begin
  perform set_config('app.current_user_id', '11111111-aaaa-0000-0000-000000000001', false);

  select job_id into job from public.enqueue_enrichment_job(
    '11111111-bbbb-0000-0000-000000000003', 'enrich', 0::smallint, 25000000::bigint, 3);
  perform public.claim_enrichment_jobs('worker-a', 60, 10);

  -- Breadth is capped separately from money, because a site serving 200-byte
  -- pages under a thousand URLs costs almost nothing and could run forever.
  for i in 1..3 loop
    select * into charge from public.charge_enrichment(job, 'crawl_fetch', 2000, 'page');
    if not charge.charged then
      raise exception 'FAIL C1 — page % of 3 was refused: %', i, charge.refused;
    end if;
  end loop;

  select * into charge from public.charge_enrichment(job, 'crawl_fetch', 2000, 'page 4');
  if charge.charged or charge.refused <> 'page_cap' then
    raise exception 'FAIL C1 — the page cap refused with % (charged=%)', charge.refused, charge.charged;
  end if;
  if (select state from enrichment_jobs where id = job) <> 'capped' then
    raise exception 'FAIL C1 — the page cap did not stop the run';
  end if;

  raise notice 'PASS C1 — breadth is capped independently of money';
end $$;

-- ─── Failing, retrying, and giving up ───────────────────────────────────────

do $$
declare
  job uuid;
  outcome record;
  i int;
begin
  perform set_config('app.current_user_id', '11111111-aaaa-0000-0000-000000000001', false);

  select job_id into job from public.enqueue_enrichment_job(
    '11111111-bbbb-0000-0000-000000000001', 'recrawl');

  -- Attempts 1..4 fail transiently and come back queued, behind a backoff.
  for i in 1..4 loop
    update enrichment_jobs set next_attempt_at = now() - interval '1 second' where id = job;
    perform public.claim_enrichment_jobs('worker-a', 60, 10);
    select * into outcome from public.fail_enrichment_job(job, 'connection reset', false, 30);
    if outcome.state <> 'queued' then
      raise exception 'FAIL C1 — attempt % of 5 became % instead of queued', i, outcome.state;
    end if;
    if (select stop_reason from enrichment_jobs where id = job) is null then
      raise exception 'FAIL C1 — a retried job forgot why it failed';
    end if;
  end loop;

  -- The fifth exhausts max_attempts and is terminal.
  update enrichment_jobs set next_attempt_at = now() - interval '1 second' where id = job;
  perform public.claim_enrichment_jobs('worker-a', 60, 10);
  select * into outcome from public.fail_enrichment_job(job, 'connection reset', false, 30);
  if outcome.state <> 'failed' then
    raise exception 'FAIL C1 — the last attempt became % instead of failed', outcome.state;
  end if;

  -- A terminal job that cannot say why is a job an operator can see and cannot
  -- act on, so the constraint refuses to store one.
  begin
    update enrichment_jobs set stop_reason = null where id = job;
    raise exception 'FAIL C1 — a terminal job was allowed to forget its reason';
  exception
    when check_violation then null;
  end;

  raise notice 'PASS C1 — a failing job retries with a reason, then gives up with one';
end $$;

do $$
declare
  job uuid;
  outcome record;
begin
  perform set_config('app.current_user_id', '11111111-aaaa-0000-0000-000000000001', false);

  select job_id into job from public.enqueue_enrichment_job(
    '11111111-bbbb-0000-0000-000000000004', 'recrawl');
  perform public.claim_enrichment_jobs('worker-a', 60, 10);

  -- Permanent on the first attempt: robots.txt forbids us, or the domain does
  -- not resolve. Retrying those forever is how a queue turns into a bill.
  select * into outcome from public.fail_enrichment_job(job, 'robots.txt forbids us', true, 0);
  if outcome.state <> 'failed' or outcome.attempts <> 1 then
    raise exception 'FAIL C1 — a permanent failure became % after % attempts',
      outcome.state, outcome.attempts;
  end if;

  raise notice 'PASS C1 — a permanent failure does not consume five attempts first';
end $$;

-- ─── The crawl cache ────────────────────────────────────────────────────────

do $$
declare
  result record;
  cached record;
  pruned int;
begin
  perform set_config('app.current_user_id', '11111111-aaaa-0000-0000-000000000001', false);

  -- First sighting: nothing to reuse, so the pipeline has to run.
  select * into result from public.record_crawl_fetch(
    'https://enrich-pages.test/menu', repeat('1', 64), 200, 'text/html', 900,
    'W/"v1"', null, 'Buffet 18,50 EUR');
  if not result.changed or not result.first_seen then
    raise exception 'FAIL C1 — a first fetch reported changed=% first_seen=%',
      result.changed, result.first_seen;
  end if;

  -- The same content again. This is the whole point: no extraction, no model
  -- call, and the page cost a fraction of a cent instead of several.
  select * into result from public.record_crawl_fetch(
    'https://enrich-pages.test/menu', repeat('1', 64), 200, 'text/html', 900,
    'W/"v1"', null, 'Buffet 18,50 EUR');
  if result.changed or result.first_seen then
    raise exception 'FAIL C1 — an unchanged page reported changed=%', result.changed;
  end if;
  if result.fetch_count <> 2 then
    raise exception 'FAIL C1 — the second fetch of one page counted %', result.fetch_count;
  end if;

  -- A real price change.
  select * into result from public.record_crawl_fetch(
    'https://enrich-pages.test/menu', repeat('2', 64), 200, 'text/html', 910,
    'W/"v2"', null, 'Buffet 19,50 EUR');
  if not result.changed then
    raise exception 'FAIL C1 — a changed page was reported unchanged';
  end if;

  -- Lookup returns the newest version, with the validators for a conditional
  -- request.
  select * into cached from public.crawl_cache_lookup('https://enrich-pages.test/menu');
  if cached.content_hash <> repeat('2', 64) or cached.etag <> 'W/"v2"' then
    raise exception 'FAIL C1 — lookup returned hash % etag %', cached.content_hash, cached.etag;
  end if;

  -- History is kept, because C4's drift cards diff against the version the owner
  -- confirmed — a sentence that is unwriteable if the previous version was
  -- overwritten by the fetch that noticed the change.
  if (select count(*) from crawl_cache where url_norm = 'https://enrich-pages.test/menu') <> 2 then
    raise exception 'FAIL C1 — the previous version of a page was overwritten';
  end if;

  -- Pruning drops superseded versions and never the newest, because the newest
  -- is what the next conditional request is built from.
  -- Exactly one row is superseded: the v1 version of this page. The v2 row is its
  -- own newest and survives, and so does the gate test's row on another URL —
  -- a URL with a single version must never be pruned, or the next re-crawl of it
  -- is a full fetch and a full extraction instead of a 304.
  select public.prune_crawl_cache(now() + interval '1 minute') into pruned;
  if pruned <> 1 then
    raise exception 'FAIL C1 — prune removed % rows, expected 1', pruned;
  end if;
  if (select count(*) from crawl_cache where url_norm = 'https://enrich-pages.test/menu') <> 1 then
    raise exception 'FAIL C1 — prune did not leave exactly one current version';
  end if;

  raise notice 'PASS C1 — the cache reports change, keeps history, and prunes safely';
end $$;

-- ─── Erasure still reaches everything derived from a prospect ───────────────

do $$
declare
  remaining_jobs int;
begin
  perform set_config('app.current_user_id', '11111111-aaaa-0000-0000-000000000001', false);

  -- 0020's erase_prospect must actually erase. A spend row or a job surviving the
  -- prospect it belongs to is an orphan that a GDPR Art. 17 response could not
  -- honestly account for.
  perform public.erase_prospect('11111111-bbbb-0000-0000-000000000003');

  select count(*) into remaining_jobs from enrichment_jobs
  where prospect_id = '11111111-bbbb-0000-0000-000000000003';
  if remaining_jobs <> 0 then
    raise exception 'FAIL C1 — % enrichment jobs survived an erased prospect', remaining_jobs;
  end if;
  if exists (select 1 from enrichment_spend
             where prospect_id = '11111111-bbbb-0000-0000-000000000003') then
    raise exception 'FAIL C1 — spend rows survived an erased prospect';
  end if;

  raise notice 'PASS C1 — erasing a prospect removes its queue and ledger rows too';
end $$;

-- ─── Cleanup ────────────────────────────────────────────────────────────────
--
-- See the header. prospects.sql asserts an exact prospect count, and it runs
-- after this file.

reset role;

delete from crawl_cache where url_norm like 'https://enrich-%';
delete from prospects where dedupe_key like 'enrich-%';
delete from platform_operators where user_id = '11111111-aaaa-0000-0000-000000000001';
delete from users where email in ('rolf@platform.test', 'sabine@tenant.test');

do $$
begin
  if exists (select 1 from prospects where dedupe_key like 'enrich-%') then
    raise exception 'FAIL C1 — this file left prospects behind for the next one';
  end if;
  raise notice 'PASS C1 — the fixtures are gone, so the next file starts where it expected to';
end $$;
