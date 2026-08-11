/**
 * What a stranger holding a quote token may see (security pass H1).
 *
 * `/q/{token}` hands its quote to `<QuoteDocument>`, a client component, so every
 * field on that object is serialised into the RSC payload inside the HTML. There is
 * no "the UI does not display it" defence at that boundary — view-source is the
 * whole attack and it needs no tooling.
 *
 * These tests exist because the leak they caught was invisible: the page looked
 * correct, every figure on it was right, and the agency's floor prices were in the
 * markup underneath. Nothing about rendering it would ever have shown that. So the
 * assertion is made against the serialised object rather than against the rendered
 * output, and the last test in the file walks the whole structure rather than the
 * fields we happen to remember today.
 */

import { describe, expect, it } from 'vitest'

import type { CalculationTrace, QuoteLine } from '../../src/engine/pricing'
import { rehydrateQuote, type ResolvedQuote } from '../../src/quote/repository'

/**
 * Overrides are plain numbers, not the branded `Cents` the engine uses.
 *
 * A fixture that has to import `cents()` to say "1200" adds a ceremony that hides
 * what the test is about, and the branding is protecting arithmetic in the engine
 * rather than assertions in a test.
 */
interface LineOverrides {
  catalogItemId?: string
  unitPrice?: number
  floorPrice?: number
}

const line = (over: LineOverrides = {}): QuoteLine =>
  ({
    catalogItemId: 'item-1',
    name: 'Fingerfood-Menü',
    description: '',
    unit: 'Person',
    quantity: 80,
    quantityDriver: 'per_guest',
    listUnitPrice: 2100,
    unitPrice: 1850,
    // The number this file exists to keep off the page: the lowest the agency
    // would ever go on this line.
    floorPrice: 1200,
    subtotal: 148000,
    modifierTotal: 0,
    net: 148000,
    vatRate: 19,
    vat: 28120,
    gross: 176120,
    ...over,
  }) as QuoteLine

const trace = (steps: CalculationTrace['steps']): CalculationTrace =>
  ({
    engineVersion: '1',
    steps,
    input: { availability: 'available' },
  }) as CalculationTrace

const resolved = (over: Partial<ResolvedQuote> = {}): ResolvedQuote =>
  ({
    quoteVersionId: 'v1',
    agencyId: 'a1',
    quoteNumber: '2026-0001',
    versionNo: 1,
    lines: [line()],
    trace: null,
    netTotalCents: 148000,
    grossTotalCents: 176120,
    vatBreakdown: [],
    validUntil: '2026-09-01',
    issuedAt: '2026-08-11T00:00:00.000Z',
    legalTextVersion: '1',
    state: 'sent',
    agency: { name: 'Catering Meier', ownerName: 'Anna Meier', brandColor: null, language: 'de' },
    ...over,
  }) as ResolvedQuote

describe('what crosses to the customer', () => {
  it('does not carry the floor price the guardrails exist to defend', () => {
    // A customer who knows the floor knows the bottom of the negotiating range
    // before she has made a single counter-offer. 0022 promises a stranger sees no
    // cost or margin figure; this is the test that makes that true.
    const quote = rehydrateQuote(resolved())

    expect(quote.lines[0]?.floorPrice).not.toBe(1200)
  })

  it('reports the floor as the price actually charged, not as zero', () => {
    // Zero is a claim — that the agency would give the line away — and it is one
    // the guardrail evaluator would act on if this object ever travelled inward.
    // Equal to `unitPrice` is the honest redaction: no room below what was quoted.
    const quote = rehydrateQuote(resolved())

    expect(quote.lines[0]?.floorPrice).toBe(quote.lines[0]?.unitPrice)
  })

  it('keeps every figure the customer was actually quoted', () => {
    // Redaction that also removed the price would be a safe document and a useless
    // one. The whole point is that only the agency-internal figures go.
    const quote = rehydrateQuote(resolved())

    expect(quote.lines[0]?.unitPrice).toBe(1850)
    expect(quote.lines[0]?.quantity).toBe(80)
    expect(quote.lines[0]?.gross).toBe(176120)
    expect(quote.grossTotal).toBe(176120)
  })

  it('strips the tier ladder out of the calculation trace', () => {
    // Step 3 records which price rule fired, thresholds and all. Knowing that the
    // price drops above 80 guests is knowing exactly where to push.
    const quote = rehydrateQuote(
      resolved({
        trace: trace([
          {
            step: 3,
            action: 'apply_price_rule',
            item: 'item-1',
            rule: { id: 'r1', minQuantity: 80, unitPrice: 1850 } as never,
            unitPrice: 1850,
          },
        ]),
      }),
    )

    const step = quote.trace?.steps.find((s) => s.step === 3)
    expect(step && 'rule' in step && step.rule).toBeNull()
  })

  it('leaves the rest of the trace intact, because the trace is a promise', () => {
    // §6 and D6: any figure can be explained in plain language on request. A trace
    // gutted for safety would break the one commitment the deterministic engine
    // was built to be able to keep.
    const quote = rehydrateQuote(
      resolved({
        trace: trace([
          { step: 4, action: 'line_subtotal', item: 'item-1', quantity: 80, unitPrice: 1850, subtotal: 148000 },
          { step: 6, action: 'sum_net', net: 148000 },
          { step: 8, action: 'gross_total', gross: 176120 },
        ]),
      }),
    )

    expect(quote.trace?.steps).toHaveLength(3)
    const subtotal = quote.trace?.steps.find((s) => s.step === 4)
    expect(subtotal && 'subtotal' in subtotal && subtotal.subtotal).toBe(148000)
  })

  it('does not mutate the row it was given', () => {
    // `resolveQuoteLink`'s result is also what a future owner-side surface would
    // read. Redacting in place would silently blind the guardrail evaluator, which
    // is the one caller that legitimately needs the floor.
    const row = resolved()
    rehydrateQuote(row)

    expect(row.lines[0]?.floorPrice).toBe(1200)
  })

  it('redacts every line, not only the first', () => {
    const quote = rehydrateQuote(
      resolved({
        lines: [
          line({ catalogItemId: 'a', unitPrice: 1850, floorPrice: 1200 }),
          line({ catalogItemId: 'b', unitPrice: 9500, floorPrice: 4000 }),
          line({ catalogItemId: 'c', unitPrice: 6500, floorPrice: 2500 }),
        ],
      }),
    )

    expect(quote.lines.map((l) => l.floorPrice)).toEqual([1850, 9500, 6500])
  })
})

describe('the serialised payload as a whole', () => {
  /**
   * The test that survives the next person adding a field.
   *
   * Every assertion above names a field somebody already thought of. This one walks
   * the finished object the way Next serialises it and looks for the *values* — so a
   * floor price that reappears on a nested shape nobody has invented yet still fails
   * here, without anyone having to remember to come back and add a case.
   */
  const FLOOR = 1200
  const OTHER_FLOOR = 4000

  it('contains no floor-price value anywhere in the object graph', () => {
    const quote = rehydrateQuote(
      resolved({
        lines: [
          line({ catalogItemId: 'a', unitPrice: 1850, floorPrice: FLOOR }),
          line({ catalogItemId: 'b', unitPrice: 9500, floorPrice: OTHER_FLOOR }),
        ],
        trace: trace([
          {
            step: 3,
            action: 'apply_price_rule',
            item: 'a',
            rule: { id: 'r1', minQuantity: 80, unitPrice: 1850, floorPrice: FLOOR } as never,
            unitPrice: 1850,
          },
        ]),
      }),
    )

    // Serialised exactly as the RSC payload would be, then searched for the numbers
    // themselves. The chosen floors do not collide with any other figure in the
    // fixture, so a hit here is a genuine leak rather than a coincidence.
    const payload = JSON.stringify(quote)

    expect(payload).not.toContain(String(FLOOR))
    expect(payload).not.toContain(String(OTHER_FLOOR))
  })
})
