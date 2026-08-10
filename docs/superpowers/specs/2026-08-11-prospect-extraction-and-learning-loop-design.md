# Design — Prospect extraction, enrichment, and the learning loop

**Date:** 2026-08-11
**Owner:** Malek Hassan
**Status:** design agreed in session, not yet implemented
**Read with:** [CLAUDE.md](../../../CLAUDE.md) §2 (invariants), §3 (locked decisions),
[docs/MERGE_EVALUATION.md](../../MERGE_EVALUATION.md) (merge direction and build order)

---

## 0. What this is

Four specs, in dependency order, that take the product from "a chat that qualifies an
inquiry" to "a system that builds a caterer's catalogue for them before they sign up, and
gets measurably better at it every time an owner corrects it."

| Spec | Name | Depends on | Status |
|---|---|---|---|
| **A** | Merge and close the loop | — | prerequisite for everything |
| **B** | Prospect ingestion | A | |
| **C** | Enrichment and the learning loop | B | the flywheel |
| **E** | Ops — Sliplane, PWA, security | A | last, small |
| ~~D~~ | ~~Marketplace~~ | — | **tabled** → [POTENTIAL_MARKETPLACE_FEATURE.md](../../POTENTIAL_MARKETPLACE_FEATURE.md) |

---

## 1. The central design decision

The naive loop is *scrape → store → the agent is smarter*. It does not work, and the
reason matters enough to state once, permanently:

**A scraped page with no verdict attached is text, not knowledge.** Storing more of it
makes retrieval noisier. Noisier retrieval raises fabrication risk. So the naive loop
makes the two stated requirements — *no hallucinations* and *smarter every run* — pull
against each other.

**The learning signal is the owner's correction, not the scrape.**

```
crawl prospect site ──▶ extract candidates ──▶ owner confirms / edits / rejects
                                                         │
                              ┌──────────────────────────┘
                              ▼
                     the training signal
     "we read <h3> as the item name and the owner renamed it"
     "we read '18,50 p.P.' as per-unit; the owner corrected it to per-person"
                              │
                              ▼
                pattern observation → shared layer
          the next tenant's extraction is measurably better
```

Every confirm/edit/reject is a labelled example, produced for free, by the person best
qualified in the world to label it. That is a real flywheel. Raw scraping is not.

### 1.1 Two memory layers, one rule

| | **Shared layer** (cross-tenant) | **Per-tenant layer** (RLS) |
|---|---|---|
| Holds | how to *read* a source | what *this tenant* sells |
| Examples | German catering vocabulary; unit conventions (`p.P.`, `ab N Pers.`); document and page layout patterns; which selector held the menu | candidate catalogue items; brand facts; tone, Sie/Du |
| Store | Cognee sidecar | Postgres + pgvector, under the existing 35 RLS policies |
| Contains | **no price, no brand, no person** | everything, tenant-scoped |
| On outage | extraction degrades to baseline | hard dependency |

**The rule, enforced by test:** a price may never enter the shared layer, and a
shared-layer read may never introduce a number into a customer-facing turn.

That single rule is what makes "smarter every run" true globally while leaving D6 and D8
untouched and the guardrail-violation target at 0.

### 1.2 Why Cognee holds only the shared layer

Tenant data never leaves Postgres, so RLS stays absolute and the `F1` finding in
`MERGE_EVALUATION.md` is not re-introduced through a side door. Because the shared layer
contains no price, brand, or person by construction, a Cognee breach or outage costs
nothing — which is also how the *no gaps in memory* requirement is actually met: the
sidecar is allowed to fail, and the system degrades instead of stopping.

**Astra is not used.** `D29` already provides pgvector. A third store buys nothing today.
Revisit only if pgvector demonstrably fails at scale.

---

## 2. Spec A — Merge and close the loop

Base is `Malek1414/Offerprofi`; port inward from `wotschofsky/offerprofi`. Rationale in
`MERGE_EVALUATION.md` §6 — RLS, the enforced model boundary and never-throw failure
semantics are the three properties that cannot be retrofitted cheaply, and all three
already exist here.

| # | Item | Location | Note |
|---|---|---|---|
| A1 | **confirm → handoff** | `src/chat/qualifying-turn.ts:166-174` | The blocking gap |
| A2 | Prompt-injection defence | → `src/agent/prompt.ts` | Behind the existing `buildPrompt` signature; no call site changes. Bring their tests |
| A3 | Spend metering | inside `callModel`, `src/agent/client.ts` | Admission check at the single boundary makes it unbypassable |
| A5 | PDF generation | new | No generation path exists today |

### A1 is the one that matters

No code path in the tree transitions an inquiry to `sent_to_owner`:

```bash
grep -rn "sent_to_owner" src/
```

returns only the state-machine definition (`src/domain/inquiry-state.ts:33,97-99`) and the
inbox label (`src/inbox/labels.ts:38`). Walkthrough on 10 Aug 2026 confirmed the failure:
the agent ends the qualifying loop with *"Passt das so?"* and nothing consumes the answer —
both *"Ja, das passt genau so"* and a bare *"Ja"* were absorbed into `Besonderes` as further
extraction, and the summary was re-asked.

Until A1 lands, *"vom Chat zum verschickten Angebot in unter 5 Minuten"* is not
demonstrable end to end. Everything else in this document is downstream of it.

### A4 — model tiering — is deliberately NOT ported

`MERGE_EVALUATION.md` recommends porting Haiku-default-with-confidence-escalation. **This
design rejects that**, on a security argument raised by the owner and accepted:

> A confidence-triggered model switch is a **customer-influenceable control path**. Input
> crafted to suppress extraction confidence forces a model change, which means the
> injection defence in A2 has to hold identically across two different prompt-framing
> paths. One model is one path is one surface to defend.

**Decision (D30): a single model — Sonnet (`claude-sonnet-5`) — for every call. No tiering,
no escalation, no downgrade.** Spend is explicitly not a constraint on this decision.

The metering in A3 is still ported, and still valuable: it caps runaway spend and gives
per-purpose cost attribution. It simply never selects a model.

---

## 3. Spec B — Prospect ingestion

**Input:** spreadsheets of catering and event businesses in Berlin / DACH that fit the ICP
and are **not customers yet**.
**Output:** structured `prospects` rows, ready for enrichment in Spec C.

```
drop file (mobile or desktop)
   → chunked upload, resumable, sha256 idempotency key
   → parse: xlsx · csv · pdf · docx · png|jpg
   → header detection → column-mapping confirmation
   → prospects + prospect_sources
```

### 3.1 A prospect is not a tenant

Prospect rows live in an **ops-scoped table outside the tenant RLS space**. They become a
tenant only when someone claims them. The alternative — minting dormant tenants at import
— invents rows that all 35 RLS policies then have to reason about, for businesses that
have never heard of the product.

### 3.2 "Zero upload failures" is an architecture, not an aspiration

The stated requirement is no runtime errors, no upload errors, not one hiccup. That is not
achieved by careful coding. It is achieved by making failure *recoverable and visible*:

- **Chunked, resumable upload.** A dropped mobile connection resumes; it does not restart.
- **sha256 idempotency key per file.** Re-uploading the same file is a no-op, not a duplicate.
- **A durable job row per file.** The unit of work survives a process restart.
- **A visible per-file state machine.** `queued → parsing → needs_mapping → imported | failed`.
  A failed file says why and offers retry. It never disappears silently.
- **Retry with backoff** on every transient class.

"It works every time" means "it recovers every time, and tells you."

### 3.3 File-type handling

| Type | Path |
|---|---|
| `.xlsx` / `.csv` | deterministic parse → header detection → mapping UI |
| `.pdf` / `.docx` | text extraction, then the model reads the table structure |
| `.png` / `.jpg` | multimodal — file part straight to the model (ported capability) |

Column mapping is **detected, then confirmed** — never guessed silently. Per CLAUDE.md §7,
owner-supplied values are confidence 1.0 and always win.

---

## 4. Spec C — Enrichment and the learning loop

```
prospect ──▶ Tavily search ──▶ select URLs ──▶ crawl ──▶ cache
                    │                                      │  key: url_norm + content_hash
              budget ledger                                ▼
        (micro-cents, reuses the         single model door: src/agent/client.ts
         src/agent/cost.ts pattern)                        │
                                                           ▼
                              candidates (per-tenant, RLS, status = UNCONFIRMED)
                                                           │
                                            owner verdict ─┤
                                                           ▼
                              pattern observation → Cognee shared layer
```

### 4.1 Orchestration lives in Postgres

A job queue in the existing database — not in Astra, not in Cognee, not in n8n. Crawl
budget is enforced by a **spend ledger in integer micro-cents**, reusing the pattern
already proven in `src/agent/cost.ts`. Per-run and per-prospect caps are hard limits, and
a run that hits its cap stops and records why.

Tavily results are cached on normalised URL plus content hash, so a re-crawl of an
unchanged page costs nothing.

### 4.2 Nothing enters the live catalogue unconfirmed

Extraction produces **candidates**, per CLAUDE.md §7 and D4. The existing
`src/onboarding/candidates.ts` is the integration point. The owner confirms, edits or
rejects per object.

### 4.3 The confirmation UI — designed so the owner doesn't quit

The verdict is the training signal, so the loop dies if owners disengage. Governing
principle:

> **Owner attention is spent only where the model is uncertain. Everything else is a bulk
> gesture.**

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

Five properties, each load-bearing:

1. **Confidence-sorted.** The easy majority collapses into one gesture. Existing
   thresholds apply — ≥0.8 required-field / ≥0.75 overall for the confident group, <0.5
   always individual.
2. **Evidence inline.** The source snippet sits under the candidate. Verifying is a
   glance, not a hunt through a PDF.
3. **Partial state is valid.** Leave at item 3 of 29, come back tomorrow, nothing is lost.
4. **Time-boxed and stated.** "≈3 Minuten" up front. Setup must be doable unaided on a
   phone (CLAUDE.md §7).
5. **The learning bar moves as they confirm.** The work visibly pays them back.

### 4.4 Drift cards keep the flywheel turning after week one

Brand identity is not static — prices move with inflation and with the owner's own
creative decisions. A scheduled re-crawl diffs against the confirmed catalogue and
produces a **drift card**:

> *"Deine Website hat sich geändert — 3 Preise weichen ab."*

Three items, thirty seconds. Not a re-onboarding. This is what converts a one-time
onboarding chore into a recurring, low-cost, high-value touch, and it keeps producing
training signal long after signup.

### 4.5 The "% smarter" bar

Built, but honest, because a judge will take apart anything else.

- **Metric:** extraction F1 against a **frozen held-out golden set**.
- **Trigger:** recomputed when confirmed-candidate count crosses a threshold — fired by
  the n8n webhook on candidate-confirmed.
- **Property that makes it credible:** the number **can go down**.

A counter of scraped pages dressed up as intelligence is theatre. This is a measurement.

### 4.6 Two executable guards

Written in the style of the §2 invariant tests, so they fail loudly on regression:

| Test | Asserts |
|---|---|
| `shared-layer-purity` | No price, brand, or person can be written to the shared layer |
| `shared-layer-no-numbers` | A shared-layer read cannot introduce a number into a customer-facing turn |

### 4.7 Legal posture — owner decision, recorded

The owner has determined that crawling prospects' **public** websites and social profiles
for menus and service information is acceptable, on the basis that the material is
publicly published. This design builds to that decision.

One factual note recorded so it is not mistaken for an oversight: a sole trader's public
business page is still personal data under GDPR, because the natural person *is* the
business. This does not change whether the processing is permissible under Art. 6(1)(f).
It means the enrichment store needs a **deletion path** — a prospect record and everything
derived from it must be removable on request. That is a checkbox in Spec B's schema, not
an open question.

---

## 5. Spec E — Ops

- **Sliplane:** Next.js container + Cognee sidecar. Postgres EU region (D15).
- **PWA install:** manifest and install flow, matching the distribution method the owner
  specified.
- **Security pass:** after A2 lands, so the injection defence is in scope for it.

Small, last, and explicitly not a gap per the owner.

---

## 6. Decisions taken in this session

| # | Decision |
|---|---|
| **D30** | **Single model — Sonnet — for every call.** No tiering, no escalation, no downgrade. A confidence-triggered switch is a customer-influenceable control path and doubles the injection-defence surface. Spend is not a constraint on this decision |
| **D31** | **Two memory layers.** Cross-tenant Cognee holds extraction know-how only — no price, no brand, no person. Per-tenant data never leaves Postgres RLS |
| **D32** | **The learning signal is the owner's verdict, not the scrape.** Confirm/edit/reject emits the pattern observation |
| **D33** | **Astra is not used.** pgvector (D29) covers the requirement; a third store buys nothing today |
| **D34** | **A prospect is not a tenant.** Ops-scoped until claimed |
| **D35** | **Marketplace tabled** → `docs/POTENTIAL_MARKETPLACE_FEATURE.md` |

---

## 7. Open questions

1. **`[Pasted text #1]`** — the customer-side flow description never arrived in session.
   Needed before Spec D is untabled; irrelevant until then.
2. **Golden-set composition.** How many prospects, chosen how, frozen when? Must be fixed
   before the first F1 number is published, or the metric means nothing.
3. **Cognee schema for pattern observations.** The shape of a "pattern observation" is
   specified by intent here, not by field. Needs pinning during Spec C planning.
4. **Re-crawl cadence** for drift cards. Weekly is the guess; no evidence behind it yet.
