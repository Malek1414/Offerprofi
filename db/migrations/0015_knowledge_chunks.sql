-- ============================================================================
-- 0015 — the searchable half of the knowledge layer (Phase C)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- NO pgvector, AND THAT IS A CHOICE WITH A MIGRATION PATH, NOT A GAP.
--
-- The plan specifies Contextual Retrieval: hybrid dense + BM25, fused with
-- Reciprocal Rank Fusion, then reranked. pgvector is not available on every
-- managed Postgres (D29d already flags this), so the dense half is deferred and
-- the sparse half ships now.
--
-- What survives the deferral is the part that does the most work: the **context
-- prefix**. Filing a chunk that reads "60 Gäste, 3 Gänge, 72 €" as *"aus dem
-- Angebot Müller, Juni 2025: 60 Gäste, 3 Gänge, 72 €"* is what makes it findable
-- at all, and it is orthogonal to how the search is done.
--
-- Adding dense later is `alter table knowledge_chunks add column embedding
-- vector(1024)` plus a changed ranking expression in one function. Nothing above
-- this layer moves. The column is deliberately absent rather than nullable-and-
-- unused, so "is dense on?" is answered by the schema instead of by a flag.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE ORIGINAL FILE IS NOT STORED, AND THAT IS WHY THIS NEEDS NO BUCKET.
--
-- Object storage was on the critical path only because the plan assumed we keep
-- 30 PDFs. We do not need the PDF; we need its text. It is parsed at upload,
-- chunked, and the binary is discarded — which removes both the bucket and the
-- worker container from this path, and improves the GDPR answer rather than
-- weakening it: there is no document store to disclose, subject-access or delete.
--
-- `source_name` is kept so a retrieved chunk can say where it came from. That is
-- a filename, not a file.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_trgm;

create table if not exists knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  -- "Angebot Müller Juni 2025.pdf". Shown to the owner, and used in the prefix.
  source_name text not null,
  kind text not null default 'past_offer',
  -- The extracted text. The PDF it came from is gone by the time this is written.
  body_text text not null,
  chunk_count integer not null default 0,
  ingested_at timestamptz not null default now()
);
create index if not exists knowledge_documents_agency_idx
  on knowledge_documents (agency_id, ingested_at desc);

create table if not exists knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  document_id uuid not null references knowledge_documents(id) on delete cascade,
  ordinal integer not null,
  -- The chunk as it appeared in the document.
  body_text text not null,
  /**
   * The sticky note. Written by a model over the parent document, with prompt
   * caching, and prepended to the text that gets indexed. Null until that call
   * has run — the chunk is still searchable, just less findable, which is the
   * right degradation when there is no API key.
   */
  context_prefix text,
  /**
   * Indexed over prefix + body, so a chunk is found by the context it was filed
   * under as well as by its own words. Generated rather than trigger-maintained:
   * a column that can disagree with its source is a column that eventually does.
   *
   * German, because these are German catering documents. A caterer whose
   * documents are English gets English stemming applied to German text, which
   * degrades to substring matching rather than to nothing — acceptable, and the
   * per-agency dictionary is a later refinement.
   */
  tsv tsvector generated always as (
    to_tsvector('german', coalesce(context_prefix, '') || ' ' || body_text)
  ) stored,
  created_at timestamptz not null default now(),
  unique (document_id, ordinal)
);
create index if not exists knowledge_chunks_tsv_idx on knowledge_chunks using gin (tsv);
-- Trigram over the raw body, for the queries stemming cannot help with:
-- "Paella-Station" against "Paella Station" is one hyphen and no shared lexeme.
create index if not exists knowledge_chunks_trgm_idx
  on knowledge_chunks using gin (body_text gin_trgm_ops);

alter table knowledge_documents enable row level security;
alter table knowledge_documents force row level security;
alter table knowledge_chunks enable row level security;
alter table knowledge_chunks force row level security;

do $$
declare
  t text;
begin
  foreach t in array array['knowledge_documents', 'knowledge_chunks'] loop
    if not exists (select 1 from pg_policies where tablename = t) then
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
    end if;
  end loop;
end $$;


-- ─── Retrieval ──────────────────────────────────────────────────────────────
--
-- Definer, because the qualifying loop runs in the customer path with no
-- identity — same as every other read on that side.
--
-- Two rankers fused, not one. `ts_rank_cd` handles the ordinary case; trigram
-- similarity catches the compound-noun and hyphenation misses German is full of
-- and stemming does not solve. Taking the greater of the two normalised scores
-- rather than summing them keeps a chunk that scores well on either from being
-- diluted by scoring zero on the other.
--
-- WHEN DENSE ARRIVES: add `embedding vector(1024)`, add cosine distance as a
-- third ranker, and switch this expression to Reciprocal Rank Fusion. Callers do
-- not change — that is the entire reason retrieval is a function and not a query
-- in TypeScript.

create or replace function public.search_knowledge(
  p_agency_id uuid,
  p_query text,
  p_limit int default 5
)
returns table (
  chunk_id uuid,
  source_name text,
  context_prefix text,
  body_text text,
  score real
)
language sql
security definer
set search_path = ''
stable
as $$
  with q as (
    select websearch_to_tsquery('german', p_query) as tsq,
           p_query as raw
  )
  select
    c.id,
    d.source_name,
    c.context_prefix,
    c.body_text,
    greatest(
      ts_rank_cd(c.tsv, q.tsq),
      -- Scaled to sit in the same range as ts_rank_cd, which tops out well below
      -- 1 in practice. Without the scaling every trigram hit would outrank every
      -- keyword hit and the fusion would be a trigram search wearing a hat.
      public.similarity(c.body_text, q.raw) * 0.1
    )::real as score
  from public.knowledge_chunks c
  join public.knowledge_documents d on d.id = c.document_id
  cross join q
  where c.agency_id = p_agency_id
    -- Operators need qualifying too: the empty search_path that keeps this
    -- definer safe also hides pg_trgm's own `%`.
    and (c.tsv @@ q.tsq or c.body_text operator(public.%) q.raw)
  order by score desc, c.ordinal
  limit greatest(1, least(coalesce(p_limit, 5), 50));
$$;

comment on function public.search_knowledge is
  'Phase C — contextual sparse retrieval. Stemmed German full-text fused with trigram. Dense is a later column, not a rewrite.';

grant execute on function public.search_knowledge(uuid, text, int) to app_user;


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
