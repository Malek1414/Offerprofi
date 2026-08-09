/**
 * The rows a request becomes, and the one field that never crosses to her copy.
 *
 * The rendered-HTML version of this rule is in document.test.tsx. This is the
 * same rule one level down, where it is enforced — a component cannot render a row
 * it was never given.
 */

import { describe, expect, it } from 'vitest'

import type { CateringRequest } from '../../src/domain/catering-request'
import { MONEY_FIELDS, requestRows } from '../../src/requests/summary'

function request(overrides: Partial<CateringRequest> = {}): CateringRequest {
  return {
    eventDate: { value: '2027-06-12', confidence: 0.9, source: 'm1', sourceKind: 'ai' },
    headcount: { value: 80, confidence: 0.9, source: 'm1', sourceKind: 'ai' },
    venue: { value: 'Schloss Bensberg', confidence: 0.9, source: 'm1', sourceKind: 'ai' },
    serviceStyle: { value: 'buffet', confidence: 0.9, source: 'm1', sourceKind: 'ai' },
    mealType: { value: 'dinner', confidence: 0.9, source: 'm1', sourceKind: 'ai' },
    language: 'de',
    formality: 'sie',
    meta: { extractionVersion: 't', model: 't', completeness: 1, overallConfidence: 0.9 },
    ...overrides,
  }
}

const withBudget = request({
  budgetIndication: {
    value: { amount: 6000, currency: 'EUR', basis: 'total' },
    confidence: 0.9,
    source: 'm2',
    sourceKind: 'ai',
  },
})

describe('money', () => {
  it('never reaches the customer’s rows', () => {
    const fields = requestRows(withBudget, 'customer').map((r) => r.field)
    for (const money of MONEY_FIELDS) {
      expect(fields).not.toContain(money)
    }
  })

  it('reaches the owner’s, attributed to her', () => {
    const row = requestRows(withBudget, 'owner').find((r) => r.field === 'budgetIndication')
    expect(row?.value).toContain('6.000')
    expect(row?.label).toContain('ihre Angabe')
  })

  it('is the only difference when nothing else is owner-only', () => {
    const hers = requestRows(withBudget, 'customer').map((r) => r.field)
    const his = requestRows(withBudget, 'owner').map((r) => r.field)
    expect(his.filter((f) => !hers.includes(f))).toEqual(['budgetIndication'])
  })
})

describe('uncertainty', () => {
  const shaky = request({
    headcount: { value: 80, confidence: 0.5, source: 'm1', sourceKind: 'ai' },
  })

  it('is marked for the owner, who can check it', () => {
    const row = requestRows(shaky, 'owner').find((r) => r.field === 'headcount')
    expect(row?.uncertain).toBe(true)
  })

  it('is not shown to the customer, who told us in the first place', () => {
    const row = requestRows(shaky, 'customer').find((r) => r.field === 'headcount')
    expect(row?.uncertain).toBeUndefined()
  })
})

describe('rendering values a person reads', () => {
  it('writes the date out', () => {
    const row = requestRows(request(), 'customer').find((r) => r.field === 'eventDate')
    expect(row?.value).toBe('12. Juni 2027')
  })

  it('notes when the date is flexible', () => {
    const flexible = request({
      dateFlexible: { value: true, confidence: 0.9, source: 'm1', sourceKind: 'ai' },
    })
    expect(
      requestRows(flexible, 'customer').find((r) => r.field === 'eventDate')?.value,
    ).toContain('flexibel')
  })

  it('leaves an unparseable date as she gave it', () => {
    // Better on his page as nonsense he can read than dropped as invalid.
    const broken = request({
      eventDate: { value: 'irgendwann im Juni', confidence: 0.4, source: 'm1', sourceKind: 'ai' },
    })
    expect(requestRows(broken, 'owner').find((r) => r.field === 'eventDate')?.value).toContain(
      'irgendwann im Juni',
    )
  })

  it('translates the enums', () => {
    const rows = requestRows(request(), 'customer', 'en')
    expect(rows.find((r) => r.field === 'serviceStyle')?.value).toBe('Buffet')
    expect(rows.find((r) => r.field === 'mealType')?.value).toBe('Dinner')
  })

  it('shows an unknown enum value rather than swallowing it', () => {
    const odd = request({
      serviceStyle: {
        value: 'family_buffet_hybrid' as never,
        confidence: 0.9,
        source: 'm1',
        sourceKind: 'ai',
      },
    })
    expect(requestRows(odd, 'owner').find((r) => r.field === 'serviceStyle')?.value).toBe(
      'family_buffet_hybrid',
    )
  })

  it('omits what she never said', () => {
    const fields = requestRows(request(), 'owner').map((r) => r.field)
    expect(fields).not.toContain('durationHours')
    expect(fields).not.toContain('dietary')
  })
})
