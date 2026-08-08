/**
 * INVARIANT 5 — human intervention is available on demand, and advertised.
 *
 * The control appears in the chat, on the quote, in every email and on the detail
 * form. Invoking it pauses automation immediately and writes an evidence row.
 *
 * Prevents: the control being quietly dropped in a redesign because it "clutters"
 * the quote page.
 */

import { describe, expect, it } from 'vitest'

import {
  INTERVENTION_SURFACES,
  isInterventionAvailable,
  requestHuman,
} from '../../src/domain/human-intervention'
import { quoteLegalBlock } from '../../src/domain/legal'
import { buildDisclosure } from '../../src/domain/disclosure'

describe('I5 — human intervention on demand', () => {
  it('is available on every surface', () => {
    for (const surface of INTERVENTION_SURFACES) {
      expect(isInterventionAvailable(surface), surface).toBe(true)
    }
  })

  it('is available in every quote state, including expired and superseded', () => {
    // A customer looking at an expired quote is precisely who needs a person.
    for (const state of ['draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'superseded']) {
      expect(isInterventionAvailable('quote', state), state).toBe(true)
    }
  })

  it('pauses automation and notifies the owner in the same operation', () => {
    const result = requestHuman({
      agencyId: 'a1',
      inquiryId: 'i1',
      trigger: 'customer_request',
      surface: 'chat',
      now: '2026-08-08T10:00:00Z',
    })
    expect(result.automationPaused).toBe(true)
    expect(result.notifyOwner).toBe(true)
  })

  it('writes an evidence row with a timestamp and an open response', () => {
    const { intervention } = requestHuman({
      agencyId: 'a1',
      inquiryId: 'i1',
      trigger: 'customer_request',
      surface: 'quote',
      now: '2026-08-08T10:00:00Z',
    })
    expect(intervention.requestedAt).toBe('2026-08-08T10:00:00Z')
    expect(intervention.respondedAt).toBeNull()
    expect(intervention.trigger).toBe('customer_request')
    expect(intervention.surface).toBe('quote')
  })

  it('advertises the route on the quote and in the chat opening', () => {
    const block = quoteLegalBlock(
      { agencyName: 'Lisa Meier Hochzeiten', validUntil: '2027-01-31', language: 'de' },
      'Lisa',
    )
    expect(block.requestHumanLabel).toContain('Lisa')
    // The AI paragraph itself names the route — it is not only a button.
    expect(block.aiDisclosure).toContain('jederzeit direkt')

    const disclosure = buildDisclosure({
      agencyName: 'Lisa Meier Hochzeiten',
      ownerName: 'Lisa',
      language: 'de',
      formality: 'sie',
      privacyNoticeUrl: 'https://example.test/datenschutz',
    })
    expect(disclosure.requestHumanLabel).toContain('Lisa')
  })
})
