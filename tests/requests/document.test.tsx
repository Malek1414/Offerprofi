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
import { eurosToCents } from '../../src/domain/money'
import { costTable, summariseMargin } from '../../src/engine/margin'
import { priceQuote } from '../../src/engine/pricing'
import { buildAgencyTheme } from '../../src/lib/theme'
import type { RequestAgency } from '../../src/requests/repository'
import type { SuggestionOutcome } from '../../src/requests/suggestion'
import { requestRows } from '../../src/requests/summary'
import type { RequestAudience } from '../../src/requests/links'
import { ITEM_CATERING, ITEM_PLANNING, fullCatalogue, minimalPricingInput } from '../fixtures/catalogue'

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

/**
 * What a person can actually read on the page.
 *
 * The document carries its stylesheet inline, and CSS is full of things that look
 * like amounts — `0.9375rem`, `1.25rem`. A leak test that trips over a border
 * radius gets loosened until it stops catching anything. Markup and styles out,
 * text in.
 */
function visibleText(html: string): string {
  return html
    .replace(/<style>[\s\S]*?<\/style>/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
}

/**
 * A real priced suggestion, from the real engine and the real margin wrapper.
 *
 * Deliberately not a stub. The point of the leak test is that a *populated* price
 * block never reaches her page, and an empty stub would pass while proving nothing.
 */
function suggestion(): SuggestionOutcome {
  const quote = priceQuote(
    { ...minimalPricingInput(), serviceIds: [ITEM_PLANNING, ITEM_CATERING] },
    fullCatalogue(),
  )
  return {
    ok: true,
    suggestion: {
      quote,
      margin: summariseMargin(
        quote,
        costTable([
          { id: ITEM_PLANNING, costCents: Number(eurosToCents(820)) },
          { id: ITEM_CATERING, costCents: Number(eurosToCents(31.4)) },
        ]),
      ),
      rationale: 'Menü und Planung passen; Personal ist im Buffetpreis enthalten.',
      unmatched: ['Paella-Station'],
    },
  }
}

function render(
  audience: RequestAudience,
  overrides: Partial<CateringRequest> = {},
  /**
   * What the *route* would pass. The customer branch never computes a suggestion,
   * so the honest default is null — and the leak test below overrides it anyway,
   * because "we remembered not to pass it" is the weaker guarantee.
   */
  withSuggestion: SuggestionOutcome | null = audience === 'owner' ? suggestion() : null,
): string {
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
      suggestion={withSuggestion}
    />,
  )
}

describe('the customer’s copy', () => {
  const html = render('customer')

  it('contains no currency symbol and no amount', () => {
    const text = visibleText(html)
    expect(text).not.toMatch(/€|EUR|\bEuro\b/i)
    // Her budget is the only monetary value that exists at this stage, and it is
    // information for him. 6000 must not appear in any form.
    expect(text).not.toMatch(/6[.,]?000/)
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

  it('renders no price block even when one is handed to it', () => {
    // THE PHASE B2 REGRESSION, IN ONE TEST.
    //
    // The realistic way the price block leaks is a conditional that renders for
    // both audiences — a `props.suggestion ? …` without the `owner &&`. So this
    // forces a fully priced suggestion into the customer's props and asserts the
    // page still has no money on it. The route does not pass one; this proves the
    // component would not use it if a future edit did.
    const text = visibleText(render('customer', {}, suggestion()))

    expect(text).not.toMatch(/€|EUR|\bEuro\b/i)
    // Any figure with cents on it. The engine renders money and nothing else this way.
    expect(text).not.toMatch(/\d[.,]\d{2}\b/)
    expect(text).not.toContain('Vorschlag')
    expect(text).not.toContain('Ihr Anteil')
    expect(text).not.toContain('Hochzeitsplanung')
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

  it('shows the suggested price, the lines and what he keeps', () => {
    expect(html).toContain('Vorschlag')
    expect(html).toContain('Ihr Anteil')
    expect(html).toContain('Hochzeitsplanung Komplett')
    // Framed as advice he overrules, not as a figure already committed.
    expect(html).toMatch(/würde ich/)
    expect(html).toContain('Die Kundin sieht davon nichts')
  })

  it('names the services with no cost recorded rather than flattering the margin', () => {
    // Décor has no cost in the fixture. An omission absorbed silently would report
    // it as pure profit, on the screen where he decides whether to take the job.
    const quote = priceQuote(
      { ...minimalPricingInput(), serviceIds: [ITEM_PLANNING, ITEM_CATERING] },
      fullCatalogue(),
    )
    const partial: SuggestionOutcome = {
      ok: true,
      suggestion: {
        quote,
        margin: summariseMargin(
          quote,
          costTable([{ id: ITEM_PLANNING, costCents: Number(eurosToCents(820)) }]),
        ),
        rationale: '',
        unmatched: [],
      },
    }
    const partialHtml = render('owner', {}, partial)
    expect(partialHtml).toContain('Ohne hinterlegte Kosten')
    expect(partialHtml).toContain('Kosten fehlen')
  })

  it('says why there is no suggestion instead of showing an error', () => {
    const empty = render('owner', {}, { ok: false, reason: 'no_catalogue' })
    expect(empty).toContain('Leistungsliste')
    expect(empty.toLowerCase()).not.toContain('error')
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
