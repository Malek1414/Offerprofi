-- ============================================================================
-- 0020 — prospects, and the durable job row behind every upload
--
-- Two things arrive together because one is the input to the other: a file lands
-- (B1), it is parsed and mapped (B2), and what comes out the far side is a
-- prospect (B3).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- A PROSPECT IS NOT A TENANT (D34).
--
-- The obvious design is to create an `agencies` row per prospect and reuse the
-- tenancy that already exists. It is the wrong one. Every one of the 35 RLS
-- policies written so far reasons about "an agency" meaning "a customer with
-- members, a catalogue and inquiries". Ten thousand dormant agency rows with no
-- member, no catalogue and no one who has ever logged in would silently become
-- something all 35 policies have to be correct about, and `is_agency_member`
-- would be answering questions about businesses that never signed up.
--
-- So prospects live outside the tenant space entirely. They have no `agency_id`
-- and are therefore not in the 0002 tenant-table list at all. A prospect becomes
-- a tenant exactly once, on claim, and `claimed_agency_id` is the only thread
-- between the two worlds.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Who may see a prospect ─────────────────────────────────────────────────
--
-- Prospect data is ours, not any tenant's, so "which agency are you a member of"
-- is the wrong question to gate it with. The alternative most codebases reach for
-- is a second database role for ops work, but that would mean a second connection
-- path in src/db/client.ts and a second place for identity handling to be wrong.
--
-- Instead the existing request-scoped identity is reused and the gate is a table.
-- One connection role, one identity mechanism, RLS still absolute — and a normal
-- agency user reaches prospects through no policy at all, because none of the
-- policies below can ever be true for them.
create table platform_operators (
  user_id uuid primary key references users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  -- Why this person has it. An access list nobody can explain is an access list
  -- nobody ever removes anyone from.
  reason text not null default ''
);

comment on table platform_operators is
  'Users permitted to see prospect data. Prospects belong to the platform, not to any tenant, so membership of an agency is the wrong gate.';

create or replace function public.is_platform_operator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_operators po
    where po.user_id = public.current_user_id()
  );
$$;

comment on function public.is_platform_operator is
  'True when the requesting identity is on the operator list. Returns false — never raises — when there is no identity, so an unauthenticated request is denied rather than erroring.';

-- ─── The upload job (B1) ────────────────────────────────────────────────────
--
-- "Zero upload failures" is an architecture, not an aspiration. The requirement
-- is not that uploads never fail — a phone on a train will drop a connection no
-- matter how the code is written — it is that a failure is *recoverable and
-- visible*. That needs a unit of work that outlives the request that created it,
-- which is this row.
create type upload_state as enum (
  'queued',        -- row exists, bytes have not all arrived
  'uploading',     -- chunks are landing
  'parsing',       -- bytes assembled, being read
  'needs_mapping', -- parsed, waiting for a human to confirm the column mapping
  'imported',      -- rows are in `prospects`
  'failed'         -- see failure_reason; retryable unless failure_permanent
);

create table upload_jobs (
  id uuid primary key default gen_random_uuid(),
  -- Uploads are performed by an authenticated agency user, so the *file* is
  -- tenant-scoped even though the prospects extracted from it are not. This is
  -- the boundary between the two worlds, and it is why this table is in the
  -- ordinary RLS space while `prospects` is not.
  agency_id uuid not null references agencies(id) on delete cascade,
  created_by uuid references users(id) on delete set null,

  scope text not null default 'prospect-import',
  filename text not null,
  content_type text not null default 'application/octet-stream',
  byte_size bigint not null check (byte_size >= 0),

  -- ─── The idempotency key ───────────────────────────────────────────────────
  -- sha256 of the whole file, computed by the browser before the first chunk is
  -- sent. Re-uploading the same file finds this row instead of creating a second
  -- one, which is what makes "I wasn't sure it worked, so I did it again" — the
  -- single most common thing a nervous user does — a no-op rather than a
  -- duplicate import. It is also what lets a resumed upload find its own job
  -- after the tab was closed.
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),

  -- Set once every chunk has landed and the assembled object has been written to
  -- the object store. Null means the bytes are still only in `upload_chunks`.
  object_key text,

  state upload_state not null default 'queued',
  -- Shown to the user verbatim. A failed file that says nothing is a file the
  -- user cannot act on, so it must never be null while state = 'failed'.
  failure_reason text,
  -- Distinguishes "the network blinked, try again" from "this is a .pages file
  -- and no amount of retrying will change that". Retrying a permanent failure
  -- forever is how a queue turns into a bill.
  failure_permanent boolean not null default false,
  attempts integer not null default 0,
  next_attempt_at timestamptz,

  chunk_size integer not null check (chunk_size > 0),
  chunk_total integer not null check (chunk_total >= 0),

  -- B2's confirmed column mapping. Null until the owner confirms it — mapping is
  -- detected then confirmed, never guessed silently.
  mapping_json jsonb,
  -- What the parser found: sheet names, detected headers, a sample of rows.
  parse_json jsonb not null default '{}'::jsonb,
  rows_imported integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,

  constraint upload_jobs_failure_has_reason
    check (state <> 'failed' or failure_reason is not null)
);

-- The idempotency guarantee, as a constraint rather than a convention. Scoped per
-- agency: two tenants uploading the same public lead list are two separate jobs.
create unique index upload_jobs_idempotency_idx on upload_jobs (agency_id, sha256);
create index upload_jobs_worker_idx on upload_jobs (state, next_attempt_at)
  where state in ('queued', 'uploading', 'parsing', 'failed');
create index upload_jobs_agency_idx on upload_jobs (agency_id, created_at desc);

comment on table upload_jobs is
  'One durable row per uploaded file. Survives a process restart, which is what makes a resumable upload resumable rather than merely retried.';

-- ─── The chunks ─────────────────────────────────────────────────────────────
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY CHUNKS LAND IN POSTGRES AND NOT IN THE OBJECT STORE.
--
-- The instinct is to write each chunk straight to S3 and assemble with a
-- multipart upload. That is what multipart is for, and at video scale it is
-- right. It is wrong here for one reason: S3 multipart state lives in S3, so
-- "which parts have arrived?" becomes a network call to a service that may be
-- the thing that is failing, and an abandoned multipart upload is invisible
-- billed storage that no row in our database knows about.
--
-- Here the answer to "which chunks do I still need?" is a primary-key lookup in
-- the same transaction as everything else. A killed process loses nothing: the
-- chunks that committed are committed. This is bounded by MAX_UPLOAD_BYTES in
-- src/uploads/limits.ts — these are spreadsheets and menus, not video, and the
-- cap is enforced before the first chunk is accepted.
-- ─────────────────────────────────────────────────────────────────────────────
create table upload_chunks (
  job_id uuid not null references upload_jobs(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  bytes bytea not null,
  received_at timestamptz not null default now(),
  primary key (job_id, chunk_index)
);

-- `agency_id` is denormalised onto the chunk table so RLS can be keyed directly
-- rather than through a join to the parent on every row.
alter table upload_chunks add column agency_id uuid not null
  references agencies(id) on delete cascade;

comment on table upload_chunks is
  'Received chunks, held until the file is assembled. Deleted on assembly — this is a staging area, not storage.';

-- ─── Prospects (B3) ─────────────────────────────────────────────────────────

create type prospect_status as enum (
  'imported',    -- came out of a file, nothing else known
  'enriching',   -- a Phase C run is working on it
  'enriched',    -- candidates exist
  'claimed',     -- became a tenant
  'suppressed'   -- see below
);

-- A NOTE ON 'suppressed', SO IT IS NOT MISREAD.
--
-- Invariant 1 says no code path may refuse, reject, decline or turn away a
-- customer. This is not that, and the distinction is not a technicality:
-- invariant 1 governs *inquiries*, where a person has approached the product and
-- must never be turned down by software. A prospect is a business on a list we
-- built, who has not approached anyone. 'suppressed' records that they asked not
-- to be — an erasure or objection under GDPR Art. 17 / 21 — which is a data
-- subject exercising a right, and honouring it is obligatory. Nothing here lets
-- software decline anybody.

create table prospects (
  id uuid primary key default gen_random_uuid(),

  business_name text not null,
  website_url text,
  city text,
  country text not null default 'DE',
  -- Free text on purpose. The ICP is "catering and event businesses", and a
  -- closed enum written now would be wrong by the second import.
  category text,

  status prospect_status not null default 'imported',

  -- D34, the whole of it. Null for every prospect that has not signed up, which
  -- is nearly all of them.
  claimed_agency_id uuid references agencies(id) on delete set null,
  claimed_at timestamptz,

  -- ─── Deduplication ────────────────────────────────────────────────────────
  -- Lead lists overlap heavily — the same caterer appears in a Google export, a
  -- directory scrape and a spreadsheet a partner sent. Computed by
  -- src/prospects/dedupe.ts from the domain where there is one and from
  -- normalised name + city where there is not, and unique, so the second import
  -- of the same business updates rather than duplicates.
  dedupe_key text not null,

  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- When the last erasure-relevant action happened. §9's legal note: a sole
  -- trader's public business page is personal data, because the natural person
  -- *is* the business.
  suppressed_at timestamptz,

  constraint prospects_claimed_consistently
    check ((claimed_agency_id is null) = (claimed_at is null)),
  constraint prospects_suppressed_consistently
    check ((status = 'suppressed') = (suppressed_at is not null))
);

create unique index prospects_dedupe_idx on prospects (dedupe_key);
create index prospects_status_idx on prospects (status, updated_at desc);
create index prospects_claimed_idx on prospects (claimed_agency_id)
  where claimed_agency_id is not null;

comment on table prospects is
  'A business that fits the ICP and is not a customer. Deliberately not an agencies row — see D34.';

-- ─── Where each fact came from ──────────────────────────────────────────────
--
-- Every prospect fact is traceable to the thing it was read out of. This is not
-- bookkeeping: §4 says a scraped page with no verdict attached is text, not
-- knowledge, and the training signal is "we read X as Y and the owner corrected
-- it". That sentence is unwriteable unless the X is still on file.
create table prospect_sources (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references prospects(id) on delete cascade,

  -- 'import_row' | 'crawl' | 'search_result'. Text rather than an enum because
  -- Phase C adds source kinds and a migration per kind is friction with no payoff.
  kind text not null,
  -- Human-meaningful pointer: a URL, or 'Tabelle1!A12'. What an evidence snippet
  -- in the C3 confirmation UI cites so the owner can verify by glance.
  locator text not null default '',

  -- The C1 cache key. Re-crawling an unchanged page must cost nothing.
  url_norm text,
  content_hash text,

  -- Set when the bytes were kept; null when only the extract was.
  object_key text,
  excerpt text,
  payload_json jsonb not null default '{}'::jsonb,

  upload_job_id uuid references upload_jobs(id) on delete set null,
  fetched_at timestamptz not null default now()
);

create index prospect_sources_prospect_idx on prospect_sources (prospect_id, fetched_at desc);
create index prospect_sources_cache_idx on prospect_sources (url_norm, content_hash)
  where url_norm is not null;

comment on table prospect_sources is
  'Provenance for every prospect fact. The training signal in §4 cannot be written down without it.';

-- ─── RLS ────────────────────────────────────────────────────────────────────

-- Tenant-scoped: the file belongs to the agency that uploaded it.
do $$
declare
  t text;
begin
  foreach t in array array['upload_jobs', 'upload_chunks'] loop
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

    execute format($p$
      create policy %I on %I for delete to app_user
      using (public.is_agency_member(agency_id))
    $p$, t || '_delete', t);
  end loop;
end $$;

-- Operator-scoped: platform data, gated by the operator list rather than by
-- membership of any agency.
do $$
declare
  t text;
begin
  foreach t in array array['prospects', 'prospect_sources', 'platform_operators'] loop
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
  upload_jobs, upload_chunks, prospects, prospect_sources, platform_operators
  to app_user;

-- ─── Recording a chunk ──────────────────────────────────────────────────────
--
-- One statement, because the alternative is two — insert the chunk, then update
-- the job — and a process killed between them leaves a job whose state disagrees
-- with the chunks on disk. Which is precisely the failure this whole design
-- exists to survive.
--
-- `on conflict do nothing` makes a re-sent chunk free. A client that lost its
-- connection mid-chunk cannot know whether the chunk landed, so it re-sends, and
-- re-sending must never be an error or the resume path would be the failure path.
create or replace function public.record_upload_chunk(
  p_job_id uuid,
  p_chunk_index integer,
  p_bytes bytea
)
returns table (received integer, total integer, state upload_state)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_agency uuid;
  v_total integer;
begin
  -- Read under RLS: a caller who is not a member of the owning agency sees no
  -- row here and gets the same answer as if the job did not exist.
  select j.agency_id, j.chunk_total into v_agency, v_total
  from public.upload_jobs j where j.id = p_job_id;

  if v_agency is null then
    raise exception 'record_upload_chunk: no such upload job %', p_job_id;
  end if;
  if p_chunk_index >= v_total then
    raise exception 'record_upload_chunk: chunk % is beyond the declared total of %',
      p_chunk_index, v_total;
  end if;

  insert into public.upload_chunks (job_id, agency_id, chunk_index, bytes)
  values (p_job_id, v_agency, p_chunk_index, p_bytes)
  on conflict (job_id, chunk_index) do nothing;

  return query
  with counted as (
    select count(*)::integer as n from public.upload_chunks c where c.job_id = p_job_id
  )
  update public.upload_jobs j
  set state = case
        when (select n from counted) >= v_total then 'parsing'::upload_state
        else 'uploading'::upload_state
      end,
      updated_at = now()
  from counted
  where j.id = p_job_id
  returning counted.n, v_total, j.state;
end;
$$;

comment on function public.record_upload_chunk is
  'Store one chunk and advance the job in the same statement. Re-sending a chunk is free, because a client that lost its connection cannot know whether the chunk landed.';

-- ─── The deletion path (B3, §9) ─────────────────────────────────────────────
--
-- Required, not optional. A sole trader's public business page is personal data
-- under GDPR because the natural person is the business, so a prospect record and
-- everything derived from it must be removable on request.
--
-- It returns counts because "done" is not evidence. Answering an erasure request
-- means being able to say what was actually removed.
--
-- Object-store bytes are *not* deleted here — a database function cannot reach
-- S3. It returns the keys instead, and src/prospects/erasure.ts deletes them and
-- only then commits. Doing it the other way round would drop the rows that say
-- which objects to delete, orphaning them permanently.
create or replace function public.erase_prospect(p_prospect_id uuid)
returns table (sources_removed integer, object_keys text[])
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_keys text[];
  v_sources integer;
begin
  select coalesce(array_agg(s.object_key) filter (where s.object_key is not null), '{}')
  into v_keys
  from public.prospect_sources s
  where s.prospect_id = p_prospect_id;

  delete from public.prospect_sources s where s.prospect_id = p_prospect_id;
  get diagnostics v_sources = row_count;

  delete from public.prospects p where p.id = p_prospect_id;

  return query select v_sources, v_keys;
end;
$$;

comment on function public.erase_prospect is
  'Remove a prospect and everything derived from it, returning what was removed. Object keys come back for the caller to delete; a database function cannot reach the object store.';

grant execute on function public.record_upload_chunk(uuid, integer, bytea) to app_user;
grant execute on function public.erase_prospect(uuid) to app_user;
grant execute on function public.is_platform_operator() to app_user;

-- ─── Coverage assertion, again ──────────────────────────────────────────────
-- 0002 asserts this over the tables that existed then. Repeating it here is what
-- makes the guarantee hold for tables added since, and it is cheap.
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

-- And the mirror of it: a prospect table that lost its operator gate would be
-- readable by every logged-in caterer, which is the same failure in the other
-- direction and would not be caught by the assertion above, because these tables
-- deliberately have no agency_id.
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
    and c.relname in ('prospects', 'prospect_sources', 'platform_operators')
    and not c.relrowsecurity;

  if unprotected is not null then
    raise exception 'Platform tables have no RLS: %', unprotected;
  end if;
end $$;
