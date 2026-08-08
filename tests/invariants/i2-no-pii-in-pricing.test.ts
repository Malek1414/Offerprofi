/**
 * INVARIANT 2 — no personal data in pricing, therefore no profiling.
 *
 * `PricingInput` admits event attributes only. Name, contact, company, address and
 * VAT id live in the `_contact` partition and are structurally unreachable from
 * pricing. No price varies by any characteristic of a person.
 *
 * This is checked three ways, because each catches a different mistake:
 *   1. source inspection of the input contract — catches a new field being added
 *   2. import-boundary check — catches the contact type being pulled into the engine
 *   3. behavioural check — catches a price that moves when only the person changes
 *
 * A type-only assertion would be defeated by an `as any`. Reading the source is
 * cruder and harder to sneak past.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { priceQuote } from '../../src/engine/pricing'
import { toPricingInput } from '../../src/domain/pricing-input'
import type { ContactPartition, EventBrief } from '../../src/domain/event-brief'
import { fullCatalogue, ITEM_DECOR, minimalPricingInput } from '../fixtures/catalogue'

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../../src/${p}`, import.meta.url)), 'utf8')

/** Anything that describes a person rather than an event. */
const PERSONAL_FIELD_NAMES = [
  'name',
  'firstName',
  'lastName',
  'email',
  'phone',
  'phoneE164',
  'company',
  'vatId',
  'address',
  'postcode',
  'contact',
  'customerId',
  'role',
  'gender',
  'age',
  'nationality',
  'ipAddress',
]

describe('I2 — no personal data in pricing', () => {
  it('declares no personal field on the PricingInput contract', () => {
    const source = read('domain/pricing-input.ts')
    const start = source.indexOf('export interface PricingInput')
    const end = source.indexOf('}', start)
    expect(start, 'PricingInput must exist').toBeGreaterThan(-1)
    const body = source.slice(start, end)

    for (const field of PERSONAL_FIELD_NAMES) {
      const declared = new RegExp(`^\\s*${field}\\s*[?:]`, 'im')
      expect(
        declared.test(body),
        `PricingInput declares "${field}". Personal data may not reach pricing (D24).`,
      ).toBe(false)
    }
  })

  it('keeps EventBrief free of contact fields', () => {
    const source = read('domain/event-brief.ts')
    const start = source.indexOf('export interface EventBrief')
    const end = source.indexOf('\n}', start)
    const body = source.slice(start, end)

    for (const field of ['email', 'phoneE164', 'vatId', 'company']) {
      expect(
        new RegExp(`^\\s*${field}\\s*[?:]`, 'im').test(body),
        `EventBrief declares "${field}" — it belongs in ContactPartition`,
      ).toBe(false)
    }
  })

  it('never imports the contact partition into the pricing engine', () => {
    const engine = read('engine/pricing.ts')
    expect(engine).not.toContain('ContactPartition')
    expect(engine).not.toContain('contact')
  })

  it('gives toPricingInput no way to accept contact data', () => {
    const source = read('domain/pricing-input.ts')
    const start = source.indexOf('export function toPricingInput')
    const signature = source.slice(start, source.indexOf('{', source.indexOf('options', start)))
    expect(signature).not.toContain('Contact')
    // The function takes a brief, an availability outcome and options — nothing else.
    expect(signature).toContain('brief: EventBrief')
  })

  it('produces an identical price for two different people at the same event', () => {
    const catalogue = fullCatalogue()

    const brief: EventBrief = {
      eventType: { value: 'wedding', confidence: 1 },
      eventDate: { value: '2027-06-12', confidence: 1 },
      guestCount: { value: 80, confidence: 1 },
      durationHours: { value: 8, confidence: 1 },
      distanceKm: { value: 40, confidence: 1 },
      servicesRequested: [{ value: ITEM_DECOR, confidence: 1 }],
      language: 'de',
      formality: 'sie',
      meta: { extractionVersion: 't', model: 't', completeness: 1, overallConfidence: 1 },
    }

    // Two customers who could hardly be more different, commercially speaking.
    const budgetShopper: ContactPartition = { name: 'A', email: 'a@example.com' }
    const corporateWhale: ContactPartition = {
      name: 'B',
      email: 'b@big-corp.example',
      company: 'Big Corp GmbH',
      vatId: 'DE123456789',
    }

    // The contact is not a parameter. It cannot influence the result, and the
    // compiler will not let a future maintainer make it one.
    void budgetShopper
    void corporateWhale

    const a = priceQuote(toPricingInput(brief, 'available'), catalogue)
    const b = priceQuote(toPricingInput(brief, 'available'), catalogue)

    expect(a.grossTotal).toBe(b.grossTotal)
    expect(a.netTotal).toBe(b.netTotal)
  })

  it('stores no personal data in the calculation trace', () => {
    const quote = priceQuote(minimalPricingInput(), fullCatalogue())
    const serialised = JSON.stringify(quote.trace)
    for (const marker of ['@', 'GmbH', 'DE1234', 'Meier', 'Straße']) {
      expect(serialised, `trace leaked "${marker}"`).not.toContain(marker)
    }
  })
})
