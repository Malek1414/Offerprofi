/**
 * F2.3 / F2.12 — onboarding progress.
 *
 * Acceptance: "The owner always knows what is left." Measured against the Phase 2
 * exit criterion, because a meter measuring anything else lies.
 */

import { describe, expect, it } from 'vitest'

import {
  REQUIRED_CONFIRMED_ITEMS,
  REQUIRED_PAST_QUOTES,
  type OnboardingState,
  onboardingProgress,
  requirementExplanation,
} from '../../src/onboarding/progress'

function state(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return {
    pastQuotesUploaded: 0,
    confirmedItemCount: 0,
    itemsWithPriceRule: 0,
    brandConfirmed: false,
    guardrailsSet: false,
    ...overrides,
  }
}

const COMPLETE: OnboardingState = {
  pastQuotesUploaded: 3,
  confirmedItemCount: 5,
  itemsWithPriceRule: 5,
  brandConfirmed: true,
  guardrailsSet: true,
}

describe('F2.12 — progress against the real exit criterion', () => {
  it('is incomplete at the start and lists everything outstanding', () => {
    const progress = onboardingProgress(state())
    expect(progress.complete).toBe(false)
    expect(progress.remaining.map((r) => r.id)).toContain('past_quotes')
    expect(progress.remaining.map((r) => r.id)).toContain('guardrails')
  })

  it('is complete only when every requirement is met', () => {
    const progress = onboardingProgress(COMPLETE)
    expect(progress.complete).toBe(true)
    expect(progress.remaining).toEqual([])
    expect(progress.ratio).toBe(1)
  })

  it('reports position against target, so the UI can say "3 of 5"', () => {
    const progress = onboardingProgress(state({ confirmedItemCount: 3 }))
    const items = progress.requirements.find((r) => r.id === 'confirmed_items')
    expect(items).toMatchObject({ current: 3, target: REQUIRED_CONFIRMED_ITEMS, met: false })
  })

  it('blocks on fewer than three past quotes (D4 / F2.3)', () => {
    expect(onboardingProgress(state({ ...COMPLETE, pastQuotesUploaded: 2 })).complete).toBe(false)
    expect(onboardingProgress({ ...COMPLETE, pastQuotesUploaded: REQUIRED_PAST_QUOTES }).complete).toBe(
      true,
    )
  })

  it('ties the price-rule target to the catalogue, not to a fixed number', () => {
    // Otherwise she satisfies it at five items and it silently stays green when she
    // adds a sixth with no price.
    const progress = onboardingProgress({
      ...COMPLETE,
      confirmedItemCount: 6,
      itemsWithPriceRule: 5,
    })
    expect(progress.complete).toBe(false)
    expect(progress.remaining.map((r) => r.id)).toEqual(['price_rules'])
  })

  it('does not block on a requirement that cannot be acted on', () => {
    // Zero confirmed items means zero items missing a price rule. Treating 0/0 as
    // unmet would show her an item she has no way to satisfy.
    const priceRules = onboardingProgress(state()).requirements.find(
      (r) => r.id === 'price_rules',
    )
    expect(priceRules?.met).toBe(true)
  })

  it('orders the remaining work the way it should be tackled', () => {
    const progress = onboardingProgress(state())
    // Uploads first — everything downstream is extracted from them. Guardrails
    // last, once she can see her own catalogue.
    expect(progress.remaining[0]?.id).toBe('past_quotes')
    expect(progress.remaining.at(-1)?.id).toBe('guardrails')
  })
})

describe('F2.3 — the requirement is explained, not just enforced', () => {
  it('explains why three past quotes are needed, in both languages', () => {
    for (const language of ['de', 'en'] as const) {
      const { title, why } = requirementExplanation('past_quotes', language)
      expect(title.length).toBeGreaterThan(0)
      // An owner blocked by a rule she does not understand assumes we are broken.
      expect(why.length).toBeGreaterThan(40)
    }
  })

  it('explains every requirement, so no blocker is ever bare', () => {
    const ids = onboardingProgress(state()).requirements.map((r) => r.id)
    for (const id of ids) {
      for (const language of ['de', 'en'] as const) {
        expect(requirementExplanation(id, language).why.length).toBeGreaterThan(20)
      }
    }
  })

  it('emits reason codes rather than prose from the progress model itself', () => {
    // Same rule as the pricing engine: the model emits codes, the UI localises.
    for (const requirement of onboardingProgress(state()).requirements) {
      expect(requirement.reasonCode).toMatch(/^[a-z_]+$/)
    }
  })
})
