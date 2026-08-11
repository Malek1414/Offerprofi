-- ============================================================================
-- 0022 — issuing a quote, and resolving the link it produces
--
-- The gap this closes is the headline promise. `/q/{token}` has rendered a demo
-- tenant since Phase 5, because nothing in the product ever wrote a
-- `quote_versions` row: the tables were designed in 0001, the numbering was built
-- in 0003, the pricing engine is exercised by 600 tests, and between an enquiry
-- sitting in the inbox and a document a customer can open there was nothing.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THIS IS THE OWNER'S ACT, AND THAT IS WHY IT IS ALLOWED TO EXIST.
--
-- Invariant 3 says nothing binding is produced automatically. Invariant 4 says a
-- human decision is always in the path to any outcome that matters. A function
-- that turns an enquiry into a sent quote would violate both if a worker could
-- call it — so it is written so that only a request carrying an authenticated
-- agency member's identity can.
--
-- `security invoker`, deliberately, unlike `send_request_to_owner` next door in
-- 0011. That one is definer because the customer holds a session cookie and not
-- an identity, so RLS has nothing to key on. Here the caller *is* the owner, RLS
-- is exactly the right gate, and making this definer would remove the only thing
-- standing between a background job and an automatically issued quote.
--
-- The quote it writes is *freibleibend*. Issuing it creates no obligation; the
-- act with legal effect is still the owner's confirmation after the customer
-- accepts. See `quote_legal_block` in src/domain/legal.ts.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.issue_quote(
  p_agency_id uuid,
  p_inquiry_id uuid,
  p_token_hash text,
  p_line_items jsonb,
  p_calculation_trace jsonb,
  p_net_total_cents bigint,
  p_vat_breakdown jsonb,
  p_gross_total_cents bigint,
  p_valid_until date,
  p_legal_text_version text
)
returns table (
  quote_id uuid,
  quote_version_id uuid,
  quote_number text,
  version_no integer,
  already_issued boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_quote_id uuid;
  v_version_id uuid;
  v_number text;
  v_state text;
  v_inquiry_state inquiry_state;
begin
  -- Read under RLS. A caller who is not a member of this agency sees no inquiry
  -- here and is told it does not exist, which is the same answer they would get
  -- for an id that really does not — nothing distinguishes the two.
  select i.state into v_inquiry_state
  from public.inquiries i
  where i.id = p_inquiry_id and i.agency_id = p_agency_id;

  if v_inquiry_state is null then
    raise exception 'issue_quote: no such inquiry %', p_inquiry_id;
  end if;

  -- ─── Idempotency ──────────────────────────────────────────────────────────
  --
  -- The owner presses a button on a phone with a bad connection. If the response
  -- is lost he presses it again, and two quotes with two numbers for one enquiry
  -- is a §14 UStG problem as well as a confusing thing to send a customer.
  --
  -- Re-quoting during a negotiation is a real requirement and is deliberately not
  -- this function's job — that is Phase 6, and it produces version 2 of the same
  -- quote through its own path with the owner's explicit intent attached.
  select q.id, q.quote_number, q.state into v_quote_id, v_number, v_state
  from public.quotes q
  where q.inquiry_id = p_inquiry_id and q.state <> 'draft'
  order by q.created_at
  limit 1;

  if v_quote_id is not null then
    select qv.id, qv.version_no into v_version_id, version_no
    from public.quote_versions qv
    where qv.quote_id = v_quote_id
    order by qv.version_no desc
    limit 1;

    return query select v_quote_id, v_version_id, v_number, version_no, true;
    return;
  end if;

  insert into public.quotes (agency_id, inquiry_id, state)
  values (p_agency_id, p_inquiry_id, 'draft')
  returning id into v_quote_id;

  -- §14 UStG: gapless per tenant, allocated on the way out of draft and never at
  -- draft time. A number burnt on a quote that was never sent is a gap, and a gap
  -- is what the requirement exists to prevent.
  v_number := public.allocate_quote_number(p_agency_id);

  insert into public.quote_versions (
    agency_id, quote_id, version_no, line_items, calculation_trace,
    net_total_cents, vat_breakdown, gross_total_cents, valid_until,
    token_hash, legal_text_version, created_by
  )
  values (
    p_agency_id, v_quote_id, 1, p_line_items, p_calculation_trace,
    p_net_total_cents, p_vat_breakdown, p_gross_total_cents, p_valid_until,
    p_token_hash, p_legal_text_version, 'user'
  )
  returning id into v_version_id;

  update public.quotes
  set quote_number = v_number, current_version_id = v_version_id, state = 'sent'
  where id = v_quote_id;

  -- The trigger from 0003 refuses a quote leaving draft without a number, so the
  -- order above is not stylistic.

  insert into public.quote_events (agency_id, quote_version_id, type, payload)
  values (p_agency_id, v_version_id, 'issued',
          jsonb_build_object('inquiry_state_before', v_inquiry_state));

  -- `priced` and `sent_to_owner` both lead to `quote_sent` under the 0011 guard.
  -- Anything else — already sent, accepted, archived — is left alone rather than
  -- forced, because the guard would reject it and the quote itself is fine.
  if v_inquiry_state in ('priced', 'sent_to_owner', 'owner_handling', 'negotiating', 'escalated') then
    update public.inquiries set state = 'quote_sent' where id = p_inquiry_id;
  end if;

  return query select v_quote_id, v_version_id, v_number, 1, false;
end;
$$;

comment on function public.issue_quote is
  'Turn a priced enquiry into a numbered, tokenised quote. security invoker on purpose: only an authenticated agency member may issue one (invariants 3 and 4).';

grant execute on function public.issue_quote(
  uuid, uuid, text, jsonb, jsonb, bigint, jsonb, bigint, date, text
) to app_user;

-- ─── Resolving the link ─────────────────────────────────────────────────────
--
-- The customer holds a token and no identity, so RLS has nothing to key on and
-- this one *is* `security definer` — the mirror of the reasoning above.
--
-- It returns exactly the columns a stranger holding a valid token may see. In
-- particular it returns no contact row and no cost or margin figure: the caterer's
-- own cost base is on the same enquiry and is not the customer's business.
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
set search_path = public
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
  limit 1;
$$;

comment on function public.resolve_quote_link is
  'Resolve a quote token to the document a stranger holding it may see. No contact row, no cost, no margin.';

grant execute on function public.resolve_quote_link(text) to app_user;

-- ─── Recording a view ───────────────────────────────────────────────────────
--
-- "Quote view rate ≥ 80%" is a target metric, and it cannot be measured without
-- this. The identifiers are hashed by the caller before they arrive — 0001 is
-- explicit that we count unique viewers without holding anything that identifies
-- one, and a raw IP on a customer surface would undo the GDPR posture that §7
-- calls a feature rather than a tax.
create or replace function public.record_quote_view(
  p_token_hash text,
  p_ip_hash text,
  p_user_agent_hash text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version uuid;
  v_agency uuid;
begin
  select qv.id, qv.agency_id into v_version, v_agency
  from public.quote_versions qv
  join public.quotes q on q.id = qv.quote_id
  where qv.token_hash = p_token_hash and q.state <> 'draft';

  if v_version is null then
    return; -- An unknown token is not an error. It is a stranger, and we say nothing.
  end if;

  insert into public.quote_events (agency_id, quote_version_id, type, ip_hash, user_agent_hash)
  values (v_agency, v_version, 'viewed', p_ip_hash, p_user_agent_hash);
end;
$$;

grant execute on function public.record_quote_view(text, text, text) to app_user;
