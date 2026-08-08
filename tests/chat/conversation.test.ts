/**
 * F1.7 / F1.8 / F1.13 / F1.14 — what the agent says, and in what order.
 */

import { describe, expect, it } from 'vitest'

import { type AckParams, acknowledgeInquiry } from '../../src/chat/ack'
import { triageInbound } from '../../src/chat/abuse'
import {
  type ComposeInput,
  composeAgentTurns,
  humanRequestedNotice,
  streamChunks,
} from '../../src/chat/conversation'
import { isPlausibleSlug } from '../../src/lib/agency'

const ACK_PARAMS: AckParams = {
  agencyName: 'Lisa Meier Hochzeiten',
  ownerName: 'Lisa',
  language: 'de',
  formality: 'sie',
  privacyNoticeUrl: 'https://example.com/datenschutz',
  slaHours: 24,
  routedToOwner: false,
  automationPaused: false,
}

function input(overrides: Partial<ComposeInput> = {}): ComposeInput {
  return {
    isFirstTurn: true,
    ack: acknowledgeInquiry(ACK_PARAMS),
    triage: triageInbound({
      text: 'Hallo, wir heiraten im Juni.',
      agencyInquiriesToday: 1,
      agencyDailyCap: 50,
    }),
    rate: {
      outcome: 'accept',
      scope: null,
      retryAfterSeconds: 0,
      limit: 20,
      used: 1,
      logLine: null,
    },
    language: 'de',
    formality: 'sie',
    automationPaused: false,
    ...overrides,
  }
}

describe('F1.8 — the disclosure leads', () => {
  it('is the very first thing said', () => {
    const turns = composeAgentTurns(input())
    expect(turns[0]?.kind).toBe('disclosure')
    expect(turns[0]?.text).toMatch(/KI-Assistent/)
  })

  it('is followed by the Art. 13 privacy line (F1.13)', () => {
    const turns = composeAgentTurns(input())
    expect(turns[1]?.kind).toBe('privacy')
    expect(turns[1]?.text).toMatch(/Datenschutz/)
  })

  it('is not repeated on later turns', () => {
    const turns = composeAgentTurns(input({ isFirstTurn: false }))
    expect(turns.map((t) => t.kind)).not.toContain('disclosure')
  })

  it('precedes the acknowledgement on the first turn', () => {
    const kinds = composeAgentTurns(input()).map((t) => t.kind)
    expect(kinds.indexOf('disclosure')).toBeLessThan(kinds.indexOf('ack'))
  })
})

describe('F1.14 / I5 — once a person is involved the agent stops', () => {
  it('says only that a human is coming, and offers no quote', () => {
    const paused = acknowledgeInquiry({ ...ACK_PARAMS, automationPaused: true })
    const turns = composeAgentTurns(input({ ack: paused, automationPaused: true }))
    const kinds = turns.map((t) => t.kind)
    expect(kinds).toContain('paused')
    expect(kinds).not.toContain('ack')
  })

  it('still discloses on a first turn that immediately asks for a human', () => {
    // A customer whose very first action is the human button is still owed the
    // Art. 50(1) disclosure — she talked to an AI to get there.
    const paused = acknowledgeInquiry({ ...ACK_PARAMS, automationPaused: true })
    const turns = composeAgentTurns(input({ ack: paused, automationPaused: true }))
    expect(turns[0]?.kind).toBe('disclosure')
  })

  it('names the owner and promises no further automatic messages', () => {
    for (const [language, formality] of [
      ['de', 'sie'],
      ['de', 'du'],
      ['en', 'sie'],
    ] as const) {
      const notice = humanRequestedNotice(language, formality, 'Lisa')
      expect(notice).toContain('Lisa')
      expect(notice).toMatch(language === 'de' ? /automatisch/ : /automatically/)
    }
  })
})

describe('F1.6 — a throttled turn is reassured, not scolded', () => {
  it('appends the notice after the acknowledgement', () => {
    const turns = composeAgentTurns(
      input({
        rate: {
          outcome: 'accept_throttled',
          scope: 'session',
          retryAfterSeconds: 30,
          limit: 20,
          used: 21,
          logLine: 'x',
        },
      }),
    )
    const kinds = turns.map((t) => t.kind)
    expect(kinds.indexOf('ack')).toBeLessThan(kinds.indexOf('throttle_notice'))
  })
})

describe('F1.7 — streaming', () => {
  it('reassembles to exactly the original text', () => {
    // A streamed message that differs from the stored one would make the
    // disclosure record a record of something the customer did not quite see.
    const text = 'Hallo! Ich bin der KI-Assistent von Lisa Meier Hochzeiten.\nWie kann ich helfen?'
    expect(streamChunks(text).join('')).toBe(text)
  })

  it('produces several chunks so the reply arrives progressively', () => {
    expect(streamChunks('eins zwei drei vier').length).toBe(4)
  })

  it('handles empty text without emitting a chunk', () => {
    expect(streamChunks('')).toEqual([])
    expect(streamChunks('   ')).toEqual([])
  })
})

describe('F1.4 — slug handling', () => {
  it('accepts realistic agency slugs', () => {
    expect(isPlausibleSlug('lisa-meier-hochzeiten')).toBe(true)
    expect(isPlausibleSlug('ab')).toBe(true)
  })

  it('rejects traversal, uppercase and overlong input before any lookup', () => {
    expect(isPlausibleSlug('../etc/passwd')).toBe(false)
    expect(isPlausibleSlug('Lisa')).toBe(false)
    expect(isPlausibleSlug('-leading-dash')).toBe(false)
    expect(isPlausibleSlug('a')).toBe(false)
    expect(isPlausibleSlug('x'.repeat(64))).toBe(false)
    expect(isPlausibleSlug('')).toBe(false)
  })
})
