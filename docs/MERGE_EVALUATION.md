# Merge evaluation — `Malek1414/Offerprofi` × `wotschofsky/offerprofi`

> **Status:** findings recorded 10 Aug 2026. Nothing here has been merged yet.
> **Purpose:** let another agent verify these findings independently and execute the merge
> without this session's context.
> **Read with:** [CLAUDE.md](../CLAUDE.md) §2 (invariants), §3 (locked decisions), §4 (channels).

Two independent backends for the same brief were built in parallel on 9–10 Aug 2026, in
near-identical volume (~17.5k LOC each). The question this document answers is **not**
"whose repo is better" — it is **which subsystem from which repo survives the merge**.

The two codebases turn out to be close to complementary. One has the better foundations,
the other the better implementation of the parts that touch the model and the customer.

---

## 1. How to verify every claim below

The comparison target is a private repo; reading it requires collaborator access.

```bash
gh repo clone wotschofsky/offerprofi /tmp/felix-offerprofi
```

Findings are pinned to:

| Repo | HEAD at time of writing | Commits |
|---|---|---|
| `Malek1414/Offerprofi` ("ours") | `e1a96fc` | 31 |
| `wotschofsky/offerprofi` ("theirs") | `dd90b6d` | 78 |

**Both repos were moving hourly when this was written. Re-run the commands before trusting
any row.** Every finding carries a command that reproduces it. If a command's output no
longer matches the recorded result, the finding is stale, not the repo wrong.

---

## 2. Verified findings

### F1 — Tenant isolation: ours enforces it in Postgres, theirs has none

```bash
grep -rin "create policy\|enable row level security" db/migrations/ | wc -l   # ours
grep -rin "create policy\|enable row level security" /tmp/felix-offerprofi/drizzle | wc -l
```

**Ours: 35 `create policy` statements across 47 RLS statements**, with request-scoped identity
set per transaction (`src/db/client.ts:74`, `set_config('app.current_user_id', …)`).
**Theirs: 0.** Tenancy is enforced entirely by application-level Drizzle predicates.

One forgotten `where` clause in one query is a cross-tenant leak on their side, and nothing
underneath catches it. This is the single most expensive property to retrofit in either
direction, and it decides the merge base.

### F2 — Model boundary: ours is single and enforced, theirs is a convention

```bash
grep -rn "@anthropic-ai/sdk" src/ | sed 's|:.*||' | sort -u        # ours
grep -rn "createAnthropic" /tmp/felix-offerprofi/lib               # theirs
```

**Ours: 1 import site** — `src/agent/client.ts` — enforced two ways: a restricted-import
group at `eslint.config.mjs:42`, and a tree-walking test in `tests/agent/boundary.test.ts`.
**Theirs: 4 call sites** — `lib/ai/{extraction,correction,whatsapp,chat-reply}.ts`.

Consequence, and the reason this matters more than style: cost attribution, untrusted-input
framing and the `agent_runs` audit row are *structurally unbypassable* on our side and
*remembered by the author* on theirs.

### F3 — Failure semantics: ours cannot surface a model failure as a refusal

`src/agent/client.ts` — `callModel` returns `{ ok: true }` or a failure carrying
`escalate: true`. There is no third case and no throw. A provider timeout cannot reach a
customer as "this agency rejected me", which is Invariant 1 expressed in the type system.

Theirs throws: `lib/ai/chat-reply.ts:60` raises when the model omits a required phrase.

### F4 — Prompt-injection defence: theirs is materially stronger

`/tmp/felix-offerprofi/lib/ai/whatsapp.ts:55-330`. Three layers:

1. **Per-request nonce** on every structural marker (`systemPrompt`, `:62`) — the frame is
   `<katalog-a3f9e1>`, so a forged tag is *inert* rather than merely undetected.
2. **Three-pass HTML-entity decoder** (`:117` `MARKER`, `decodePass`) that follows nested
   spellings forward — `&amp;#60;`, `&#38;#x3c;`, `&lt&nbsp/system>`.
3. **Marker-count gate** (`screenRequest`, `:309`) — count markers in the finished prompt,
   compare against the number the renderer emitted. A whitelist over its own writes rather
   than a blacklist of encodings, so it does not need to enumerate attacks.

The gates run **before** the model is invoked, deliberately: a provider error after the fact
would skip the handoff and leave the inquiry on automation.

Ours (`src/agent/prompt.ts:65`) escapes `<` → `&lt;` and labels the block. The reasoning in
that file is sound — the prompt is the first line and not the control, guardrails run
deterministically after generation — but it is one regex against an attacker with unlimited
attempts.

### F5 — Spend: theirs caps it, ours only records it

`/tmp/felix-offerprofi/lib/db/domain-schema.ts:312` — `ai_extraction_budget`, hourly meters
per `tenant` / `user` / `platform`, capacity taken by atomic conditional upsert ("a SELECT
count is stale the moment it returns"). Separate `attempt:*` meters charge preprocessing work
even when a request is ultimately rejected for free.

Ours has the better *accounting* and no cap: `src/agent/cost.ts` computes exact integer
micro-cents over a rate table, attributed per purpose into `agent_runs`, and gates on
zero-retention eligibility (D17). It answers "what did this inquiry cost" precisely; it
cannot stop a bill.

### F6 — Model tiering: theirs is cost-aware, ours is not

`/tmp/felix-offerprofi/lib/ai/extraction.ts:11-12` — Haiku 4.5 by default, escalating to
Sonnet 5 only when mean item confidence < 0.6 (`needsFallback`, `:87`, applied `:137`).

Ours runs `claude-opus-5` on every call (`src/agent/client.ts:59`). Measured in `agent_runs`
on 10 Aug: extraction 6.0–7.9s, qualifying 4.6–9.9s per turn. This is the direct lever on
both the latency target (< 5 min p50 is safe; the per-turn feel is not) and CLAUDE.md §9
open question 3 (real variable cost per inquiry).

### F7 — Retrieval: only ours has any

```bash
ls src/knowledge/
grep -rl "embedding\|tsvector\|retriev" /tmp/felix-offerprofi/lib
```

Ours: 541 LOC — document chunking (`chunk.ts`), model-generated contextual prefixes
(`context.ts`), hybrid German full-text + trigram search (`repository.ts`).
**Theirs: no equivalent exists.** The grep hits on their side are unrelated substrings.

This is the clearest "AI intelligence" gap in the comparison, and it is in our favour.

### F8 — PDF generation: only theirs has any

```bash
node -e "const p=require('./package.json');console.log(Object.keys({...p.dependencies}).filter(k=>/pdf|puppeteer/i.test(k)))"
```

Theirs: `@react-pdf/renderer` + `lib/pdf/{generate,render,quote-pdf}.tsx`, metered by an
admission decision. Ours: `pdf-parse` only — we can *read* a PDF and cannot *produce* one.
Phase 5 of the build sequence is unstarted.

### Also recorded

- **Pricing depth.** Ours `src/engine/pricing.ts` (459 LOC) + modifiers + price bands +
  `src/guardrails/evaluator.ts` (280 LOC). Theirs `lib/quote-calc.ts` (65 LOC: line totals,
  per-rate tax buckets, half-away-from-zero rounding). Theirs is correct and shallow; ours is
  a product.
- **Invariants.** Ours `tests/invariants/i1..i6` (679 LOC), one test per §2 invariant. No
  counterpart on their side.
- **Crash-safety.** Theirs is ahead: leases, resumable delivery, serialised binding
  acceptance, guards against concurrent approval and edit. Ours has none of this because it
  has no durable outbound channel yet.
- **Correction / rework.** Theirs `lib/ai/correction.ts` reworks quote lines from a customer
  wish with a `feasible` flag and typed reason (`unknown_service` / `missing_price` /
  `unclear`). Ours is `src/agent/rework.ts`. Compare properly at merge time — not evaluated
  in depth here.

---

## 3. Two conclusions to guard against

An agent reading the raw diff will plausibly reach for both of these. Both are wrong.

**`TurnOutcome = "declined"` is not an automated customer refusal.**
`/tmp/felix-offerprofi/lib/whatsapp-flow.ts:923`, verified against its return sites at
`:963-1010`. It means *this turn declined to process this message* — automation stopped,
inquiry assigned to a human, or status already past automation. That is the same posture as
Invariant 1, in different vocabulary. It does **not** breach §2.

**Test counts are not a quality ranking.**
Ours: 602 cases, unit-weighted. Theirs: 230 cases, integration-weighted — `tests/global-setup.ts`
stands up a real Next server on :3999, Postgres and MinIO per run. These measure different
things. Report both shapes; do not score one against the other.

---

## 4. Verdict

**Theirs is the better machine.** A complete vertical slice — message in, quote PDF out —
with spend metering, crash-safety, leases and resumable delivery. It can be demonstrated
end to end today.

**Ours is the better foundation.** RLS, an enforced model boundary, exact cost attribution,
a retrieval layer, a real pricing engine, and the six invariants as executable tests.

**On AI-layer intelligence specifically, the split is narrow and real:** their injection
hardening and model tiering are the better *implementation*; our retrieval, enforced
boundary, cost accounting and never-throw guarantee are the better *architecture*.

The asymmetry that decides the merge direction: **their weakest point (no RLS) is the most
expensive thing in this comparison to retrofit. Ours (no confirm→handoff, no PDF, one-regex
injection defence) are among the cheapest.**

---

## 5. The OpenWA constraint — owner decision, not an agent's

Their WhatsApp channel runs on **OpenWA**, the unofficial WhatsApp Web automation route,
reached over HTTP with HMAC (`lib/openwa.ts`) as a self-hosted service rather than an npm
dependency.

[CLAUDE.md](../CLAUDE.md) §4 carries a standing rule against exactly this:

> **Never use unofficial WhatsApp automation libraries.** They violate Meta's terms and get
> the agency's own business number banned — the number their livelihood runs through.

That rule is sound and this document does not propose relaxing it. Both things are true at
once: a live WhatsApp demo on 14 Aug is a genuine asset, and a permanent dependency on OpenWA
is a genuine liability to the customer's business.

**Do not let a merge adopt it silently as infrastructure.** If it ships, it ships as a
deliberate, time-boxed demo decision recorded here with an owner's name against it.

---

## 6. Merge direction

**Base: `Malek1414/Offerprofi`.** Not because it is ours — because F1, F2 and F7 are the
three properties that cannot be retrofitted cheaply, and all three already exist here.
Port inward from theirs.

| Concern | Keep from | Why |
|---|---|---|
| Tenant isolation (RLS) | **Ours** | 35 policies vs 0 (F1); largest single retrofit in either direction |
| Model boundary | **Ours** | Lint + test enforced (F2); makes cost, framing, audit unbypassable |
| Failure semantics | **Ours** | Never-throws (F3) — Invariant 1 in the type system |
| Cost accounting | **Ours** | Exact micro-cents, per-purpose attribution, ZDR gating (F5) |
| Retrieval / knowledge | **Ours** | No counterpart exists (F7) |
| Pricing engine + guardrails | **Ours** | 459 + 280 LOC vs 65 |
| Six invariants + tests | **Ours** | No counterpart exists |
| Prompt-injection defence | **Theirs** | Port `lib/ai/whatsapp.ts:55-330` into `src/agent/prompt.ts` (F4) |
| Spend metering | **Theirs** | Port `ai_extraction_budget` + admission check (F5) |
| Model tiering | **Theirs** | Haiku default, confidence-triggered escalation (F6) |
| Multimodal extraction | **Theirs** | PDF/image file parts straight to the model |
| PDF generation | **Theirs** | We have no generation path at all (F8) |
| Crash-safe delivery, leases | **Theirs** | Port the pattern when a durable channel lands |
| WhatsApp transport | **Neither, yet** | Owner decision — §5 |

### Build order

Sized against the 14 Aug pitch, highest value first.

1. **Confirm → handoff.** The blocking gap. No code path in the working tree *or* at `HEAD`
   transitions an inquiry to `sent_to_owner`:
   ```bash
   grep -rn "sent_to_owner" src/
   ```
   returns only the state-machine definition (`src/domain/inquiry-state.ts:33,97-99`) and the
   inbox label (`src/inbox/labels.ts:38`). Confirmed by walkthrough on 10 Aug: the agent ends
   the qualifying loop with "Passt das so?" and nothing consumes the answer — "Ja, das passt
   genau so" and a bare "Ja" were both absorbed into `Besonderes` as further extraction, and
   the summary was re-asked.
   Fix the ready-to-send branch at `src/chat/qualifying-turn.ts:166-174` so an affirmative
   reply mints the `request_links` rows and transitions state.
   **Without this the headline promise — chat to sent Angebot in under five minutes — is not
   demonstrable end to end.**
2. **Port the injection defence** (F4) into `src/agent/prompt.ts`, behind the existing
   `buildPrompt` signature so no call site changes. Bring their tests across.
3. **Port spend metering** (F5) — migration plus an admission check *inside* `callModel`, so
   the single boundary makes it unbypassable. Their 4-call-site layout cannot offer that
   guarantee; ours can, and this is the clearest case of the merge being worth more than
   either half.
4. **Model tiering** (F6) in `client.ts` — Haiku default with confidence-triggered escalation.
5. **PDF generation** (F8), if time survives 1–4.

Items 2–5 are independent of item 1 and of each other.

---

## 7. Known gaps in this evaluation

Stated so nobody mistakes absence of comment for a clean bill:

- **Their `correction.ts` vs our `rework.ts`** was not compared in depth.
- **Their auth stack** (better-auth, organisations, invitations, signed super-admin support
  cookie with server-side TTL) was read only far enough to establish the tenancy model. It
  looks more complete than ours and deserves its own comparison.
- **Neither repo's frontend** was evaluated. This document is backend and AI layer only.
- **No performance benchmarking** was run on either side. The 6–9s figures in F6 are observed
  `agent_runs` latencies from a single walkthrough on one machine, not a benchmark.
