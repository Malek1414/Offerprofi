/**
 * Drift detection (C4).
 *
 * The load-bearing decisions here are all about restraint, so that is what these
 * pin: no fuzzy name matching, a floor under what counts as a change, and a hard
 * cap on how many differences one card may carry. Each of those is the difference
 * between a thirty-second nudge and a re-onboarding the owner learns to close.
 */

import { describe, expect, it } from 'vitest'

import {
  MAX_CARDS,
  detectDrift,
  driftHeadline,
  nextRecrawlAt,
  type ConfirmedItem,
  type ObservedItem,
} from '../../src/drift/detect'

const confirmed = (over: Partial<ConfirmedItem> = {}): ConfirmedItem => ({
  catalogItemId: 'item-1',
  name: 'Fingerfood-Menü',
  unitPriceCents: 1850,
  unit: 'Person',
  ...over,
})

const observed = (over: Partial<ObservedItem> = {}): ObservedItem => ({
  name: 'Fingerfood-Menü',
  unitPriceCents: 1850,
  unit: 'Person',
  sourceUrl: 'https://cateringmeier.de/menue',
  excerpt: 'Fingerfood-Menü ab 12 Personen 18,50 € p.P.',
  ...over,
})

describe('detectDrift', () => {
  it('says nothing when the website still agrees with the catalogue', () => {
    expect(detectDrift([confirmed()], [observed()])).toEqual([])
  })

  it('notices a price that moved', () => {
    const cards = detectDrift([confirmed()], [observed({ unitPriceCents: 2100 })])

    expect(cards).toHaveLength(1)
    expect(cards[0]?.field).toBe('unitPriceCents')
    expect(cards[0]?.currentValue).toBe('1850')
    expect(cards[0]?.observedValue).toBe('2100')
    // The evidence travels with the card, so the owner verifies by glance rather
    // than by opening her own website and hunting.
    expect(cards[0]?.excerpt).toContain('18,50')
  })

  it('ignores a difference too small to be a real price change', () => {
    // A page rendering "18,50" one week and "18,5" the next has not changed its
    // price, and a card for that costs exactly as much attention as a real one.
    expect(detectDrift([confirmed()], [observed({ unitPriceCents: 1851 })])).toEqual([])
  })

  it('matches through the punctuation a website restyles without meaning to', () => {
    const cards = detectDrift(
      [confirmed({ name: 'Fingerfood-Menü' })],
      [observed({ name: 'Fingerfood Menü', unitPriceCents: 2100 })],
    )
    expect(cards).toHaveLength(1)
  })

  it('does not match a different item that merely looks similar', () => {
    // The asymmetry the whole design rests on: silence costs a nudge, a wrong
    // card costs trust. A card claiming her Fingerfood price changed when the
    // page was describing Fingerfood Deluxe teaches her the feature is unreliable.
    const cards = detectDrift(
      [confirmed({ name: 'Fingerfood-Menü' })],
      [observed({ name: 'Fingerfood Deluxe', unitPriceCents: 4900 })],
    )
    expect(cards).toEqual([])
  })

  it('ranks a changed unit above a changed price', () => {
    const cards = detectDrift(
      [
        confirmed({ catalogItemId: 'a', name: 'Buffet', unitPriceCents: 1000, unit: 'Person' }),
        confirmed({ catalogItemId: 'b', name: 'Deko', unitPriceCents: 1000, unit: 'Pauschale' }),
      ],
      [
        observed({ name: 'Deko', unitPriceCents: 5000, unit: 'Pauschale' }),
        observed({ name: 'Buffet', unitPriceCents: 1000, unit: 'Stück' }),
      ],
    )

    // "per person" becoming "per item" silently multiplies or divides every quote
    // that uses it, which outranks almost any price move.
    expect(cards[0]?.field).toBe('unit')
  })

  it('never shows more than three, because a longer list is a re-onboarding', () => {
    const items = Array.from({ length: 9 }, (_, n) =>
      confirmed({ catalogItemId: `item-${n}`, name: `Leistung ${n}`, unitPriceCents: 1000 }),
    )
    const pages = items.map((item, n) =>
      observed({ name: item.name, unitPriceCents: 1000 + (n + 1) * 500 }),
    )

    expect(detectDrift(items, pages)).toHaveLength(MAX_CARDS)
  })

  it('shows the largest discrepancies when it has to choose', () => {
    const items = Array.from({ length: 5 }, (_, n) =>
      confirmed({ catalogItemId: `item-${n}`, name: `Leistung ${n}`, unitPriceCents: 1000 }),
    )
    const pages = items.map((item, n) => observed({ name: item.name, unitPriceCents: 1000 + n * 1000 }))

    const cards = detectDrift(items, pages)

    // Ranked by how far the price moved relative to the confirmed one.
    expect(cards[0]?.observedValue).toBe('5000')
  })
})

describe('driftHeadline', () => {
  it('counts what was found, not what is shown', () => {
    // Telling an owner about three differences when nine were found, without
    // saying so, is a small dishonesty that gets discovered and colours the rest.
    expect(driftHeadline(9)).toContain('9')
  })

  it('gets the singular right, because "1 Einträge" reads as broken software', () => {
    expect(driftHeadline(1)).toContain('1 Eintrag')
  })

  it('says so when nothing changed', () => {
    expect(driftHeadline(0)).toMatch(/stimmt/)
  })
})

describe('nextRecrawlAt', () => {
  it('schedules a week out by default', () => {
    const last = new Date('2026-08-01T00:00:00Z')
    expect(nextRecrawlAt(last, 7)?.toISOString()).toBe('2026-08-08T00:00:00.000Z')
  })

  it('returns null rather than a far-future date when re-crawling is off', () => {
    // A scheduler reading a date will eventually run the job. "Never" expressed
    // as the year 3000 is a bug waiting for someone to change a comparison.
    expect(nextRecrawlAt(new Date(), 0)).toBeNull()
  })

  it('is due immediately when a tenant has never been crawled', () => {
    expect(nextRecrawlAt(null, 7)).toBeInstanceOf(Date)
  })
})
