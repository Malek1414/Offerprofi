/**
 * Guardrail form (F2.13).
 *
 * Two things under test, and the second matters more than the first.
 *
 * The rules: ranges, cross-field consistency, and the German money format again.
 *
 * The *copy*: `minOrderValue` is refusal-shaped, and an owner who believes it declines
 * small jobs will set it expecting that behaviour. Invariant 1 makes the behaviour
 * impossible in code; only the wording can stop her expecting it. A test on wording
 * looks unusual, but the gap between what she believes and what happens is exactly
 * where a complaint comes from.
 */

import { describe, expect, it } from 'vitest'

import {
  GUARDRAIL_RANGES,
  validateGuardrails,
  type GuardrailForm,
} from '../../src/onboarding/guardrail-form'
import { defaultGuardrails } from '../../src/guardrails/config'
import { guardrailCopy } from '../../src/onboarding/guardrail-copy'

const form = (over: Partial<GuardrailForm> = {}): GuardrailForm => ({
  minOrderValue: '',
  maxAutoQuoteValue: '5.000,00',
  allowScopeReduction: true,
  maxNegotiationRounds: '4',
  quoteValidityDays: '14',
  autoSendEnabled: true,
  leadTimeMinDays: '14',
  capacityPerDay: '1',
  allowEmoji: false,
  ...over,
})

const problemsFor = (over: Partial<GuardrailForm>) => {
  const out = validateGuardrails(form(over))
  return out.ok ? [] : out.problems
}

describe('F2.13 — the three-minute path', () => {
  it('accepts the defaults untouched', () => {
    // The whole time budget rests on this: an owner who reads nothing and presses
    // save gets a safe, complete configuration.
    const out = validateGuardrails(form())
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.value.maxAutoQuoteValueCents).toBe(500000)
      expect(out.value.minOrderValueCents).toBe(0)
    }
  })

  it('the form defaults match the code defaults', () => {
    // If these drift, the form silently changes behaviour for every new agency.
    const defaults = defaultGuardrails('a1')
    const out = validateGuardrails(form())
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.value.maxAutoQuoteValueCents).toBe(defaults.maxAutoQuoteValue)
      expect(out.value.maxNegotiationRounds).toBe(defaults.maxNegotiationRounds)
      expect(out.value.quoteValidityDays).toBe(defaults.quoteValidityDays)
      expect(out.value.leadTimeMinDays).toBe(defaults.leadTimeMinDays)
      expect(out.value.capacityPerDay).toBe(defaults.capacityPerDay)
      expect(out.value.allowScopeReduction).toBe(defaults.allowScopeReduction)
      expect(out.value.autoSendEnabled).toBe(defaults.autoSendEnabled)
      expect(out.value.allowEmoji).toBe(defaults.allowEmoji)
    }
  })

  it('reads a blank minimum as no minimum', () => {
    expect(problemsFor({ minOrderValue: '' })).toEqual([])
    expect(problemsFor({ minOrderValue: '   ' })).toEqual([])
  })

  it('parses German amounts here too', () => {
    const out = validateGuardrails(form({ minOrderValue: '1.500,00', maxAutoQuoteValue: '12.000,00' }))
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.value.minOrderValueCents).toBe(150000)
      expect(out.value.maxAutoQuoteValueCents).toBe(1200000)
    }
  })
})

describe('F2.13 — rules that stop a self-defeating configuration', () => {
  it('refuses a minimum above the auto-send ceiling', () => {
    // Otherwise every quote trips both thresholds at once, nothing is ever sent
    // automatically, and neither number does what she thinks.
    expect(problemsFor({ minOrderValue: '9.000,00', maxAutoQuoteValue: '5.000,00' })).toEqual([
      { field: 'minOrderValue', code: 'above_max_auto' },
    ])
  })

  it('does not blame the minimum when the ceiling is what is wrong', () => {
    expect(problemsFor({ minOrderValue: '9.000,00', maxAutoQuoteValue: 'abc' }).map((p) => p.field))
      .toEqual(['maxAutoQuoteValue'])
  })

  it('refuses a ceiling of zero and points at the switch that means it', () => {
    // Zero would hold every quote — which is what autoSendEnabled is for, and saying
    // so plainly beats hiding the same behaviour behind a number.
    expect(problemsFor({ maxAutoQuoteValue: '0,00' })).toEqual([
      { field: 'maxAutoQuoteValue', code: 'zero' },
    ])
  })

  it('requires a ceiling', () => {
    expect(problemsFor({ maxAutoQuoteValue: '' })).toEqual([
      { field: 'maxAutoQuoteValue', code: 'missing' },
    ])
  })

  it('holds every numeric field to its range', () => {
    const cases: Array<[keyof GuardrailForm, string]> = [
      ['maxNegotiationRounds', '0'],
      ['maxNegotiationRounds', '11'],
      ['quoteValidityDays', '0'],
      ['quoteValidityDays', '366'],
      ['leadTimeMinDays', '366'],
      ['capacityPerDay', '0'],
      ['capacityPerDay', '51'],
    ]
    for (const [field, value] of cases) {
      expect(problemsFor({ [field]: value }), `${field}=${value} was accepted`).toHaveLength(1)
    }
  })

  it('allows zero lead time, because some agencies do take same-day work', () => {
    expect(problemsFor({ leadTimeMinDays: '0' })).toEqual([])
    expect(GUARDRAIL_RANGES.leadTimeMinDays.min).toBe(0)
  })

  it('rejects a decimal where a count is expected', () => {
    // "2,5 Verhandlungsrunden" is not a thing, and Number() would happily take it.
    expect(problemsFor({ maxNegotiationRounds: '2,5' })).toHaveLength(1)
    expect(problemsFor({ capacityPerDay: '1.5' })).toHaveLength(1)
    expect(problemsFor({ quoteValidityDays: '-3' })).toHaveLength(1)
  })
})

describe('I1 — the copy never promises a refusal the product cannot make', () => {
  it('describes the minimum as an alert, not a rejection', () => {
    const copy = guardrailCopy('de')
    const text = `${copy.minOrderValue.label} ${copy.minOrderValue.help}`.toLowerCase()

    // Words that would tell her small jobs are turned away. The product has no code
    // path that can do it (there is no declined_by_system state), so promising it
    // would be a lie she configures her business around.
    for (const forbidden of ['ablehn', 'absag', 'abweis', 'nicht angenommen', 'lehnt ab']) {
      expect(text, `minimum-order copy suggests a refusal: "${forbidden}"`).not.toContain(forbidden)
    }
    // And it must positively say what does happen.
    expect(text).toMatch(/melde|informier|bescheid|sie selbst|zu ihnen/)
  })

  it('says what happens rather than naming a parameter', () => {
    const copy = guardrailCopy('de')
    for (const [key, entry] of Object.entries(copy)) {
      expect(entry.label.length, `${key} has no label`).toBeGreaterThan(3)
      // Our vocabulary must not reach her screen.
      expect(entry.label, `${key} leaks a parameter name`).not.toMatch(/_|max_|min_|value|Cents/)
      expect(entry.help.length, `${key} has no explanation`).toBeGreaterThan(10)
    }
  })

  it('is written in both languages', () => {
    const de = guardrailCopy('de')
    const en = guardrailCopy('en')
    for (const key of Object.keys(de) as Array<keyof typeof de>) {
      expect(en[key], `${key} missing in English`).toBeDefined()
      expect(de[key].label).not.toBe(en[key].label)
    }
  })
})
