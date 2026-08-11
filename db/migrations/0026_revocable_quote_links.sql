-- ============================================================================
-- 0026 — a quote link that can be taken back (security pass H2, H3, H4, H5)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE DOCUMENT IS IMMUTABLE. THE LINK TO IT IS NOT.
--
-- 0003 made `quote_versions` immutable with an unconditional trigger, for a good
-- reason: acceptance references a specific version id, so a version that could be
-- edited afterwards would make "the customer accepted this" mean nothing.
--
-- But the token lives in the same row, and the trigger did not distinguish the
-- two. The result was a revocation path that could not run — `reissueQuoteLink`
-- updated `token_hash`, the trigger raised, zero rows came back, and the route
-- answered 404. An owner who sent a quote to the wrong address was told the quote
-- did not exist, while the leaked link stayed valid forever.
--
-- So immutability is narrowed to what it was actually protecting. Everything
-- about the *document* — figures, trace, totals, version number — stays frozen.
-- The two columns that address it may move.
--
-- The comparison below masks those two columns out of a whole-row `to_jsonb`
-- rather than listing the columns that must not change. That is deliberate: a
-- column added by a later migration is then immutable by default, rather than
-- immutable only if whoever added it remembered this file.
-- ─────────────────────────────────────────────────────────────────────────────

alter table quote_versions add column if not exists revoked_at timestamptz;

comment on column quote_versions.revoked_at is
  'Set when the link was replaced or withdrawn. One-way. A revoked version still exists — the acceptance audit trail needs it — but its token no longer resolves.';

-- ─── Narrowed immutability ──────────────────────────────────────────────────

create or replace function public.forbid_quote_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'quote_versions are immutable — an issued version may not be deleted';
  end if;

  if to_jsonb(new) - 'token_hash' - 'revoked_at'
     is distinct from
     to_jsonb(old) - 'token_hash' - 'revoked_at' then
    raise exception 'quote_versions are immutable — create a new version instead';
  end if;

  -- Revocation is one-way *at the same address*. Clearing it is permitted only
  -- together with a new token, because that is not un-revoking — it is issuing a
  -- new link, and the address the owner was told was dead stays dead either way.
  -- Without the second condition, "revoke" would be undoable by anyone who could
  -- write a single UPDATE, which is the same as not having revocation.
  if old.revoked_at is not null
     and new.revoked_at is null
     and new.token_hash is not distinct from old.token_hash then
    raise exception 'A revoked quote link may not be restored — issue a new link instead';
  end if;

  return new;
end $$;

-- ─── The narrow update policy ───────────────────────────────────────────────
--
-- 0002 dropped the UPDATE *policy* on this table, but its blanket
-- `grant … update … on all tables` left the privilege itself in place — the policy
-- was doing all the work. Re-adding a policy without touching the grant would put
-- the whole table back in reach and leave the trigger as the only guard.
--
-- So the privilege is narrowed at the same time, and the rule ends up stated three
-- times by three different mechanisms: RLS decides *which rows* a member may touch,
-- the column grant decides *which columns* Postgres will even accept in a SET
-- clause, and the trigger decides *what a legal transition looks like*. Any one of
-- the three failing still leaves the document frozen.

create policy quote_versions_relink on quote_versions
  for update to app_user
  using (public.is_agency_member(agency_id))
  with check (public.is_agency_member(agency_id));

revoke update on quote_versions from app_user;
grant update (token_hash, revoked_at) on quote_versions to app_user;

-- ─── The resolver stops answering for a revoked link ────────────────────────
--
-- `valid_until` is deliberately NOT filtered here, unlike `revoked_at`.
--
-- The two are different facts. A revoked link must be dead: the owner performed an
-- act to kill it and has been told it is gone. An *expired* quote is a document
-- that still exists and that the customer is entitled to read — she was sent it,
-- it is hers. 404ing her the morning after `valid_until` would teach her the link
-- was broken rather than that the offer had lapsed.
--
-- Nothing binding turns on the difference: every quote is freibleibend (D9, §145
-- BGB) and there is no acceptance path that does not pass through the owner
-- (invariants 3 and 4). So expiry is a rendering question, answered on the page
-- with the date the customer was already given, and this function keeps returning
-- `valid_until` for it to answer with.
create or replace function public.resolve_quote_link(p_token_hash text)
returns table (
  quote_version_id uuid,
  quote_id uuid,
  agency_id uuid,
  inquiry_id uuid,
  quote_number text,
  version_no integer,
  line_items jsonb,
  calculation_trace jsonb,
  net_total_cents bigint,
  vat_breakdown jsonb,
  gross_total_cents bigint,
  valid_until date,
  legal_text_version text,
  issued_at timestamptz,
  quote_state text,
  agency_name text,
  agency_owner_name text,
  agency_language text,
  brand_color text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    qv.id, qv.quote_id, qv.agency_id, q.inquiry_id, q.quote_number, qv.version_no,
    qv.line_items, qv.calculation_trace, qv.net_total_cents, qv.vat_breakdown,
    qv.gross_total_cents, qv.valid_until, qv.legal_text_version, qv.created_at,
    q.state,
    a.name,
    coalesce(nullif(btrim(u.display_name), ''), a.name),
    a.locale,
    coalesce(bp.color_primary, '')
  from public.quote_versions qv
  join public.quotes q on q.id = qv.quote_id
  join public.agencies a on a.id = qv.agency_id
  left join public.brand_profiles bp on bp.agency_id = a.id
  left join public.agency_members m
    on m.agency_id = a.id and m.role = 'owner'
  left join public.users u on u.id = m.user_id
  where qv.token_hash = p_token_hash
    -- A draft has no number and must not be reachable, even by a token that was
    -- somehow minted early. Only a quote that was actually issued resolves.
    and q.state <> 'draft'
    and qv.revoked_at is null
  limit 1;
$$;

comment on function public.resolve_quote_link is
  'Resolve a quote token to the document a stranger holding it may see. No contact row, no cost, no margin. A revoked link resolves to nothing; an expired one still resolves, because the customer is entitled to read what she was sent.';

-- ─── Revoking, as one statement rather than two ─────────────────────────────
--
-- Doing this in the application would mean an UPDATE that revokes followed by an
-- INSERT that mints, with a window between them in which the old link is dead and
-- the new one does not exist. Here it is one transaction, and the new hash is
-- passed in already hashed — the plaintext token never reaches the database, which
-- is the whole point of storing only a digest.
create or replace function public.replace_quote_link(
  p_inquiry_id uuid,
  p_new_token_hash text
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_quote_number text;
  v_agency_id uuid;
  v_version_id uuid;
begin
  if p_new_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'replace_quote_link expects a sha256 hex digest';
  end if;

  -- Read under RLS. A caller who is not a member of this tenant sees no row, and a
  -- cross-tenant inquiry id is therefore indistinguishable from a missing one.
  select q.quote_number, q.agency_id, q.current_version_id
  into v_quote_number, v_agency_id, v_version_id
  from public.quotes q
  where q.inquiry_id = p_inquiry_id
    and q.state <> 'draft'
    and q.current_version_id is not null;

  if v_version_id is null then
    return null;
  end if;

  -- The old row is marked revoked and keeps its (now dead) hash, so the audit
  -- trail records that a link existed and when it stopped working. The live hash
  -- moves to the same row, because the document did not change — only its address.
  update public.quote_versions
  set token_hash = p_new_token_hash,
      revoked_at = null
  where id = v_version_id;

  insert into public.quote_events (agency_id, quote_version_id, type, payload)
  values (v_agency_id, v_version_id, 'link_replaced', '{}'::jsonb);

  return v_quote_number;
end $$;

grant execute on function public.replace_quote_link(uuid, text) to app_user;

create or replace function public.revoke_quote_link(p_inquiry_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_agency_id uuid;
  v_version_id uuid;
begin
  select q.agency_id, q.current_version_id
  into v_agency_id, v_version_id
  from public.quotes q
  where q.inquiry_id = p_inquiry_id
    and q.state <> 'draft'
    and q.current_version_id is not null;

  if v_version_id is null then
    return false;
  end if;

  update public.quote_versions
  set revoked_at = now()
  where id = v_version_id and revoked_at is null;

  if not found then
    return false;
  end if;

  insert into public.quote_events (agency_id, quote_version_id, type, payload)
  values (v_agency_id, v_version_id, 'link_revoked', '{}'::jsonb);

  return true;
end $$;

grant execute on function public.revoke_quote_link(uuid) to app_user;

-- ─── allocate_quote_number is hardened (H4, H5) ─────────────────────────────
--
-- Two defects in one pre-existing function that 0022 put into the live quote path.
--
-- H4: it is SECURITY DEFINER, takes the tenant id as a parameter, never checks
-- membership, and has no explicit GRANT — so PostgreSQL's default EXECUTE TO PUBLIC
-- applied. Anyone able to issue SQL as `app_user` could call it in a loop against a
-- competitor's uuid, permanently burning holes in that tenant's gapless per-year
-- counter. §14 UStG requires the sequence to be gapless and there is no repair for
-- a number that was handed out and never used. The return value also disclosed how
-- many quotes that agency had issued this year.
--
-- H5: `set search_path = public` does not remove `pg_temp`, which Postgres searches
-- first for relations and which TEMP-privileged roles may write to. The three
-- unqualified references to `quote_number_counters` were therefore shadowable, and
-- a temp table of that name carrying a BEFORE INSERT trigger would have run its
-- body inside the definer context. 0006 and 0011 already defend against exactly
-- this with `set search_path = ''`; this function predates that habit.
create or replace function public.allocate_quote_number(target_agency uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_year smallint := extract(year from now())::smallint;
  allocated integer;
begin
  -- The membership check is the whole point of the fix and it has to be inside the
  -- definer body: the caller cannot be trusted to have made it, and RLS is bypassed
  -- here by definition.
  if not public.is_agency_member(target_agency) then
    raise exception 'allocate_quote_number: not a member of agency %', target_agency
      using errcode = '42501';
  end if;

  insert into public.quote_number_counters (agency_id, year, next_value)
  values (target_agency, current_year, 1)
  on conflict (agency_id, year) do nothing;

  -- FOR UPDATE serialises concurrent sends for this tenant. Two workers sending at
  -- the same instant get consecutive numbers rather than the same one.
  select next_value into allocated
  from public.quote_number_counters
  where agency_id = target_agency and year = current_year
  for update;

  update public.quote_number_counters
  set next_value = next_value + 1
  where agency_id = target_agency and year = current_year;

  return current_year::text || '-' || lpad(allocated::text, 4, '0');
end $$;

revoke execute on function public.allocate_quote_number(uuid) from public;
grant execute on function public.allocate_quote_number(uuid) to app_user;

-- ─── token_hash gets the format check its siblings already have ─────────────
--
-- 0020:100 and 0021:297 both carry this constraint for the same shape. Without it
-- a bug that stored a plaintext token instead of its digest would be invisible.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'quote_versions_token_hash_shape'
  ) then
    -- Not validated against existing rows: a dev database may hold pre-0026 rows
    -- written before the shape was enforced, and failing the migration over test
    -- data would be a worse outcome than letting those rows age out.
    alter table quote_versions add constraint quote_versions_token_hash_shape
      check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$') not valid;
  end if;
end $$;
