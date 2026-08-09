-- ============================================================================
-- 0010 — what the qualifying loop needs from the database
--
-- Third function in the shape of 0007/0008/0009, and for the same reason: the
-- caller is a customer in the hosted chat, who has no identity and never will
-- (D11). Every policy in 0002 is member-scoped, so the reads and the state move
-- below are unreachable from the customer path without a definer.
--
-- Two functions, one read and one write:
--
--   conversation_context   — the state the model is given each turn: the stored
--                            request, its contact half, and the tail of the
--                            transcript. Fixed column list, like
--                            public_agency_profile, so a later `alter table` on
--                            inquiries or messages cannot quietly widen what the
--                            customer path can read.
--
--   record_agent_progress  — the only way the agent may move an inquiry, and it
--                            can express exactly two outcomes.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- INVARIANT 1, AT THE STORAGE LAYER, IN THE SIGNATURE.
--
-- `record_agent_progress` takes an outcome that is either 'qualifying' or
-- 'escalated'. There is no third value and no parameter through which a caller
-- could express one — the two outcomes of the product are "keep going" and "a
-- human takes over", and the enum-shaped argument is what makes that a thing a
-- reviewer can check rather than a promise made in a comment. Anything else
-- raises, naming the invariant.
--
-- Escalation is also not a decline. It sets automation_paused so the agent stops
-- talking, and leaves the inquiry live in the owner's tray.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The walk from 'new' to 'qualifying' goes one edge at a time rather than
-- jumping, because 0003's transition guard is a real trigger and jumping is
-- illegal. Each edge writes its own audit_log row through the trigger in 0003,
-- which is what X4 asks for — a transition nobody can see is a transition nobody
-- can defend.
-- ============================================================================

-- ─── The transcript needs an order, and `now()` was not one ─────────────────
--
-- `messages.created_at` defaulted to now(), which is the *transaction* timestamp
-- and does not advance while a transaction runs. Two messages written in one
-- transaction therefore carry the same timestamp, and "the last ten messages,
-- oldest first" becomes an arbitrary order — which is a scrambled conversation
-- handed to the model, not a missing index.
--
-- The same mistake was already found once in this schema, on session expiry, and
-- fixed the same way. In production the turns of a chat arrive in separate
-- transactions and the bug is invisible; the qualifying loop is the first thing
-- that depends on the order being right, so it is worth being right for reasons
-- other than luck.
alter table public.messages alter column created_at set default clock_timestamp();


create or replace function public.conversation_context(
  p_agency_id uuid,
  p_inquiry_id uuid,
  p_message_limit int default 10
)
returns table (
  brief_json jsonb,
  contact_json jsonb,
  -- [{ "id": ..., "text": ... }], oldest first.
  messages jsonb,
  state inquiry_state,
  automation_paused boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid;
begin
  if p_agency_id is null or p_inquiry_id is null then
    raise exception 'conversation_context requires an agency and an inquiry';
  end if;

  -- The pair is checked, not trusted. The function runs as its owner, so RLS is
  -- not underneath it to catch a mismatched agency and inquiry.
  select i.agency_id into v_agency from public.inquiries i where i.id = p_inquiry_id;
  if v_agency is null then
    raise exception 'conversation_context: inquiry % does not exist', p_inquiry_id;
  end if;
  if v_agency <> p_agency_id then
    raise exception 'conversation_context: inquiry % does not belong to agency %',
      p_inquiry_id, p_agency_id;
  end if;

  return query
  select
    eb.brief_json,
    eb.contact_json,
    coalesce(
      (
        -- Oldest first for the model, newest first for the limit. The tail is what
        -- matters: the state carries everything the scrolled-off messages said.
        select jsonb_agg(jsonb_build_object('id', t.id::text, 'text', t.body_text)
                         order by t.created_at)
          from (
            select m.id, m.body_text, m.created_at
              from public.messages m
             where m.inquiry_id = p_inquiry_id
               and m.direction = 'inbound'
               and m.body_text is not null
             order by m.created_at desc
             limit greatest(1, coalesce(p_message_limit, 10))
          ) t
      ),
      '[]'::jsonb
    ),
    i.state,
    i.automation_paused
  from public.inquiries i
  left join public.event_briefs eb on eb.inquiry_id = i.id
  where i.id = p_inquiry_id;
end;
$$;

comment on function public.conversation_context is
  'Phase B — the bounded context one qualifying turn is given: stored request, contact half, transcript tail. Fixed column list.';

grant execute on function public.conversation_context(uuid, uuid, int) to app_user;


create or replace function public.record_agent_progress(
  p_agency_id uuid,
  p_inquiry_id uuid,
  -- 'qualifying' or 'escalated'. There is no third outcome; see the header.
  p_outcome text,
  p_reason text default null
)
returns inquiry_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid;
  v_state inquiry_state;
begin
  if p_agency_id is null or p_inquiry_id is null then
    raise exception 'record_agent_progress requires an agency and an inquiry';
  end if;

  if p_outcome not in ('qualifying', 'escalated') then
    raise exception
      'Invariant 1: the agent has two outcomes, "qualifying" and "escalated", and "%" '
      'is neither. Software may never refuse, decline or deprioritise a customer — '
      'escalate and a human decides. See PRODUCT_SPEC §12.6.', p_outcome;
  end if;

  select i.agency_id, i.state into v_agency, v_state
    from public.inquiries i where i.id = p_inquiry_id;
  if v_agency is null then
    raise exception 'record_agent_progress: inquiry % does not exist', p_inquiry_id;
  end if;
  if v_agency <> p_agency_id then
    raise exception 'record_agent_progress: inquiry % does not belong to agency %',
      p_inquiry_id, p_agency_id;
  end if;

  if p_outcome = 'escalated' then
    -- Legal from every state the agent can be in when it gives up. From anywhere
    -- else — a human is already handling it, or it is closed — this is a no-op
    -- rather than an error: a model failure must never surface as a 500 on the
    -- customer's screen, and re-escalating an escalated inquiry changes nothing.
    if v_state in ('new', 'acknowledged', 'extracting', 'qualifying', 'priced',
                   'quote_sent', 'negotiating') then
      update public.inquiries
         set state = 'escalated',
             escalation_reason = coalesce(p_reason, escalation_reason),
             -- While true, no agent turn is generated. The person takes the thread.
             automation_paused = true
       where id = p_inquiry_id;
    end if;
    select i.state into v_state from public.inquiries i where i.id = p_inquiry_id;
    return v_state;
  end if;

  -- One edge at a time. 0003's trigger rejects a jump, and each hop is audited.
  update public.inquiries
     set state = 'acknowledged',
         acknowledged_at = coalesce(acknowledged_at, now())
   where id = p_inquiry_id and state = 'new';

  update public.inquiries set state = 'extracting'
   where id = p_inquiry_id and state = 'acknowledged';

  -- Deliberately not from 'escalated'. That edge is legal — a human can hand a
  -- conversation back — but it is a human's to make, and an agent that could take
  -- an escalated thread back would undo Invariant 5 one turn after it fired.
  update public.inquiries set state = 'qualifying'
   where id = p_inquiry_id and state = 'extracting';

  select i.state into v_state from public.inquiries i where i.id = p_inquiry_id;
  return v_state;
end;
$$;

comment on function public.record_agent_progress is
  'Phase B — the agent''s only state move. Two outcomes: qualifying, or escalated to a human (I1).';

grant execute on function public.record_agent_progress(uuid, uuid, text, text) to app_user;
