-- ============================================================================
-- 0001 — initial schema (PRODUCT_SPEC §10, FEATURE_INVENTORY F0.3)
--
-- Every tenant table carries agency_id and is protected by RLS scoped through
-- agency_members. Workers use the service role and must pass agency_id explicitly;
-- the public chat route resolves slug → agency_id server-side and never accepts an
-- agency_id from the client.
--
-- Two structural decisions in here are load-bearing for GDPR Art. 22 and are called
-- out where they appear:
--   * inquiries.state has no 'declined_by_system' value          (invariant 1)
--   * event_briefs splits brief_json from contact_json           (invariant 2)
-- ============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ─── Enums ──────────────────────────────────────────────────────────────────

-- INVARIANT 1. There is deliberately no 'declined_by_system'. The only decline
-- values are declined_by_customer (the customer's own choice) and declined_by_owner
-- (a human decision by an authenticated agency user). Adding a system-decline value
-- here would put the product inside GDPR Art. 22. Do not add one.
create type inquiry_state as enum (
  'new', 'acknowledged', 'extracting', 'qualifying', 'priced', 'quote_sent',
  'negotiating', 'escalated', 'owner_handling', 'accepted', 'confirmed', 'fulfilled',
  'declined_by_customer', 'declined_by_owner', 'expired', 'spam', 'archived'
);

create type channel_kind as enum (
  'hosted_chat', 'email', 'paste_in', 'web_form', 'whatsapp', 'slack'
);

create type message_direction as enum ('inbound', 'outbound');
create type message_sender as enum ('agent', 'user', 'system', 'customer');
create type extraction_source as enum ('ai', 'form', 'owner', 'customer_confirm');
create type member_role as enum ('owner', 'member');
create type quantity_driver as enum ('flat', 'per_guest', 'per_hour', 'per_km', 'per_day', 'per_item');
create type scan_status as enum ('pending', 'clean', 'blocked');
create type intervention_trigger as enum ('customer_request', 'escalation', 'owner_initiated');

-- ─── Tenancy ────────────────────────────────────────────────────────────────

create table agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  address text,
  tax_id text,
  vat_id text,
  plan text not null default 'trial',
  locale text not null default 'de',
  owner_display_name text,
  created_at timestamptz not null default now()
);

create table agency_members (
  agency_id uuid not null references agencies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role member_role not null default 'member',
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (agency_id, user_id)
);
create index on agency_members (user_id);

create table agency_slugs (
  agency_id uuid primary key references agencies(id) on delete cascade,
  slug text not null unique,
  alias_email text not null unique
);
-- F1.4 / F7.1 — the public chat route and the inbound mail handler both hit this.
create index agency_slugs_slug_idx on agency_slugs (slug);

-- The single source of truth for "may this user see this tenant's rows".
-- SECURITY DEFINER so the policy can read agency_members without recursing into
-- agency_members' own policy.
create or replace function public.is_agency_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from agency_members m
    where m.agency_id = target and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_agency_owner(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from agency_members m
    where m.agency_id = target and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

-- ─── Channels and onboarding ────────────────────────────────────────────────

create table channel_connections (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  kind text not null,
  external_account_id text,
  -- Envelope-encrypted, key in managed KMS. Never plaintext, never in env files.
  credentials_encrypted bytea,
  scopes text[],
  status text not null default 'disconnected',
  dns_verified_at timestamptz,
  last_sync_token text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index on channel_connections (agency_id, kind);

create table onboarding_assets (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  kind text not null,
  filename text not null,
  mime text not null,
  bytes bigint not null,
  sha256 text not null,
  storage_path text not null,
  processing_status text not null default 'pending',
  extracted_json jsonb,
  error text,
  created_at timestamptz not null default now()
);
create index on onboarding_assets (agency_id, processing_status);

create table brand_profiles (
  agency_id uuid primary key references agencies(id) on delete cascade,
  logo_asset_id uuid references onboarding_assets(id) on delete set null,
  color_primary text,
  color_secondary text,
  font_family text,
  letterhead_json jsonb,
  voice_descriptor text,
  voice_examples jsonb,
  confirmed_at timestamptz
);

-- ─── Catalogue ──────────────────────────────────────────────────────────────

create table catalog_items (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  name text not null,
  description text not null default '',
  unit text not null default 'Pauschale',
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  -- D8: the hard floor. Defaults to list price, so no-discounting is the out-of-box
  -- behaviour and permitting one is a deliberate act by the owner.
  floor_price_cents bigint not null check (floor_price_cents >= 0),
  vat_rate smallint not null default 19 check (vat_rate in (0, 7, 19)),
  quantity_driver quantity_driver not null default 'flat',
  active boolean not null default true,
  source_asset_ids uuid[],
  confirmed_by uuid references auth.users(id),
  -- F2.8: nothing enters the live catalogue unconfirmed. Enforced below.
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint floor_not_above_list check (floor_price_cents <= unit_price_cents),
  constraint active_items_must_be_confirmed check (not active or confirmed_at is not null)
);
create index on catalog_items (agency_id, active);

create table price_rules (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  catalog_item_id uuid not null references catalog_items(id) on delete cascade,
  min_qty integer not null check (min_qty >= 0),
  max_qty integer,
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  constraint band_ordered check (max_qty is null or max_qty >= min_qty)
);
create index on price_rules (catalog_item_id);

create table packages (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  name text not null,
  description text not null default '',
  bundle_price_cents bigint
);

create table package_items (
  package_id uuid not null references packages(id) on delete cascade,
  catalog_item_id uuid not null references catalog_items(id) on delete cascade,
  quantity numeric not null default 1,
  primary key (package_id, catalog_item_id)
);

create table modifiers (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  kind text not null,
  condition_json jsonb not null,
  adjustment_type text not null check (adjustment_type in ('pct', 'fixed')),
  value numeric not null,
  order_index integer not null default 0
);
create index on modifiers (agency_id, order_index);

-- §6 guardrails. One row per tenant, fillable in under three minutes (F2.13).
create table guardrails (
  agency_id uuid primary key references agencies(id) on delete cascade,
  min_order_value_cents bigint not null default 0,
  max_auto_quote_value_cents bigint not null default 500000,
  allow_scope_reduction boolean not null default true,
  max_negotiation_rounds smallint not null default 4,
  quote_validity_days smallint not null default 14,
  auto_send_enabled boolean not null default true,
  blackout_dates jsonb not null default '[]',
  peak_season_ranges jsonb not null default '[]',
  lead_time_min_days smallint not null default 14,
  capacity_per_day smallint not null default 1,
  escalation_notify text[] not null default array['push','email'],
  allow_emoji boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ─── Contacts and inquiries ─────────────────────────────────────────────────

create table contacts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  name text,
  email text,
  phone_e164 text,
  language text not null default 'de',
  formality text not null default 'unknown',
  opt_in_source text,
  opt_in_at timestamptz,
  -- Once set, all outbound is blocked permanently (F9.8).
  opt_out_at timestamptz,
  created_at timestamptz not null default now()
);
create index on contacts (agency_id, email);

create table inquiries (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  channel channel_kind not null,
  external_thread_id text,
  state inquiry_state not null default 'new',
  first_message_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  sla_due_at timestamptz,
  assigned_user_id uuid references auth.users(id),
  escalation_reason text,
  closed_reason text,
  -- Set by request-human or an escalation. While true, no agent turn is generated.
  automation_paused boolean not null default false,
  negotiation_round smallint not null default 0,
  created_at timestamptz not null default now(),
  -- INVARIANT 1, belt and braces at the storage layer: only a human decline may be
  -- recorded, and it must name the human who made it.
  constraint owner_decline_needs_a_human check (
    state <> 'declined_by_owner' or assigned_user_id is not null
  )
);
-- The dashboard's hot path (spec §10).
create index inquiries_dashboard_idx on inquiries (agency_id, state, sla_due_at);

create table chat_sessions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  inquiry_id uuid references inquiries(id) on delete cascade,
  session_token_hash text not null unique,
  resumable_until timestamptz not null,
  last_seen_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  inquiry_id uuid not null references inquiries(id) on delete cascade,
  direction message_direction not null,
  channel channel_kind not null,
  -- Idempotency across every channel (spec §4.9). One replayed webhook, one message.
  external_message_id text,
  body_text text,
  interactive_json jsonb,
  status text not null default 'pending',
  error text,
  raw_payload_ref text,
  sent_by message_sender not null,
  created_at timestamptz not null default now()
);
create unique index messages_external_message_id_key
  on messages (external_message_id) where external_message_id is not null;
create index on messages (inquiry_id, created_at);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  message_id uuid references messages(id) on delete cascade,
  kind text not null,
  mime text not null,
  filename text,
  bytes bigint not null,
  sha256 text not null,
  storage_path text not null,
  -- F1.10 — nothing is parsed until this is 'clean'.
  scan_status scan_status not null default 'pending',
  extracted_text text,
  created_at timestamptz not null default now()
);
create index attachments_sha256_idx on attachments (sha256);

create table extractions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  inquiry_id uuid not null references inquiries(id) on delete cascade,
  field_path text not null,
  value_json jsonb,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  source_message_id uuid references messages(id) on delete set null,
  source extraction_source not null,
  created_at timestamptz not null default now()
);
create index on extractions (inquiry_id, field_path);

-- INVARIANT 2. brief_json and contact_json are separate columns, not one document.
-- The pricing path reads brief_json only; contact_json is never joined into it.
-- Merging these two columns would be the quiet way to break the Art. 22 position.
create table event_briefs (
  inquiry_id uuid primary key references inquiries(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  brief_json jsonb not null default '{}',
  contact_json jsonb not null default '{}',
  completeness numeric not null default 0,
  overall_confidence numeric not null default 0,
  updated_at timestamptz not null default now()
);

-- ─── Availability ───────────────────────────────────────────────────────────

-- F4.9 — busy/free only. There is deliberately no column for event title, attendees,
-- description or location, so the owner's private calendar content cannot be stored
-- even by a careless sync. That absence is the permission ask we can defend.
create table availability_cache (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  calendar_connection_id uuid references channel_connections(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  is_blocking boolean not null default true
);
create index on availability_cache (agency_id, starts_at, ends_at);

create table blackout_dates (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  reason text
);

create table capacity_rules (
  agency_id uuid primary key references agencies(id) on delete cascade,
  events_per_day smallint not null default 1,
  lead_time_min_days smallint not null default 14,
  peak_ranges jsonb not null default '[]'
);

-- ─── Quotes ─────────────────────────────────────────────────────────────────

create table quotes (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  inquiry_id uuid not null references inquiries(id) on delete cascade,
  -- §14 UStG: gapless per tenant. Allocated at send, never at draft (F5.1) —
  -- see next_quote_number() in 0003.
  quote_number text,
  current_version_id uuid,
  state text not null default 'draft',
  created_at timestamptz not null default now(),
  unique (agency_id, quote_number)
);

create table quote_versions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  quote_id uuid not null references quotes(id) on delete cascade,
  version_no integer not null,
  line_items jsonb not null,
  -- The full §7.3 trace. This is what lets any figure be reconstructed years later.
  calculation_trace jsonb not null,
  net_total_cents bigint not null,
  vat_breakdown jsonb not null,
  gross_total_cents bigint not null,
  valid_until date not null,
  pdf_path text,
  token_hash text not null unique,
  -- The disclosure text in force when this version was produced (I6).
  legal_text_version text not null,
  created_by message_sender not null,
  created_at timestamptz not null default now(),
  unique (quote_id, version_no)
);
create index on quote_versions (quote_id, version_no desc);

create table quote_events (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  quote_version_id uuid not null references quote_versions(id) on delete cascade,
  type text not null,
  payload jsonb,
  -- Hashed, never raw. We can count unique viewers without holding an identifier.
  ip_hash text,
  user_agent_hash text,
  occurred_at timestamptz not null default now()
);
create index on quote_events (quote_version_id, occurred_at);

-- ─── Agent runs, guardrails, escalations ────────────────────────────────────

create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  inquiry_id uuid references inquiries(id) on delete cascade,
  purpose text not null,
  model text not null,
  input_ref text,
  output_ref text,
  tokens_in integer,
  tokens_out integer,
  latency_ms integer,
  -- X6/F8.8 — this column is what turns the €19–49 price hypothesis into a measurement.
  cost_cents numeric,
  created_at timestamptz not null default now()
);
create index on agent_runs (agency_id, created_at);

create table guardrail_checks (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  agent_run_id uuid references agent_runs(id) on delete cascade,
  quote_version_id uuid references quote_versions(id) on delete cascade,
  rule text not null,
  passed boolean not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create table escalations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  inquiry_id uuid not null references inquiries(id) on delete cascade,
  reason text not null,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id)
);
create index on escalations (agency_id, resolved_at);

-- INVARIANT 5 evidence trail. Every request for a human, and how fast it was answered.
create table human_interventions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  inquiry_id uuid not null references inquiries(id) on delete cascade,
  trigger intervention_trigger not null,
  surface text not null,
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  user_id uuid references auth.users(id)
);
create index on human_interventions (agency_id, requested_at);

-- INVARIANT 6 evidence. What this customer was shown, and when.
create table disclosure_records (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  inquiry_id uuid not null references inquiries(id) on delete cascade,
  version text not null,
  language text not null,
  formality text not null,
  text_shown text not null,
  shown_at timestamptz not null default now()
);

create table follow_up_jobs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  inquiry_id uuid not null references inquiries(id) on delete cascade,
  kind text not null,
  scheduled_for timestamptz not null,
  state text not null default 'scheduled',
  attempts smallint not null default 0
);
create index follow_up_jobs_worker_idx on follow_up_jobs (state, scheduled_for);

create table subscriptions (
  agency_id uuid primary key references agencies(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text not null default 'trial',
  status text not null default 'trialing',
  quota_quotes_month integer not null default 15,
  quotes_used_period integer not null default 0,
  current_period_end timestamptz
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  actor text not null,
  action text not null,
  entity text not null,
  entity_id uuid,
  diff jsonb,
  occurred_at timestamptz not null default now()
);
create index on audit_log (agency_id, occurred_at desc);
