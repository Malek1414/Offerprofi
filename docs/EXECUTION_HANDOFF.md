# Execution handoff — 2026-08-11

> **You are picking this up cold. Read §1 and §2 before touching anything.**
>
> This document consolidates the research and design done on 10–11 Aug 2026 into one
> executable brief. It supersedes nothing: [CLAUDE.md](../CLAUDE.md) and
> [PRODUCT_SPEC.md](../PRODUCT_SPEC.md) remain authoritative, and where this document and
> those disagree, they win and this is a bug.
>
> **Companion documents**
> · [docs/MERGE_EVALUATION.md](MERGE_EVALUATION.md) — the two-repo comparison, with reproduction commands
> · [docs/superpowers/specs/2026-08-11-prospect-extraction-and-learning-loop-design.md](superpowers/specs/2026-08-11-prospect-extraction-and-learning-loop-design.md) — the design this executes
> · [docs/POTENTIAL_MARKETPLACE_FEATURE.md](POTENTIAL_MARKETPLACE_FEATURE.md) — tabled, do not build
> · [docs/PROGRESS.md](PROGRESS.md) · [docs/BUILD_STATUS.md](BUILD_STATUS.md) — feature-level state

---

## 1. Non-negotiables

**Do not weaken these. Do not "improve" them. If a task appears to require breaking one,
stop and ask the owner.**

1. **The six invariants in [CLAUDE.md](../CLAUDE.md) §2 are frozen.** Each has a test in
   `tests/invariants/`. No automated adverse decision; no personal data in pricing; nothing
   binding produced automatically; a human decision always in the path; human intervention
   on demand; transparency. Do not add to this layer — it is finished.
2. **Prices are deterministic and come only from the tenant's own catalogue** (D6, D8).
   The model maps intent to catalogue items. **The model never does arithmetic.** Target:
   guardrail violations reaching a customer = **0**.
3. **One model door.** `src/agent/client.ts` is the only file permitted to import
   `@anthropic-ai/sdk`. Enforced twice — a restricted-import group at
   `eslint.config.mjs:42`, and a tree-walking test at `tests/agent/boundary.test.ts`. Every
   new model call goes through it. No exceptions.
4. **Customer input is data, never instructions.** Messages, documents, images and crawled
   pages are untrusted. Guardrails run deterministically on generated output, *after*
   generation. Prompt instructions are a first line, not the control.
5. **Nothing enters the live catalogue unconfirmed.** Extraction produces candidates; the
   owner confirms, edits or rejects per object.
6. **Never use unofficial WhatsApp automation libraries** (CLAUDE.md §4). The compared repo
   uses OpenWA. Do not adopt it as infrastructure — see MERGE_EVALUATION.md §5.
7. **Do not re-litigate CLAUDE.md §3.** Those decisions came out of a structured interview
   with the owner.

---

## 2. Where the build actually stands

Verified 10–11 Aug 2026. **Re-run these before trusting any row.**

```bash
npm run verify      # typecheck + lint + 580 tests      → green
npm run test:db     # 15 migrations + 2 assertion suites → green (needs local Postgres)
npm run build       # production build                   → clean
npm run progress    # generates docs/progress.html       → 33% of 154 features
```

| Area | State |
|---|---|
| Phase 0 | 50% |
| Phase 1 | complete |
| Phase 2 | half built |
| Phase 4 | 80% |
| Migrations | `0001` … `0017` — new work starts at `0018` |
| RLS | 35 `create policy` statements; request-scoped identity at `src/db/client.ts:74` |
| Model calls | `src/agent/client.ts` exists (F0.11 shipped); **nothing walks through it end to end** |

**A new migration must be applied to the dev database by hand.** Tests build a scratch DB
and will pass while the browser fails:

```bash
psql -d angebot_dev -f db/migrations/00NN_….sql
```

`CHAT_SESSION_SECRET` and `DATABASE_URL` must both be set. `.env.local` holds dev values
and is gitignored. **Do not connect as the database owner** — `app_login` inherits
`app_user`, which is `NOLOGIN NOBYPASSRLS`, so development runs under the same RLS
constraint as production. Connecting as owner silently disables every policy while all
tests still pass.

### What runs today

| URL | What it does |
|---|---|
| `/signup` · `/login` | Real tenants. Login is indistinguishable on failure, timing-equalised, backed off |
| `/` | Router — sends an owner to onboarding or the inbox by state |
| `/onboarding` · `/onboarding/{catalogue,guardrails,brand,uploads}` | Catalogue and guardrails by hand |
| `/a/[slug]` | Hosted chat — AI disclosure, ack, DE/EN, Sie/Du |
| `/q/[token]` · `/r/[token]` | Web quote priced by the real engine; request links |
| `/inbox` · `/inbox/[id]` | Owner inbox |

---

## 3. Decisions taken 11 Aug 2026

Append these to CLAUDE.md §3 when convenient.

| # | Decision | Rationale |
|---|---|---|
| **D30** | **Single model — Sonnet (`claude-sonnet-5`) — for every call.** No tiering, no escalation, no downgrade | A confidence-triggered model switch is a **customer-influenceable control path**: input crafted to suppress confidence forces a model change, so the injection defence would have to hold identically across two prompt-framing paths. One model = one path = one surface. Spend is explicitly not a constraint |
| **D31** | **Two memory layers.** Cognee holds cross-tenant extraction know-how only — no price, no brand, no person. Per-tenant data never leaves Postgres RLS | Keeps RLS absolute; lets the sidecar fail without stopping the system |
| **D32** | **The learning signal is the owner's verdict, not the scrape** | §4 below |
| **D33** | **Astra is not used** | D29 already provides pgvector. A third store buys nothing today. Revisit only if pgvector demonstrably fails at scale |
| **D34** | **A prospect is not a tenant** until claimed | Otherwise dormant tenants exist that all 35 RLS policies must reason about |
| **D35** | **Marketplace tabled** | See POTENTIAL_MARKETPLACE_FEATURE.md |

---

## 4. The central design argument

**Do not implement "scrape → store → the agent is smarter." It does not work.**

A scraped page with no verdict attached is text, not knowledge. Storing more of it makes
retrieval noisier; noisier retrieval raises fabrication risk. The naive loop therefore puts
*no hallucinations* and *smarter every run* in direct opposition.

```
crawl prospect site ──▶ extract candidates ──▶ owner confirms / edits / rejects
                                                         │
                              ┌──────────────────────────┘
                              ▼
                     THE TRAINING SIGNAL
     "we read <h3> as the item name and the owner renamed it"
     "we read '18,50 p.P.' as per-unit; the owner corrected it to per-person"
                              │
                              ▼
                pattern observation → shared layer
          the next tenant's extraction is measurably better
```

Each confirm/edit/reject is a labelled example, produced free by the best-qualified
labeller alive for that data. That is the flywheel.

### The two layers, and the one rule

| | **Shared** (cross-tenant, Cognee) | **Per-tenant** (Postgres + pgvector, RLS) |
|---|---|---|
| Holds | how to *read* a source | what *this tenant* sells |
| Examples | German catering vocabulary; unit conventions (`p.P.`, `ab N Pers.`); document and page layout patterns; which selector held the menu | candidate catalogue items; brand facts; tone; Sie/Du |
| Contains | **no price, no brand, no person** | everything, tenant-scoped |
| On outage | degrade to baseline extraction | hard dependency |

> **The rule, enforced by test:** a price may never enter the shared layer, and a
> shared-layer read may never introduce a number into a customer-facing turn.

Two tests, written in the style of `tests/invariants/`:

| Test | Asserts |
|---|---|
| `shared-layer-purity` | No price, brand or person can be written to the shared layer |
| `shared-layer-no-numbers` | A shared-layer read cannot introduce a number into a customer-facing turn |

---

## 5. Phase A — Merge and close the loop *(prerequisite for everything)*

Base is this repo; port inward from `wotschofsky/offerprofi`. Full rationale and
reproduction commands in MERGE_EVALUATION.md §6.

```bash
gh repo clone wotschofsky/offerprofi /tmp/felix-offerprofi
```

### A1 — `confirm → handoff` · **do this first**

Nothing in the tree transitions an inquiry to `sent_to_owner`:

```bash
grep -rn "sent_to_owner" src/
```

returns only the state-machine definition (`src/domain/inquiry-state.ts:33,97-99`) and the
inbox label (`src/inbox/labels.ts:38`).

Reproduced by walkthrough on 10 Aug: the agent ends the qualifying loop with *"Passt das
so?"* and nothing consumes the answer. Both *"Ja, das passt genau so"* and a bare *"Ja"*
were absorbed into `Besonderes` as further extraction, and the summary was re-asked.

**Fix:** the ready-to-send branch at `src/chat/qualifying-turn.ts:166-174`. An affirmative
reply mints the `request_links` rows and transitions state.

**Until this lands, "vom Chat zum verschickten Angebot in unter 5 Minuten" is not
demonstrable end to end, and everything below is downstream of it.**

### A2 — Prompt-injection defence

Port `/tmp/felix-offerprofi/lib/ai/whatsapp.ts:55-330` into `src/agent/prompt.ts`, **behind
the existing `buildPrompt` signature** so no call site changes. Bring their tests across.
It is the better implementation: cryptographic nonce, entity decoding, escalation gates.
Ours is one regex.

### A3 — Spend metering

Port their `ai_extraction_budget` table and admission check — but put the check **inside
`callModel`** in `src/agent/client.ts`. Their four call sites cannot make it unbypassable;
our single boundary can. This is the clearest case of the merge being worth more than
either half.

Multi-scope hourly budgets, atomic upsert, and it must distinguish paid extractions from
rejected attempts.

### A4 — **DO NOT PORT**

MERGE_EVALUATION.md recommends porting Haiku-default-with-confidence-escalation. **That
recommendation is superseded by D30.** Skip it. Do not add model selection logic anywhere.

### A5 — PDF generation

Port from theirs. We have no generation path at all — we parse PDFs, we do not render them.

### Also worth taking while in there

Their **multimodal extraction** (PDF/image file parts straight to the model) is needed by
Phase B anyway. Their **crash-safety patterns** — leases, resumable delivery, serialised
acceptance, guards against concurrent approval and edit — port when a durable outbound
channel lands, not before.

---

## 6. Phase B — Prospect ingestion

**Input:** spreadsheets of catering and event businesses in Berlin / DACH that fit the ICP
and are **not customers yet**.
**Output:** structured `prospects` rows ready for Phase C.

```
drop file (mobile or desktop)
   → chunked upload, resumable, sha256 idempotency key
   → parse: xlsx · csv · pdf · docx · png|jpg
   → header detection → column-mapping confirmation
   → prospects + prospect_sources
```

### B0 — Object storage adapter *(first step of this phase)*

D29 puts object storage on us: S3-compatible, EU region. Build the adapter, then everything
else in Phase B sits on top of it.

Keep the existing discard-by-default behaviour for *knowledge* uploads —
`src/app/onboarding/uploads/page.tsx:29` promises the original file is read in-request and
discarded, leaving only filename and extracted text. That promise is a feature. Prospect
uploads are a new path with its own retention, not a change to that one.

### B1 — "Zero upload failures" is an architecture, not an aspiration

The requirement is no runtime errors, no upload errors, not one hiccup, or the product
loses user confidence. That is not achieved by careful coding. It is achieved by making
failure recoverable and visible:

- **Chunked, resumable upload.** A dropped mobile connection resumes; it does not restart.
- **sha256 idempotency key per file.** Re-uploading the same file is a no-op, not a duplicate.
- **A durable job row per file.** The unit of work survives a process restart.
- **A visible per-file state machine:** `queued → parsing → needs_mapping → imported | failed`.
  A failed file says why and offers retry. It never disappears silently.
- **Retry with backoff** on every transient class.

### B2 — Parsing and mapping

| Type | Path |
|---|---|
| `.xlsx` / `.csv` | deterministic parse → header detection → mapping UI |
| `.pdf` / `.docx` | text extraction, then the model reads table structure |
| `.png` / `.jpg` | multimodal — file part straight to the model (A5 capability) |

Column mapping is **detected, then confirmed** — never guessed silently. Owner-supplied
values are confidence 1.0 and always win (CLAUDE.md §7).

### B3 — A prospect is not a tenant (D34)

`prospects` lives in an **ops-scoped table outside the tenant RLS space**. A prospect
becomes a tenant only on claim.

**Schema must include a deletion path**: a prospect record and everything derived from it
must be removable on request. See §9 on the legal note.

---

## 7. Phase C — Enrichment and the learning loop

```
prospect ──▶ Tavily search ──▶ select URLs ──▶ crawl ──▶ cache
                    │                                      │  key: url_norm + content_hash
              budget ledger                                ▼
        (micro-cents, reuses            single model door: src/agent/client.ts
         src/agent/cost.ts)                                │
                                                           ▼
                              candidates (per-tenant, RLS, status = UNCONFIRMED)
                                                           │
                                            owner verdict ─┤
                                                           ▼
                              pattern observation → Cognee shared layer
```

### C1 — Orchestration lives in Postgres

A job queue in the existing database. **Not** in Astra, **not** in Cognee, **not** in n8n.

Crawl budget is enforced by a **spend ledger in integer micro-cents**, reusing the pattern
already proven in `src/agent/cost.ts`. Per-run and per-prospect caps are hard limits; a run
that hits its cap stops and records why. Tavily results cache on normalised URL plus
content hash, so re-crawling an unchanged page costs nothing.

### C2 — Candidates, not catalogue

Integration point is the existing `src/onboarding/candidates.ts`. Everything arrives
`UNCONFIRMED`.

### C3 — The confirmation UI, designed so the owner does not quit

The verdict *is* the training signal, so the loop dies if owners disengage.

> **Governing principle: owner attention is spent only where the model is uncertain.
> Everything else is a bulk gesture.**

```
┌─ 24 Leistungen · sicher ──────────────── ⌄ ┐   one tap, one row
│  Fingerfood · Buffet · Getränke · …        │   expandable, never hidden
│                      [ Alle 24 übernehmen ]│
└────────────────────────────────────────────┘

┌─ 5 brauchen dich ─────────────────── 1/5 ──┐   only these cost attention
│  "Menü ab 12 Pers. · 18,50"                │
│   ┌─ from menu.pdf, S.2 ─────────────┐     │   evidence inline —
│   │ …Fingerfood-Menü ab 12 Personen  │     │   verify by glance,
│   │   18,50 € p.P. …                 │     │   never go hunting
│   └──────────────────────────────────┘     │
│   pro Person · 18,50 €                     │
│   ✗ verwerfen   ✎ ändern   ✓ passt         │
└────────────────────────────────────────────┘
     mobile: swipe ← →      desktop: J/K, Y/N
```

Five load-bearing properties:

1. **Confidence-sorted.** Existing thresholds apply — ≥0.8 required-field / ≥0.75 overall
   for the confident group; <0.5 always individual, never guessed.
2. **Evidence inline.** The source snippet sits under the candidate.
3. **Partial state is valid.** Leave at item 3 of 29, return tomorrow, nothing lost.
4. **Time-boxed and stated up front** — "≈3 Minuten". Must be doable unaided on a phone.
5. **The learning bar moves as they confirm.**

### C4 — Drift cards keep the flywheel turning past week one

Brand identity is not static: prices move with inflation and with the owner's own creative
decisions. A scheduled re-crawl diffs against the confirmed catalogue and produces:

> *"Deine Website hat sich geändert — 3 Preise weichen ab."*

Three items, thirty seconds. Not a re-onboarding. This is what keeps producing training
signal long after signup.

### C5 — The "% smarter" bar

Build it, but honestly, because a judge will take apart anything else.

- **Metric:** extraction F1 against a **frozen held-out golden set**.
- **Trigger:** recomputed when confirmed-candidate count crosses a threshold — fired by the
  n8n webhook on candidate-confirmed.
- **The property that makes it credible: the number can go down.**

A counter of scraped pages dressed up as intelligence is theatre. This is a measurement.

---

## 8. Phase D — Mobile and desktop app

Same codebase serves both. **Responsive, not two apps.** Next.js 16 + React 19, CSS
modules (`src/app/**/*.module.css`) — there is no CSS framework and none should be added.

### D1 — What "hyper-responsive, no lag, Claude-inspired" has to mean concretely

Vague aesthetic goals do not survive contact with a build. These are the testable ones:

| Property | Requirement |
|---|---|
| Streaming | Model output streams token-by-token. Never a spinner while a full response is awaited |
| Optimistic UI | User actions render instantly; the network confirms after |
| Loading state | Skeletons that match final layout. **No layout shift on load** |
| Input latency | Typing never blocks. No synchronous work in the keystroke path |
| Scroll | 60fps on a mid-range Android. Virtualise any list that can exceed ~100 rows |
| Touch targets | ≥44px. Thumb-reachable primary actions on mobile |
| Offline | Uploads queue and resume rather than erroring (Phase B) |

### D2 — Upload capability, and the asymmetry between the two sides

**Client side (the caterer — this is who we are trying to impress):** parity with what
Claude's own apps accept — `pdf`, `docx`, `xlsx`, `csv`, `txt`, `md`, `png`, `jpg`, `heic`,
`webp` — plus **voice recording**.

**Customer side (the end customer):** **documents and screenshots only.** No voice, no
richer capture. Voice on the customer side is error-prone and adds nothing; this was an
explicit owner correction.

Client-side voice ships as **capture, store and flag — no transcription**, which is what
D5 already specifies. Transcription is a later increment.

### D3 — Install path

Distribution follows the method Mann Bellani / publikhq.com uses to let non-technical
followers install open-source apps from his site. **Step one of this task is to read
publikhq.com and the repo descriptions and write the method down** — then build to what
you find. The expected shape is an installable PWA (`manifest.webmanifest`, service worker,
platform-specific install prompts, iOS "Zum Home-Bildschirm" instructions); confirm against
the source rather than building from that assumption.

The PWA layer is greenfield — no `public/` directory, no manifest, no service worker:

```bash
find src public -iname "*manifest*" -o -iname "*service-worker*"   # → nothing
```

### D4 — Graphify

Read the Graphify repo (in the owner's GitHub stars) as a reference for the brand knowledge
graph before designing the per-tenant graph schema. If it turns out not to fit, note why in
one line and move on — the schema does not depend on it.

---

## 9. Phase E — Ops

- **Sliplane:** Next.js container + Cognee sidecar. Postgres EU region (D15).
- **n8n:** webhook on candidate-confirmed → recompute the C5 metric. Keep n8n *out* of the
  critical path — it observes, it does not orchestrate.
- **Security pass:** run it **after A2**, so the injection defence is in scope.

### Legal note, recorded so it is not mistaken for an oversight

The owner has determined that crawling prospects' **public** websites and social profiles
for menus and service information is acceptable, and this plan builds to that decision.

One factual point stands regardless: a sole trader's public business page is still personal
data under GDPR, because the natural person *is* the business. This does not change whether
the processing is permissible under Art. 6(1)(f). It means the enrichment store needs a
**deletion path** — hence the requirement in B3.

---

## 10. Do not build

| | |
|---|---|
| **Marketplace / vendor directory** | Tabled — D35, POTENTIAL_MARKETPLACE_FEATURE.md |
| **Model tiering** | Superseded by D30 |
| **Astra integration** | Superseded by D33 |
| **OpenWA / unofficial WhatsApp** | CLAUDE.md §4 standing rule; MERGE_EVALUATION.md §5 |
| **More invariant-layer work** | The §2 layer is finished |

---

## 11. Choices with defaults — take the default and keep moving

Each of these has a working default. Use it, note it in the commit, and carry on. None of
them is worth stopping for.

| Choice | Default to build |
|---|---|
| **Golden-set composition** (C5) | 50 prospects, stratified across Berlin catering / event services / décor rental, frozen at first import and never added to. Freeze it before publishing an F1 number |
| **Re-crawl cadence** (C4) | Weekly. Make it a per-tenant setting so it can be tuned on evidence later |
| **Cognee pattern-observation schema** (§4) | `{ source_kind, locator, read_as, corrected_to, confidence_before, language }`. Extend as extraction reveals what it needs |
| **Client voice** (D2) | Capture, store, flag. No transcription — that is what D5 already says |
| **Install method** (D3) | Installable PWA, after reading publikhq.com to confirm the shape |
| **Graphify** (D4) | Read it; if it does not fit, one line saying so and move on |

---

## 12. Verification gates

Nothing is "done" until these pass. Evidence before assertions.

```bash
npm run verify        # typecheck + lint + tests
npm run test:db       # migrations + assertion suites (needs local Postgres)
npm run build         # production build
npm run test:invariants
npm run progress      # regenerate docs/progress.html
```

Plus, per phase:

| Phase | Gate |
|---|---|
| A1 | A chat conversation reaches `sent_to_owner` and appears in `/inbox` — **in a browser, against real rows**, not only in tests |
| A2 | Their injection tests pass here |
| A3 | A model call cannot bypass the budget check — assert at the boundary |
| B | A file upload survives a killed process and resumes |
| C | `shared-layer-purity` and `shared-layer-no-numbers` both fail loudly when violated |
| D | Lighthouse PWA install criteria met; 60fps scroll on a throttled mid-range profile |

**Apply every new migration to `angebot_dev` by hand.** Tests pass on a scratch database
while the browser fails, and that gap has cost this project time before.
