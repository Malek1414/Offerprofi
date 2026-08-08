/**
 * F1.11 — abuse controls.
 *
 * Acceptance: "**No path rejects a customer** (I1). The cap alerts the owner; it
 * does not turn anyone away."
 */

import { describe, expect, it } from 'vitest'

import {
  MIN_HUMAN_SUBMIT_MS,
  type TriageInput,
  customerIsAcknowledged,
  triageInbound,
} from '../../src/chat/abuse'

function input(overrides: Partial<TriageInput> = {}): TriageInput {
  return {
    text: 'Hallo, wir heiraten im Juni 2027 und suchen noch Unterstützung.',
    agencyInquiriesToday: 3,
    agencyDailyCap: 50,
    ...overrides,
  }
}

describe('F1.11 — signals', () => {
  it('lets a normal inquiry through to automation', () => {
    const result = triageInbound(input({ honeypotValue: '', timeToSubmitMs: 45_000 }))
    expect(result.handling).toBe('automate')
    expect(result.signals).toEqual([])
    expect(result.ownerAlert).toBeNull()
  })

  it('routes a filled honeypot to the owner tray', () => {
    const result = triageInbound(input({ honeypotValue: 'http://spam.example' }))
    expect(result.signals).toContain('honeypot_filled')
    expect(result.handling).toBe('owner_tray')
  })

  it('routes an impossibly fast submission to the tray', () => {
    const result = triageInbound(input({ timeToSubmitMs: MIN_HUMAN_SUBMIT_MS - 1 }))
    expect(result.signals).toContain('submitted_impossibly_fast')
  })

  it('does not flag a human who typed quickly', () => {
    expect(triageInbound(input({ timeToSubmitMs: 8_000 })).handling).toBe('automate')
  })

  it('recognises bulk marketing spam', () => {
    const result = triageInbound(
      input({ text: 'Hello, we offer SEO services and quality backlink packages.' }),
    )
    expect(result.signals).toContain('spam_language')
  })

  it('does not flag a real inquiry that mentions price', () => {
    // Precision over recall: this only changes who reads it first, and a broad
    // list would tray real customers for saying "best price".
    const result = triageInbound(
      input({ text: 'Wir suchen das beste Angebot für 80 Gäste, gerne mit Preisliste.' }),
    )
    expect(result.handling).toBe('automate')
  })

  it('routes a repeated identical message to the tray', () => {
    expect(triageInbound(input({ identicalRepeatCount: 3 })).signals).toContain('duplicate_flood')
  })

  it('treats a missing honeypot or timing value as no signal, not as guilt', () => {
    const result = triageInbound(input({ honeypotValue: null, timeToSubmitMs: null }))
    expect(result.handling).toBe('automate')
  })
})

describe('F1.11 — the daily cap alerts the owner, it does not turn anyone away', () => {
  it('routes to the tray and alerts the owner when the cap is reached', () => {
    const result = triageInbound(input({ agencyInquiriesToday: 50, agencyDailyCap: 50 }))
    expect(result.handling).toBe('owner_tray')
    expect(result.ownerAlert?.kind).toBe('daily_cap_reached')
  })

  it('still acknowledges the customer when the cap is reached', () => {
    // The failure this prevents: billing quietly becoming an automated adverse
    // decision (FEATURE_INVENTORY §16.1).
    const result = triageInbound(input({ agencyInquiriesToday: 999, agencyDailyCap: 50 }))
    expect(customerIsAcknowledged(result)).toBe(true)
  })

  it("says nothing to the customer about the agency's plan limits", () => {
    const result = triageInbound(input({ agencyInquiriesToday: 50, agencyDailyCap: 50 }))
    // The alert is addressed to the owner. A customer must never learn that a
    // quota is why she is waiting.
    expect(result.ownerAlert?.message).toMatch(/quota|plan/i)
    expect(result.handling).toBe('owner_tray')
  })
})

describe('F1.11 / I1 — no path refuses a customer', () => {
  it('produces only the two permitted outcomes, whatever the signals', () => {
    const hostile: TriageInput = {
      honeypotValue: 'bot',
      timeToSubmitMs: 1,
      text: 'crypto investment opportunity, guest post backlink, forex',
      agencyInquiriesToday: 10_000,
      agencyDailyCap: 1,
      identicalRepeatCount: 99,
    }
    const result = triageInbound(hostile)
    // Invariant 1: an offer is produced, or a human takes over. Even here.
    expect(['automate', 'owner_tray']).toContain(result.handling)
    expect(customerIsAcknowledged(result)).toBe(true)
  })

  it('explains the routing to the owner in plain language', () => {
    const result = triageInbound(input({ honeypotValue: 'bot', timeToSubmitMs: 10 }))
    expect(result.reason).toBeTruthy()
    expect(result.reason).toMatch(/hidden field/)
    expect(result.reason).toMatch(/faster than a person/)
  })

  it('has no reject-shaped handling value across an exhaustive sweep', () => {
    const outcomes = new Set<string>()
    for (const honeypot of ['', 'x']) {
      for (const ms of [1, 60_000]) {
        for (const text of ['Hochzeit im Juni', 'buy bitcoin now']) {
          for (const today of [0, 100]) {
            outcomes.add(
              triageInbound({
                honeypotValue: honeypot,
                timeToSubmitMs: ms,
                text,
                agencyInquiriesToday: today,
                agencyDailyCap: 50,
              }).handling,
            )
          }
        }
      }
    }
    expect([...outcomes].sort()).toEqual(['automate', 'owner_tray'])
  })
})
