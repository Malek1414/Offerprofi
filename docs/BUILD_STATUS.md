# Build status

Honest account of what exists against [FEATURE_INVENTORY.md](FEATURE_INVENTORY.md).
Updated 2026-08-09.

## Verified working

`npm run verify` — typecheck, lint and **231 tests**, all green. `npm run build` produces
a clean production build. `npm run dev` then `/q/demo` renders a real quote priced by the
real engine, and `/a/demo` runs the hosted chat against the real endpoint.

Phase 1 was exercised end-to-end against the running dev server, not only in unit tests:
a first turn streams the disclosure before the ack; a second turn on the same cookie does
not repeat the disclosure; an English message comes back in English; a "du" message comes
back in "du"; and a message with the honeypot filled and a 40 ms submit time is **still
acknowledged**, routed to the owner tray rather than refused (Invariant 1 in the real
request path, not just in a test).

| Feature | State | Notes |
|---|---|---|
| F1.1 envelope | **Done** | Type + zod schema + idempotency. 11 tests |
| F1.2 adapter registry (X1) | **Done** | Pure `payload → InboundEvent`; contract violations throw. 16 tests |
| F1.3 hosted_chat adapter | **Done** | Client clock distrusted; tenant never from payload |
| F1.4 `/a/{slug}` | **Done** | Slug resolved server-side; neutral 404, no tenant enumeration |
| F1.5 sessions | **Partial** | Token mint/hash/sign/verify done and tested. No `chat_sessions` row — needs the database |
| F1.6 rate limiting | **Partial** | Throttle-never-refuse, tunable, logged. Process-local map; needs a shared store for >1 instance |
| F1.7 SSE streaming | **Done** | Frame-safe client parser; typing indicator; no blank wait state |
| F1.8 AI disclosure | **Done** | First turn + persistent header label. Versioned; **storing** the record needs the database |
| F1.9 instant ack | **Done** | Ordering enforced by `AckPlan`, asserted by test |
| F1.10 uploads | **Partial** | Sniffing, limits and the scan gate done and tested. No signed URLs, no storage, no scanner |
| F1.11 abuse controls | **Done** | Honeypot, timing, cap, spam → tray. No CAPTCHA. 14 tests |
| F1.12 no third-party origins | **Done** | CSP covers `/a/*`; chat surface has zero external requests |
| F1.13 Art. 13 privacy link | **Done** | First turn and footer, both languages |
| F1.14 "mit {Owner} sprechen" | **Done** | Aborts the in-flight stream first, then records. Never disabled mid-conversation |
| F1.15 language/formality | **Done** | Case-sensitive Sie detection; agency override wins. 16 tests |
| F2.6 catalogue candidates | **Partial** | Candidate model + frequency score. No extraction worker produces them yet |
| F2.8 confirm/edit/reject | **Done** | Guaranteed in three places: type, DB constraint, test. 17 tests |
| F2.12 progress meter | **Done** | Measured against the real Phase 2 exit criterion. 10 tests |
| X2 guardrail evaluator | **Done** | 17 tests. Two outcomes only |
| X4 audit log | **Schema** | Trigger writes on every inquiry transition |
| X5 i18n DE/EN | **Partial** | Quote document and modifier reasons localised, Sie/Du mirrored. Dashboard and email templates not built |
| X7 invariant CI gate | **Done** | 39 tests across I1–I6 |
| F0.3 schema | **Done** | 33 tables, indexes, enums |
| F0.4 RLS | **Done** | Generated from a list plus a migration-time coverage assertion |
| F0.8 tenancy tests | **Done** | `npm run test:db` — 8 assertions, executed against real Postgres. Isolation verified in both directions |
| F3.1/F3.2 EventBrief + `_contact` | **Done** | Types and confidence policy. Extraction worker not built |
| F3.6 confidence policy | **Done** | `evaluateConfidence()` implements the §4.10 table |
| F4.1–F4.8 pricing engine | **Done** | Golden set reproduces to the cent |
| F4.13 guardrails | **Done** | All rules from spec §5.2 |
| F4.14 six invariants | **Done** | Named tests, all failing loudly on regression |
| F5.1 gapless numbering | **Schema** | `allocate_quote_number()` under a row lock; not yet called from application code |
| F5.2 web quote | **Done** | Screen S26, server-rendered, responsive, print stylesheet |
| F5.4 §14 UStG content | **Done** | Rendered; not yet reviewed by counsel |
| F5.5 legal framing | **Done** | Non-removable, DE + EN |
| F5.6 Art. 50(2) marking | **Done** | JSON-LD on the quote page |
| F1.12 no third-party origins | **Done** | Enforced by CSP in `next.config.ts` |
| §15 theming chassis | **Done** | WCAG AA guaranteed for arbitrary agency colours, both schemes |

## Not built

Everything else in the inventory. Named explicitly rather than left to inference:

- **Phase 2, the rest** — F2.1 bulk upload, F2.2 per-format workers, F2.4 crawl,
  F2.5 BrandProfile candidates, F2.7 QuotePattern, F2.9 catalogue CRUD, F2.10 house
  voice, F2.11 manual fallback, F2.13 guardrail form, and screens S9–S19. The
  confirmation *model* exists; the confirmation *UI* (S13, the hardest screen in the
  product) does not. **This is the next thing to build**, and most of it needs
  object storage first.
- **Phase 3** the extraction worker itself (types exist, the Claude calls do not).
- **Phase 4** calendar sync (F4.9–F4.12). `AvailabilityOutcome` is consumed by the
  engine but nothing populates it yet.
- **Phase 5** PDF rendering, tokenised link resolution, accept/decline endpoints,
  quote versioning in application code.
- **Phase 6** negotiation loop, escalation handling, owner dashboard, handoff.
- **Phase 7** email in and out, follow-ups, SLA timers, paste-in.
- **Phase 8** Stripe.
- **Phase 9** GDPR surfaces.
- **Phases 10–12** Slack, Gmail OAuth, WhatsApp.

## Known gaps in what *is* built

1. **No production Postgres is provisioned**, but the migrations are no longer
   unproven: they apply cleanly to a real PostgreSQL 18 and the RLS policies were
   verified to isolate two tenants in both directions (`npm run test:db`). What
   remains is a hosted EU instance, plus S3-compatible object storage and our own
   auth (D29).
2. **The quote route serves a demo tenant.** Token resolution against the database is
   not implemented; `/q/demo` is hardcoded.
3. **Accept / decline / request-human buttons render but do nothing.** The endpoints
   in spec §11 are not built.
4. **`reduceScopeToBudget` removes whole lines only.** It will not reduce a guest count
   or move a line into a cheaper tier, so a budget between two line combinations lands
   lower than it strictly needs to. Documented in the function.
5. ~~Tenancy tests are not executed.~~ **Closed 2026-08-09.** `npm run test:db` applies
   all three migrations to a scratch database and runs 8 assertions against real
   Postgres. It needs a running server, so it is deliberately not part of
   `npm run verify` — CI must provide a Postgres service for it.
6. **Nothing in the chat is persisted.** The envelope is built and validated on every
   turn and then dropped (`void event` in the route). No `inquiries`, `messages`,
   `chat_sessions` or `disclosure_records` rows are written, so a returning customer
   gets a *session* but not a *transcript* — F1.5's "the thread is intact" is only
   half met. Every insertion point is marked `TODO(Phase 1, database)`.
7. **The rate limiter is process-local.** Correct on one instance; under-counts across
   several. Tolerable only because it throttles and never refuses — see the reasoning
   in `src/chat/rate-limit.ts`. Needs a shared store before it guards anything harder.
8. **Uploads have policy but no plumbing.** Sniffing, limits and the scan gate are
   written and tested; signed Storage URLs, the malware scanner and the upload UI
   (screen S6) are not built.
9. **`CHAT_SESSION_SECRET` must be set** or the message endpoint throws. Deliberate —
   a predictable signing key is no key. `.env.local` carries a dev value; production
   needs a real one.
10. **The chat surface has not been reviewed on a real phone.** It was verified at a
    true 980px viewport and by end-to-end request tests. Headless screenshots at
    `--window-size=430` clip the page, but that is an artifact of the layout viewport
    not following the flag — the pre-existing quote page clips identically — not a
    CSS overflow bug.

## Decisions taken during the build

Recorded because they are not in the spec and may want overriding:

- **Gapless numbering uses a locked counter row, not a Postgres sequence.** Sequences
  are non-transactional, so a rolled-back render would burn a number and break §14
  UStG. Serialises sends per tenant, which is an acceptable trade.
- **Overlapping open-ended price bands break the tie on higher minimum quantity.**
  Previously the result depended on row order, which is not deterministic.
- **Budget reduction drops the cheapest line first**, so the substantive service
  survives. Dropping the most expensive reaches the budget faster but left quotes
  consisting of a travel surcharge.
- **The engine emits reason codes, never prose.** A German customer was seeing
  "2027-06-12 falls in peak season" on her Angebot.
- **CSP allows `unsafe-eval` in development only.** Next's dev HMR needs it; the
  production policy stays strict.
- **The rate limiter throttles and never rejects.** A 429 that drops a message is,
  from the customer's side, indistinguishable from being turned away — which §2.1
  forbids. `RateLimitDecision` has no variant that can express a refusal.
- **Abuse triage has exactly two outcomes**, `automate` and `owner_tray`, which is
  Invariant 1 written as a type. A spambot reaching Lisa's tray costs two seconds; a
  binned inquiry costs a wedding.
- **Sie/Du detection is case-sensitive on purpose.** Lowercase "sie" is "she"; only
  capitalised "Sie" away from a sentence start signals register. A case-insensitive
  match reads nearly every German message as formal.
- **The client clock is distrusted but not discarded.** A timestamp up to an hour old
  is honoured, so a phone that composed offline in a venue basement keeps its own
  ordering; anything further out, or ahead, is replaced. SLA timers use `receivedAt`.
- **No CAPTCHA, ever, on customer surfaces.** It would be a third-party script and
  would forfeit the TDDDG §25 no-banner position (F1.12).
- **The idempotency key is not agency-scoped.** One physical message must never be
  admitted twice even if a routing bug attributed it to two tenants.
