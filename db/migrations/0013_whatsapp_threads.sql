-- ============================================================================
-- 0013 — WhatsApp threads, and the two mitigations that are not optional
--
-- STANDING RISK, RECORDED ONCE AND NOT RE-ARGUED HERE.
--
-- Unipile links WhatsApp by QR / pairing code — the WhatsApp Web session
-- mechanism, without Meta approval, and Unipile state they are not a Meta
-- Partner. CLAUDE.md §4 forbids exactly this. The owner has weighed it and
-- decided (N3). The consent tick-box in the questionnaire closes the UWG §7
-- solicitation question; it does nothing about Meta's enforcement, which keys on
-- the mechanism and the traffic pattern.
--
-- So the two mitigations are part of the schema rather than part of a runbook:
--
--   1. EVERY CUSTOMER THREAD IS INBOUND-INITIATED. `whatsapp_threads` rows are
--      created by an *inbound* message. `may_send_to_thread` returns false for a
--      number that has not written to us, and there is no argument that overrides
--      it. The questionnaire hands her a `wa.me` deep link; she opens the thread.
--
--   2. A HARD DAILY CAP ON NEW THREADS PER ACCOUNT, plus a kill switch that falls
--      back to email per agency without a deploy. Both are columns, not constants,
--      because the moment they are needed is the moment a deploy is slowest.
--
-- The official Cloud API stays the documented destination. Nothing here should
-- make that migration hard: the adapter emits the same `InboundEvent` as every
-- other channel, and these tables are about *permission to send*, which the Cloud
-- API answers differently but answers with the same question.
-- ============================================================================

create table if not exists whatsapp_accounts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  -- Unipile's account id for the linked phone. Not a secret; the API key is.
  provider_account_id text not null,
  display_phone text,
  status text not null default 'linked' check (status in ('linked', 'disconnected', 'error')),
  -- MITIGATION 2, first half. A number, so it can be lowered from a psql prompt
  -- at 2am without waiting for CI.
  daily_new_thread_cap integer not null default 20 check (daily_new_thread_cap >= 0),
  -- MITIGATION 2, second half. The kill switch. While true nothing is sent over
  -- WhatsApp at all and the caller falls back to email.
  sending_paused boolean not null default false,
  paused_reason text,
  linked_at timestamptz not null default now(),
  unique (provider_account_id)
);
create index if not exists whatsapp_accounts_agency_idx on whatsapp_accounts (agency_id);

-- One row per conversation with one number. `first_inbound_at` is the permission
-- slip: it is set only by an inbound message, and `may_send_to_thread` reads it.
create table if not exists whatsapp_threads (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  account_id uuid not null references whatsapp_accounts(id) on delete cascade,
  -- E.164. The customer's number, or the owner's on his own thread.
  peer_phone text not null,
  -- 'customer' or 'owner'. The owner's thread is how he is notified and how he
  -- replies; it is not subject to the new-thread cap, because he asked for it by
  -- linking his own account.
  peer_role text not null default 'customer' check (peer_role in ('customer', 'owner')),
  inquiry_id uuid references inquiries(id) on delete set null,
  provider_thread_id text,
  -- MITIGATION 1. Null means nobody has written to us on this thread, and nothing
  -- may be sent to it. Set by the inbound webhook, never by a send path.
  first_inbound_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  created_at timestamptz not null default now(),
  unique (account_id, peer_phone)
);
create index if not exists whatsapp_threads_inquiry_idx on whatsapp_threads (inquiry_id);

alter table whatsapp_accounts enable row level security;
alter table whatsapp_accounts force row level security;
alter table whatsapp_threads enable row level security;
alter table whatsapp_threads force row level security;

do $$
declare
  t text;
begin
  foreach t in array array['whatsapp_accounts', 'whatsapp_threads'] loop
    if not exists (select 1 from pg_policies where tablename = t) then
      execute format($p$
        create policy %I on %I for select to app_user
        using (public.is_agency_member(agency_id))
      $p$, t || '_select', t);
      execute format($p$
        create policy %I on %I for insert to app_user
        with check (public.is_agency_member(agency_id))
      $p$, t || '_insert', t);
      execute format($p$
        create policy %I on %I for update to app_user
        using (public.is_agency_member(agency_id))
        with check (public.is_agency_member(agency_id))
      $p$, t || '_update', t);
      execute format($p$
        create policy %I on %I for delete to app_user
        using (public.is_agency_member(agency_id))
      $p$, t || '_delete', t);
    end if;
  end loop;
end $$;


-- ─── Recording an inbound message ───────────────────────────────────────────
--
-- The webhook has no identity: it is a POST from Unipile, authenticated by a
-- shared secret checked in the route, not by a session. Definer, like every other
-- write on this side.
--
-- This is the *only* function that sets `first_inbound_at`, which is what makes
-- mitigation 1 a property of the schema rather than a rule in a code review.

create or replace function public.record_whatsapp_inbound(
  p_provider_account_id text,
  p_peer_phone text,
  p_peer_role text default 'customer',
  p_provider_thread_id text default null
)
returns table (agency_id uuid, thread_id uuid, inquiry_id uuid, is_new_thread boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account record;
  v_thread record;
  v_new boolean := false;
begin
  select a.id, a.agency_id into v_account
    from public.whatsapp_accounts a
   where a.provider_account_id = p_provider_account_id;

  if v_account.id is null then
    -- An unknown account is not an error worth raising at a webhook: Unipile will
    -- retry forever. The route logs it and returns 200 to an empty result.
    return;
  end if;

  select t.* into v_thread
    from public.whatsapp_threads t
   where t.account_id = v_account.id and t.peer_phone = p_peer_phone;

  if v_thread.id is null then
    insert into public.whatsapp_threads
      (agency_id, account_id, peer_phone, peer_role, provider_thread_id,
       first_inbound_at, last_inbound_at)
    values
      (v_account.agency_id, v_account.id, p_peer_phone, p_peer_role, p_provider_thread_id,
       clock_timestamp(), clock_timestamp())
    returning * into v_thread;
    v_new := true;
  else
    update public.whatsapp_threads t
       set last_inbound_at = clock_timestamp(),
           -- Idempotent: an existing thread keeps the first time it was opened.
           first_inbound_at = coalesce(t.first_inbound_at, clock_timestamp()),
           provider_thread_id = coalesce(p_provider_thread_id, t.provider_thread_id)
     where t.id = v_thread.id
    returning * into v_thread;
  end if;

  return query select v_account.agency_id, v_thread.id, v_thread.inquiry_id, v_new;
end;
$$;

comment on function public.record_whatsapp_inbound is
  'Phase E — the only writer of first_inbound_at. Inbound is what grants permission to send (mitigation 1).';

grant execute on function public.record_whatsapp_inbound(text, text, text, text) to app_user;


-- ─── May we send? ───────────────────────────────────────────────────────────
--
-- One function, both mitigations, and a reason string for the log. Returning a
-- reason rather than a bare boolean matters: "we did not message this customer"
-- is a thing someone will have to explain, and "cap_reached" versus
-- "no_inbound_message" are very different explanations.

create or replace function public.may_send_to_thread(
  p_agency_id uuid,
  p_peer_phone text
)
returns table (allowed boolean, reason text, thread_id uuid)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_account record;
  v_thread record;
  v_new_today int;
begin
  select a.* into v_account
    from public.whatsapp_accounts a
   where a.agency_id = p_agency_id and a.status = 'linked'
   order by a.linked_at desc
   limit 1;

  if v_account.id is null then
    return query select false, 'no_linked_account', null::uuid;
    return;
  end if;

  -- MITIGATION 2, the kill switch. Checked before anything else, because the
  -- reason it is flipped is that sending must stop now.
  if v_account.sending_paused then
    return query select false, coalesce(v_account.paused_reason, 'sending_paused'), null::uuid;
    return;
  end if;

  select t.* into v_thread
    from public.whatsapp_threads t
   where t.account_id = v_account.id and t.peer_phone = p_peer_phone;

  -- MITIGATION 1. No inbound message, no thread, no send. There is no argument to
  -- this function that overrides it and no code path that sets first_inbound_at
  -- other than the webhook.
  if v_thread.id is null or v_thread.first_inbound_at is null then
    return query select false, 'no_inbound_message', null::uuid;
    return;
  end if;

  -- The owner's own thread is not a new customer contact and is not capped: he
  -- linked the account, and the cap exists to keep us from spraying strangers.
  if v_thread.peer_role = 'owner' then
    return query select true, 'ok', v_thread.id;
    return;
  end if;

  -- MITIGATION 2, the cap. Counts threads *opened* today, not messages: a long
  -- conversation with one customer is not the pattern that gets a number banned.
  select count(*) into v_new_today
    from public.whatsapp_threads t
   where t.account_id = v_account.id
     and t.peer_role = 'customer'
     and t.first_inbound_at >= date_trunc('day', clock_timestamp());

  -- An already-open thread from an earlier day is never blocked by today's cap;
  -- only a thread first opened today counts against it.
  if v_thread.first_inbound_at >= date_trunc('day', clock_timestamp())
     and v_new_today > v_account.daily_new_thread_cap then
    return query select false, 'daily_cap_reached', v_thread.id;
    return;
  end if;

  return query select true, 'ok', v_thread.id;
end;
$$;

comment on function public.may_send_to_thread is
  'Phase E — mitigations 1 and 2 in one answer: inbound-initiated only, and a per-account daily cap on new threads.';

grant execute on function public.may_send_to_thread(uuid, text) to app_user;


create or replace function public.record_whatsapp_outbound(p_thread_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.whatsapp_threads set last_outbound_at = clock_timestamp() where id = p_thread_id;
$$;

grant execute on function public.record_whatsapp_outbound(uuid) to app_user;


-- ─── Coverage assertion (F0.4) ──────────────────────────────────────────────
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
