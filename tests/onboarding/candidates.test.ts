/**
 * F2.6 / F2.8 — catalogue candidates and confirmation.
 *
 * Acceptance: "Nothing enters the live catalogue unconfirmed. Test: extraction alone
 * never creates a live `catalog_item`."
 */

import { describe, expect, it } from 'vitest'

import { cents } from '../../src/domain/money'
import * as candidates from '../../src/onboarding/candidates'
import {
  type CatalogueCandidate,
  candidateStrength,
  confirmCandidate,
  rejectCandidate,
  toLiveCatalogItem,
} from '../../src/onboarding/candidates'

const NOW = '2026-08-09T09:00:00.000Z'
const OWNER = 'user_lisa'

function candidate(overrides: Partial<CatalogueCandidate> = {}): CatalogueCandidate {
  return {
    candidateId: 'cand_1',
    agencyId: 'agency_1',
    name: 'Hochzeitsplanung Komplett',
    description: 'Konzept, Dienstleisterauswahl, Zeitplan und Koordination',
    unit: 'Pauschale',
    unitPriceCents: cents(245_000),
    vatRate: 19,
    quantityDriver: 'flat',
    frequency: 3,
    quoteCount: 3,
    sourceRefs: [
      { assetId: 'asset_1', page: 2, excerpt: 'Hochzeitsplanung Komplett — 2.450,00 €' },
      { assetId: 'asset_2', page: 1, excerpt: 'Planung komplett 2.450 €' },
    ],
    ...overrides,
  }
}

describe('F2.8 — extraction alone never creates a live catalogue item', () => {
  it('offers no function from a candidate straight to a live item', () => {
    // The structural claim. If someone adds a convenience helper that skips
    // confirmation, this fails — which is the entire point of asserting it.
    const exported = Object.keys(candidates).filter(
      (key) => typeof (candidates as Record<string, unknown>)[key] === 'function',
    )
    expect(exported.sort()).toEqual(
      ['candidateStrength', 'confirmCandidate', 'rejectCandidate', 'toLiveCatalogItem'].sort(),
    )
  })

  it('refuses to confirm without a named user', () => {
    // A "system" confirmation is exactly what must not exist. Every live price has
    // to trace back to a person.
    expect(() => confirmCandidate(candidate(), {}, '', NOW)).toThrow(/authenticated user/)
  })

  it('records who confirmed and when', () => {
    const confirmed = confirmCandidate(candidate(), {}, OWNER, NOW)
    expect(confirmed.confirmedBy).toBe(OWNER)
    expect(confirmed.confirmedAt).toBe(NOW)
  })

  it('only produces a live item from a confirmed one', () => {
    const confirmed = confirmCandidate(candidate(), {}, OWNER, NOW)
    const live = toLiveCatalogItem(confirmed, 'itm_1')
    expect(live.active).toBe(true)
    expect(live.name).toBe('Hochzeitsplanung Komplett')
  })

  it('carries the source assets onto the confirmed item, de-duplicated', () => {
    const confirmed = confirmCandidate(
      candidate({
        sourceRefs: [
          { assetId: 'asset_1', excerpt: 'a' },
          { assetId: 'asset_1', excerpt: 'b' },
          { assetId: 'asset_2', excerpt: 'c' },
        ],
      }),
      {},
      OWNER,
      NOW,
    )
    expect(confirmed.sourceAssetIds).toEqual(['asset_1', 'asset_2'])
  })
})

describe('F2.8 — the owner may edit anything while confirming', () => {
  it('applies edits over the extracted values', () => {
    // Extraction is a first draft. She knows her own prices better than a model.
    const confirmed = confirmCandidate(
      candidate(),
      { name: 'Full Planning', unitPriceCents: cents(260_000), vatRate: 7 },
      OWNER,
      NOW,
    )
    expect(confirmed.name).toBe('Full Planning')
    expect(confirmed.unitPriceCents).toBe(260_000)
    expect(confirmed.vatRate).toBe(7)
  })

  it('defaults the floor to the list price, so no discount is granted by accident', () => {
    // D8 — no-discounting is the out-of-box behaviour; permitting one is deliberate.
    const confirmed = confirmCandidate(candidate(), {}, OWNER, NOW)
    expect(confirmed.floorPriceCents).toBe(confirmed.unitPriceCents)
  })

  it('honours a deliberately lowered floor', () => {
    const confirmed = confirmCandidate(candidate(), { floorPriceCents: cents(200_000) }, OWNER, NOW)
    expect(confirmed.floorPriceCents).toBe(200_000)
  })

  it('rejects a floor above the list price', () => {
    expect(() =>
      confirmCandidate(candidate(), { floorPriceCents: cents(300_000) }, OWNER, NOW),
    ).toThrow(/floor price/)
  })

  it('rejects a negative price', () => {
    expect(() => confirmCandidate(candidate(), { unitPriceCents: -1 as never }, OWNER, NOW)).toThrow(
      /negative/,
    )
  })
})

describe('F2.8 — rejections are retained as negative signal', () => {
  it('records who rejected it and when', () => {
    const rejected = rejectCandidate(candidate(), OWNER, NOW, 'war ein Freundschaftspreis')
    expect(rejected.candidateId).toBe('cand_1')
    expect(rejected.rejectedBy).toBe(OWNER)
    expect(rejected.reason).toBe('war ein Freundschaftspreis')
  })

  it('does not require a reason — the owner need not explain herself', () => {
    expect(rejectCandidate(candidate(), OWNER, NOW).reason).toBeUndefined()
  })

  it('still names the user', () => {
    expect(() => rejectCandidate(candidate(), '', NOW)).toThrow(/name the user/)
  })
})

describe('F2.6 — frequency is a signal shown to the owner, not an auto-confirm', () => {
  it('scores an item present in every quote at 1', () => {
    expect(candidateStrength(candidate({ frequency: 3, quoteCount: 3 }))).toBe(1)
  })

  it('scores a one-off low', () => {
    // Possibly a favour for a friend. Pricing future weddings off it would be wrong.
    expect(candidateStrength(candidate({ frequency: 1, quoteCount: 3 }))).toBeCloseTo(0.33, 2)
  })

  it('does not divide by zero', () => {
    expect(candidateStrength(candidate({ frequency: 0, quoteCount: 0 }))).toBe(0)
  })

  it('never exceeds 1 even on inconsistent counts', () => {
    expect(candidateStrength(candidate({ frequency: 9, quoteCount: 3 }))).toBe(1)
  })

  it('a perfect score still does not confirm anything', () => {
    // Consistency is not correctness. A consistently wrong price is still wrong.
    const strong = candidate({ frequency: 3, quoteCount: 3 })
    expect(candidateStrength(strong)).toBe(1)
    // There is still no way to reach a live item without a user.
    expect(() => confirmCandidate(strong, {}, '', NOW)).toThrow()
  })
})
