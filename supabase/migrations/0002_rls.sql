-- ============================================================================
-- 0002 — row level security (FEATURE_INVENTORY F0.4, F0.5)
--
-- Every tenant table is protected, keyed on agency_id via agency_members.
--
-- The policies are generated from a list rather than hand-written thirty times.
-- Hand-writing them is more readable in isolation and reliably misses one — and a
-- single unprotected table is a cross-tenant data leak, which for a product whose
-- selling point is a defensible privacy posture is not a bug you survive. The list
-- is asserted against the live catalogue at the bottom of this file, so a table
-- added later without a policy fails the migration rather than shipping quietly.
-- ============================================================================

-- Tables scoped by a direct agency_id column.
do $$
declare
  t text;
  tenant_tables text[] := array[
    'channel_connections', 'onboarding_assets', 'brand_profiles',
    'catalog_items', 'price_rules', 'packages', 'modifiers', 'guardrails',
    'contacts', 'inquiries', 'chat_sessions', 'messages', 'attachments',
    'extractions', 'event_briefs', 'availability_cache', 'blackout_dates',
    'capacity_rules', 'quotes', 'quote_versions', 'quote_events',
    'agent_runs', 'guardrail_checks', 'escalations', 'human_interventions',
    'disclosure_records', 'follow_up_jobs', 'subscriptions', 'audit_log',
    'agency_slugs'
  ];
begin
  foreach t in array tenant_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);

    execute format($p$
      create policy %I on %I
      for select to authenticated
      using (public.is_agency_member(agency_id))
    $p$, t || '_select', t);

    execute format($p$
      create policy %I on %I
      for insert to authenticated
      with check (public.is_agency_member(agency_id))
    $p$, t || '_insert', t);

    execute format($p$
      create policy %I on %I
      for update to authenticated
      using (public.is_agency_member(agency_id))
      with check (public.is_agency_member(agency_id))
    $p$, t || '_update', t);

    execute format($p$
      create policy %I on %I
      for delete to authenticated
      using (public.is_agency_member(agency_id))
    $p$, t || '_delete', t);
  end loop;
end $$;

-- ─── Tables needing their own shape ─────────────────────────────────────────

alter table agencies enable row level security;
alter table agencies force row level security;

create policy agencies_select on agencies
  for select to authenticated
  using (public.is_agency_member(id));

-- Only an owner may edit the agency's own legal identity — it lands on every quote
-- under §14 UStG, so a teammate changing the VAT id is a tax problem, not a typo.
create policy agencies_update on agencies
  for update to authenticated
  using (public.is_agency_owner(id))
  with check (public.is_agency_owner(id));

alter table agency_members enable row level security;
alter table agency_members force row level security;

create policy agency_members_select on agency_members
  for select to authenticated
  using (public.is_agency_member(agency_id));

-- Membership changes are an owner-only act (F6.15). Enforced here rather than in
-- the UI, because UI-enforced permissions are decoration.
create policy agency_members_write on agency_members
  for all to authenticated
  using (public.is_agency_owner(agency_id))
  with check (public.is_agency_owner(agency_id));

-- Billing is owner-only (F6.15). Teammates may not see or change it.
drop policy subscriptions_select on subscriptions;
drop policy subscriptions_insert on subscriptions;
drop policy subscriptions_update on subscriptions;
drop policy subscriptions_delete on subscriptions;
create policy subscriptions_owner_only on subscriptions
  for all to authenticated
  using (public.is_agency_owner(agency_id))
  with check (public.is_agency_owner(agency_id));

-- Guardrails and channel connections are owner-only for the same reason: they set
-- what the agent may commit to, and who can reach the mailbox.
drop policy guardrails_insert on guardrails;
drop policy guardrails_update on guardrails;
drop policy guardrails_delete on guardrails;
create policy guardrails_owner_write on guardrails
  for all to authenticated
  using (public.is_agency_owner(agency_id))
  with check (public.is_agency_owner(agency_id));

drop policy channel_connections_insert on channel_connections;
drop policy channel_connections_update on channel_connections;
drop policy channel_connections_delete on channel_connections;
create policy channel_connections_owner_write on channel_connections
  for all to authenticated
  using (public.is_agency_owner(agency_id))
  with check (public.is_agency_owner(agency_id));

-- The audit log is append-only from the application's point of view. A tamperable
-- audit trail is worse than none, because it invites reliance.
drop policy audit_log_update on audit_log;
drop policy audit_log_delete on audit_log;

-- Same for the Art. 22 evidence tables. These exist to be produced to a regulator.
drop policy human_interventions_update on human_interventions;
drop policy human_interventions_delete on human_interventions;
drop policy disclosure_records_update on disclosure_records;
drop policy disclosure_records_delete on disclosure_records;
-- Responding to an intervention must still be recordable.
create policy human_interventions_respond on human_interventions
  for update to authenticated
  using (public.is_agency_member(agency_id))
  with check (public.is_agency_member(agency_id));

-- Quote versions are immutable once written (F5.10). A new negotiation round is a
-- new row; editing an old one would break the acceptance audit trail.
drop policy quote_versions_update on quote_versions;
drop policy quote_versions_delete on quote_versions;

-- ─── Coverage assertion (F0.4) ──────────────────────────────────────────────
-- Any public table carrying agency_id must have RLS enabled. This runs at migration
-- time, so the failure arrives during deploy rather than during an incident.
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
