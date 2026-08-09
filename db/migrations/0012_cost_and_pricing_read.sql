-- ============================================================================
-- 0012 — what a suggested price needs (Phase B2)
--
-- Two things, and neither is a pricing change: a column saying what a service
-- costs to produce, and a read that works from the owner's request page.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- COST IS NULLABLE, AND THAT IS THE WHOLE DESIGN.
--
-- `unit_price_cents` is what a service sells for; this is what it costs to make.
-- Filling it in is the one genuinely tedious step the pivot asks of a caterer,
-- and making it required would block onboarding on it. A suggestion without
-- margins is still worth having, so a line with no cost is reported as *unknown*
-- rather than counted as pure profit — an omission that flattered every margin
-- would be worse than no margin at all.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- No check that cost ≤ price. A caterer who loses money on a loss-leader knows he
-- does; refusing the number would only mean he stops entering them.

alter table catalog_items
  add column if not exists cost_cents bigint check (cost_cents is null or cost_cents >= 0);

comment on column catalog_items.cost_cents is
  'Phase B2 — what this service costs the caterer to produce, per unit. Nullable: margin unknown is reported, never assumed.';


-- ─── The catalogue, read with no identity ───────────────────────────────────
--
-- `listCatalogueItems` in src/onboarding/repository.ts is user-scoped and
-- correctly so: it is the owner's editor, behind a login. The suggestion is
-- rendered on `/r/{token}`, which is reached by a token and has no session, so
-- that read cannot be reused.
--
-- Fixed column list, like `public_agency_profile` and `resolve_request_link`, so
-- a later `alter table catalog_items` cannot silently widen what the tokenised
-- path can read.
--
-- Only confirmed, active items. F2.8 is the rule that nothing unconfirmed is ever
-- used, and a suggestion built from a candidate the owner never approved is
-- exactly the use it forbids.

create or replace function public.catalogue_for_pricing(p_agency_id uuid)
returns table (
  id uuid,
  name text,
  description text,
  unit text,
  unit_price_cents bigint,
  floor_price_cents bigint,
  cost_cents bigint,
  vat_rate smallint,
  quantity_driver quantity_driver,
  -- [{ "min_qty": …, "max_qty": …, "unit_price_cents": … }], ascending.
  price_rules jsonb
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    ci.id,
    ci.name,
    ci.description,
    ci.unit,
    ci.unit_price_cents,
    ci.floor_price_cents,
    ci.cost_cents,
    ci.vat_rate,
    ci.quantity_driver,
    coalesce(
      (select jsonb_agg(jsonb_build_object(
                'min_qty', pr.min_qty,
                'max_qty', pr.max_qty,
                'unit_price_cents', pr.unit_price_cents)
              order by pr.min_qty)
         from public.price_rules pr
        where pr.catalog_item_id = ci.id),
      '[]'::jsonb)
  from public.catalog_items ci
  where ci.agency_id = p_agency_id
    and ci.active
    and ci.confirmed_at is not null
  order by ci.name;
$$;

comment on function public.catalogue_for_pricing is
  'Phase B2 — the catalogue as the owner-side price suggestion reads it. Confirmed active items only (F2.8).';

grant execute on function public.catalogue_for_pricing(uuid) to app_user;


create or replace function public.modifiers_for_pricing(p_agency_id uuid)
returns table (
  id uuid,
  kind text,
  condition_json jsonb,
  adjustment_type text,
  value numeric,
  order_index integer
)
language sql
security definer
set search_path = ''
stable
as $$
  select m.id, m.kind, m.condition_json, m.adjustment_type, m.value, m.order_index
    from public.modifiers m
   where m.agency_id = p_agency_id
   order by m.order_index;
$$;

comment on function public.modifiers_for_pricing is
  'Phase B2 — weekend, peak season and travel surcharges, for the owner-side suggestion.';

grant execute on function public.modifiers_for_pricing(uuid) to app_user;
