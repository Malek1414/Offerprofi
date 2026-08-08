-- ============================================================================
-- 0003 — gapless quote numbering, state-transition enforcement, audit trail
--        (FEATURE_INVENTORY F5.1, X4, and the §16 decisions)
-- ============================================================================

-- ─── Gapless quote numbers per tenant (§14 UStG) ────────────────────────────
--
-- A Postgres sequence is the obvious choice and the wrong one: sequences are
-- non-transactional, so a rolled-back transaction burns a number and leaves a gap.
-- German invoice numbering has to be gapless (lückenlos), and "we skipped 2027-0041
-- because a PDF render failed" is a conversation with a tax adviser nobody wants.
--
-- So: a counter row per tenant per year, taken under a row lock. Serialised per
-- tenant, which is fine — an agency issuing quotes fast enough to contend on this
-- lock has a much better problem than lock contention.
--
-- Called at SEND, never at draft (the §16 decision). A draft that is never sent
-- must not consume a number.

create table quote_number_counters (
  agency_id uuid not null references agencies(id) on delete cascade,
  year smallint not null,
  next_value integer not null default 1,
  primary key (agency_id, year)
);

alter table quote_number_counters enable row level security;
alter table quote_number_counters force row level security;
create policy quote_number_counters_select on quote_number_counters
  for select to authenticated using (public.is_agency_member(agency_id));

create or replace function public.allocate_quote_number(target_agency uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_year smallint := extract(year from now())::smallint;
  allocated integer;
begin
  insert into quote_number_counters (agency_id, year, next_value)
  values (target_agency, current_year, 1)
  on conflict (agency_id, year) do nothing;

  -- FOR UPDATE serialises concurrent sends for this tenant. Two workers sending at
  -- the same instant get consecutive numbers rather than the same one.
  select next_value into allocated
  from quote_number_counters
  where agency_id = target_agency and year = current_year
  for update;

  update quote_number_counters
  set next_value = next_value + 1
  where agency_id = target_agency and year = current_year;

  return current_year::text || '-' || lpad(allocated::text, 4, '0');
end $$;

-- A number may only be assigned once, and only on the way out of draft.
create or replace function public.enforce_quote_number_immutable()
returns trigger
language plpgsql
as $$
begin
  if old.quote_number is not null and new.quote_number is distinct from old.quote_number then
    raise exception 'Quote number % is already allocated and may not be changed', old.quote_number;
  end if;
  if new.state <> 'draft' and new.quote_number is null then
    raise exception 'A quote leaving draft must carry an allocated number (§14 UStG)';
  end if;
  return new;
end $$;

create trigger quotes_number_immutable
  before update on quotes
  for each row execute function public.enforce_quote_number_immutable();

-- ─── Quote versions are immutable ───────────────────────────────────────────
-- Acceptance references a specific version id (spec §8.4). If a version could be
-- edited after the fact, "the customer accepted this" would mean nothing.

create or replace function public.forbid_quote_version_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'quote_versions are immutable — create a new version instead';
end $$;

create trigger quote_versions_immutable
  before update or delete on quote_versions
  for each row execute function public.forbid_quote_version_mutation();

-- ─── Inquiry state transitions ──────────────────────────────────────────────
--
-- INVARIANT 1 + INVARIANT 4, enforced in the database as well as in TypeScript.
-- The application is the primary guard; this is the backstop for anything that
-- reaches the table by another route — a worker using the service role, a manual
-- fix during an incident, a future admin tool written in a hurry.

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
    when 'extracting' then new.state in ('qualifying','priced','escalated','archived')
    when 'qualifying' then new.state in ('qualifying','priced','escalated','expired','archived')
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

create trigger inquiries_transition_guard
  before update on inquiries
  for each row execute function public.enforce_inquiry_transition();

-- ─── Audit trail on every transition (X4) ───────────────────────────────────

create or replace function public.log_inquiry_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.state is distinct from old.state then
    insert into audit_log (agency_id, actor, action, entity, entity_id, diff)
    values (
      new.agency_id,
      coalesce(
        case when auth.uid() is not null then 'user:' || auth.uid()::text end,
        'system'
      ),
      'inquiry.state_changed',
      'inquiry',
      new.id,
      jsonb_build_object(
        'from', old.state,
        'to', new.state,
        'reason', new.escalation_reason,
        'assigned_user_id', new.assigned_user_id
      )
    );
  end if;
  return new;
end $$;

create trigger inquiries_audit
  after update on inquiries
  for each row execute function public.log_inquiry_transition();

-- ─── Opt-out is absolute (F9.8) ─────────────────────────────────────────────
-- Once a contact opts out, no outbound message may be written for them at all.

create or replace function public.enforce_opt_out()
returns trigger
language plpgsql
as $$
declare
  opted_out timestamptz;
begin
  if new.direction <> 'outbound' then
    return new;
  end if;

  select c.opt_out_at into opted_out
  from inquiries i
  join contacts c on c.id = i.contact_id
  where i.id = new.inquiry_id;

  if opted_out is not null then
    raise exception 'Contact opted out at %; outbound messages are blocked', opted_out;
  end if;

  return new;
end $$;

create trigger messages_respect_opt_out
  before insert on messages
  for each row execute function public.enforce_opt_out();
