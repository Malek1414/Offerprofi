# Progress and session handoff

**Updated:** 2026-08-09 · **Phase 0 and Phase 4 complete. Phase 1 complete except for
persistence. Phase 2 core (F2.6/F2.8/F2.12) built; the rest of Phase 2 is next.**

See [EVAL.md](EVAL.md) for how to tear this down and judge it on evidence. Its section
0 is the uncomfortable one: nothing here has met a real agency yet.

Read [CLAUDE.md](../CLAUDE.md) first, then [PRODUCT_SPEC.md](../PRODUCT_SPEC.md), then
[BUILD_STATUS.md](BUILD_STATUS.md) for the feature-by-feature account. This file is the
short version: where the work stopped, and what to pick up.

---

## State of the tree

`npm run verify` → typecheck, lint, **231 tests**, all green.
`npm run test:db` → migrations applied to a scratch Postgres + **8 database assertions**.
`npm run build` → clean production build.
`npm run dev` → `/q/demo` renders a real quote; `/a/demo` runs the hosted chat.

Nothing is committed yet beyond the two documentation commits. The whole of Phase 0,
Phase 4 and Phase 1 is sitting in the working tree.

### What runs today, without any credentials

| URL | What it does |
|---|---|
| `/a/demo` | Hosted chat. Streams the AI disclosure, then the acknowledgement, mirroring DE/EN and Sie/Du |
| `/q/demo` | Web quote, priced by the real deterministic engine |

`CHAT_SESSION_SECRET` must be set or the message endpoint throws by design. `.env.local`
holds a development value and is gitignored.

---

## What was built this session (Phase 1)

Nine modules and six test files, 124 new tests. The engine-side work from the previous
session was untouched.

```
src/channels/envelope.ts            F1.1  canonical InboundEvent + zod + idempotency
src/channels/registry.ts            F1.2  adapter contract + registry (constraint X1)
src/channels/adapters/hosted-chat.ts F1.3 the first adapter
src/i18n/detect.ts                  F1.15 language + formality detection
src/chat/session.ts                 F1.5  token mint/hash/sign/verify
src/chat/rate-limit.ts              F1.6  throttle, never refuse
src/chat/abuse.ts                   F1.11 honeypot/timing/cap/spam → tray, never away
src/chat/uploads.ts                 F1.10 content sniffing, limits, scan gate
src/chat/ack.ts                     F1.9  instant ack, ordering enforced by type
src/chat/conversation.ts            F1.7/8/13/14  what the agent says, and when
src/lib/agency.ts                   F1.4  slug → tenant, server-side only
src/app/a/[slug]/                   S4/S5/S7/S8  the chat surface
src/app/api/chat/[slug]/route.ts    the SSE message endpoint
```

Verified against the running server, not only in unit tests: disclosure precedes the
ack; a second turn on the same cookie does not repeat the disclosure; English gets
English; "du" gets "du"; and a message with the honeypot filled and a 40 ms submit time
is **still acknowledged** and routed to the tray rather than refused.

---

## Phase 2 so far

Built: `src/onboarding/candidates.ts` (F2.6/F2.8) and `src/onboarding/progress.ts`
(F2.3/F2.12), 27 tests. The rule that *nothing enters the live catalogue unconfirmed*
now holds in three independent places — the type system (no function crosses from
`CatalogueCandidate` to `CatalogItem` without a user id), the database
(`active_items_must_be_confirmed`), and a test that fails if a bypass is added.

Not built: everything that needs file storage or a model call.

## Pick up here — the rest of Phase 2

Phase 2 is the ≥70% unaided-completion target, and S13 (catalogue confirm) is called out
in the inventory as the hardest screen in the product. Order suggested:

1. **F2.1/F2.2 bulk upload and per-format workers.** Reuse `src/chat/uploads.ts` — the
   sniffing and the scan gate are already written and tested; do not write a second
   upload path.
2. **F2.6 extraction** of catalogue candidates from the mandatory ≥3 past quotes (D4).
   First Claude call in the codebase. It emits `CatalogueCandidate[]` and nothing else —
   the confirmation model already exists and must not be routed around.
3. **S13 confirmation UI** — per-object confirm/edit/reject with the source excerpt
   shown inline. Without the excerpt visible the owner confirms blindly and the review
   is theatre.
4. **F2.5 BrandProfile** — feeds `buildAgencyTheme()`, which already guarantees WCAG AA
   for arbitrary agency colours in both schemes.
5. **F2.13 guardrail form** — must be fillable in under three minutes by a non-engineer.

### Before Phase 2, two things worth doing first

- **Provision the Postgres EU instance and object storage.** The schema itself is no
  longer a risk — it applies cleanly and RLS provably isolates tenants (`npm run
  test:db`). What is blocking: the chat cannot persist a transcript and Phase 2 has
  nowhere to put uploaded files. Also needed, and new since D15 changed: our own
  auth, and an S3-compatible bucket (D29).
- **Close the Phase 1 persistence gap** while the code is fresh. Every insertion point
  is marked `TODO(Phase 1, database)` in `src/app/api/chat/[slug]/route.ts` and
  `src/lib/agency.ts`. It is roughly: resolve the slug against `agency_slugs`, upsert
  the inquiry, insert the message idempotently on `external_message_id`, write the
  `chat_sessions` row and the `disclosure_records` row.

---

## Open questions this session did not resolve

Carried forward from CLAUDE.md §9, with what the build learned:

1. **The product name is still blocking.** It is now hardcoded nowhere, but it is
   customer-visible the moment a real agency uses `/a/{slug}`.
2. **SLA wording (§9.8).** The ack says "within X hours" and `slaHours` is currently a
   per-agency field with no UI. Who sets it, and what happens when it is missed?
3. **Chat conversion rate (§9.6)** — still the load-bearing unknown, and now measurable
   as soon as a design partner has a link.

## Stack change, 2026-08-09

D15 moved from Supabase to plain PostgreSQL. What that actually cost is written up as
**D29** in CLAUDE.md — Supabase supplied four things and only Postgres itself is
replaced for free. Auth, object storage and the request-scoped identity behind RLS are
now ours. The identity piece is built (`src/db/client.ts` sets `app.current_user_id`
per transaction, so a pooled connection cannot leak one request's identity into the
next); auth and storage are not.

`supabase/` is now `db/`. The `pg` driver replaced `@supabase/*`.

## Things a future session should not undo

- The six invariants in CLAUDE.md §2, and their tests. They fail loudly for a reason.
- `RateLimitDecision` and `TriageResult` having no refusal-shaped variant.
- The adapter contract staying a pure function. Phase 12's exit criterion — a WhatsApp
  adapter landing with zero downstream changes — is only achievable while it holds.
- Case-sensitive Sie detection.
- Zero third-party origins on `/a/*`, `/q/*`, `/f/*`.
