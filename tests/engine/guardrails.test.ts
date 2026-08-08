/**
 * Guardrail evaluator tests (FEATURE_INVENTORY X2, F4.13).
 *
 * The evaluator runs on generated output, so these tests feed it the kind of text a
 * model actually produces when it has been talked into something — not the kind a
 * developer writes when imagining misbehaviour.
 */

import { describe, expect, it } from 'vitest'

import { defaultGuardrails } from '../../src/guardrails/config'
import { evaluateOutbound, holdingMessage, type OutboundContext } from '../../src/guardrails/evaluator'
import { eurosToCents } from '../../src/domain/money'
import { priceQuote } from '../../src/engine/pricing'
import { ITEM_DECOR, minimalCatalogue, minimalPricingInput } from '../fixtures/catalogue'

const quote = () =>
  priceQuote(minimalPricingInput({ serviceIds: [ITEM_DECOR] }), minimalCatalogue())

const ctx = (over: Partial<OutboundContext> = {}): OutboundContext => ({
  guardrails: defaultGuardrails('a1'),
  quote: quote(),
  negotiationRound: 1,
  contactOptedOutAt: null,
  availabilityCommitted: false,
  injectionSuspected: false,
  customerAssertedPrices: [],
  ...over,
})

describe('guardrails', () => {
  it('sends a clean quote', () => {
    expect(evaluateOutbound(ctx()).action).toBe('send')
  })

  it('blocks a discount offered in German', () => {
    const out = evaluateOutbound(
      ctx({ messageText: 'Gerne gebe ich Ihnen 10% Rabatt auf die Dekoration.' }),
    )
    expect(out.action).toBe('escalate')
    if (out.action === 'escalate') expect(out.reason).toBe('discount_offered')
  })

  it('blocks a discount offered in English', () => {
    const out = evaluateOutbound(ctx({ messageText: 'I can offer you a special price on this.' }))
    expect(out.action).toBe('escalate')
  })

  it('blocks a price the engine never produced', () => {
    // The quote is €1,180 net. The model has invented €950 out of helpfulness.
    const out = evaluateOutbound(
      ctx({ messageText: 'Die Dekoration kostet 950,00 € — ein guter Preis.' }),
    )
    expect(out.action).toBe('escalate')
    if (out.action === 'escalate') expect(out.reason).toBe('price_not_from_catalogue')
  })

  it('allows a price that came from the engine, in German formatting', () => {
    const q = quote()
    const gross = (q.grossTotal / 100).toFixed(2).replace('.', ',')
    const out = evaluateOutbound(
      ctx({ quote: q, messageText: `Das Gesamtpaket liegt bei ${gross} € inkl. MwSt.` }),
    )
    expect(out.action).toBe('send')
  })

  it('ignores small numbers that are guest counts, not prices', () => {
    const out = evaluateOutbound(ctx({ messageText: 'Für 80 Gäste und 8 Stunden — passt das?' }))
    expect(out.action).toBe('send')
  })

  it('escalates above the auto-send ceiling', () => {
    const out = evaluateOutbound(
      ctx({ guardrails: { ...defaultGuardrails('a1'), maxAutoQuoteValue: eurosToCents(500) } }),
    )
    expect(out.action).toBe('escalate')
    if (out.action === 'escalate') expect(out.reason).toBe('above_max_auto_quote_value')
  })

  it('blocks everything after an opt-out, before any other check', () => {
    const out = evaluateOutbound(
      ctx({ contactOptedOutAt: '2026-08-01T00:00:00Z', messageText: 'Ein kurzes Update...' }),
    )
    expect(out.action).toBe('escalate')
    if (out.action === 'escalate') expect(out.reason).toBe('sent_after_opt_out')
  })

  it('escalates on suspected prompt injection without complying', () => {
    const out = evaluateOutbound(ctx({ injectionSuspected: true }))
    expect(out.action).toBe('escalate')
    if (out.action === 'escalate') expect(out.reason).toBe('injection_suspected')
  })

  it('escalates when the negotiation has run too long', () => {
    const out = evaluateOutbound(ctx({ negotiationRound: 5 }))
    expect(out.action).toBe('escalate')
    if (out.action === 'escalate') expect(out.reason).toBe('negotiation_rounds_exceeded')
  })

  it('escalates when a total lands exactly on a price the customer named', () => {
    const q = quote()
    const out = evaluateOutbound(ctx({ quote: q, customerAssertedPrices: [q.grossTotal] }))
    expect(out.action).toBe('escalate')
    if (out.action === 'escalate') expect(out.reason).toBe('accepted_customer_price_framing')
  })

  it('escalates rather than committing to a conflicted date', () => {
    const q = priceQuote(
      minimalPricingInput({ serviceIds: [ITEM_DECOR], availability: 'hard_conflict' }),
      minimalCatalogue(),
    )
    expect(evaluateOutbound(ctx({ quote: q, availabilityCommitted: true })).action).toBe('escalate')
    // Not committing to the date is fine — the agent may still discuss it.
    expect(evaluateOutbound(ctx({ quote: q, availabilityCommitted: false })).action).toBe('send')
  })

  it('holds everything when auto-send is switched off', () => {
    const out = evaluateOutbound(
      ctx({ guardrails: { ...defaultGuardrails('a1'), autoSendEnabled: false } }),
    )
    expect(out.action).toBe('escalate')
    if (out.action === 'escalate') expect(out.reason).toBe('auto_send_disabled')
  })

  it('records a check row for every rule it evaluated', () => {
    const out = evaluateOutbound(ctx())
    expect(out.checks.length).toBeGreaterThan(5)
    expect(out.checks.every((c) => typeof c.passed === 'boolean')).toBe(true)
  })

  it('never tells the customer a rule was hit', () => {
    for (const [language, formality] of [
      ['de', 'sie'],
      ['de', 'du'],
      ['en', 'unknown'],
    ] as const) {
      const message = holdingMessage('Lisa', language, formality)
      for (const leak of ['Regel', 'rule', 'Limit', 'Guardrail', 'Rabatt', 'discount', 'Fehler', 'error']) {
        expect(message, `holding message leaked "${leak}"`).not.toContain(leak)
      }
      expect(message).toContain('Lisa')
    }
    expect(holdingMessage('Lisa', 'de', 'du')).toContain('du hörst')
    expect(holdingMessage('Lisa', 'de', 'sie')).toContain('Sie hören')
  })
})

describe('modifier reasons are localised, never emitted by the engine', () => {
  it('renders German and English for every reason code', async () => {
    const { modifierReason } = await import('../../src/i18n/modifier-reasons')
    const cases = [
      ['weekend', { date: '2027-06-12' }],
      ['peak_season', { date: '2027-06-12' }],
      ['rush', { days: 14 }],
      ['travel_distance', { km: 60, threshold: 30 }],
      ['overtime', { hours: 10, included: 8 }],
    ] as const

    for (const [code, params] of cases) {
      const de = modifierReason(code, params, 'de')
      const en = modifierReason(code, params, 'en')
      expect(de.length).toBeGreaterThan(5)
      expect(en.length).toBeGreaterThan(5)
      expect(de).not.toBe(en)
      // No raw ISO dates leaking onto a customer-facing document.
      expect(de).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    }
  })

  it('writes German dates as a German reader expects', () => {
    // 12. Juni 2027, not 2027-06-12 and not June 12.
    return import('../../src/i18n/modifier-reasons').then(({ modifierReason }) => {
      expect(modifierReason('peak_season', { date: '2027-06-12' }, 'de')).toContain('12. Juni 2027')
    })
  })
})
