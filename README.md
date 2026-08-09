# Offerprofi

Offerprofi turns a catering conversation into a qualified, shareable request and puts
it in the caterer's inbox. The customer never receives an AI-generated price. The
caterer sees an owner-side suggestion calculated deterministically from their confirmed
catalogue, including the line-by-line margin view, and remains the person who decides.

## Documents

| File | What it is |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Standing context. Six binding invariants, 28 locked decisions. **Read first.** |
| [PRODUCT_SPEC.md](PRODUCT_SPEC.md) | Original full specification; the catering pivot in PROGRESS takes precedence |
| [docs/PROGRESS.md](docs/PROGRESS.md) | Current implementation and session handoff |
| [docs/FEATURE_INVENTORY.md](docs/FEATURE_INVENTORY.md) | ~130 features across phases 0–12, each with an acceptance criterion. 59 screens |
| [docs/ORIGINAL_BRIEF.md](docs/ORIGINAL_BRIEF.md) | Source record, verbatim |

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
npm run verify       # typecheck + lint + all tests
npm run test:invariants   # the six Art. 22 tests on their own
npm run test:db      # applies every migration to a scratch PostgreSQL database
```

For the full owner and customer flow:

```bash
./db/dev-setup.sh
psql -d angebot_dev -f scripts/seed-demo.sql
npm run dev
```

Then sign in with `johannes@krautundrueben.test` / `DemoPasswort2026!`, or open the
customer chat at `/a/kraut-und-rueben`. Copy `.env.example` to `.env.local` and add an
`ANTHROPIC_API_KEY` to enable real extraction, qualifying questions, contextual
document prefixes and service mapping. Without it, the product uses its tested human
handoff and sparse-search fallbacks.

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

**Schema.** PostgreSQL tenant isolation, state-transition and opt-out triggers,
append-only evidence, request links, owner inbox, structured agency facts and the
searchable document layer. RLS protects every tenant table.

**Product surfaces.** Signup/login, checklist onboarding, document ingestion, manual
catalogue, brand colour, guardrails, public chat, two-audience request documents,
owner-side price suggestion, WhatsApp adapter and inbox.

**Before a public launch:** supply the Anthropic key, production database/domain,
review and complete the legal pages, and configure any optional channel provider.
See `docs/PROGRESS.md` for the exact state.

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
