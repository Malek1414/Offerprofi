/**
 * THE PRICE-LEAK TEST.
 *
 * This file is the new spec's equivalent of the I2 test: one assertion standing in
 * for a rule that is otherwise a convention, guarding the single regression that
 * would embarrass the product in front of a customer.
 *
 * The rule: **the customer's copy of a request contains no money and no contact
 * details.** Under the pivot the caterer is the first party to attach a price to
 * anything, and the request document is what she gets *before* he has. A figure
 * appearing here — her budget echoed back, a suggested total, a margin — reads to
 * her as a price, and one she may have been quoted.
 *
 * It is written as a grep over rendered HTML rather than a props check on purpose.
 * Phase B2 adds a price block to this component for the owner's audience, and the
 * realistic way it breaks is a conditional that renders for both. A test that asks
 * "what did you pass in" would not notice; one that reads the page will.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { RequestDocument } from '../../src/app/r/[token]/request-document'
import type { CateringRequest } from '../../src/domain/catering-request'
import type { ContactPartition } from '../../src/domain/extracted'
import { buildAgencyTheme } from '../../src/lib/theme'
import type { RequestAgency } from '../../src/requests/repository'
import { requestRows } from '../../src/requests/summary'
import type { RequestAudience } from '../../src/requests/links'

const AGENCY: RequestAgency = {
  name: 'Kraut & Rüben Catering',
  ownerName: 'Johannes',
  brandColor: '#2F6F4F',
  privacyNoticeUrl: '/datenschutz',
  imprintUrl: '/impressum',
  language: 'de',
}

const CONTACT: ContactPartition = {
  name: 'Sarah Müller',
  email: 'sarah.mueller@example.de',
  phoneE164: '+4915112345678',
  company: 'Müller & Partner GmbH',
}

function request(overrides: Partial<CateringRequest> = {}): CateringRequest {
  return {
    occasion: { value: 'wedding', confidence: 0.9, source: 'm1', sourceKind: 'ai' },
    eventDate: { value: '2027-06-12', confidence: 0.9, source: 'm1', sourceKind: 'ai' },
    headcount: { value: 80, confidence: 0.6, source: 'm1', sourceKind: 'ai' },
    venue: { value: 'Schloss Bensberg', confidence: 0.9, source: 'm1', sourceKind: 'ai' },
    serviceStyle: { value: 'buffet', confidence: 0.9, source: 'm1', sourceKind: 'ai' },
    mealType: { value: 'dinner', confidence: 0.9, source: 'm1', sourceKind: 'ai' },
    dietary: ['6 vegan', '2 glutenfrei'],
    requestedItems: ['Paella-Station'],
    budgetIndication: {
      value: { amount: 6000, currency: 'EUR', basis: 'total' },
      confidence: 0.8,
      source: 'm2',
      sourceKind: 'ai',
    },
    language: 'de',
    formality: 'sie',
    meta: { extractionVersion: 't', model: 't', completeness: 1, overallConfidence: 0.85 },
    ...overrides,
  }
}

function render(audience: RequestAudience, overrides: Partial<CateringRequest> = {}): string {
  const req = request(overrides)
  return renderToStaticMarkup(
    <RequestDocument
      audience={audience}
      agency={AGENCY}
      theme={buildAgencyTheme(AGENCY.brandColor)}
      rows={requestRows(req, audience, 'de')}
      // What the route passes: the row itself has nulls for her token.
      contact={audience === 'owner' ? CONTACT : null}
      sentAt="2026-08-09T15:00:00.000Z"
      language="de"
    />,
  )
}

describe('the customer’s copy', () => {
  const html = render('customer')

  it('contains no currency symbol and no amount', () => {
    expect(html).not.toMatch(/€|EUR|\bEuro\b/i)
    // Her budget is the only monetary value that exists at this stage, and it is
    // information for him. 6000 must not appear in any form.
    expect(html).not.toMatch(/6[.,]?000/)
  })

  it('contains no word that only a priced document has', () => {
    // "Preis" is deliberately *not* on this list: the disclaimer says there are no
    // prices here, and it has to be allowed to say so. These words have no
    // innocent reading on a request — every one of them belongs to an invoice.
    expect(html.toLowerCase()).not.toMatch(
      /marge|zwischensumme|gesamtsumme|netto|brutto|mwst|umsatzsteuer|rabatt|anzahlung/,
    )
  })

  it('says plainly that there are no prices here and nothing is binding', () => {
    // The absence of a figure is not self-explanatory. A customer who sees a
    // summary with no price wonders whether one is being withheld.
    expect(html).toContain('keine Preise')
    expect(html).toMatch(/kein Angebot|nicht verbindlich|Verbindlich wird nichts/)
  })

  it('discloses that an assistant wrote it (Art. 50)', () => {
    expect(html).toContain('KI-Assistenten')
    expect(html).toContain('Johannes')
  })

  it('still contains the request itself', () => {
    expect(html).toContain('Schloss Bensberg')
    expect(html).toContain('Buffet')
    expect(html).toContain('12. Juni 2027')
    expect(html).toContain('Paella-Station')
  })

  it('carries no contact details, even though they are hers', () => {
    // Not a privacy rule so much as a forwarding one: this link is the thing she
    // pastes to a partner, and it should be about the event.
    expect(html).not.toContain('Sarah')
    expect(html).not.toContain('example.de')
    expect(html).not.toContain('4915112345678')
  })

  it('shows no confidence marks', () => {
    // Headcount is at 0.6 above. He should double-check it; telling her we are
    // unsure about her own sentence teaches her nothing and costs trust.
    expect(html).not.toContain('prüfen')
  })
})

describe('the owner’s copy', () => {
  const html = render('owner')

  it('has how to reach her', () => {
    expect(html).toContain('Sarah Müller')
    expect(html).toContain('sarah.mueller@example.de')
    expect(html).toContain('Müller &amp; Partner GmbH')
  })

  it('has the budget she mentioned, marked as hers', () => {
    expect(html).toContain('6.000')
    expect(html).toContain('EUR')
    expect(html).toContain('ihre Angabe')
  })

  it('marks the field we are least sure about', () => {
    expect(html).toContain('prüfen')
  })

  it('tells him to answer in plain language', () => {
    expect(html).toMatch(/normaler Sprache/)
  })

  it('tells him he is free — nothing was quoted to her', () => {
    // The customer-facing sentence is addressed to "Ihnen" and would be talking to
    // the wrong person here. What he needs from the same fact is the other half:
    // no number has been said out loud, so he is not negotiating against one.
    expect(html).toContain('kein Preis genannt')
    expect(html).not.toContain('Verbindlich wird nichts, bevor')
  })
})

describe('self-contained, both copies', () => {
  for (const audience of ['customer', 'owner'] as const) {
    it(`fetches nothing from anywhere — ${audience}`, () => {
      const html = render(audience)
      // F1.12 and TDDDG §25: no third-party origin on a customer surface, which is
      // what keeps this product free of a consent banner. Also what makes the page
      // printable to a single-file PDF.
      expect(html).not.toMatch(/https?:\/\//)
      expect(html).not.toMatch(/<script(?![^>]*application\/ld\+json)/)
      expect(html).not.toContain('<img')
      expect(html).not.toContain('<link')
    })
  }
})
