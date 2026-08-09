# Build status

Honest account of what exists against [FEATURE_INVENTORY.md](FEATURE_INVENTORY.md).
Updated 2026-08-09.

## Verified working

`npm run verify` — typecheck, lint and **498 tests**, all green. `npm run test:db` applies
all eleven migrations to a scratch PostgreSQL and runs **two assertion suites** against it.
`npm run build` produces a clean production build. `npm run dev` then `/q/demo` renders a
real quote priced by the real engine, `/a/{slug}` runs the hosted chat for **any real
tenant** against the real endpoint, and `/signup` and `/login` render the owner-side auth
surfaces.

Note that `/a/demo` **404s whenever `DATABASE_URL` is set**, and always did — the demo
tenant is the no-database fallback, and with a database configured that branch is dead
and `demo` is simply a slug no agency owns. Use a slug from `agency_slugs` instead.

Phase 1 was exercised end-to-end against the running dev server, not only in unit tests:
a first turn streams the disclosure before the ack; a second turn on the same cookie does
not repeat the disclosure; an English message comes back in English; a "du" message comes
back in "du"; and a message with the honeypot filled and a 40 ms submit time is **still
acknowledged**, routed to the owner tray rather than refused (Invariant 1 in the real
request path, not just in a test).

| Feature | State | Notes |
|---|---|---|
| F1.1 envelope | **Done** | Type + zod schema + idempotency, now enforced by the unique index rather than only modelled: a replayed turn creates no second inquiry and no second message. 11 tests + 1 DB assertion |
| F1.2 adapter registry (X1) | **Done** | Pure `payload → InboundEvent`; contract violations throw. 16 tests |
| F1.3 hosted_chat adapter | **Done** | Client clock distrusted; tenant never from payload |
| F1.4 `/a/{slug}` | **Done** | Resolved against the database via `resolve_public_agency`, a SECURITY DEFINER function returning a fixed stranger-visible column list. Neutral 404; suspended and nonexistent are indistinguishable. 3 DB assertions, including that `agency_slugs` is **not** directly readable without an identity |
| F1.5 sessions | **Done** | `chat_sessions` row written per session; a returning cookie keeps its inquiry and its transcript. 2 DB assertions |
| F1.6 rate limiting | **Partial** | Throttle-never-refuse, tunable, logged. Process-local map; needs a shared store for >1 instance |
| F1.7 SSE streaming | **Done** | Frame-safe client parser; typing indicator; no blank wait state |
| F1.8 AI disclosure | **Done** | First turn + persistent header label. The exact text shown is stored in `disclosure_records`, once per inquiry even under replay — so what a given customer saw on a given date is provable (I6) |
| F1.9 instant ack | **Done** | Ordering enforced by `AckPlan`, asserted by test |
| F1.10 uploads | **Partial** | Sniffing, limits and the scan gate done and tested. No signed URLs, no storage, no scanner |
| F1.11 abuse controls | **Done** | Honeypot, timing, cap, spam → tray. No CAPTCHA. 14 tests |
| F1.12 no third-party origins | **Done** | CSP covers `/a/*`; chat surface has zero external requests |
| F1.13 Art. 13 privacy link | **Done** | First turn and footer, both languages |
| F1.14 "mit {Owner} sprechen" | **Done** | Aborts the in-flight stream first, then records. Never disabled mid-conversation |
| F1.15 language/formality | **Done** | Case-sensitive Sie detection; agency override wins. 16 tests |
| F2.6 catalogue candidates | **Partial** | Candidate model + frequency score. No extraction worker produces them yet |
| F2.8 confirm/edit/reject | **Done** | Guaranteed in three places: type, DB constraint, test. 17 tests |
| X2 guardrail evaluator | **Done** | 17 tests. Two outcomes only |
| X4 audit log | **Schema** | Trigger writes on every inquiry transition |
| X5 i18n DE/EN | **Partial** | Quote document and modifier reasons localised, Sie/Du mirrored. Dashboard and email templates not built |
| X7 invariant CI gate | **Done** | 39 tests across I1–I6 |
| F0.6 owner auth | **Done** | scrypt hashing, DB-backed revocable sessions, signup/login/logout endpoints, screens S1–S2. 56 tests + 20 DB assertions |
| F0.7 tenant bootstrap | **Done** | One atomic function writes user + agency + owner membership + slug. Collision returns suggestions, never an error page |
| F2.9 catalogue CRUD | **Done** | Create, edit, retire. German money parsing. Screens S16/S17. 26 tests |
| F2.11 manual fallback | **Done** | The whole catalogue is buildable by hand, so poor extraction never blocks onboarding (closes open question #5) |
| F2.12 progress meter | **Done** | Screen S9. Renders real state; blocked steps are neither done nor actionable |
| F0.1 repo, TS strict, CI | **Partial** | Repo and strict TS are done and `npm run verify` is the gate locally. **No `.github/workflows` exists**, so nothing blocks a merge yet |
| F0.2 Postgres EU + storage + pgvector | **Partial** | A real local PostgreSQL 18 with migrations and RLS. Not hosted, not EU-verified, no pgvector confirmed, no object storage |
| F0.3 schema | **Done** | 33 tables, indexes, enums |
| F0.4 RLS | **Done** | Generated from a list plus a migration-time coverage assertion |
| F0.5 storage bucket policies | **Not started** | The blocker for most of the rest of Phase 2 |
| F0.8 tenancy tests | **Done** | `npm run test:db` — 8 assertions, executed against real Postgres. Isolation verified in both directions |
| F0.9 `audit_log` helper | **Partial** | The database trigger writes on every inquiry transition and is asserted (X4). No application-side helper or actor resolution yet |
| F0.10 Vercel + preview deploys | **Not started** | No `vercel.json`, no deploy configured |
| F0.11 Anthropic client wrapper | **Done** | `src/agent/client.ts` is the only file that may import the SDK — enforced by a lint rule and by `tests/agent/boundary.test.ts`. Every call writes an `agent_runs` row through a SECURITY DEFINER function, failed calls included. Returns a failure that escalates; never throws at a customer |
| F0.12 feature-flag table | **Not started** | Needed to ship Phases 10–12 dark |
| F0.13 external verification track | **Not started** | Non-code, day-1 item (§5). DPA, Stripe, Cloudflare, Meta, Google, counsel |
| F3.1/F3.2 EventBrief + `_contact` | **Done** | Types and confidence policy |
| F3.3/F3.5 extraction | **Done** | `src/agent/extraction.ts` — transcript → `EventBrief` + `ContactPartition`, one `extractions` row per field. Invented service ids are discarded (D8); language and formality stay deterministic; completeness and overall confidence are computed here, not asked for |
| F3.11 injection handling | **Done** | Untrusted blocks with the delimiter escaped (`src/agent/prompt.ts`). `injection_suspected` is reported and escalates; it changes no other field and refuses nobody |
| F3.7/F3.9/F3.10 qualifying loop, wired | **Done** | `src/chat/qualifying-turn.ts` — one turn runs extraction, stores the request, then asks at most two questions the model wrote from the fields code says are missing. Streams on the same connection as the ack, always behind it. Every failure path ends in a handoff to a person, never a refusal (I1, I5) |
| F5.2/F5.3 request document (Phase D) | **Done** | `/r/{token}` — two documents from one route, self-contained HTML, no external origin, dark and print variants. The customer's copy carries no money and no contact details, enforced by the query (0011), by `requestRows` and by a grep over the rendered page |
| Phase D send | **Done** | `POST /api/chat/{slug}/send` — hers to press, idempotent, and it never refuses a thin or escalated request. Mints two unrelated tokens, stores hashes only, walks the inquiry to `sent_to_owner` |
| Qualifying-loop storage | **Done** | Migration 0010: `conversation_context` (the bounded state one turn is given, fixed column list) and `record_agent_progress`, whose outcome argument admits exactly two values — Invariant 1 in a function signature. Six database assertions |
| F3.6 confidence policy | **Done** | `evaluateConfidence()` implements the §4.10 table |
| F4.1 `PricingInput` + pure function | **Done** | No I/O, no model call, no personal field. Purity asserted by test |
| F4.2 calculation order + trace | **Done** | Spec §7.3 order 1–9; every figure reconstructible from the trace |
| F4.3 tiered `price_rules` | **Done** | Band boundaries tested at the edges. Owner-editable on S17: one threshold per band, upper bounds derived, so a hand-built ladder cannot gap or overlap. 19 tests |
| F4.4 modifiers | **Done** | Ordered, each recorded individually in the trace |
| F4.5 VAT per line | **Partial** | 19% / 7% / 0% split works and is tested. `reverseCharge` is an **input flag** — the VIES lookup that should set it is not built |
| F4.6 rounding | **Done** | Half-up 2dp at line level, totals summed from rounded lines |
| F4.7 budget handling | **Done** | Reduced-scope variant from catalogue items only. Never discounts, never declines |
| F4.8 golden set | **Done** | Reproduces to the cent |
| F4.9 calendar sync | **Not started** | No Google/Graph client exists |
| F4.10 calendar connect flow | **Partial** | The "works fully with no calendar connected" half is true and is the current state. No connect flow |
| F4.11 capacity / blackout / peak / lead time | **Partial** | All four modelled with defaults; lead time and capacity are owner-editable on S15. `blackoutDates` and `peakSeasonRanges` have **no UI** |
| F4.12 `AvailabilityOutcome` | **Partial** | Type exists and the evaluator consumes it correctly (none of the three auto-declines). Nothing computes it — it arrives as an input |
| F4.13 guardrails | **Done** | All rules from spec §5.2 |
| F4.14 six invariants | **Done** | Named tests, all failing loudly on regression |
| F4.15 escalation, never refusal | **Done** | `escalate` is one of exactly two evaluator outcomes |
| F2.13 guardrail form | **Done** | Nine of twelve settings, screen S15. The other three are F4.11 calendar work and Phase 10 channels. Copy tested against I1 |
| F5.1 gapless numbering | **Schema** | `allocate_quote_number()` under a row lock; not yet called from application code |
| F5.2 web quote | **Done** | Screen S26, server-rendered, responsive, print stylesheet |
| F5.4 §14 UStG content | **Done** | Rendered; not yet reviewed by counsel |
| F5.5 legal framing | **Done** | Non-removable, DE + EN |
| F5.6 Art. 50(2) marking | **Done** | JSON-LD on the quote page |
| F1.12 no third-party origins | **Done** | Enforced by CSP in `next.config.ts` |
| §15 theming chassis | **Done** | WCAG AA guaranteed for arbitrary agency colours, both schemes |

## Not built

Everything else in the inventory. Named explicitly rather than left to inference:

- **Phase 0, the rest** — F0.2 a provisioned EU Postgres, F0.5 object storage and its
  bucket policies, F0.10 Vercel and preview deploys, F0.12 feature flags. F0.11, the
  Anthropic client wrapper, is now **closed**. Auth (F0.6) and tenant bootstrap (F0.7) are now closed; **email
  verification and password reset are not** — both need outbound email, which is
  Phase 7. Signup therefore trusts the address until then, and says so.
- **Phase 2, the rest** — F2.1 bulk upload, F2.2 per-format workers, F2.3 the
  three-quote requirement (counted and explained, but nothing can be uploaded yet),
  F2.4 crawl, F2.5 BrandProfile candidates, F2.7 QuotePattern, F2.10 house voice,
  and screens S10–S14, S18, S19. The confirmation *model* exists; the confirmation
  *UI* (S13, the hardest screen in the product) does not. **Everything still
  outstanding here needs either object storage (F0.5) or a model call (F0.11)** —
  F2.13, the guardrail form, was the last piece that needed neither, and it is done.
- ~~Staffelpreise have no UI.~~ **Closed 2026-08-09.** S17 takes a ladder of
  "ab {n} {Einheit} — {Preis}" rows. Only the lower bound is asked for; upper bounds
  are derived from the next band up, so a hand-entered ladder is total and
  non-overlapping by construction. A band under the item floor is rejected at entry,
  because the engine would otherwise clamp it silently and price at the floor with
  nothing to explain the difference.
- **Phase 3** the detail form (F3.8). ~~The in-chat qualifying loop, and extraction
  that nothing calls.~~ **Both closed 2026-08-09.** A customer's turn now runs
  extraction and the qualifying loop on the same SSE connection, behind the
  acknowledgement, and the model's question streams back into the chat she is
  already in (`src/chat/qualifying-turn.ts`). What it cannot do yet is produce a
  price — by design, under the pivot: the caterer is the first party to attach one.
- **Phase 4** calendar sync (F4.9–F4.12) and the VIES lookup behind F4.5.
  `AvailabilityOutcome` is consumed by the engine but nothing populates it yet, so
  **Phase 4 is not complete** — the pricing and guardrail half is, the calendar half
  is untouched. Screens S23–S25 do not exist.
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
2. **The *quote* route still serves a demo tenant.** `/q/demo` is hardcoded and token
   resolution against the database is not implemented there. The *request* route
   `/r/{token}` does resolve real tokens (Phase D) — under the pivot that is the
   document the loop actually produces, and the quote page is the caterer's later
   offer, which he has not written yet.
3. **Accept / decline / request-human buttons render but do nothing.** The endpoints
   in spec §11 are not built.
4. **`reduceScopeToBudget` removes whole lines only.** It will not reduce a guest count
   or move a line into a cheaper tier, so a budget between two line combinations lands
   lower than it strictly needs to. Documented in the function.
5. ~~Tenancy tests are not executed.~~ **Closed 2026-08-09.** `npm run test:db` applies
   all three migrations to a scratch database and runs 8 assertions against real
   Postgres. It needs a running server, so it is deliberately not part of
   `npm run verify` — CI must provide a Postgres service for it.
6. ~~Nothing in the chat is persisted.~~ **Closed 2026-08-09.** A turn writes its
   `inquiries`, `messages`, `chat_sessions` and `disclosure_records` rows through
   `record_inbound_chat_turn`. It runs **behind the first streamed chunk**, never in
   front of it, so a slow database cannot move the F1.9 metric — and a failed write
   is logged rather than shown, because the customer's message did arrive and
   telling her otherwise would be false. What is still missing is the *outbound*
   side: the agent's own turns are streamed but not stored, so the transcript
   currently holds only the customer's half.
7. **The rate limiter is process-local.** Correct on one instance; under-counts across
   several. Tolerable only because it throttles and never refuses — see the reasoning
   in `src/chat/rate-limit.ts`. Needs a shared store before it guards anything harder.
8. **Uploads have policy but no plumbing.** Sniffing, limits and the scan gate are
   written and tested; signed Storage URLs, the malware scanner and the upload UI
   (screen S6) are not built.
9. **`CHAT_SESSION_SECRET` must be set** or the message endpoint throws. Deliberate —
   a predictable signing key is no key. `.env.local` carries a dev value; production
   needs a real one.
10. ~~Signup and login have nowhere to land.~~ **Closed 2026-08-09.** `/` is now a
    router that sends an owner to `/onboarding` or the inbox by her state, and
    `/onboarding` exists. The inbox is still Phase 6, so a *completed* owner has
    nowhere to go — but no new signup can reach that state yet.
11. **No email verification and no password reset.** Both need outbound email
    (Phase 7). Until then an address is trusted as typed, and an owner who forgets her
    password has no self-service route back in. Stated on the signup screen rather
    than implied.
12. **The auth throttle is process-local**, with the same caveat as the chat limiter —
    it under-counts across instances. Unlike that one it genuinely refuses, so a
    shared store matters more here before there is a second instance.
13. **The chat surface has not been reviewed on a real phone.** It was verified at a
    true 980px viewport and by end-to-end request tests. Headless screenshots at
    `--window-size=430` clip the page, but that is an artifact of the layout viewport
    not following the flag — the pre-existing quote page clips identically — not a
    CSS overflow bug.
14. **`ANTHROPIC_API_KEY` is not set anywhere, and the qualifying loop is the first
    thing that needs it.** Without it `callModel` returns `not_configured`, so every
    turn escalates and the customer is told a person is taking over. That is the
    designed failure and it was verified end to end against real rows — but it is not
    a demo. Setting the key is one line in `.env.local`, and it is the only thing
    between the wiring and the headline promise.

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
- **There are two rate limiters, and they are deliberately different types.**
  `src/chat/rate-limit.ts` guards the customer surface and has no variant that can
  express a refusal — that is Invariant 1 written as a type. `src/auth/throttle.ts`
  guards our own signup and login and does refuse, which is correct: I1 protects the
  agency's customers, not anonymous strangers hammering our front door. Merging them
  would quietly turn I1 from a compiler guarantee into a convention.
- **Login backs off exponentially rather than locking out.** A lockout is itself an
  attack — anyone who knows Lisa's email could keep her out of her own dashboard on
  the morning she needs it.
- **Signup says plainly that an email is already taken.** The usual advice is to
  respond identically and send a "someone tried to sign up" mail instead, but that
  pattern *requires* the mail, and outbound email is Phase 7. The alternative until
  then is an owner who appears to sign up and then cannot log in, with nothing
  available to explain it. Login makes the opposite trade and is indistinguishable.
- **Session expiry is checked with `clock_timestamp()`, not `now()`.** `now()` is the
  transaction timestamp and does not advance while a transaction runs, so a session
  that died mid-request would still resolve. Caught by a database assertion.
- **The slug transliterates rather than strips.** `Schröder` becomes `schroeder`, not
  `schroder` — in DACH the latter reads as a misspelling of the owner's own name, on a
  string that ends up printed on a business card.
- **The idempotency key is not agency-scoped.** One physical message must never be
  admitted twice even if a routing bug attributed it to two tenants.
