/**
 * INVARIANT 4 — a human decision is always in the path to any outcome that matters.
 *
 * Owner confirmation is mandatory, non-skippable, and the owner may renegotiate or
 * decline at that point without penalty. This is the limb that defeats "solely
 * automated processing" under Art. 22(1).
 *
 * Prevents: an "instant booking" feature that skips confirmation.
 */

import { describe, expect, it } from 'vitest'

import {
  AutomatedRefusalError,
  INQUIRY_STATES,
  type InquiryState,
  allowedTransitions,
  assertTransition,
  canTransition,
  isHumanOnlyState,
} from '../../src/domain/inquiry-state'

describe('I4 — a human is always in the path', () => {
  it('lets only an authenticated user confirm a booking', () => {
    expect(() =>
      assertTransition('accepted', 'confirmed', { kind: 'user', userId: 'u1' }),
    ).not.toThrow()

    for (const actor of [
      { kind: 'system' } as const,
      { kind: 'agent' } as const,
      { kind: 'customer', inquiryId: 'i1' } as const,
    ]) {
      expect(
        () => assertTransition('accepted', 'confirmed', actor),
        `${actor.kind} must not be able to form a contract`,
      ).toThrow(AutomatedRefusalError)
    }
  })

  it('marks confirmed and declined_by_owner as human-only', () => {
    expect(isHumanOnlyState('confirmed')).toBe(true)
    expect(isHumanOnlyState('declined_by_owner')).toBe(true)
    expect(isHumanOnlyState('quote_sent')).toBe(false)
  })

  it('offers no route to confirmed that bypasses acceptance or owner handling', () => {
    const predecessors = INQUIRY_STATES.filter((s) => canTransition(s, 'confirmed'))
    expect(predecessors.sort()).toEqual(['accepted', 'owner_handling'])
  })

  it('offers no route from an automated state straight to fulfilled', () => {
    // Fulfilment implies a contract, so it must sit behind confirmation.
    const predecessors = INQUIRY_STATES.filter((s) => canTransition(s, 'fulfilled'))
    expect(predecessors).toEqual(['confirmed'])
  })

  it('leaves the owner free to renegotiate or decline after acceptance', () => {
    // D9's non-binding framing is only meaningful if the owner really can say no
    // at this point without penalty.
    const onward = allowedTransitions('accepted')
    expect(onward).toContain('declined_by_owner')
    expect(onward).toContain('owner_handling')
  })

  it('never lets the agent reach a state that decides something commercially', () => {
    // `fulfilled` is deliberately absent. It is operational, not commercial — the
    // contract formed at `confirmed`, by a person. A worker marking an event done
    // after the date has passed decides nothing about anyone, so gating it on a
    // human would be ceremony rather than a safeguard.
    const commercial: InquiryState[] = ['confirmed', 'declined_by_owner']
    for (const to of commercial) {
      for (const from of INQUIRY_STATES) {
        if (!canTransition(from, to)) continue
        expect(
          () => assertTransition(from, to, { kind: 'agent' }),
          `agent reached ${to} from ${from}`,
        ).toThrow()
      }
    }
  })
})
