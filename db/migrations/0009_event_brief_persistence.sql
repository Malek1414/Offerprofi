-- ============================================================================
-- 0009 — storing an extraction (F3.3, F3.5)
--
-- Third definer function, same reason as 0007 and 0008: extraction runs while a
-- customer is in the chat, and a customer has no identity.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE BRIEF AND THE EXTRACTIONS ARE ONE FACT, SO THEY ARE ONE FUNCTION.
--
-- `event_briefs` holds the current answer; `extractions` holds where each part of
-- it came from. A brief with no provenance rows cannot be explained to a customer
-- who asks why her quote says eighty guests, and provenance rows with no brief
-- describe a state the product never reached. Splitting the two writes across two
-- calls means the first can succeed and the second fail, and the failure is
-- invisible until someone asks the one question the trace exists to answer.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- INVARIANT 2 SURVIVES THE ROUND TRIP. `brief_json` and `contact_json` arrive as
-- two parameters and land in two columns. There is no parameter here that takes a
-- merged document, so no caller can flatten them on the way in — which is the
-- quiet way the Art. 22 position would break.
--
-- Extractions are append-only. A later turn adds rows rather than replacing them,
-- because "the guest count was 80 until message four said 95" is exactly the
-- history the conflict rule in §4.10 is written against.
-- ============================================================================

create or replace function public.record_event_brief(
  p_agency_id uuid,
  p_inquiry_id uuid,
  p_brief_json jsonb,
  p_contact_json jsonb,
  p_completeness numeric,
  p_overall_confidence numeric,
  -- [{ "field_path": ..., "value": ..., "confidence": ..., "source_ref": ... }]
  p_extractions jsonb default '[]'::jsonb,
  p_source extraction_source default 'ai'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid;
begin
  if p_agency_id is null or p_inquiry_id is null then
    raise exception 'record_event_brief requires an agency and an inquiry';
  end if;

  -- The inquiry has to belong to the agency being written on behalf of. Without
  -- this the function is a cross-tenant write primitive: it runs as its owner, so
  -- RLS is not there to catch a mismatched pair.
  select i.agency_id into v_agency from public.inquiries i where i.id = p_inquiry_id;
  if v_agency is null then
    raise exception 'record_event_brief: inquiry % does not exist', p_inquiry_id;
  end if;
  if v_agency <> p_agency_id then
    raise exception 'record_event_brief: inquiry % does not belong to agency %',
      p_inquiry_id, p_agency_id;
  end if;

  insert into public.event_briefs
    (inquiry_id, agency_id, brief_json, contact_json, completeness, overall_confidence, updated_at)
  values
    (p_inquiry_id, p_agency_id, p_brief_json, p_contact_json,
     p_completeness, p_overall_confidence, now())
  on conflict (inquiry_id) do update
    set brief_json = excluded.brief_json,
        contact_json = excluded.contact_json,
        completeness = excluded.completeness,
        overall_confidence = excluded.overall_confidence,
        updated_at = now();

  insert into public.extractions
    (agency_id, inquiry_id, field_path, value_json, confidence, source)
  select
    p_agency_id,
    p_inquiry_id,
    e ->> 'field_path',
    e -> 'value',
    -- Clamped here as well as in the application. The column has a check
    -- constraint, and a confidence of 1.4 arriving from anywhere would otherwise
    -- abort the whole write rather than record a slightly optimistic figure.
    least(1, greatest(0, (e ->> 'confidence')::numeric)),
    p_source
  from jsonb_array_elements(p_extractions) e
  where e ->> 'field_path' is not null;
end;
$$;

comment on function public.record_event_brief is
  'F3.3/F3.5 — upserts an EventBrief and appends its provenance rows. brief and contact stay in separate columns (I2).';

grant execute on function public.record_event_brief(
  uuid, uuid, jsonb, jsonb, numeric, numeric, jsonb, extraction_source
) to app_user;
