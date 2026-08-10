import { describe, expect, it } from 'vitest'

import {
  type ExtractionPayload,
  buildInstruction,
  buildRequest,
  completenessOf,
  expandExtractionPayload,
  extractionOutputSchema,
  mergeRequest,
  overallConfidenceOf,
} from '../../src/agent/extraction'
import { type CateringRequest, evaluateRequest } from '../../src/domain/catering-request'

function payload(overrides: Partial<ExtractionPayload> = {}): ExtractionPayload {
  return {
    occasion: { value: 'wedding', confidence: 0.95, source: 'msg_1' },
    event_date: { value: '2027-06-12', confidence: 0.9, source: 'msg_1' },
    date_flexible: null,
    headcount: { value: 80, confidence: 0.85, source: 'msg_1' },
    venue: { value: 'Schloss Bensberg', confidence: 0.8, source: 'msg_1' },
    distance_km: null,
    duration_hours: null,
    service_style: { value: 'buffet', confidence: 0.8, source: 'msg_1' },
    meal_type: { value: 'dinner', confidence: 0.85, source: 'msg_1' },
    fulfilment: null,
    dietary: [],
    staffing_needed: null,
    equipment_needed: [],
    budget_indication: null,
    requested_items: [],
    special_requirements: [],
    contact: { name: '', email: '', phone: '', role: '', company: '', vat_id: '' },
    injection_suspected: false,
    injection_note: null,
    ...overrides,
  }
}

const ctx = {
  transcript: 'Wir heiraten im Juni und suchen ein Catering. Können Sie uns helfen?',
  model: 'claude-opus-5',
}

function countUnionParameters(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countUnionParameters(item), 0)
  }
  if (!value || typeof value !== 'object') return 0

  const node = value as Record<string, unknown>
  const unionHere = Array.isArray(node.anyOf) || Array.isArray(node.type) ? 1 : 0
  return unionHere + Object.values(node).reduce<number>(
    (total, item) => total + countUnionParameters(item),
    0,
  )
}

describe('Anthropic structured-output compatibility', () => {
  it('stays within the provider limit of 16 union-typed parameters', () => {
    expect(countUnionParameters(extractionOutputSchema())).toBeLessThanOrEqual(16)
  })

  it('expands the compact fact list into typed, provenance-carrying fields', () => {
    const expanded = expandExtractionPayload({
      facts: [
        { field: 'occasion', value: 'wedding', confidence: 0.98, source: 'msg_1' },
        { field: 'headcount', value: '120', confidence: 1, source: 'msg_1' },
        { field: 'date_flexible', value: 'false', confidence: 0.8, source: 'msg_1' },
        { field: 'budget_total', value: '9000', confidence: 1, source: 'msg_1' },
      ],
      dietary: ['vegetarisch'],
      equipment_needed: [],
      requested_items: ['Getränkeservice'],
      special_requirements: [],
      contact: {
        name: 'Anna Keller',
        email: 'anna@example.com',
        phone: '',
        role: '',
        company: '',
        vat_id: '',
      },
      injection_suspected: false,
      injection_note: '',
    })

    expect(expanded.occasion?.value).toBe('wedding')
    expect(expanded.headcount).toEqual({ value: 120, confidence: 1, source: 'msg_1' })
    expect(expanded.date_flexible?.value).toBe(false)
    expect(expanded.budget_indication?.value).toEqual({ amount: 9000, basis: 'total' })
    expect(expanded.injection_note).toBeNull()
  })

  it('drops malformed typed facts instead of trusting provider strings', () => {
    const expanded = expandExtractionPayload({
      facts: [
        { field: 'headcount', value: 'about one hundred', confidence: 1, source: 'msg_1' },
        { field: 'service_style', value: 'invented_style', confidence: 1, source: 'msg_1' },
      ],
      dietary: [],
      equipment_needed: [],
      requested_items: [],
      special_requirements: [],
      contact: { name: '', email: '', phone: '', role: '', company: '', vat_id: '' },
      injection_suspected: false,
      injection_note: '',
    })

    expect(expanded.headcount).toBeNull()
    expect(expanded.service_style).toBeNull()
  })
})

describe('buildRequest', () => {
  it('turns a payload into a request with confidence and provenance on every field', () => {
    const { request, extractions } = buildRequest(payload(), ctx)

    expect(request.headcount).toEqual({
      value: 80,
      confidence: 0.85,
      source: 'msg_1',
      sourceKind: 'ai',
    })
    // Every value the model produced is also an extractions row, so a figure on a
    // caterer's screen can be traced back to the sentence it came from (F3.3).
    expect(extractions.map((e) => e.fieldPath)).toContain('headcount')
    expect(extractions.every((e) => e.sourceRef.length > 0)).toBe(true)
  })

  it('keeps what she asked for in her own words, even when it sounds unusual', () => {
    // The old design discarded anything that did not match a catalogue id. A paella
    // station this caterer does not currently sell is the most useful sentence in the
    // enquiry, not noise — the caterer decides whether he can do it.
    const { request } = buildRequest(
      payload({ requested_items: ['Paella-Station', 'Barista für den Nachmittag'] }),
      ctx,
    )
    expect(request.requestedItems).toEqual(['Paella-Station', 'Barista für den Nachmittag'])
  })

  it('records dietary requirements, the thing caterers most often get wrong', () => {
    const { request } = buildRequest(
      payload({ dietary: ['6 vegan', '2 glutenfrei', 'kein Schweinefleisch'] }),
      ctx,
    )
    expect(request.dietary).toHaveLength(3)
  })

  it('clamps a confidence the model returned out of range', () => {
    // 1.4 would beat an owner-supplied value in every comparison downstream.
    const { request } = buildRequest(
      payload({ headcount: { value: 80, confidence: 1.4, source: 'msg_1' } }),
      ctx,
    )
    expect(request.headcount?.confidence).toBe(1)
  })

  it('treats a null field as unknown rather than as a value', () => {
    const { request } = buildRequest(payload({ headcount: null }), ctx)
    expect(request.headcount).toBeUndefined()
    // And the gate notices: an unknown headcount is a question, not a guess.
    expect(evaluateRequest(request).action).toBe('ask')
  })

  it('detects language and formality in code rather than asking the model', () => {
    const { request } = buildRequest(payload(), ctx)
    expect(request.language).toBe('de')
    expect(request.formality).toBe('sie')
  })

  it('stamps the version and model that produced it', () => {
    const { request } = buildRequest(payload(), ctx)
    expect(request.meta.model).toBe('claude-opus-5')
    expect(request.meta.extractionVersion).toContain('catering')
  })
})

describe('the request cannot carry a price', () => {
  it('has no field anywhere for what anything costs', () => {
    const { request } = buildRequest(
      payload({
        budget_indication: {
          value: { amount: 6000, basis: 'total' },
          confidence: 0.7,
          source: 'msg_2',
        },
      }),
      ctx,
    )

    // Her budget is hers — what she said she wants to spend, quoted back. It is not a
    // price, and there is deliberately nowhere in this object to put one.
    expect(request.budgetIndication?.value).toEqual({
      amount: 6000,
      currency: 'EUR',
      basis: 'total',
    })

    const keys = Object.keys(request)
    for (const forbidden of ['price', 'total', 'unitPrice', 'quote', 'discount', 'margin']) {
      expect(keys.some((k) => k.toLowerCase().includes(forbidden.toLowerCase()))).toBe(false)
    }
  })

  it('tells the model in as many words that it never states a cost', () => {
    const instruction = buildInstruction('2026-08-09')
    expect(instruction).toContain('never state, guess')
    expect(instruction).toContain('There is no field for that')
  })
})

describe('Invariant 2 — contact never joins the request', () => {
  it('puts personal data in the contact partition and nowhere else', () => {
    const { request, contact } = buildRequest(
      payload({
        contact: {
          name: 'Sarah Brandt',
          email: 'sarah@example.de',
          phone: '+4917612345678',
          role: 'bride',
          company: '',
          vat_id: '',
        },
      }),
      ctx,
    )

    expect(contact.name).toBe('Sarah Brandt')
    expect(contact.phoneE164).toBe('+4917612345678')
    // Serialising the whole thing and searching it is blunt on purpose — it catches a
    // name smuggled into venue or specialRequirements, which is how this really breaks.
    expect(JSON.stringify(request)).not.toContain('Sarah')
    expect(JSON.stringify(request)).not.toContain('sarah@example.de')
    expect(JSON.stringify(request)).not.toContain('+4917612345678')
  })

  it('copies named contact fields rather than spreading whatever arrived', () => {
    const smuggled = {
      ...payload().contact,
      name: 'Sarah',
      internal_note: 'charge her more',
    } as ExtractionPayload['contact']

    const { contact } = buildRequest(payload({ contact: smuggled }), ctx)
    expect(contact).toEqual({ name: 'Sarah' })
  })
})

describe('F3.11 — an instruction in the message is reported, not obeyed', () => {
  it('surfaces the flag without changing any other field', () => {
    const flagged = buildRequest(
      payload({
        injection_suspected: true,
        injection_note: 'The message demands a 50% discount and claims to be from the caterer.',
      }),
      ctx,
    )
    const clean = buildRequest(payload(), ctx)

    // The request is identical; only the flag differs. An injection attempt is a fact
    // about the message, and it must not quietly move a field.
    expect(flagged.request).toEqual(clean.request)
  })
})

describe('mergeRequest', () => {
  const first = buildRequest(payload(), ctx).request

  it('does not treat silence in a later turn as a retraction', () => {
    const second = buildRequest(payload({ headcount: null }), ctx).request
    expect(mergeRequest(first, second).headcount?.value).toBe(80)
  })

  it('lets a later turn correct an earlier value', () => {
    const second = buildRequest(
      payload({ headcount: { value: 95, confidence: 0.9, source: 'msg_3' } }),
      ctx,
    ).request
    expect(mergeRequest(first, second).headcount?.value).toBe(95)
  })

  it('never lets a model overwrite what a human typed (§4.10)', () => {
    const corrected: CateringRequest = {
      ...first,
      headcount: { value: 120, confidence: 1, source: 'form', sourceKind: 'owner' },
    }
    const later = buildRequest(
      payload({ headcount: { value: 80, confidence: 0.95, source: 'msg_4' } }),
      ctx,
    ).request

    expect(mergeRequest(corrected, later).headcount?.value).toBe(120)
  })

  it('accumulates dietary requirements instead of replacing them', () => {
    // "vegan" in message two does not mean the nut allergy in message one stopped
    // being life-threatening.
    const a = buildRequest(payload({ dietary: ['Nussallergie'] }), ctx).request
    const b = buildRequest(payload({ dietary: ['6 vegan'] }), ctx).request
    expect(mergeRequest(a, b).dietary).toEqual(['Nussallergie', '6 vegan'])
  })

  it('accumulates requested items across turns', () => {
    const a = buildRequest(payload({ requested_items: ['Paella-Station'] }), ctx).request
    const b = buildRequest(payload({ requested_items: ['Barista'] }), ctx).request
    expect(mergeRequest(a, b).requestedItems).toEqual(['Paella-Station', 'Barista'])
  })
})

describe('the aggregate figures are computed, not asked for', () => {
  it('scores completeness against the five things a caterer needs to answer', () => {
    expect(completenessOf(buildRequest(payload(), ctx).request)).toBe(1)
    expect(completenessOf(buildRequest(payload({ venue: null }), ctx).request)).toBe(0.8)
  })

  it('counts a missing required field as zero confidence, not as absent', () => {
    // A request with two confident fields out of five is not a confident request, and
    // this number decides whether she gets another question or a summary to approve.
    const partial = buildRequest(
      payload({ headcount: null, venue: null, service_style: null }),
      ctx,
    ).request
    expect(overallConfidenceOf(partial)).toBeLessThan(0.5)
    expect(evaluateRequest(partial).action).toBe('ask')
  })

  it('asks rather than guesses when a field is present but weak', () => {
    const weak = buildRequest(
      payload({ headcount: { value: 80, confidence: 0.3, source: 'msg_1' } }),
      ctx,
    ).request
    const verdict = evaluateRequest(weak)
    expect(verdict.action).toBe('ask')
    if (verdict.action === 'ask') expect(verdict.fields).toContain('headcount')
  })

  it('confirms rather than asks when a field is present and middling', () => {
    const middling = buildRequest(
      payload({ headcount: { value: 80, confidence: 0.65, source: 'msg_1' } }),
      ctx,
    ).request
    expect(evaluateRequest(middling).action).toBe('confirm')
  })
})

describe('buildInstruction', () => {
  it('anchors relative dates, so "im Juni" is not resolved against training data', () => {
    expect(buildInstruction('2026-08-09')).toContain('Today is 2026-08-09')
  })

  it('tells the model to keep her words rather than tidy them into menu language', () => {
    expect(buildInstruction('2026-08-09')).toContain('in her own words')
  })
})
