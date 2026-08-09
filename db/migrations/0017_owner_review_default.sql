-- The launch product routes every customer-facing quote through an owner review.
-- Keep the persisted default aligned with that safety invariant.

alter table guardrails
  alter column auto_send_enabled set default false;

update guardrails
set auto_send_enabled = false,
    updated_at = now()
where auto_send_enabled = true;
