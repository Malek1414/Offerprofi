-- ============================================================================
-- 0019 — persist what the assistant said
--
-- `messages` has held only inbound turns since 0007. Twenty-one rows in the
-- development database on 11 Aug 2026, every one of them `inbound`/`customer`:
-- the assistant's half of every conversation was composed, streamed to the
-- browser and dropped.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE OWNER CANNOT JUDGE A CONVERSATION HE CAN ONLY SEE HALF OF.
--
-- The inbox exists so a caterer can pick up a thread and answer it. Half a
-- transcript — the customer's questions with none of the answers — is worse than
-- none, because it reads as complete. It also means a reload of the chat loses
-- everything the assistant said, and that any future audit of what a customer was
-- told has nothing to audit.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `kind` is stored because the turns are not interchangeable: a disclosure, an
-- acknowledgement, a qualifying question and a handoff notice are different
-- obligations, and I6 requires being able to show that the disclosure was shown.
-- The existing `messages.interactive_json` carries it rather than a new column,
-- so nothing about the table's shape changes.

-- ─── Writing an outbound turn ───────────────────────────────────────────────
--
-- Takes the whole batch, because one turn is never produced alone: the first
-- exchange is a disclosure, a privacy line and an acknowledgement, and writing
-- them in three round trips off the response path is three chances to half-write
-- a conversation.
--
-- `security definer` for the same reason as `record_inbound_chat_turn`: the
-- customer holds a session cookie, not an identity, so there is no
-- `app.current_user_id` for RLS to key on. The agency and inquiry are checked
-- here instead, and they must agree.
create or replace function public.record_outbound_chat_turns(
  p_agency_id uuid,
  p_inquiry_id uuid,
  p_kinds text[],
  p_bodies text[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid;
  v_written integer := 0;
  i integer;
begin
  if p_agency_id is null or p_inquiry_id is null then
    raise exception 'record_outbound_chat_turns requires an agency and an inquiry';
  end if;
  if array_length(p_kinds, 1) is distinct from array_length(p_bodies, 1) then
    raise exception 'record_outbound_chat_turns: kinds and bodies must be the same length';
  end if;
  if p_kinds is null or array_length(p_kinds, 1) is null then
    return 0;
  end if;

  select i2.agency_id into v_agency from public.inquiries i2 where i2.id = p_inquiry_id;
  if v_agency is null then
    raise exception 'record_outbound_chat_turns: inquiry % does not exist', p_inquiry_id;
  end if;
  -- The same cross-tenant check the inbound writer makes. A session cookie proves
  -- which conversation, never which agency, so the two are verified against each
  -- other rather than trusted.
  if v_agency <> p_agency_id then
    raise exception 'record_outbound_chat_turns: inquiry % does not belong to agency %',
      p_inquiry_id, p_agency_id;
  end if;

  for i in 1 .. array_length(p_kinds, 1) loop
    -- An empty turn is a real outcome — `runQualifyingTurn` returns none at all
    -- when a human is already on the thread — and there is nothing to record.
    continue when p_bodies[i] is null or btrim(p_bodies[i]) = '';

    insert into public.messages
      (agency_id, inquiry_id, direction, channel, body_text, interactive_json, status, sent_by)
    values
      (p_agency_id, p_inquiry_id, 'outbound', 'hosted_chat', p_bodies[i],
       jsonb_build_object('kind', p_kinds[i]), 'sent', 'agent');
    v_written := v_written + 1;
  end loop;

  return v_written;
end;
$$;

comment on function public.record_outbound_chat_turns is
  'Persist the assistant''s side of a hosted-chat exchange. Batched: the first exchange is three turns and writing them separately is three chances to half-write a conversation.';

grant execute on function public.record_outbound_chat_turns(uuid, uuid, text[], text[]) to app_user;
