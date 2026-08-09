-- ============================================================================
-- 0006 — the public face of an agency (F1.4)
--
-- `/a/{slug}` is unauthenticated. Anyone with the link reaches it, which is the
-- entire point: the link goes in an Instagram bio, on a business card and behind a
-- QR code. So resolving a slug happens with no identity at all — the same situation
-- as signup and login in 0005, and it gets the same answer for the same reason.
--
-- `agency_slugs` has member-scoped policies only, so an anonymous read matches
-- nothing. Rather than add a public SELECT policy to a tenant table — which would
-- widen every future query against it, including ones written by someone who never
-- read this comment — the public surface is one SECURITY DEFINER function that
-- returns a fixed column list. It cannot be asked for a column it does not name.
--
-- What a stranger may see is exactly what already appears on the rendered page:
-- the trading name, the owner's first name in the greeting, the brand colour and
-- logo, the advertised response time, and the language the agency writes in. Not
-- the legal name, address, tax id, VAT id, plan or any member.
-- ============================================================================

-- ─── Columns the public surface needs and the schema did not have ───────────
--
-- These were carried as constants in the demo tenant, which is why their absence
-- went unnoticed until a real agency had to render.

alter table agencies
  -- The response time advertised in the acknowledgement. Per-agency because a
  -- one-person planner and a three-person corporate shop promise different things.
  -- Spec open question §9.8 asks who sets this and what happens when it is missed;
  -- the column exists so that answer has somewhere to land, and 24 is the default
  -- the acknowledgement copy was written against.
  add column if not exists sla_hours smallint not null default 24
    constraint agencies_sla_hours_sane check (sla_hours between 1 and 336),

  -- Sie or Du as the agency's own default. The customer's own register still wins
  -- (F1.15) unless force_formality is set, which is the override for an agency
  -- whose brand is one or the other regardless of how it is addressed.
  add column if not exists default_formality text not null default 'sie'
    constraint agencies_default_formality check (default_formality in ('du', 'sie')),
  add column if not exists force_formality text
    constraint agencies_force_formality check (force_formality in ('du', 'sie')),

  -- Art. 13 requires the privacy notice to be reachable from the first turn, and
  -- §5 TMG the imprint. An agency with its own pages points at them; null falls
  -- back to ours, which is what a solo planner without a website needs.
  add column if not exists privacy_notice_url text,
  add column if not exists imprint_url text,

  -- Suspension is an agency-level state, never a customer-level one. It exists for
  -- non-payment and for an agency that asks to pause, and it makes the chat link
  -- resolve to nothing. It is not, and must never become, a way to turn away an
  -- individual customer — see Invariant 1.
  add column if not exists suspended_at timestamptz;

-- ─── The resolver ───────────────────────────────────────────────────────────
--
-- Returns at most one row. A suspended agency and a nonexistent one are the same
-- empty result on purpose: the caller renders a neutral not-found either way, and
-- a public endpoint that distinguishes them tells strangers which tenants exist.
-- The slug is guessable by design, so that distinction would be an enumeration
-- oracle over the customer list of every agency on the platform.

create or replace function public.resolve_public_agency(p_slug text)
returns table (
  agency_id uuid,
  slug text,
  name text,
  owner_display_name text,
  locale text,
  sla_hours smallint,
  default_formality text,
  force_formality text,
  privacy_notice_url text,
  imprint_url text,
  color_primary text,
  logo_asset_id uuid
)
language sql
security definer
-- Empty search_path: a SECURITY DEFINER function that resolves unqualified names
-- through the caller's search_path can be pointed at a shadowing table.
set search_path = ''
stable
as $$
  select
    a.id,
    s.slug,
    a.name,
    a.owner_display_name,
    a.locale,
    a.sla_hours,
    a.default_formality,
    a.force_formality,
    a.privacy_notice_url,
    a.imprint_url,
    b.color_primary,
    b.logo_asset_id
  from public.agency_slugs s
  join public.agencies a on a.id = s.agency_id
  -- Left, not inner: brand confirmation is a later onboarding step (F2.5) and an
  -- agency that has not reached it still has a working chat link.
  left join public.brand_profiles b on b.agency_id = a.id
  where s.slug = p_slug
    and a.suspended_at is null
$$;

comment on function public.resolve_public_agency(text) is
  'F1.4 — anonymous slug lookup. Returns only columns a stranger may see; suspended and nonexistent are indistinguishable.';

-- Granted to app_user, which is the role the application connects as. The function
-- is the privilege; the role still has no direct read on agency_slugs.
grant execute on function public.resolve_public_agency(text) to app_user;
