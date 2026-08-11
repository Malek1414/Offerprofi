# Build status

Honest account of what exists against [FEATURE_INVENTORY.md](FEATURE_INVENTORY.md).
Updated 2026-08-11.

## What the 33% headline does and does not mean

`npm run progress` reports **33% (45 done, 11 partial, 98 to go, of 154)**, and that number
is generated rather than asserted, which is why it is trusted here. It is also **stale in
one specific way that matters**: it scores against the original 154-feature inventory, and
Phases B–F below are not in that inventory. They were specified after it was written.

So 33% is an accurate answer to "how much of the original spec exists" and an inaccurate
answer to "how much of the product exists". Neither number is fudged to fix that. The
inventory should absorb B–F and the metric re-run; until it does, read the two sections
separately and do not add them together.

## Verified working

`npm run verify` — typecheck, lint and **1,032 tests across 75 files**, all green.
`npm run test:db` applies **all twenty-five migrations** to a scratch PostgreSQL and runs
**six assertion suites** against it (tenancy, signup, prospects, enrichment, candidates,
quote links). `npm run build` produces a clean production build. `npm run dev` then
`/q/demo` renders a
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
| Phase C — structured facts | **Done** | `agency_facts` + `facts_for_agent`. Confirmed rows only (F2.8), read as data, never ranked. Wired into the qualifying loop |
| Phase C — retrieval | **Done, sparse only** | Migration 0015 + `src/knowledge/`. German `tsvector` over context-prefix + body, fused with trigram. Contextual prefixes are one model call per document. **No pgvector**: the dense column is a later `alter table`, and a 5-case golden set lives in `db/tests/tenancy.sql` because the ranking is SQL |
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
| Owner document onboarding | **Done** | `/onboarding/uploads`: PDF/TXT extraction, validation, tenant-scoped de-duplication, chunking, contextual prefixes, storage, listing and deletion. Original binaries are discarded |
| Owner brand onboarding | **Done** | `/onboarding/brand`: persisted colour, accessible live preview and wordmark fallback |
| Legal routes | **Partial** | `/datenschutz`, `/impressum` and `/agb` resolve and state the factual processing behavior. Operator details, legal bases, retention and final wording require configuration/counsel |
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
- **Phase 9** export/deletion workflows and counsel-approved GDPR operations. The linked
  privacy, imprint and terms surfaces now exist and clearly mark every unconfigured fact.
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
8. **Customer attachment uploads have policy but no plumbing.** The owner knowledge-upload
   flow is complete without object storage: it parses PDF/TXT in memory, saves extracted
   text and discards the binary. Customer message attachments still need signed URLs,
   scanning and storage if that feature is enabled later.
9. **`CHAT_SESSION_SECRET` must be set** or the message endpoint throws. Deliberate —
   a predictable signing key is no key. `.env.local` carries a dev value; production
   needs a real one.
10. ~~Signup and login have nowhere to land.~~ **Closed 2026-08-09.** `/` routes an
    incomplete owner to `/onboarding` and a 5/5 owner to the working `/inbox`; both paths
    were walked in a real browser.
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
14. ~~Four linked routes 404.~~ **Closed 2026-08-09.** `/datenschutz`, `/impressum`,
    `/onboarding/uploads` and `/onboarding/brand` now resolve; `/agb`, discovered through
    the signup/legal-link audit, was added too.
15. ~~The product has no name.~~ **Closed 2026-08-09.** The default product name is
    **Offerprofi**, with environment overrides still available for white-labelling.
16. ~~Phase C has no UI.~~ **Closed 2026-08-09.** The owner upload screen now drives real
    extraction, chunking, contextual prefixing, storage, listing, deletion and onboarding
    progress. It intentionally stores text rather than original files.
17. **`ANTHROPIC_API_KEY` is not set anywhere, and the qualifying loop is the first
    thing that needs it.** Without it `callModel` returns `not_configured`, so every
    turn escalates and the customer is told a person is taking over. That is the
    designed failure and it was verified end to end against real rows — but it is not
    a model-backed demo. Setting the key is one line in `.env.local`, and it is the only
    missing input for the model path. Public launch separately requires production hosting,
    secrets and legally reviewed operator text.

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

---

## Phases B–F (2026-08-11) — not in FEATURE_INVENTORY.md

Specified in `docs/EXECUTION_HANDOFF.md` after the 154-feature inventory was written, so
none of the below is counted by `npm run progress`. Shipped as six pull requests.

| Item | State | Notes |
|---|---|---|
| **B0** object storage | **Done** | S3 over `fetch` + hand-rolled SigV4, path-style addressing because virtual-host is an AWS default most S3-compatible providers do not implement. `list()` follows the continuation token, because S3 truncates at 1000 keys with a flag rather than an error and `list` is what the deletion path enumerates. Refuses the filesystem driver in production rather than silently writing to a container that will be replaced. 7 tests |
| **B1** resumable uploads | **Done** | 1 MiB chunks in `bytea`, not S3 multipart: the client is a phone on a venue's wifi, and a dropped connection must cost one chunk rather than one file. Digest verified before the object is written; `chunk_total` derived server-side so "declare 1 byte, send 10 GB" is not expressible. 27 tests + 4 DB assertions |
| **B2** parsing | **Done** | xlsx/docx/csv/pdf read without a dependency. ZIP guarded in three stages (declared size, `maxOutputLength`, actual length), XXE absent by construction — DOCTYPE is stepped over as an opaque span, so there is nothing for an entity to bind to |
| **B3** prospects schema | **Done** | Ops-scoped, gated by `is_platform_operator()`, which takes no parameter and so cannot be told which user to be. A prospect is **not** a tenant (D34) — no `agency_id` — with `erase_prospect()` as the GDPR path. 10 DB assertions |
| **C1** enrichment queue | **Done** | Lease, budget and cache. Prospect budget, run budget and page cap tested independently, so a caller passing `micro_cents = 0` still hits `max_pages`. 12 DB assertions |
| **C2** page → candidates | **Done** | The model finds the item; **code reads the price**. The output schema has no numeric price field, so a computed price has nowhere to be returned; every excerpt is checked verbatim against the page actually fetched. 37 tests, verified by mutation rather than by passing |
| **C3** confirmation UI | **Done** | Split into confident and needs-you **in the query**, not the component. One tap confirms 24 items and writes 24 verdicts — the verdict is the product (§4), and a set-based implementation would have lost 23 of them per tap. 8 DB assertions |
| **C4** drift cards | **Done** | Weekly re-crawl diffs against what was confirmed. Exact name matching only, a 1% floor, three cards hard. 14 tests |
| **C5** the "% smarter" number | **Done** | Extraction F1 against a **frozen, fingerprinted, held-out** golden set. Micro-averaged; refuses to publish below 50 examples or across a set that changed. The first test asserts the number **can go down** — that is the property that makes it a measurement rather than a chart. 13 tests |
| **D1** responsive shell | **Done** | 44px targets, zero CLS measured on inbox/catalogue/guardrails under mobile slow-3G |
| **D2** upload capability | **Done** | The client/customer asymmetry lives in `src/uploads/limits.ts`, not in an `accept` attribute: voice notes from the owner, never from a stranger (D5) |
| **D3** install path | **Done** | PWA. The researched alternative — per-device build-from-source guides, ~35 min with Xcode for iOS — is unusable for a paywalled SaaS. Recorded in `docs/research/INSTALL_METHOD.md` |
| **E** ops | **Done** | 3-stage Dockerfile, non-root uid 1001, standalone output, `/api/health` that reports ok/degraded/unconfigured and no driver text or hostname |
| **Execution button** | **Done** | `[ ▶ Angebot erstellen & senden ]`. Closed a larger hole than expected: nothing in the product had ever written a `quote_versions` row, so `/q/[token]` could only render the demo tenant |
| **Security pass** | **Done** | `docs/SECURITY_PASS.md`. Three live HIGH findings fixed (H1 floor-price leak, H2 revocation impossible, H3 revoked links resolving) plus H4/H5 on `allocate_quote_number` |

### Still open out of the security pass

Everything tagged **[latent]** in `docs/SECURITY_PASS.md` — real defects that nothing calls
yet, or that need a second vulnerability to reach. The ones worth doing next, in order:

1. **H7** — the crawler has no SSRF guard. It is not wired to a live caller today, and it
   must not be until the host is resolved, non-public addresses are rejected, and the
   resolved address is pinned for the connection. Redirects are currently followed with the
   host check applied once, before the first hop.
2. **M1** — `request.arrayBuffer()` on the chunk route buffers before the size check. App
   Router has no default body cap and `output: 'standalone'` means no upstream one either.
3. **M2** — failed uploads leak their chunks; `failJob` should delete them.
4. **M3** — owner-only catalogue writes are enforced in the route but not in SQL.
5. **M5/M6/M7** — the `upload_chunks` tenancy gap, enrichment lease ownership, and the
   cascade that defeats the deliberate no-delete policy on `candidate_verdicts`.
