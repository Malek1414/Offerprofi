-- ============================================================================
-- 0014 — the caterer's hard facts (Phase C, structured half)
--
-- The knowledge layer is two piles, deliberately separated:
--
--   HARD FACTS — minimum order, delivery radius, payment terms, notice period,
--   what he will and will not do. Pulled out of his documents once, reviewed by
--   him, and written into rows. The model reads these **as data**. It cannot
--   search for them, mis-rank them, or paraphrase them into something wrong.
--
--   EVERYTHING ELSE — how he describes his food, past menu combinations,
--   phrasing — goes into a searchable index built with Contextual Retrieval.
--   That half needs pgvector, an embeddings call and a worker container to ingest
--   30 PDFs. **It is not in this migration**, and the gap is deliberate rather
--   than forgotten: see docs/PROGRESS.md.
--
-- This is the half that makes the qualifying questions *sensible* rather than
-- generic, and it is the half that works without any of that infrastructure.
-- `qualify()` has taken a `facts` parameter since Phase B and nothing has ever
-- filled it.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- NOTHING UNCONFIRMED IS EVER USED.
--
-- F2.8's rule, applied to facts rather than to catalogue items, and enforced the
-- same way: a check constraint, not a convention. An extracted fact is a
-- *candidate* until he says otherwise. A model that told a customer "we deliver
-- up to 50km" because it read that off a 2019 PDF he had forgotten about is the
-- failure this prevents.
-- ─────────────────────────────────────────────────────────────────────────────
-- ============================================================================

create table if not exists agency_facts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  -- A short machine key: 'min_order', 'delivery_radius_km', 'notice_days',
  -- 'payment_terms', 'cancellation', 'service_area', 'dietary_capability'.
  -- Deliberately not an enum: the useful facts differ per caterer, and a schema
  -- change to record "we don't do pork" would mean the fact never gets recorded.
  key text not null,
  -- What to tell the model, in a sentence. Prose rather than a number, because
  -- this goes into a prompt and "at least 20 people" beats {min: 20}.
  value text not null,
  /**
   * F2.8. Null means a candidate: extracted, not yet reviewed, and invisible to
   * `facts_for_agent`.
   */
  confirmed_by_user_id uuid references users(id),
  confirmed_at timestamptz,
  source_note text,
  created_at timestamptz not null default now(),
  constraint confirmed_needs_a_human check (confirmed_at is null or confirmed_by_user_id is not null),
  unique (agency_id, key)
);
create index if not exists agency_facts_live_idx
  on agency_facts (agency_id) where confirmed_at is not null;

alter table agency_facts enable row level security;
alter table agency_facts force row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'agency_facts') then
    create policy agency_facts_select on agency_facts
      for select to app_user using (public.is_agency_member(agency_id));
    create policy agency_facts_insert on agency_facts
      for insert to app_user with check (public.is_agency_member(agency_id));
    create policy agency_facts_update on agency_facts
      for update to app_user
      using (public.is_agency_member(agency_id))
      with check (public.is_agency_member(agency_id));
    create policy agency_facts_delete on agency_facts
      for delete to app_user using (public.is_agency_member(agency_id));
  end if;
end $$;


-- ─── What the agent is allowed to know ──────────────────────────────────────
--
-- Definer, because the qualifying loop runs in the customer path with no
-- identity — same shape as every other read on that side. Confirmed facts only,
-- and a fixed column list.

create or replace function public.facts_for_agent(p_agency_id uuid)
returns table (key text, value text)
language sql
security definer
set search_path = ''
stable
as $$
  select f.key, f.value
    from public.agency_facts f
   where f.agency_id = p_agency_id
     and f.confirmed_at is not null
   order by f.key;
$$;

comment on function public.facts_for_agent is
  'Phase C — confirmed facts only. An unreviewed extraction never reaches a customer conversation (F2.8).';

grant execute on function public.facts_for_agent(uuid) to app_user;


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
