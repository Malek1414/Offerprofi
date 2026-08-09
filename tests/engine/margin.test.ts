/**
 * What the caterer keeps.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MARGIN IS CHECKED AGAINST THE ENGINE, NOT AGAINST ITSELF.
 *
 * The tempting test is `revenue − cost === margin`, which restates the
 * implementation and passes even if the wrapper reads the wrong field off every
 * line. The load-bearing assertion is the one tying the wrapper's revenue to
 * `quote.netTotal` — a figure the golden set already pins to the cent.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, expect, it } from 'vitest'

import { type CatalogItemId, catalogItemId } from '../../src/domain/catalogue'
import { type Cents, eurosToCents } from '../../src/domain/money'
import { costTable, summariseMargin } from '../../src/engine/margin'
import { priceQuote } from '../../src/engine/pricing'
import {
  ITEM_CATERING,
  ITEM_DECOR,
  ITEM_PLANNING,
  fullCatalogue,
  minimalPricingInput,
} from '../fixtures/catalogue'

/** Costs a caterer might plausibly enter. Deliberately not round. */
function costs(overrides: Partial<Record<string, Cents | null>> = {}) {
  const base: { id: CatalogItemId; costCents: number | null }[] = [
    { id: ITEM_PLANNING, costCents: eurosToCents(820) },
    { id: ITEM_DECOR, costCents: eurosToCents(437.5) },
    { id: ITEM_CATERING, costCents: eurosToCents(31.4) },
  ]
  return costTable(
    base.map((row) =>
      row.id in overrides
        ? { id: row.id, costCents: overrides[row.id] === null ? null : Number(overrides[row.id]) }
        : row,
    ),
  )
}

function quoteFor(serviceIds: CatalogItemId[]) {
  return priceQuote({ ...minimalPricingInput(), serviceIds }, fullCatalogue())
}

describe('margin against the engine', () => {
  it('revenue equals the engine’s net total, to the cent', () => {
    // The assertion that matters. If the wrapper reads `gross` or `subtotal`
    // instead of `net`, every margin on the page is quietly wrong and every
    // self-referential test still passes.
    const quote = quoteFor([ITEM_PLANNING, ITEM_DECOR, ITEM_CATERING])
    const margin = summariseMargin(quote, costs())
    expect(margin.revenue).toBe(quote.netTotal)
  })

  it('revenue − margin equals what the services cost him', () => {
    const quote = quoteFor([ITEM_PLANNING, ITEM_DECOR])
    const margin = summariseMargin(quote, costs())
    expect(Number(margin.revenue) - Number(margin.margin)).toBe(Number(margin.knownCost))
  })

  it('counts VAT as nobody’s profit', () => {
    // Margin is computed on net. Counting collected VAT as revenue would inflate
    // every figure by the VAT rate, on the screen where he decides whether an
    // event is worth doing.
    const quote = quoteFor([ITEM_PLANNING])
    const margin = summariseMargin(quote, costs())
    expect(Number(margin.revenue)).toBeLessThan(Number(quote.grossTotal))
    expect(margin.revenue).toBe(quote.netTotal)
  })

  it('includes a surcharge as revenue he keeps', () => {
    // A weekend or peak-season modifier is money in his pocket, so it belongs in
    // the margin. `line.net` already carries it — this pins that it is not
    // silently dropped by using `subtotal`.
    const quote = quoteFor([ITEM_CATERING])
    const line = quote.lines[0]
    expect(line, 'the fixture must produce a line').toBeDefined()
    const margin = summariseMargin(quote, costs())
    expect(margin.lines[0]?.revenue).toBe(line?.net)
  })
})

describe('a cost nobody entered', () => {
  it('is reported as unknown, never as pure profit', () => {
    // The failure that would matter: an omission that flatters every margin.
    const quote = quoteFor([ITEM_PLANNING, ITEM_DECOR])
    const margin = summariseMargin(quote, costs({ [ITEM_DECOR]: null }))

    expect(margin.unknownCostLines.map((l) => l.catalogItemId)).toEqual([ITEM_DECOR])
    expect(margin.lines.find((l) => l.catalogItemId === ITEM_DECOR)?.margin).toBeNull()
    expect(margin.lines.find((l) => l.catalogItemId === ITEM_DECOR)?.cost).toBeNull()
  })

  it('is excluded from the margin rather than counted at zero', () => {
    const quote = quoteFor([ITEM_PLANNING, ITEM_DECOR])
    const complete = summariseMargin(quote, costs())
    const partial = summariseMargin(quote, costs({ [ITEM_DECOR]: null }))

    // Zeroing the décor cost would have *raised* the reported margin. Excluding it
    // lowers it, which is the direction that cannot mislead him.
    expect(Number(partial.margin)).toBeLessThan(Number(complete.margin))
  })

  it('names the revenue the margin says nothing about', () => {
    const quote = quoteFor([ITEM_PLANNING, ITEM_DECOR])
    const margin = summariseMargin(quote, costs({ [ITEM_DECOR]: null }))
    const decor = quote.lines.find((l) => l.catalogItemId === ITEM_DECOR)
    expect(margin.uncostedRevenue).toBe(decor?.net)
    expect(margin.unknownCostLines[0]?.name).toBe(decor?.name)
  })

  it('reports the percentage over costed revenue only', () => {
    const quote = quoteFor([ITEM_PLANNING, ITEM_DECOR])
    const margin = summariseMargin(quote, costs({ [ITEM_DECOR]: null }))
    const planning = quote.lines.find((l) => l.catalogItemId === ITEM_PLANNING)
    // Not margin/revenue — that would report a percentage of money it has no
    // costs for, which is a made-up number wearing a decimal point.
    const expected =
      Math.round((Number(margin.margin) / Number(planning?.net ?? 1)) * 1000) / 10
    expect(margin.marginPct).toBe(expected)
  })

  it('says so when nothing has a cost at all', () => {
    const quote = quoteFor([ITEM_PLANNING])
    const margin = summariseMargin(quote, costTable([]))
    expect(margin.hasAnyCost).toBe(false)
    expect(margin.marginPct).toBeNull()
    expect(Number(margin.margin)).toBe(0)
  })
})

describe('per line', () => {
  it('multiplies unit cost by the engine’s quantity, not by a guess', () => {
    const quote = quoteFor([ITEM_CATERING])
    const margin = summariseMargin(quote, costs())
    const line = quote.lines[0]
    const marginLine = margin.lines[0]
    expect(marginLine?.quantity).toBe(line?.quantity)
    expect(Number(marginLine?.cost)).toBe(Number(eurosToCents(31.4)) * (line?.quantity ?? 0))
  })

  it('reports a loss as a loss', () => {
    // A caterer who prices a loss-leader below cost should see a negative number,
    // not a clamped zero. It is his decision and he already knows.
    const quote = quoteFor([ITEM_DECOR])
    const margin = summariseMargin(
      quote,
      costTable([{ id: ITEM_DECOR, costCents: Number(eurosToCents(9999)) }]),
    )
    expect(Number(margin.margin)).toBeLessThan(0)
    expect(margin.marginPct).toBeLessThan(0)
  })

  it('has no percentage for a free line', () => {
    const free = catalogItemId('itm_free')
    const margin = summariseMargin(
      {
        ...quoteFor([ITEM_PLANNING]),
        lines: [
          {
            ...(quoteFor([ITEM_PLANNING]).lines[0] as NonNullable<
              ReturnType<typeof quoteFor>['lines'][number]
            >),
            catalogItemId: free,
            net: 0 as Cents,
          },
        ],
      },
      costTable([{ id: free, costCents: 0 }]),
    )
    // "0%" next to a free line reads as a loss. Null renders as nothing.
    expect(margin.lines[0]?.marginPct).toBeNull()
  })
})
