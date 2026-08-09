-- ============================================================================
-- 0016 — owner onboarding surfaces
--
-- Uploads are parsed synchronously and the binary is discarded. The digest is
-- retained so re-uploading the same offer does not create a second searchable
-- copy, and so the UI can report a duplicate without keeping the original file.
-- ============================================================================

alter table knowledge_documents
  add column if not exists sha256 text;

create unique index if not exists knowledge_documents_agency_sha256_idx
  on knowledge_documents (agency_id, sha256)
  where sha256 is not null;

-- Onboarding changes the agency's public presentation and knowledge base. Keep
-- reads available to members, but make every write owner-only at the database
-- boundary as well as in the route handlers.
drop policy if exists brand_profiles_insert on brand_profiles;
drop policy if exists brand_profiles_update on brand_profiles;
drop policy if exists brand_profiles_delete on brand_profiles;
create policy brand_profiles_owner_write on brand_profiles
  for all to app_user
  using (public.is_agency_owner(agency_id))
  with check (public.is_agency_owner(agency_id));

do $$
declare
  t text;
begin
  foreach t in array array['knowledge_documents', 'knowledge_chunks'] loop
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format('drop policy if exists %I on %I', t || '_delete', t);
    execute format($policy$
      create policy %I on %I for all to app_user
      using (public.is_agency_owner(agency_id))
      with check (public.is_agency_owner(agency_id))
    $policy$, t || '_owner_write', t);
  end loop;
end $$;
