-- ============================================================================
-- 0007 — persisting a chat turn (F1.1, F1.5, F1.8)
--
-- Same situation as 0005 and 0006: the writer has no identity. A customer in the
-- hosted chat is not a user of the platform and never will be — D11 gives them a
-- tokenised link and no account. Every policy in 0002 is member-scoped, so the four
-- rows a turn produces cannot be written by the caller directly.
--
-- One function, because the four writes are one fact. A message with no inquiry is
-- unreachable; an inquiry with no first message is an empty row in the owner's
-- tray; a chat_session pointing at neither loses the customer's thread on refresh,
-- which is precisely what F1.5's acceptance criterion forbids. plpgsql makes it
-- atomic; writing it as one function means no caller can do three of the four.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- REPLAY IS A NO-OP, AND THE UNIQUE INDEX IS WHAT MAKES IT ONE.
--
-- F1.1's acceptance is "replaying an event creates no second inquiry". The client
-- retries: a flaky mobile connection re-POSTs a turn whose response never arrived,
-- and the customer must not end up with two inquiries and the agency with two
-- entries in the tray. `messages_external_message_id_key` is the enforcement — the
-- insert is `on conflict do nothing` against a real unique index, not a select
-- followed by an insert, which races with itself under exactly the concurrency
-- that produces retries in the first place.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Note what this function does NOT do: it never sets a state other than 'new', and
-- it has no parameter that could route an inquiry away. Spam and over-cap turns are
-- persisted identically to any other and differ only in what the owner is shown
-- (F1.11). There is no argument here that can refuse a customer, which is
-- Invariant 1 held at the storage layer rather than promised above it.
-- ============================================================================

create or replace function public.record_inbound_chat_turn(
  p_agency_id uuid,
  p_session_token_hash text,
  p_resumable_until timestamptz,
  p_external_message_id text,
  p_body_text text,
  -- Null on every turn but the first. Passed as a row rather than looked up so the
  -- exact text shown to this customer is stored, not a version resolved later —
  -- I6 requires proving what a given person saw on a given date.
  p_disclosure_version text default null,
  p_disclosure_language text default null,
  p_disclosure_formality text default null,
  p_disclosure_text text default null
)
returns table (inquiry_id uuid, chat_session_id uuid, is_new_inquiry boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inquiry_id uuid;
  v_session_id uuid;
  v_new boolean := false;
begin
  if p_agency_id is null or p_session_token_hash is null or p_external_message_id is null then
    raise exception 'record_inbound_chat_turn requires an agency, a session and a message id';
  end if;

  -- The agency is checked, not trusted from the join. A token hash is unguessable,
  -- but pairing it with the agency resolved from the path means a hash that somehow
  -- collided across tenants still cannot attach this turn to the wrong one.
  select cs.id, cs.inquiry_id into v_session_id, v_inquiry_id
    from public.chat_sessions cs
   where cs.session_token_hash = p_session_token_hash
     and cs.agency_id = p_agency_id;

  if v_inquiry_id is null then
    insert into public.inquiries (agency_id, channel, state)
    values (p_agency_id, 'hosted_chat', 'new')
    returning id into v_inquiry_id;
    v_new := true;
  end if;

  if v_session_id is null then
    insert into public.chat_sessions
      (agency_id, inquiry_id, session_token_hash, resumable_until, last_seen_at)
    values
      (p_agency_id, v_inquiry_id, p_session_token_hash, p_resumable_until, now())
    on conflict (session_token_hash) do nothing
    returning id into v_session_id;

    -- Lost a race with a concurrent first turn on the same session. Adopt the
    -- winner's rows rather than failing the customer's message — and abandon the
    -- inquiry just created, which has no message attached and so is invisible in
    -- the tray. Two inquiries for one thread would be the worse outcome.
    if v_session_id is null then
      select cs.id, cs.inquiry_id into v_session_id, v_inquiry_id
        from public.chat_sessions cs
       where cs.session_token_hash = p_session_token_hash
         and cs.agency_id = p_agency_id;
      v_new := false;
    end if;
  else
    update public.chat_sessions
       set last_seen_at = now(),
           resumable_until = greatest(resumable_until, p_resumable_until)
     where id = v_session_id;
  end if;

  insert into public.messages
    (agency_id, inquiry_id, direction, channel, external_message_id, body_text, sent_by, status)
  values
    (p_agency_id, v_inquiry_id, 'inbound', 'hosted_chat', p_external_message_id,
     p_body_text, 'customer', 'received')
  on conflict (external_message_id) where external_message_id is not null do nothing;

  -- I6: recorded once per inquiry, and only when the caller says this was the turn
  -- that showed it. A second insert would misrepresent the transcript as having
  -- disclosed twice.
  if p_disclosure_version is not null then
    insert into public.disclosure_records
      (agency_id, inquiry_id, version, language, formality, text_shown)
    select p_agency_id, v_inquiry_id, p_disclosure_version, p_disclosure_language,
           p_disclosure_formality, p_disclosure_text
     where not exists (
       select 1 from public.disclosure_records d where d.inquiry_id = v_inquiry_id
     );
  end if;

  return query select v_inquiry_id, v_session_id, v_new;
end;
$$;

comment on function public.record_inbound_chat_turn is
  'F1.1/F1.5/F1.8 — persists one inbound hosted-chat turn. Idempotent on external_message_id. Cannot set any state but new.';

grant execute on function public.record_inbound_chat_turn(
  uuid, text, timestamptz, text, text, text, text, text, text
) to app_user;
