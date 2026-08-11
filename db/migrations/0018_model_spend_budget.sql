-- ============================================================================
-- 0018 — hourly spend meters for model calls (A3)
--
-- Ported from the compared repo's `ai_extraction_budget`. What it adds over the
-- cost accounting already in `agent_runs` is the ability to say *no*: `agent_runs`
-- records what was spent after the fact, which is an invoice, not a cap.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CAPACITY IS TAKEN BY A CONDITIONAL UPSERT, NOT BY COUNTING THEN INSERTING.
--
-- `select count(*)` is stale the moment it returns, and two requests arriving in
-- the same millisecond both read the same under-limit number and both proceed.
-- The upsert below increments *and* tests the limit in one statement, so the
-- count and the decision to act cannot drift apart. That is the entire reason
-- this is a database function rather than three lines of TypeScript.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ─────────────────────────────────────────────────────────────────────────────
-- EXHAUSTING A METER IS NOT A REFUSAL OF A CUSTOMER (I1).
--
-- When capacity runs out the inquiry escalates to a human — the same path as a
-- model timeout or an unparseable response. Nobody is told no, nobody is turned
-- away, and the caterer gets a thread with a person on it. There is deliberately
-- no state here that a customer could be moved into.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Fixed hourly windows, not rolling. A burst straddling a boundary can therefore
-- reach twice the limit within two minutes. That is accepted: the meter exists to
-- stop a runaway loop and a scripted abuser, and both are orders of magnitude
-- away from 2x. Make it rolling only if a real incident shows the boundary matters.

create table if not exists model_spend_budget (
  -- `paid:*` is charged only when a call actually reached the provider.
  -- `attempt:*` is charged on every attempt and never refunded, because reading
  -- and parsing untrusted documents costs real work even when the request is
  -- rejected for free afterwards. Without it, looping on cheap rejections is free.
  scope text not null check (scope in (
    'paid:agency', 'paid:inquiry', 'paid:platform',
    'attempt:agency', 'attempt:inquiry', 'attempt:platform'
  )),
  -- The agency id, the inquiry id, or '' for the platform-wide meter.
  key text not null,
  window_start timestamptz not null,
  runs integer not null default 0 check (runs >= 0),
  primary key (scope, key, window_start)
);

comment on table model_spend_budget is
  'A3 — hourly meters per scope. Capacity is taken by the conditional upsert in take_model_budget_slot, which is atomic with the decision to call the model.';

-- Old windows are dead weight; nothing reads them once the hour has passed.
create index if not exists model_spend_budget_window_idx
  on model_spend_budget (window_start);


-- ─── Taking a slot ──────────────────────────────────────────────────────────
--
-- Returns the new count, or NULL when the limit is already reached. `security
-- definer` because this is infrastructure metering rather than tenant data: it is
-- keyed by agency but it is not *about* an agency, and a tenant must not be able
-- to read, reset or raise its own meter. There is deliberately no RLS policy
-- granting `app_user` direct access to the table for that reason.
create or replace function public.take_model_budget_slot(
  p_scope text,
  p_key text,
  p_limit integer,
  p_window_start timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_runs integer;
begin
  if p_limit <= 0 then
    return null;
  end if;

  insert into public.model_spend_budget as b (scope, key, window_start, runs)
  values (p_scope, p_key, p_window_start, 1)
  on conflict (scope, key, window_start) do update
     set runs = b.runs + 1
   -- The test and the increment are the same statement. This WHERE is the cap.
   where b.runs < p_limit
  returning b.runs into v_runs;

  -- No row came back: the conflict target matched and the WHERE rejected it, so
  -- the meter is full. NULL rather than an exception, because a full meter is an
  -- ordinary outcome that ends in a human, not an error.
  return v_runs;
end;
$$;

comment on function public.take_model_budget_slot is
  'A3 — take one slot of an hourly meter. Returns the new count, or NULL when full. Atomic: the limit test and the increment are one statement.';

grant execute on function public.take_model_budget_slot(text, text, integer, timestamptz) to app_user;


-- ─── Housekeeping ───────────────────────────────────────────────────────────
--
-- Nothing reads a window once it has passed, so rows are droppable. Called from
-- no schedule yet; the table is tiny and this exists so that when it is not, the
-- answer is already written down.
create or replace function public.prune_model_budget(p_before timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.model_spend_budget where window_start < p_before;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.prune_model_budget is
  'A3 — drop meter rows for windows that have passed. Safe at any time; nothing reads a closed window.';

grant execute on function public.prune_model_budget(timestamptz) to app_user;
