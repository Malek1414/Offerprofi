# EVAL.md — how to tear this product down

A standing rubric for evaluating what has been built, so that a later session (or a
reviewer, or the SummerUP panel) can judge the app on evidence rather than on the
confidence of its own documentation.

**Rule for using this file: a claim is not a result.** Every row below has a
verification column. If nobody has run it, the row is "unverified" — not "probably
fine". `docs/BUILD_STATUS.md` is the honest state of the code; this file is the method
for checking whether that honesty holds.

---

## 0. The three questions that actually matter

Everything else in this document is subordinate to these. Answer them first.

| # | Question | How you would know | Status |
|---|---|---|---|
| Q1 | **Does anyone want this?** | Signups from real DACH event agencies who were not asked as a favour | **Unanswered — no signup surface exists** |
| Q2 | **Does the quote survive contact with a real catalogue?** | Three real agencies' past quotes reproduce to the cent through the engine | Unanswered — no real catalogue has been loaded |
| Q3 | **Does a stranger finish the chat?** | Chat link → completed inquiry ≥ 40% (CLAUDE.md §8, flagged as *the* unvalidated metric) | Unanswered — needs a design partner |

A perfect score on every section below with Q1 unanswered is a well-built product
nobody asked for. Sections 1–5 are how you avoid shipping something broken; section 0
is how you avoid shipping something pointless.

---

## 1. Invariant evals — the ones that must never regress

These are not quality metrics; they are the product's legal position (CLAUDE.md §2).
A failure here is a stop-the-line event, not a bug ticket.

| ID | Claim | Verification | Current |
|---|---|---|---|
| I1 | No code path refuses a customer | `npx vitest run tests/invariants/i1-no-automated-refusal.test.ts`, the exhaustive sweep in `tests/chat/abuse.test.ts`, **and `npm run test:db`** which proves the database also rejects a decline with no human | ✅ automated, both layers |
| I2 | No personal data reaches pricing | `tests/invariants/i2-no-pii-in-pricing.test.ts` | ✅ automated |
| I3 | Nothing binding is produced automatically | `tests/invariants/i3-nothing-binding-automatic.test.ts` | ✅ automated |
| I4 | A human is always in the path | `tests/invariants/i4-human-in-path.test.ts` | ✅ automated |
| I5 | Human intervention on demand, advertised | `tests/invariants/i5-intervention-available.test.ts` | ✅ automated |
| I6 | Transparency / AI disclosure | `tests/invariants/i6-transparency.test.ts` | ✅ automated |

**Adversarial eval still owed.** The tests above prove the *code* has no refusal path.
They do not prove the *system* has none. Owed: a red-team pass where a reviewer tries
to construct any input — spam, abuse, a hit quota, an out-of-region date, a €50 budget
for a €5,000 event — that leaves a customer with no answer and no human. Write results
here. Zero automated refusals is a target in CLAUDE.md §8 with the value **0**.

---

## 2. Engine evals — determinism and money

The engine is the defensible part of the product (CLAUDE.md §7). It is evaluated more
harshly than anything else because a wrong number in a quote is not a UX problem.

| Check | Method | Pass condition | Current |
|---|---|---|---|
| Golden set reproduces | `tests/engine/pricing.test.ts` | To the cent | ✅ 13 tests |
| Determinism | Same input → identical output, including tie-breaks | Byte-identical `PricingResult` | ✅ covered |
| Guardrails | `tests/engine/guardrails.test.ts` | Two outcomes only, never a refusal | ✅ 17 tests |
| Audit trail | Every figure reconstructable from the stored trace | A human can explain any line in plain German | ✅ trace exists, ⚠️ never read aloud to a real customer |
| **Real-catalogue eval** | Load 3 real agencies' quotes, re-price, diff against what they actually sent | ≥95% of lines within €0 | ❌ **not run — this is Q2** |

**Known engine limitation**, carried from BUILD_STATUS: `reduceScopeToBudget` removes
whole lines only. A budget falling between two line combinations lands lower than it
needs to. Evaluate whether real budgets hit this before adding tier-walking.

---

## 3. Channel and envelope evals

The architectural bet is X1: a new channel is one adapter and nothing downstream
changes (CLAUDE.md §4). It is cheap to claim and expensive to be wrong about.

| Check | Method | Pass condition | Current |
|---|---|---|---|
| Adapter purity | `tests/channels/adapters.test.ts` | Same payload + context → identical envelope | ✅ |
| Tenant cannot come from a payload | Hostile-payload test | Context wins, always | ✅ |
| Replay safety | `tests/channels/envelope.test.ts` | Duplicate key → no second inquiry | ✅ in logic, ❌ **not at the database** |
| **X1 proof** | Write the `paste_in` adapter and count downstream changed lines | **Zero** downstream changes | ⏳ registry test simulates it; the real proof is Phase 7/12 |

The X1 claim is currently supported by a test that registers a stub second channel.
That is evidence, not proof. The honest proof arrives with the WhatsApp adapter.

---

## 4. Conversion and copy evals — the customer-facing surfaces

These decide whether the product earns money. They are Tier 1 in the design brief
(FEATURE_INVENTORY §15) and the least automatable to evaluate.

| Surface | Check | Pass condition | Current |
|---|---|---|---|
| S4 chat | Ack latency | < 10s p95, decoupled from extraction | ✅ ordering enforced by type; ⚠️ never measured under load |
| S4 chat | Sie/Du mirroring | Correct on 20 real German inquiry openings | ✅ 16 unit tests; ❌ **not run against real messages** |
| S4 chat | Renders on a real phone | Legible one-handed, composer reachable | ❌ **never opened on a device** |
| S26 quote | "Looks as good as my Instagram" (Lisa's stated bar) | A real wedding planner says yes | ❌ not asked |
| Both | Zero third-party origins | DevTools network tab shows no external host | ✅ CSP-enforced |
| Both | German string lengths | No clipping at ~30% longer than English | ⚠️ eyeballed at 980px only |

**Copy eval owed.** Every customer-facing German string should be read by a native
speaker who is not the author. The acknowledgement and the disclosure especially: they
are the first impression and they carry the Art. 50 obligation. A stilted "Sie" or a
presumptuous "du" is a conversion cost that no test will catch.

---

## 5. Code-spec teardown — is the code what the spec says it is?

Run this when auditing the codebase against `PRODUCT_SPEC.md` and
`docs/FEATURE_INVENTORY.md`. The failure mode it catches is drift: code that works but
no longer implements the decision it was written for.

For each feature ID claimed "Done" in `BUILD_STATUS.md`, ask:

1. **Does the acceptance criterion in FEATURE_INVENTORY actually pass?** Not "is the
   feature there" — does the *stated criterion* pass, as written, verifiably?
2. **Is the criterion tested, or asserted?** A criterion with no test is a claim.
3. **Does the implementation match the locked decision (CLAUDE.md §3), or a
   convenient reading of it?**
4. **If someone deleted the comment explaining why, would the next person restore the
   same behaviour or "fix" it?** If they would fix it, the guarantee is fragile and
   belongs in a type or a test, not a comment.

Question 4 is the important one. This codebase deliberately encodes guarantees
structurally — `RateLimitDecision` has no `reject` variant; `EventBrief` has no
contact field; `TriageResult` has two outcomes. Every place where a guarantee lives
only in prose is a place it will eventually be lost.

### Standing drift watchlist

| Guarantee | Lives in | Fragile? |
|---|---|---|
| No refusal from rate limiting | The `RateLimitDecision` union | Strong — unrepresentable |
| No refusal from triage | The `Handling` union | Strong — unrepresentable |
| No PII in pricing | `EventBrief` / `PricingInput` types | Strong |
| Ack before extraction | `AckPlan.steps` order + test | Medium — an ordering, not a type |
| Disclosure before first reply | `composeAgentTurns` + test | Medium |
| Sie detection is case-sensitive | A comment and 8 tests | **Weak — a "case-insensitive is more robust" refactor would pass review** |
| Scan gate is a positive check | `mayParse` + test | Medium |

---

## 6. What "done" means for a phase

A phase is done when its exit criterion in FEATURE_INVENTORY passes **as written**, not
when its features exist.

| Phase | Exit criterion | Honest status |
|---|---|---|
| 0 | Schema, RLS, tenancy tests | ⚠️ written, never executed against a live project |
| 1 | A stranger reaches the link and is acknowledged in under 10s | ⚠️ acknowledged yes; **not persisted**, so the stranger's thread does not survive |
| 2 | Owner reaches a confirmed 5-item catalogue in under 15 min, unaided | ❌ not started |
| 4 | Engine + guardrails + six invariant tests | ✅ met |

Phase 1's exit is the interesting one: by a narrow reading it passes, and by the
reading that matters — a real customer coming back to their thread — it does not. Prefer
the second reading. That is the whole point of this file.

---

## 7. How to record an eval run

Append here. Date, who, what was run, what was found. Do not edit the tables above to
say "passed" without a corresponding entry.

| Date | Who | What was evaluated | Result |
|---|---|---|---|
| 2026-08-09 | Claude (build session) | **First execution of the migrations against real Postgres** (18, local). All three applied clean. 8 assertions: tenant isolation both directions, unauthenticated fails closed, no system-decline state, decline blocked without a human, decline permitted with one, unconfirmed catalogue item rejected, audit rows written, gapless per-tenant numbering | **All passed.** Found and removed an unused `create extension "vector"` that made every deploy fail on a Postgres without pgvector, for a feature that does not exist yet |
| 2026-08-09 | Claude (build session) | Phase 1 end-to-end against dev server: disclosure ordering, session resume, DE/EN mirroring, Sie/Du mirroring, bot triage still acknowledged | Passed. Found and fixed a real dark-mode contrast bug (brand variables not resolved from the `-l`/`-d` pairs). Did **not** verify on a physical device |
