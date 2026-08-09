import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  MAX_QUESTIONS_PER_TURN,
  askableFields,
  buildInstruction,
  buildRole,
  missingRequired,
  renderState,
  selectQuestions,
} from '../../src/agent/qualify'
import type { CateringRequest } from '../../src/domain/catering-request'

function request(overrides: Partial<CateringRequest> = {}): CateringRequest {
  return {
    eventDate: { value: '2027-06-12', confidence: 0.9, source: 'msg_1', sourceKind: 'ai' },
    headcount: { value: 80, confidence: 0.9, source: 'msg_1', sourceKind: 'ai' },
    venue: { value: 'Schloss Bensberg', confidence: 0.9, source: 'msg_1', sourceKind: 'ai' },
    serviceStyle: { value: 'buffet', confidence: 0.9, source: 'msg_1', sourceKind: 'ai' },
    mealType: { value: 'dinner', confidence: 0.9, source: 'msg_1', sourceKind: 'ai' },
    language: 'de',
    formality: 'sie',
    meta: {
      extractionVersion: 't',
      model: 't',
      completeness: 1,
      overallConfidence: 0.9,
    },
    ...overrides,
  }
}

describe('when to stop asking — decided in code, never by the model', () => {
  it('is ready when the five required fields are there and confident', () => {
    expect(missingRequired(request())).toEqual([])
  })

  it('is not ready when a required field is missing', () => {
    expect(missingRequired(request({ headcount: undefined }))).toContain('headcount')
  })

  it('is not ready when a required field is present but weakly held', () => {
    // Present-but-uncertain and missing are the same situation: we do not know.
    // Guessing at a headcount produces a quote for the wrong wedding.
    const weak = request({
      headcount: { value: 80, confidence: 0.3, source: 'msg_1', sourceKind: 'ai' },
    })
    expect(missingRequired(weak)).toContain('headcount')
  })

  it('gives the same answer for the same state every time', () => {
    // The property a model could not offer, and the reason this is not a model call.
    const r = request({ venue: undefined })
    const answers = Array.from({ length: 5 }, () => missingRequired(r).join(','))
    expect(new Set(answers).size).toBe(1)
  })
})

describe('askableFields', () => {
  it('puts missing required fields ahead of nice-to-haves', () => {
    const fields = askableFields(request({ headcount: undefined }))
    expect(fields[0]).toBe('headcount')
  })

  it('still has something worth asking once the required five are in', () => {
    // A complete request is not the end of the conversation — dietary needs and
    // fulfilment change the answer the caterer gives, they just do not block it.
    const fields = askableFields(request())
    expect(fields).toContain('dietary')
    expect(fields).not.toContain('headcount')
  })

  it('stops offering a field once she has answered it', () => {
    expect(askableFields(request({ dietary: ['6 vegan'] }))).not.toContain('dietary')
  })
})

describe('selectQuestions', () => {
  const askable = askableFields(request({ headcount: undefined, venue: undefined }))

  it('caps the number of questions per turn', () => {
    // Three reads as an interrogation and she stops answering.
    const proposed = [
      { field: 'headcount', text: 'Für wie viele Personen?' },
      { field: 'venue', text: 'Wo findet es statt?' },
      { field: 'dietary', text: 'Gibt es Unverträglichkeiten?' },
    ]
    expect(selectQuestions(proposed, askable)).toHaveLength(MAX_QUESTIONS_PER_TURN)
  })

  it('drops a question about something she already told us', () => {
    // Asking twice reads as not listening, which is the fastest way to lose the
    // conversation this product exists to keep.
    const proposed = [
      { field: 'eventDate', text: 'Wann ist die Feier?' },
      { field: 'headcount', text: 'Für wie viele Personen?' },
    ]
    const kept = selectQuestions(proposed, askable)
    expect(kept.map((q) => q.field)).toEqual(['headcount'])
  })

  it('drops a duplicate field', () => {
    const proposed = [
      { field: 'headcount', text: 'Wie viele Gäste?' },
      { field: 'headcount', text: 'Und wie viele Personen genau?' },
    ]
    expect(selectQuestions(proposed, askable)).toHaveLength(1)
  })

  it('drops an invented field name', () => {
    const proposed = [{ field: 'preferred_wine_region', text: 'Welche Weinregion?' }]
    expect(selectQuestions(proposed, askable)).toEqual([])
  })

  it('drops an empty question', () => {
    expect(selectQuestions([{ field: 'headcount', text: '   ' }], askable)).toEqual([])
  })
})

describe('renderState', () => {
  it('renders typed values, so nothing a customer types lands in our own text', () => {
    // The free-text venue is reported as present, not quoted. Her words stay inside
    // the untrusted blocks where the delimiter escaping protects them.
    const rendered = renderState(request())
    expect(rendered).toContain('venue given: yes')
    expect(rendered).not.toContain('Schloss Bensberg')
  })

  it('says so plainly when there is nothing yet', () => {
    const empty = request({
      eventDate: undefined,
      headcount: undefined,
      venue: undefined,
      serviceStyle: undefined,
      mealType: undefined,
    })
    expect(renderState(empty)).toBe('- nothing yet')
  })

  it('reports her stated budget without turning it into a price', () => {
    const withBudget = request({
      budgetIndication: {
        value: { amount: 6000, currency: 'EUR', basis: 'total' },
        confidence: 0.7,
        source: 'msg_2',
        sourceKind: 'ai',
      },
    })
    expect(renderState(withBudget)).toContain('budget she mentioned: 6000 EUR total')
  })
})

describe('buildInstruction', () => {
  it('asks questions while fields are open', () => {
    const instruction = buildInstruction(request({ headcount: undefined }), ['headcount'], false)
    expect(instruction).toContain('Ask at most 2 questions')
    expect(instruction).toContain('headcount')
  })

  it('switches to a summary for her to check once nothing is missing', () => {
    const instruction = buildInstruction(request(), [], true)
    expect(instruction).toContain('empty questions array')
    expect(instruction).toContain('Do not mention money')
  })

  it('mirrors her language and her Sie', () => {
    expect(buildInstruction(request(), [], true)).toContain('German, using Sie')
    const informal = buildInstruction(request({ language: 'en', formality: 'du' }), [], true)
    expect(informal).toContain('English, using du')
  })

  it('never invites the model to price anything', () => {
    for (const ready of [true, false]) {
      const instruction = buildInstruction(request(), ['dietary'], ready)
      expect(instruction.toLowerCase()).not.toMatch(/\bprice (it|this|the)\b|\bestimate the cost\b/)
    }
  })
})

describe('Invariant 1 — the customer-facing agent has no way to say no', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../../src/agent/qualify.ts', import.meta.url)),
    'utf8',
  )

  it('declares no field the model could use to decline or route an enquiry away', () => {
    // Source inspection rather than a type assertion, for the same reason the I2 test
    // reads source: a type check is defeated by one `as any`, and this is the schema
    // that decides what the model is even able to say.
    const start = source.indexOf('const QualifyPayloadSchema')
    const body = source.slice(start, source.indexOf('})', start))

    // Declared keys, not substrings — the comment above the schema says the word
    // "decline" on purpose, and a test that cannot tell a rule from its explanation
    // is a test that gets deleted the first time it fires.
    for (const field of ['decline', 'reject', 'refuse', 'not_a_fit', 'out_of_scope', 'ignore']) {
      expect(
        new RegExp(`^\\s*${field}\\w*\\s*:`, 'im').test(body),
        `QualifyPayloadSchema declares "${field}" — the agent may never turn a customer away`,
      ).toBe(false)
    }
  })

  it('tells the model in as many words that it turns nobody away', () => {
    const role = buildRole({
      agencyId: 'a',
      request: request(),
      messages: [],
      agencyName: 'Beispiel Catering',
      ownerName: 'Markus',
    })
    expect(role).toContain('never turn anyone away')
    expect(role).toContain('too small')
  })

  it('leaves pricing to the owner by name, so "what does it cost" has an answer', () => {
    const role = buildRole({
      agencyId: 'a',
      request: request(),
      messages: [],
      agencyName: 'Beispiel Catering',
      ownerName: 'Markus',
    })
    expect(role).toContain('Markus')
    expect(role).toContain('never state, estimate, imply or hint at a price')
  })
})

describe('the caterer’s confirmed facts (Phase C, structured half)', () => {
  const facts = [
    'Mindestbestellung ab 20 Personen.',
    'Lieferung im Umkreis von 40 km um Köln.',
  ]

  it('reaches the model as our own text, not as an untrusted block', () => {
    // These are rows he confirmed. Putting them through the untrusted framing
    // would tell the model to distrust the one pile that has no ranker in front
    // of it, which is the whole reason the pile exists.
    const instruction = buildInstruction(request({ venue: undefined }), ['venue'], false, facts)
    expect(instruction).toContain('Mindestbestellung ab 20 Personen.')
    expect(instruction).toContain('confirmed by him')
  })

  it('is absent entirely when he has confirmed nothing', () => {
    const instruction = buildInstruction(request({ venue: undefined }), ['venue'], false, [])
    expect(instruction).not.toContain('confirmed by him')
  })

  it('can never become a reason to turn someone away', () => {
    // INVARIANT 1, at its most fragile point. "Mindestbestellung ab 20 Personen"
    // plus an enquiry for 12 is the most natural-sounding refusal in the product,
    // and a model would produce it helpfully. The instruction forbids it in as
    // many words, and this is the test that keeps the sentence there.
    const instruction = buildInstruction(request({ venue: undefined }), ['venue'], false, facts)
    expect(instruction).toContain('never a reason to turn someone away')
    expect(instruction).toContain('his decision to make')
  })
})
