/**
 * INVARIANT 1 — no automated adverse decision, ever.
 *
 * The system has exactly two outcomes for any inquiry: an offer is produced, or a
 * human takes over. No code path lets software refuse, reject, decline, deprioritise
 * or turn away a customer — not for budget, date, capacity, region, or suspected spam.
 *
 * This test exists to fail loudly the day someone ships "auto-reject low-budget
 * leads" as a growth feature. That feature is the exact fact pattern GDPR Art. 22
 * was written for. See PRODUCT_SPEC §12.6.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  AutomatedRefusalError,
  INQUIRY_STATES,
  type InquiryState,
  allowedTransitions,
  assertTransition,
  canTransition,
} from '../../src/domain/inquiry-state'
import { defaultGuardrails } from '../../src/guardrails/config'
import { evaluateOutbound } from '../../src/guardrails/evaluator'
import { eurosToCents } from '../../src/domain/money'
import { priceQuote } from '../../src/engine/pricing'
import { minimalCatalogue, minimalPricingInput } from '../fixtures/catalogue'

const src = (p: string) => readFileSync(fileURLToPath(new URL(`../../src/${p}`, import.meta.url)), 'utf8')

describe('I1 — no automated refusal', () => {
  it('has no system-decline state in the state machine', () => {
    const forbidden = ['declined_by_system', 'rejected', 'refused', 'auto_declined', 'not_eligible']
    for (const name of forbidden) {
      expect(
        INQUIRY_STATES as readonly string[],
        `"${name}" must not exist as an inquiry state — route to "escalated" instead`,
      ).not.toContain(name)
    }
  })

  it('lets only an authenticated user decline', () => {
    // The owner may decline. That is a human decision, and it is allowed.
    expect(() =>
      assertTransition('owner_handling', 'declined_by_owner', { kind: 'user', userId: 'u1' }),
    ).not.toThrow()

    // Nothing else may.
    for (const actor of [
      { kind: 'system' } as const,
      { kind: 'agent' } as const,
      { kind: 'customer', inquiryId: 'i1' } as const,
    ]) {
      expect(
        () => assertTransition('owner_handling', 'declined_by_owner', actor),
        `${actor.kind} must not be able to decline a customer`,
      ).toThrow(AutomatedRefusalError)
    }
  })

  it('leaves every state where the system is still in control a route to a human', () => {
    // Excluded because a human decision has already happened, or the conversation is
    // over. `confirmed` and `declined_by_owner` were *just* set by an authenticated
    // user; `declined_by_customer` is the customer's own choice; `fulfilled` and
    // `archived` are past the commercial decision entirely. The invariant protects
    // customers waiting on the system, not bookkeeping states.
    const postDecision: InquiryState[] = [
      'confirmed',
      'fulfilled',
      'archived',
      'declined_by_customer',
      'declined_by_owner',
    ]
    for (const state of INQUIRY_STATES) {
      if (postDecision.includes(state)) continue
      const onward = allowedTransitions(state)
      const reachesHuman =
        onward.includes('escalated') ||
        onward.includes('owner_handling') ||
        onward.includes('confirmed') ||
        onward.some((s) => allowedTransitions(s).includes('escalated'))
      expect(reachesHuman, `"${state}" must be able to reach a human`).toBe(true)
    }
  })

  it('keeps a misclassified spam inquiry recoverable', () => {
    // Spam classification routes to a tray, and a tray you cannot get out of is a
    // refusal with extra steps.
    expect(canTransition('spam', 'new')).toBe(true)
  })

  it('escalates rather than refuses when a quote falls below the minimum order value', () => {
    const guardrails = { ...defaultGuardrails('a1'), minOrderValue: eurosToCents(2000) }
    const quote = priceQuote(minimalPricingInput(), minimalCatalogue())

    const outcome = evaluateOutbound({
      guardrails,
      quote,
      negotiationRound: 1,
      contactOptedOutAt: null,
      availabilityCommitted: false,
      injectionSuspected: false,
      customerAssertedPrices: [],
    })

    expect(outcome.action).toBe('escalate')
    if (outcome.action === 'escalate') {
      expect(outcome.reason).toBe('below_min_order_value')
    }
  })

  it('never produces a "reject" outcome from the guardrail evaluator', () => {
    // A structural check on the type's own source: adding a reject variant to
    // GuardrailOutcome would be the quiet way to reintroduce automated refusal.
    const evaluator = src('guardrails/evaluator.ts')
    const outcomeType = evaluator.slice(
      evaluator.indexOf('export type GuardrailOutcome'),
      evaluator.indexOf('export interface OutboundContext'),
    )
    expect(outcomeType).toContain("action: 'send'")
    expect(outcomeType).toContain("action: 'escalate'")
    for (const forbidden of ["'reject'", "'decline'", "'refuse'", "'block'"]) {
      expect(outcomeType, `GuardrailOutcome must not admit ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('escalates on an unavailable date instead of declining it', () => {
    const quote = priceQuote({ ...minimalPricingInput(), availability: 'hard_conflict' }, minimalCatalogue())
    const outcome = evaluateOutbound({
      guardrails: defaultGuardrails('a1'),
      quote,
      negotiationRound: 1,
      contactOptedOutAt: null,
      availabilityCommitted: true,
      injectionSuspected: false,
      customerAssertedPrices: [],
    })
    expect(outcome.action).toBe('escalate')
    // Crucially, the engine still priced the event. A conflicted date is a
    // scheduling conversation, not a closed door.
    expect(quote.grossTotal).toBeGreaterThan(0)
  })
})
