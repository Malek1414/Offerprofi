# Quote automation for small event agencies (DACH)

An inquiry arrives, is acknowledged in seconds, is parsed into structured event data,
is priced **deterministically** against the agency's own catalogue, and becomes a
branded quote. The agent negotiates with the end customer inside hard guardrails, and
the owner enters after agreement — to confirm and fulfil, not to type documents.

Working title still open. `{BRAND}` and `{DOMAIN}` are placeholders throughout; see
open question #1 in [CLAUDE.md](CLAUDE.md).

## Documents

| File | What it is |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Standing context. Six binding invariants, 28 locked decisions. **Read first.** |
| [PRODUCT_SPEC.md](PRODUCT_SPEC.md) | Full specification, rev. 3. Authoritative |
| [docs/FEATURE_INVENTORY.md](docs/FEATURE_INVENTORY.md) | ~130 features across phases 0–12, each with an acceptance criterion. 59 screens |
| [docs/ORIGINAL_BRIEF.md](docs/ORIGINAL_BRIEF.md) | Source record, verbatim |

## Running it

```bash
npm install
npm run dev          # http://localhost:3737/q/demo renders a real quote
npm run verify       # typecheck + lint + all tests
npm run test:invariants   # the six Art. 22 tests on their own
```

No database is needed to see the customer-facing surfaces — they fall back to
a demo tenant (`src/lib/demo.ts`) when `DATABASE_URL` is unset.

## The six invariants

These outrank every other requirement. Each has a test that fails loudly by name, and
`npm run verify` is the gate.

| | Invariant | Where it lives |
|---|---|---|
| I1 | No automated adverse decision, ever | `src/domain/inquiry-state.ts` — there is no `declined_by_system` state |
| I2 | No personal data in pricing | `src/domain/pricing-input.ts` — the type admits event attributes only |
| I3 | Nothing binding is produced automatically | `src/domain/legal.ts` — the *freibleibend* clause has no off switch |
| I4 | A human is always in the path | Only an authenticated user reaches `confirmed` |
| I5 | Human intervention on demand, advertised | `src/domain/human-intervention.ts` |
| I6 | Transparency | `src/domain/disclosure.ts` + the calculation trace |

A feature that violates one is rejected at design time — not risk-assessed.

## What is built

**Engine (complete).** Deterministic pricing over the catalogue, integer cents,
half-up rounding at line level with totals summed from rounded lines, tiered Staffel
rules, ordered modifiers, per-line VAT 19/7/0, full calculation trace. Pure: no I/O,
no model call. Guardrail evaluator whose outcome type admits exactly two values,
`send` and `escalate`.

**Schema (complete).** 33 tables, RLS on every tenant table plus a migration-time
assertion that none was missed, state-transition and opt-out triggers, gapless quote
numbering allocated at send.

**Quote document (complete).** Server-rendered, branded from the agency's own colour,
DE/EN, print stylesheet, mobile-first. Any line opens to show its arithmetic.

**Not yet built:** onboarding, extraction, the conversation agent, the owner
dashboard, email, billing. See `docs/BUILD_STATUS.md`.

## Architecture notes

- **The engine is the product; channels are commodity.** Every channel is one adapter
  emitting the same `InboundEvent` envelope. Nothing downstream knows which channel a
  message came from.
- **Determinism where money is involved.** The model maps intent onto catalogue ids
  and does nothing else with money. All arithmetic is code.
- **Customer input is data, never instructions.** Guardrails run deterministically on
  generated output, *after* generation. Prompt instructions are a first line, not the
  control.
- **The design system hosts someone else's brand.** Agency colour and logo carry the
  personality; our chassis stays achromatic and guarantees legibility whatever hex
  they choose (`src/lib/theme.ts`).
