-- ============================================================================
-- 0011 — the handoff artefact (Phase D)
--
-- She presses send. Two documents come into existence from one request: hers,
-- which confirms what she asked for, and his, which is the same request plus
-- everything he needs to answer it. Each is reached by its own unguessable token.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE CUSTOMER'S ROW DOES NOT CONTAIN THE THINGS THE CUSTOMER MAY NOT SEE.
--
-- `resolve_request_link` returns contact details only for the owner's audience.
-- The customer's document cannot render a contact block by mistake, because the
-- row it is built from has nulls where those columns are — the same reasoning as
-- the brief/contact split in 0009, applied to the read side.
--
-- When the price suggestion lands (Phase B2) it belongs in exactly the same
-- place: on the owner's row, absent from hers. The rule the price-leak test
-- asserts is that no figure ever appears in the customer's document; this
-- function is what makes that structural rather than a filter someone can forget.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Tokens are stored as hashes. A leaked backup is then a list of hashes rather
-- than a list of working links into strangers' enquiries — the same shape as
-- `chat_sessions.session_token_hash` and `user_sessions.token_hash`.
-- ============================================================================

-- ─── The state she puts the inquiry into ────────────────────────────────────
--
-- Not `owner_handling`: he has not picked it up yet, and the distinction is the
-- whole SLA. Note who moves it — she does, by pressing send. The agent's two
-- outcomes in 0010 are unchanged, and it still cannot reach this state.
alter type inquiry_state add value if not exists 'sent_to_owner' after 'qualifying';


create table if not exists request_links (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  inquiry_id uuid not null references inquiries(id) on delete cascade,
  -- 'customer' or 'owner'. Two rows per request, two different documents.
  audience text not null check (audience in ('customer', 'owner')),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  -- Set when a link should stop working. Nothing writes it yet; having the column
  -- means revocation is an update rather than a migration during an incident.
  revoked_at timestamptz,
  unique (inquiry_id, audience)
);
create index if not exists request_links_inquiry_idx on request_links (inquiry_id);

alter table request_links enable row level security;
alter table request_links force row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'request_links') then
    create policy request_links_select on request_links
      for select to app_user using (public.is_agency_member(agency_id));
    create policy request_links_insert on request_links
      for insert to app_user with check (public.is_agency_member(agency_id));
    create policy request_links_update on request_links
      for update to app_user
      using (public.is_agency_member(agency_id))
      with check (public.is_agency_member(agency_id));
    create policy request_links_delete on request_links
      for delete to app_user using (public.is_agency_member(agency_id));
  end if;
end $$;


-- ─── The transition guard, extended for the new state ───────────────────────
--
-- Restated in full rather than patched, because the guard is one CASE and a
-- partial redefinition would silently drop the rows it does not mention. The only
-- changes from 0003 are the two lines carrying `sent_to_owner`; INVARIANT 1 and
-- INVARIANT 4 below them are byte-identical and stay that way.

create or replace function public.enforce_inquiry_transition()
returns trigger
language plpgsql
as $$
declare
  legal boolean;
begin
  if new.state = old.state then
    return new;
  end if;

  legal := case old.state
    when 'new' then new.state in ('acknowledged','escalated','spam','archived')
    when 'acknowledged' then new.state in ('extracting','escalated','spam','archived')
    when 'extracting' then new.state in ('qualifying','sent_to_owner','priced','escalated','archived')
    when 'qualifying' then new.state in ('qualifying','sent_to_owner','priced','escalated','expired','archived')
    -- He has it and has not picked it up yet. Everything he can do next is here,
    -- including handing it back to nobody: expiry is a timer, not a decision.
    when 'sent_to_owner' then new.state in ('owner_handling','negotiating','priced','quote_sent','escalated','declined_by_customer','expired','archived')
    when 'priced' then new.state in ('quote_sent','escalated','archived')
    when 'quote_sent' then new.state in ('negotiating','accepted','escalated','declined_by_customer','expired','archived')
    when 'negotiating' then new.state in ('negotiating','priced','quote_sent','accepted','escalated','declined_by_customer','expired','archived')
    when 'escalated' then new.state in ('owner_handling','qualifying','negotiating','quote_sent','archived')
    when 'owner_handling' then new.state in ('negotiating','quote_sent','accepted','confirmed','declined_by_owner','declined_by_customer','archived')
    when 'accepted' then new.state in ('confirmed','declined_by_owner','owner_handling','archived')
    when 'confirmed' then new.state in ('fulfilled','archived')
    when 'fulfilled' then new.state in ('archived')
    when 'declined_by_customer' then new.state in ('archived')
    when 'declined_by_owner' then new.state in ('archived')
    when 'expired' then new.state in ('negotiating','archived')
    when 'spam' then new.state in ('new','archived')
    when 'archived' then false
    else false
  end;

  if not legal then
    raise exception 'Illegal inquiry transition: % → %', old.state, new.state;
  end if;

  -- The two states that decide something commercially require a named human.
  -- There is no service-role bypass here on purpose: a worker that wants to confirm
  -- a booking or decline a customer is a bug, not a use case.
  if new.state in ('confirmed', 'declined_by_owner') and new.assigned_user_id is null then
    raise exception
      'Invariant violation: "%" requires an authenticated agency user. '
      'Route to "escalated" instead — the system may never decide this. See PRODUCT_SPEC §12.6.',
      new.state;
  end if;

  return new;
end $$;


-- ─── Sending ────────────────────────────────────────────────────────────────

create or replace function public.send_request_to_owner(
  p_agency_id uuid,
  p_inquiry_id uuid,
  p_customer_token_hash text,
  p_owner_token_hash text
)
returns table (state inquiry_state, already_sent boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid;
  v_state inquiry_state;
  v_existing int;
begin
  if p_agency_id is null or p_inquiry_id is null
     or p_customer_token_hash is null or p_owner_token_hash is null then
    raise exception 'send_request_to_owner requires an agency, an inquiry and two tokens';
  end if;

  select i.agency_id, i.state into v_agency, v_state
    from public.inquiries i where i.id = p_inquiry_id;
  if v_agency is null then
    raise exception 'send_request_to_owner: inquiry % does not exist', p_inquiry_id;
  end if;
  if v_agency <> p_agency_id then
    raise exception 'send_request_to_owner: inquiry % does not belong to agency %',
      p_inquiry_id, p_agency_id;
  end if;

  -- Pressing send twice is one send. The unique index on (inquiry_id, audience) is
  -- the enforcement; this is what turns the second press into a no-op that returns
  -- the links she already has rather than an error page on the way to the caterer.
  select count(*) into v_existing from public.request_links l where l.inquiry_id = p_inquiry_id;
  if v_existing > 0 then
    return query select v_state, true;
    return;
  end if;

  insert into public.request_links (agency_id, inquiry_id, audience, token_hash)
  values (p_agency_id, p_inquiry_id, 'customer', p_customer_token_hash),
         (p_agency_id, p_inquiry_id, 'owner', p_owner_token_hash);

  -- Escalated stays escalated: a person is already on the thread, and the request
  -- reaching them is the point. Everything else walks to sent_to_owner one legal
  -- edge at a time, because 0003's guard rejects a jump and each hop is audited.
  -- Aliased because this function's OUT parameter is also called `state`, and an
  -- unqualified reference resolves to the variable rather than the column.
  update public.inquiries as i
     set state = 'acknowledged', acknowledged_at = coalesce(i.acknowledged_at, now())
   where i.id = p_inquiry_id and i.state = 'new';
  update public.inquiries as i set state = 'extracting'
   where i.id = p_inquiry_id and i.state = 'acknowledged';
  update public.inquiries as i set state = 'sent_to_owner'
   where i.id = p_inquiry_id and i.state in ('extracting', 'qualifying');

  select i.state into v_state from public.inquiries i where i.id = p_inquiry_id;
  return query select v_state, false;
end;
$$;

comment on function public.send_request_to_owner is
  'Phase D — the customer''s send. Mints the two document links and hands the request over. Idempotent.';

grant execute on function public.send_request_to_owner(uuid, uuid, text, text) to app_user;


-- ─── Which inquiry is this browser in? ──────────────────────────────────────
--
-- The send button is pressed by someone holding a chat session cookie and nothing
-- else. 0007 resolves a session while writing a turn; this resolves one without
-- writing anything, which is what an action that is not a message needs.
--
-- The agency is checked rather than trusted from the join, for the same reason as
-- in 0007: the pair coming from two places is what stops a hash that somehow
-- collided across tenants from acting on the wrong one.

create or replace function public.inquiry_for_session(
  p_agency_id uuid,
  p_session_token_hash text
)
returns table (inquiry_id uuid, state inquiry_state)
language sql
security definer
set search_path = ''
as $$
  select cs.inquiry_id, i.state
    from public.chat_sessions cs
    join public.inquiries i on i.id = cs.inquiry_id
   where cs.session_token_hash = p_session_token_hash
     and cs.agency_id = p_agency_id
     and cs.resumable_until > clock_timestamp();
$$;

comment on function public.inquiry_for_session is
  'Phase D — resolves a live chat session to its inquiry without writing anything.';

grant execute on function public.inquiry_for_session(uuid, text) to app_user;


-- ─── Reading a document ─────────────────────────────────────────────────────

create or replace function public.resolve_request_link(p_token_hash text)
returns table (
  audience text,
  agency_id uuid,
  inquiry_id uuid,
  state inquiry_state,
  sent_at timestamptz,
  brief_json jsonb,
  -- Owner audience only. Null for the customer, in the row, not in a filter.
  contact_json jsonb,
  agency_name text,
  owner_display_name text,
  color_primary text,
  privacy_notice_url text,
  imprint_url text,
  locale text
)
language plpgsql
security definer
-- Empty search_path for the same reason 0006 has one: this function is reachable
-- by anyone holding a token, so nothing in it may resolve through a caller's path.
set search_path = ''
as $$
begin
  if p_token_hash is null or p_token_hash = '' then
    return;
  end if;

  return query
  select
    l.audience,
    l.agency_id,
    l.inquiry_id,
    i.state,
    l.created_at,
    eb.brief_json,
    case when l.audience = 'owner' then eb.contact_json else null end,
    a.name,
    a.owner_display_name,
    b.color_primary,
    a.privacy_notice_url,
    a.imprint_url,
    a.locale
  from public.request_links l
  join public.inquiries i on i.id = l.inquiry_id
  join public.agencies a on a.id = l.agency_id
  -- Left, for the same reason 0006's is left: brand confirmation is a later
  -- onboarding step, and an agency that has not reached it still sends requests.
  left join public.brand_profiles b on b.agency_id = a.id
  left join public.event_briefs eb on eb.inquiry_id = l.inquiry_id
  where l.token_hash = p_token_hash
    and l.revoked_at is null;
end;
$$;

comment on function public.resolve_request_link is
  'Phase D — one token, one document. Contact details are returned for the owner audience only.';

grant execute on function public.resolve_request_link(text) to app_user;


-- ─── Coverage assertion, again (F0.4) ───────────────────────────────────────
-- 0002 checks this against the catalogue as it stood then. A table added later is
-- exactly the case that assertion exists for, so it is worth repeating here.
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
