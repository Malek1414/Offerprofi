-- ============================================================================
-- 0008 — recording a model call (F0.11, X6)
--
-- Same shape and same reason as 0007: the writer has no identity. Every model
-- call this product makes happens while a customer is in the chat, and a customer
-- is not a user of the platform (D11). The `agent_runs` policies in 0002 are
-- member-scoped, so the row cannot be written by the caller directly.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THIS IS THE ROW THAT ANSWERS OPEN QUESTION #3.
--
-- The €19–49/month hypothesis in CLAUDE.md §9.3 is unvalidated because nobody has
-- ever measured the variable cost of one inquiry. `tokens_in`, `tokens_out` and
-- `cost_cents` are that measurement, per tenant, from the first model call the
-- product ever makes — which is why the wrapper writes this row on every call
-- including the failed ones, and not only on the ones that produced a quote. A
-- timeout that burned input tokens still cost money.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Note what is NOT stored: the prompt and the completion. `input_ref` and
-- `output_ref` take a content hash, never content. The customer's message is
-- already in `messages` and the extraction is already in `event_briefs`; copying
-- either here would put the same personal data in a third place with a different
-- retention story, for no analytical gain — token counts answer the cost question
-- and a hash is enough to prove which text produced which run.
-- ============================================================================

create or replace function public.record_agent_run(
  p_agency_id uuid,
  p_purpose text,
  p_model text,
  p_inquiry_id uuid default null,
  -- Hashes. The function has no parameter that could carry prompt text, so a
  -- caller cannot decide to store some later.
  p_input_ref text default null,
  p_output_ref text default null,
  p_tokens_in integer default null,
  p_tokens_out integer default null,
  p_latency_ms integer default null,
  p_cost_cents numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_agency uuid;
begin
  if p_agency_id is null then
    raise exception 'record_agent_run requires an agency id';
  end if;
  if p_purpose is null or p_model is null then
    raise exception 'record_agent_run requires a purpose and a model';
  end if;

  -- A definer function runs as its owner, so RLS is not standing behind this pair.
  -- An inquiry attributed to the wrong agency would put one tenant's cost on
  -- another's bill, which is the one thing this table exists not to get wrong.
  if p_inquiry_id is not null then
    select i.agency_id into v_agency from public.inquiries i where i.id = p_inquiry_id;
    if v_agency is distinct from p_agency_id then
      raise exception 'record_agent_run: inquiry % does not belong to agency %',
        p_inquiry_id, p_agency_id;
    end if;
  end if;

  insert into public.agent_runs
    (agency_id, inquiry_id, purpose, model, input_ref, output_ref,
     tokens_in, tokens_out, latency_ms, cost_cents)
  values
    (p_agency_id, p_inquiry_id, p_purpose, p_model, p_input_ref, p_output_ref,
     p_tokens_in, p_tokens_out, p_latency_ms, p_cost_cents)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.record_agent_run is
  'F0.11/X6 — records one model call for cost accounting. Stores hashes, never prompt or completion text.';

grant execute on function public.record_agent_run(
  uuid, text, text, uuid, text, text, integer, integer, integer, numeric
) to app_user;
