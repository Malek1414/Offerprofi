/**
 * F1.9 — the instant acknowledgement.
 *
 * Acceptance: "Ack fires before the extraction worker is scheduled, not after."
 * This is the sub-10s p95 promise, and the ordering is the whole of it.
 */

import { describe, expect, it } from 'vitest'

import { type AckParams, acknowledgeInquiry, stepIndex } from '../../src/chat/ack'

function params(overrides: Partial<AckParams> = {}): AckParams {
  return {
    agencyName: 'Lisa Meier Hochzeiten',
    ownerName: 'Lisa',
    language: 'de',
    formality: 'sie',
    privacyNoticeUrl: 'https://example.com/datenschutz',
    slaHours: 24,
    routedToOwner: false,
    automationPaused: false,
    ...overrides,
  }
}

describe('F1.9 — ordering', () => {
  it('sends the ack before scheduling extraction', () => {
    const plan = acknowledgeInquiry(params())
    expect(stepIndex(plan, 'send_ack')).toBeLessThan(stepIndex(plan, 'schedule_extraction'))
  })

  it('records the disclosure before anything is sent', () => {
    // I6 / F1.8 — what was shown must be provable, so it is written first. A
    // disclosure recorded after sending is a disclosure that can be lost.
    const plan = acknowledgeInquiry(params())
    expect(stepIndex(plan, 'record_disclosure')).toBeLessThan(stepIndex(plan, 'send_ack'))
    expect(stepIndex(plan, 'record_disclosure')).toBe(0)
  })

  it('notifies the owner after the customer has been answered, never before', () => {
    const plan = acknowledgeInquiry(params({ routedToOwner: true }))
    expect(stepIndex(plan, 'send_ack')).toBeLessThan(stepIndex(plan, 'notify_owner'))
  })

  it('acknowledges even when triage routed the inquiry to the owner', () => {
    const plan = acknowledgeInquiry(params({ routedToOwner: true }))
    expect(stepIndex(plan, 'send_ack')).toBeGreaterThanOrEqual(0)
    expect(plan.ackText.length).toBeGreaterThan(0)
  })

  it('acknowledges when the customer has asked for a human', () => {
    const plan = acknowledgeInquiry(params({ automationPaused: true }))
    expect(stepIndex(plan, 'send_ack')).toBeGreaterThanOrEqual(0)
  })

  it('schedules no extraction while automation is paused', () => {
    // I5 — after a customer asks for a person, no worker may quietly carry on
    // preparing a quote behind their back.
    const plan = acknowledgeInquiry(params({ automationPaused: true }))
    expect(stepIndex(plan, 'schedule_extraction')).toBe(-1)
    expect(plan.steps.some((s) => s.kind === 'notify_owner')).toBe(true)
  })
})

describe('F1.9 — the acknowledgement copy', () => {
  it('mirrors Sie', () => {
    const plan = acknowledgeInquiry(params({ language: 'de', formality: 'sie' }))
    expect(plan.ackText).toMatch(/Ihre Anfrage/)
    expect(plan.ackText).not.toMatch(/\bDeine\b/)
  })

  it('mirrors du', () => {
    const plan = acknowledgeInquiry(params({ language: 'de', formality: 'du' }))
    expect(plan.ackText).toMatch(/Deine Anfrage/)
    expect(plan.ackText).not.toMatch(/Ihre Anfrage/)
  })

  it('answers in English when the customer wrote English', () => {
    const plan = acknowledgeInquiry(params({ language: 'en' }))
    expect(plan.ackText).toMatch(/Your inquiry has arrived/)
  })

  it('states the SLA the agency advertises', () => {
    expect(acknowledgeInquiry(params({ slaHours: 4 })).ackText).toMatch(/4 Stunden/)
  })

  it('never implies the quote is final — the owner confirms (I3)', () => {
    for (const language of ['de', 'en'] as const) {
      const plan = acknowledgeInquiry(params({ language }))
      // The one thing the first message must not do is suggest that anything
      // binding happens automatically.
      expect(plan.ackText).toMatch(language === 'de' ? /Bestätigung|persönlich/ : /reviews|personally/)
    }
  })

  it('carries the versioned AI disclosure (F1.8, D25)', () => {
    const plan = acknowledgeInquiry(params())
    expect(plan.disclosure.version).toBeTruthy()
    expect(plan.disclosure.openingLine).toMatch(/KI-Assistent/)
    expect(plan.disclosure.requestHumanLabel).toMatch(/Lisa/)
  })
})
