-- ============================================================================
-- Prospect and upload assertions (0020 — B1, B3, D34)
--
-- Two claims are being tested, and both are the kind that a TypeScript suite
-- cannot speak to at all:
--
--  1. **The operator gate holds.** Prospect data belongs to the platform, not to
--     any tenant. A logged-in caterer must reach none of it. This is not a UI
--     concern — if the policy is wrong, every customer of ours can read our lead
--     list, and no amount of careful routing in the app would matter.
--
--  2. **A prospect is not a tenant (D34).** Importing ten thousand businesses
--     must not create ten thousand `agencies` rows.
--
-- Run with db/test.sh. Self-contained: it builds its own tenants.
-- ============================================================================

\set ON_ERROR_STOP on

-- ─── Fixtures ───────────────────────────────────────────────────────────────
--
-- Deliberately self-contained, with its own users and agencies rather than
-- tenancy.sql's. db/test.sh runs the files in glob order, which puts this one
-- first, and a test that silently depends on another file having run already is
-- a test that fails the day somebody adds `a_new_test.sql`.
--
-- Nina is the operator, and is deliberately *not* a member of any agency, so
-- that operator access and tenant access cannot be confused for one another.

insert into users (id, email, password_hash) values
  ('99999999-9999-9999-9999-999999999999', 'nina@platform.test', 'not-a-real-hash'),
  ('44444444-4444-4444-4444-444444444444', 'petra@example.test', 'not-a-real-hash'),
  ('55555555-5555-5555-5555-555555555555', 'tobias@example.test', 'not-a-real-hash');

insert into agencies (id, name) values
  ('eeeeeeee-0000-0000-0000-00000000000e', 'Petra Catering'),
  ('ffffffff-0000-0000-0000-00000000000f', 'Tobias Eventtechnik');

insert into agency_members (agency_id, user_id, role) values
  ('eeeeeeee-0000-0000-0000-00000000000e', '44444444-4444-4444-4444-444444444444', 'owner'),
  ('ffffffff-0000-0000-0000-00000000000f', '55555555-5555-5555-5555-555555555555', 'owner');

insert into contacts (agency_id, name) values
  ('eeeeeeee-0000-0000-0000-00000000000e', 'Petra customer');

insert into platform_operators (user_id, reason) values
  ('99999999-9999-9999-9999-999999999999', 'runs prospect imports');

-- The login role the application connects as: inherits app_user, and is
-- emphatically not the superuser, who bypasses RLS entirely and would make every
-- assertion below pass for the wrong reason.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_login') then
    create role app_login login inherit;
  end if;
end $$;
grant app_user to app_login;

-- ─── D34: importing prospects creates no tenants ────────────────────────────
--
-- Measured as a delta rather than an absolute count, so the assertion says what
-- it means — "importing prospects created no agencies" — regardless of what else
-- exists in the database by the time it runs.

do $$
declare
  before_count int;
  after_count int;
begin
  select count(*) into before_count from agencies;

  insert into prospects (id, business_name, city, dedupe_key) values
    ('cccccccc-0000-0000-0000-00000000000c', 'Catering Meier', 'Berlin', 'cateringmeier.de'),
    ('dddddddd-0000-0000-0000-00000000000d', 'Eventdeko Schmidt', 'Potsdam', 'eventdeko-schmidt.de');

  insert into prospect_sources (prospect_id, kind, locator, object_key) values
    ('cccccccc-0000-0000-0000-00000000000c', 'import_row', 'Tabelle1!A12', null),
    ('cccccccc-0000-0000-0000-00000000000c', 'crawl', 'https://cateringmeier.de/menue',
     'a/eeeeeeee-0000-0000-0000-00000000000e/prospect-source/'
     || repeat('a', 64) || '.pdf');

  select count(*) into after_count from agencies;

  if after_count <> before_count then
    raise exception 'FAIL D34 — importing prospects created % agencies rows',
      after_count - before_count;
  end if;
  raise notice 'PASS D34 — a prospect is not a tenant';
end $$;

set role app_login;

-- ─── The operator gate ──────────────────────────────────────────────────────

do $$
declare
  visible int;
begin
  -- As Petra: a real, logged-in, paying tenant owner. She is not an operator.
  perform set_config('app.current_user_id', '44444444-4444-4444-4444-444444444444', false);

  select count(*) into visible from prospects;
  if visible <> 0 then
    raise exception 'FAIL B3 — a tenant owner can see % prospect rows', visible;
  end if;

  select count(*) into visible from prospect_sources;
  if visible <> 0 then
    raise exception 'FAIL B3 — a tenant owner can see % prospect_sources rows', visible;
  end if;

  -- And she cannot write one either. A gate that only covers reads is not a gate:
  -- an insert she can make is a row she can then select back.
  begin
    insert into prospects (business_name, dedupe_key) values ('Injected', 'injected.test');
    raise exception 'FAIL B3 — a tenant owner inserted a prospect';
  exception
    when insufficient_privilege then null;
  end;

  raise notice 'PASS B3 — prospect data is unreachable from a tenant identity';
end $$;

do $$
declare
  visible int;
begin
  -- As Nina: an operator with no agency membership at all.
  perform set_config('app.current_user_id', '99999999-9999-9999-9999-999999999999', false);

  select count(*) into visible from prospects;
  if visible <> 2 then
    raise exception 'FAIL B3 — an operator sees % prospects, expected 2', visible;
  end if;

  -- The converse, and the reason Nina has no membership: being an operator must
  -- not hand anybody a tenant's customer data. These are separate powers.
  select count(*) into visible from contacts;
  if visible <> 0 then
    raise exception 'FAIL B3 — an operator can read % tenant contacts', visible;
  end if;

  raise notice 'PASS B3 — an operator sees prospects and no tenant data';
end $$;

do $$
declare
  visible int;
begin
  -- No identity at all: an unauthenticated request, or a pooled connection whose
  -- setting was never applied. This must be the most locked-down case, not the
  -- least — `current_user_id()` returns null and every policy must be false.
  perform set_config('app.current_user_id', '', false);

  select count(*) into visible from prospects;
  if visible <> 0 then
    raise exception 'FAIL B3 — an unauthenticated connection sees % prospects', visible;
  end if;
  raise notice 'PASS B3 — no identity means no prospects, not all prospects';
end $$;

-- ─── B1: the upload job ─────────────────────────────────────────────────────

do $$
declare
  job uuid;
  chunk record;
begin
  perform set_config('app.current_user_id', '44444444-4444-4444-4444-444444444444', false);

  insert into upload_jobs
    (agency_id, created_by, filename, content_type, byte_size, sha256, chunk_size, chunk_total)
  values
    ('eeeeeeee-0000-0000-0000-00000000000e', '44444444-4444-4444-4444-444444444444',
     'leads.csv', 'text/csv', 12, repeat('a', 64), 8, 2)
  returning id into job;

  -- The idempotency guarantee. The same file, uploaded twice by a user who was
  -- not sure the first one worked, is one job.
  begin
    insert into upload_jobs
      (agency_id, filename, content_type, byte_size, sha256, chunk_size, chunk_total)
    values
      ('eeeeeeee-0000-0000-0000-00000000000e', 'leads-copy.csv', 'text/csv', 12,
       repeat('a', 64), 8, 2);
    raise exception 'FAIL B1 — the same file uploaded twice created two jobs';
  exception
    when unique_violation then null;
  end;

  -- First chunk: the job is receiving, not yet complete.
  select * into chunk from public.record_upload_chunk(job, 0, '\x6162636465666768'::bytea);
  if chunk.received <> 1 or chunk.state <> 'uploading' then
    raise exception 'FAIL B1 — after one of two chunks the job is % with % received',
      chunk.state, chunk.received;
  end if;

  -- The same chunk again. A client that lost its connection mid-chunk cannot know
  -- whether it landed, so it re-sends — and a re-send must not be an error, or the
  -- resume path is the failure path.
  select * into chunk from public.record_upload_chunk(job, 0, '\x6162636465666768'::bytea);
  if chunk.received <> 1 then
    raise exception 'FAIL B1 — a re-sent chunk was counted twice (% received)', chunk.received;
  end if;

  -- Last chunk: now there is a whole file to parse.
  select * into chunk from public.record_upload_chunk(job, 1, '\x61626364'::bytea);
  if chunk.received <> 2 or chunk.state <> 'parsing' then
    raise exception 'FAIL B1 — a complete upload is % with % received', chunk.state, chunk.received;
  end if;

  -- A chunk beyond the declared total is a client bug or an attack; either way it
  -- must not be stored, because assembly trusts the declared count.
  begin
    perform public.record_upload_chunk(job, 9, '\x00'::bytea);
    raise exception 'FAIL B1 — a chunk beyond the declared total was accepted';
  exception
    when others then
      if sqlerrm like 'FAIL B1%' then raise; end if;
  end;

  raise notice 'PASS B1 — chunks are idempotent, counted, and bounded';
end $$;

do $$
declare
  visible int;
begin
  -- Markus must not see Lisa's upload, nor the bytes inside it. A lead list is
  -- commercially sensitive in exactly the way a customer list is.
  perform set_config('app.current_user_id', '55555555-5555-5555-5555-555555555555', false);

  select count(*) into visible from upload_jobs;
  if visible <> 0 then
    raise exception 'FAIL F0.4 — another tenant sees % upload jobs', visible;
  end if;

  select count(*) into visible from upload_chunks;
  if visible <> 0 then
    raise exception 'FAIL F0.4 — another tenant sees % upload chunks', visible;
  end if;

  raise notice 'PASS F0.4 — uploads and their bytes are tenant-isolated';
end $$;

-- ─── A failed job must say why ──────────────────────────────────────────────

do $$
begin
  perform set_config('app.current_user_id', '44444444-4444-4444-4444-444444444444', false);

  -- B1: a failed file says why and offers retry; it never disappears silently.
  -- A failure with no reason is a file the user can see and cannot act on, so the
  -- constraint refuses to store one.
  begin
    update upload_jobs set state = 'failed', failure_reason = null
    where agency_id = 'eeeeeeee-0000-0000-0000-00000000000e';
    raise exception 'FAIL B1 — a job failed without a reason';
  exception
    when check_violation then null;
  end;

  raise notice 'PASS B1 — a failed upload cannot be stored without a reason';
end $$;

-- ─── The deletion path (B3, §9) ─────────────────────────────────────────────

do $$
declare
  erased record;
  remaining int;
begin
  perform set_config('app.current_user_id', '99999999-9999-9999-9999-999999999999', false);

  select * into erased from public.erase_prospect('cccccccc-0000-0000-0000-00000000000c');

  if erased.sources_removed <> 2 then
    raise exception 'FAIL B3 — erasure removed % sources, expected 2', erased.sources_removed;
  end if;

  -- The object keys come back so the caller can delete the bytes. An erasure that
  -- drops the rows naming the objects would orphan them permanently — unreachable,
  -- undeletable, and still holding the data somebody asked to have removed.
  if array_length(erased.object_keys, 1) <> 1 then
    raise exception 'FAIL B3 — erasure returned % object keys, expected 1',
      coalesce(array_length(erased.object_keys, 1), 0);
  end if;

  select count(*) into remaining from prospects
  where id = 'cccccccc-0000-0000-0000-00000000000c';
  if remaining <> 0 then
    raise exception 'FAIL B3 — the prospect survived erasure';
  end if;

  -- And it touched nobody else.
  select count(*) into remaining from prospects;
  if remaining <> 1 then
    raise exception 'FAIL B3 — erasure removed % prospects, expected 1 to remain', remaining;
  end if;

  raise notice 'PASS B3 — a prospect and everything derived from it is removable, with evidence';
end $$;

-- ─── Consistency constraints ────────────────────────────────────────────────

do $$
begin
  perform set_config('app.current_user_id', '99999999-9999-9999-9999-999999999999', false);

  -- 'suppressed' is a recorded data-subject objection. A row claiming that status
  -- without a timestamp cannot answer "when", which is the only thing that makes
  -- the record worth keeping.
  begin
    update prospects set status = 'suppressed'
    where id = 'dddddddd-0000-0000-0000-00000000000d';
    raise exception 'FAIL B3 — a prospect was suppressed without a timestamp';
  exception
    when check_violation then null;
  end;

  update prospects set status = 'suppressed', suppressed_at = now()
  where id = 'dddddddd-0000-0000-0000-00000000000d';

  raise notice 'PASS B3 — suppression must record when it happened';
end $$;

reset role;

select 'ALL PROSPECT ASSERTIONS PASSED' as result;
