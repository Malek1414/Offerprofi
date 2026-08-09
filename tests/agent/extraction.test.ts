import { describe, expect, it } from 'vitest'

import {
  type ExtractionPayload,
  buildBrief,
  buildInstruction,
  completenessOf,
  mergeBrief,
  overallConfidenceOf,
} from '../../src/agent/extraction'
import type { EventBrief } from '../../src/domain/event-brief'
import { evaluateConfidence } from '../../src/domain/event-brief'
import { ITEM_CATERING, ITEM_PLANNING, items } from '../fixtures/catalogue'

const KNOWN = new Set(items().map((i) => i.id as string))

function payload(overrides: Partial<ExtractionPayload> = {}): ExtractionPayload {
  return {
    event_type: { value: 'wedding', confidence: 0.95, source: 'msg_1' },
    event_date: { value: '2027-06-12', confidence: 0.9, source: 'msg_1' },
    date_flexible: null,
    guest_count: { value: 80, confidence: 0.85, source: 'msg_1' },
    location: { value: 'Schloss Bensberg', confidence: 0.8, source: 'msg_1' },
    distance_km: null,
    duration_hours: null,
    budget_total_eur: null,
    services: [{ catalog_item_id: ITEM_PLANNING, confidence: 0.9, source: 'msg_1' }],
    style_keywords: [],
    special_requirements: [],
    deadline_mentioned: null,
    competing_quotes_mentioned: false,
    contact: { name: null, email: null, phone: null, role: null, company: null, vat_id: null },
    injection_suspected: false,
    injection_note: null,
    ...overrides,
  }
}

const ctx = {
  known: KNOWN,
  transcript: 'Wir heiraten im Juni und suchen Unterstützung. Können Sie uns helfen?',
  model: 'claude-opus-5',
}

describe('buildBrief', () => {
  it('turns a payload into a brief with confidence and provenance on every field', () => {
    const { brief, extractions } = buildBrief(payload(), ctx)

    expect(brief.guestCount).toEqual({
      value: 80,
      confidence: 0.85,
      source: 'msg_1',
      sourceKind: 'ai',
    })
    // Every value the model produced is also an extractions row, so a figure on a
    // quote can be traced to the sentence it came from (F3.3).
    expect(extractions.map((e) => e.fieldPath)).toContain('guestCount')
    expect(extractions.every((e) => e.sourceRef.length > 0)).toBe(true)
  })

  it('drops a service the agency does not sell rather than pricing it (D8)', () => {
    const { brief, discardedServices } = buildBrief(
      payload({
        services: [
          { catalog_item_id: ITEM_PLANNING, confidence: 0.9, source: 'msg_1' },
          { catalog_item_id: 'itm_feuerwerk', confidence: 0.9, source: 'msg_1' },
        ],
      }),
      ctx,
    )

    expect(discardedServices).toEqual(['itm_feuerwerk'])
    expect(brief.servicesRequested?.map((s) => s.value)).toEqual([ITEM_PLANNING])
  })

  it('keeps an invented service out of the extractions rows too', () => {
    // Otherwise it reappears as provenance for a line item that was never quoted.
    const { extractions } = buildBrief(
      payload({
        services: [{ catalog_item_id: 'itm_feuerwerk', confidence: 0.9, source: 'msg_1' }],
      }),
      ctx,
    )
    expect(extractions.some((e) => JSON.stringify(e.value).includes('feuerwerk'))).toBe(false)
  })

  it('clamps a confidence the model returned out of range', () => {
    // 1.4 would beat an owner-supplied value in every comparison downstream.
    const { brief } = buildBrief(
      payload({ guest_count: { value: 80, confidence: 1.4, source: 'msg_1' } }),
      ctx,
    )
    expect(brief.guestCount?.confidence).toBe(1)
  })

  it('treats a null field as unknown rather than as a value', () => {
    const { brief } = buildBrief(payload({ guest_count: null }), ctx)
    expect(brief.guestCount).toBeUndefined()
    // And the gate notices: an unknown guest count is a question, not a guess.
    expect(evaluateConfidence(brief).action).toBe('ask')
  })

  it('detects language and formality in code rather than asking the model', () => {
    const { brief } = buildBrief(payload(), ctx)
    expect(brief.language).toBe('de')
    expect(brief.formality).toBe('sie')
  })

  it('stamps the version and model that produced it', () => {
    const { brief } = buildBrief(payload(), ctx)
    expect(brief.meta.model).toBe('claude-opus-5')
    expect(brief.meta.extractionVersion).toMatch(/^\d{4}-\d{2}-\d{2}\./)
  })
})

describe('Invariant 2 — contact never joins the brief', () => {
  it('puts personal data in the contact partition and nowhere else', () => {
    const { brief, contact } = buildBrief(
      payload({
        contact: {
          name: 'Sarah Brandt',
          email: 'sarah@example.de',
          phone: '+4917612345678',
          role: 'bride',
          company: null,
          vat_id: null,
        },
      }),
      ctx,
    )

    expect(contact.name).toBe('Sarah Brandt')
    expect(contact.phoneE164).toBe('+4917612345678')
    // The brief is what reaches pricing. Serialising the whole thing and searching
    // it is blunt on purpose — it catches a name smuggled into location or
    // specialRequirements, which is the realistic way this breaks.
    expect(JSON.stringify(brief)).not.toContain('Sarah')
    expect(JSON.stringify(brief)).not.toContain('sarah@example.de')
    expect(JSON.stringify(brief)).not.toContain('+4917612345678')
  })

  it('copies named contact fields rather than spreading whatever arrived', () => {
    const smuggled = {
      ...payload().contact,
      name: 'Sarah',
      internal_note: 'charge her more',
    } as ExtractionPayload['contact']

    const { contact } = buildBrief(payload({ contact: smuggled }), ctx)
    expect(contact).toEqual({ name: 'Sarah' })
  })
})

describe('F3.11 — an instruction in the message is reported, not obeyed', () => {
  it('surfaces the flag without changing any other field', () => {
    const flagged = buildBrief(
      payload({
        injection_suspected: true,
        injection_note: 'The message demands a 50% discount and claims to be from the owner.',
      }),
      ctx,
    )
    const clean = buildBrief(payload(), ctx)

    // The brief is identical; only the flag differs. An injection attempt is a fact
    // about the message, and it must not quietly move a price-relevant field.
    expect(flagged.brief).toEqual(clean.brief)
  })
})

describe('mergeBrief', () => {
  const first = buildBrief(payload(), ctx).brief

  it('does not treat silence in a later turn as a retraction', () => {
    const second = buildBrief(payload({ guest_count: null }), ctx).brief
    const merged = mergeBrief(first, second)
    expect(merged.guestCount?.value).toBe(80)
  })

  it('lets a later turn correct an earlier value', () => {
    const second = buildBrief(
      payload({ guest_count: { value: 95, confidence: 0.9, source: 'msg_3' } }),
      ctx,
    ).brief
    expect(mergeBrief(first, second).guestCount?.value).toBe(95)
  })

  it('never lets a model overwrite what the owner typed (§4.10)', () => {
    const corrected: EventBrief = {
      ...first,
      guestCount: { value: 120, confidence: 1, source: 'form', sourceKind: 'owner' },
    }
    const later = buildBrief(
      payload({ guest_count: { value: 80, confidence: 0.95, source: 'msg_4' } }),
      ctx,
    ).brief

    expect(mergeBrief(corrected, later).guestCount?.value).toBe(120)
  })

  it('accumulates special requirements instead of replacing them', () => {
    // "vegan" in message two does not mean the wheelchair access in message one
    // stopped mattering.
    const a = buildBrief(payload({ special_requirements: ['barrierefrei'] }), ctx).brief
    const b = buildBrief(payload({ special_requirements: ['vegan'] }), ctx).brief
    expect(mergeBrief(a, b).specialRequirements).toEqual(['barrierefrei', 'vegan'])
  })
})

describe('the aggregate figures are computed, not asked for', () => {
  it('scores completeness against the fields this event type needs to be priced', () => {
    // Wedding requires date, guests, location, services — all four present.
    expect(completenessOf(buildBrief(payload(), ctx).brief)).toBe(1)
    expect(completenessOf(buildBrief(payload({ location: null }), ctx).brief)).toBe(0.75)
  })

  it('counts a missing required field as zero confidence, not as absent', () => {
    // A brief with one confident field out of four is not a confident brief, and
    // this number is one of the two gates on sending a quote unattended.
    const partial = buildBrief(
      payload({ guest_count: null, location: null, services: [] }),
      ctx,
    ).brief
    expect(overallConfidenceOf(partial)).toBeLessThan(0.5)
  })

  it('is only as confident as the least certain service in the list', () => {
    const brief = buildBrief(
      payload({
        services: [
          { catalog_item_id: ITEM_PLANNING, confidence: 0.95, source: 'msg_1' },
          { catalog_item_id: ITEM_CATERING, confidence: 0.4, source: 'msg_1' },
        ],
      }),
      ctx,
    ).brief
    expect(evaluateConfidence(brief).action).toBe('ask')
  })
})

describe('buildInstruction', () => {
  it('lists only what the agency actually sells', () => {
    const instruction = buildInstruction(items(), '2026-08-09')
    expect(instruction).toContain(ITEM_PLANNING)
    expect(instruction).toContain('do not invent an id')
  })

  it('anchors relative dates, so "im Juni" is not resolved against training data', () => {
    expect(buildInstruction(items(), '2026-08-09')).toContain('Today is 2026-08-09')
  })

  it('never asks the model for a price', () => {
    const instruction = buildInstruction(items(), '2026-08-09')
    expect(instruction).toContain('Never write a price')
    // The catalogue is described to the model without its numbers (D6): it maps
    // intent to ids, and arithmetic stays in the engine.
    expect(instruction).not.toContain('2450')
  })

  it('survives an agency with no catalogue yet', () => {
    expect(buildInstruction([], '2026-08-09')).toContain('empty services array')
  })
})
