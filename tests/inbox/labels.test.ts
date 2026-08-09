/**
 * What the owner's inbox calls things.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INVARIANT 1 IS A COPY PROBLEM HERE, NOT A LOGIC PROBLEM.
 *
 * The system cannot refuse anybody — that is enforced in the enum, the trigger
 * and the function signatures. What is left to get wrong is the *impression*: an
 * owner who reads "eskaliert" or "Spam" in his own inbox concludes the software
 * turned someone away, and configures his business around a behaviour that cannot
 * happen. The guardrail copy already has a test for exactly this reason; these
 * labels get the same one.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, expect, it } from 'vitest'

import type { CateringRequest } from '../../src/domain/catering-request'
import { INQUIRY_STATES, type InquiryState } from '../../src/domain/inquiry-state'
import { relativeTime, requestOneLiner, stateLabel } from '../../src/inbox/labels'

describe('no label reads as a refusal', () => {
  it('has a label for every state, with none missing', () => {
    // A state added later and left unlabelled would render as its raw enum value
    // in front of a paying customer.
    for (const state of INQUIRY_STATES) {
      const label = stateLabel(state)
      expect(label.text.length, `no label for ${state}`).toBeGreaterThan(1)
      expect(label.text).not.toBe(state)
    }
  })

  it('never uses a word that suggests the software said no', () => {
    for (const state of INQUIRY_STATES) {
      const text = stateLabel(state).text.toLowerCase()
      expect(text, `"${text}" (${state}) reads as a system refusal`).not.toMatch(
        /eskaliert|abgebrochen|abgewiesen|abgelehnt durch|gesperrt|blockiert|verweigert|spam/,
      )
    }
  })

  it('calls the escalation what it is: waiting for him', () => {
    // Not a failure state. A person is needed, which is the product working.
    expect(stateLabel('escalated').text).toBe('Wartet auf Sie')
    expect(stateLabel('escalated').urgency).toBe('waiting')
  })

  it('calls the spam tray a tray', () => {
    // It is where a suspected bot lands *after* being acknowledged like everyone
    // else. Naming it "Spam" invites him to believe someone was turned away.
    expect(stateLabel('spam').text).toBe('Zur Durchsicht')
  })

  it('attributes a decline to whoever actually made it', () => {
    // The only two declines that exist, and both name a human.
    expect(stateLabel('declined_by_customer').text).toContain('Kundin')
    expect(stateLabel('declined_by_owner').text).toContain('Ihnen')
  })

  it('marks exactly the states where he is the next step', () => {
    const waiting = INQUIRY_STATES.filter((s) => stateLabel(s).urgency === 'waiting')
    expect(waiting).toEqual(
      expect.arrayContaining<InquiryState>([
        'sent_to_owner',
        'escalated',
        'owner_handling',
        'accepted',
      ]),
    )
    // Anything the assistant is still working on is not his problem yet.
    expect(waiting).not.toContain('qualifying')
    expect(waiting).not.toContain('new')
  })
})

describe('the one-line summary', () => {
  const base: CateringRequest = {
    language: 'de',
    formality: 'sie',
    meta: { extractionVersion: 't', model: 't', completeness: 1, overallConfidence: 0.9 },
  }
  const at = <T,>(value: T) => ({ value, confidence: 0.9, source: 'm1', sourceKind: 'ai' as const })

  it('reads as a sentence a caterer scans, with labels not enum values', () => {
    // It printed the raw "buffet" in his inbox until this went through the same
    // renderer as the detail page.
    const request: CateringRequest = {
      ...base,
      eventDate: at('2027-06-12'),
      headcount: at(80),
      serviceStyle: at('buffet' as const),
    }
    expect(requestOneLiner(request)).toBe('12. Juni 2027 · 80 Personen · Buffet')
  })

  it('says so plainly when nothing has been extracted', () => {
    expect(requestOneLiner(null)).toBe('Noch keine Details')
    expect(requestOneLiner(base)).toBe('Noch keine Details')
  })

  it('leaves out what she never said rather than printing a gap', () => {
    expect(requestOneLiner({ ...base, headcount: at(40) })).toBe('40 Personen')
  })

  it('survives a date that never parsed', () => {
    expect(requestOneLiner({ ...base, eventDate: at('im Juni') })).toContain('im Juni')
  })
})

describe('how long ago', () => {
  const now = new Date('2026-08-09T15:00:00.000Z')

  it('uses the words a person uses', () => {
    expect(relativeTime('2026-08-09T14:59:40.000Z', now)).toBe('gerade eben')
    expect(relativeTime('2026-08-09T14:30:00.000Z', now)).toBe('vor 30 Min.')
    expect(relativeTime('2026-08-09T09:00:00.000Z', now)).toBe('vor 6 Std.')
    expect(relativeTime('2026-08-08T15:00:00.000Z', now)).toBe('vor 1 Tag')
    expect(relativeTime('2026-08-04T15:00:00.000Z', now)).toBe('vor 5 Tagen')
  })

  it('falls back to a date once "days ago" stops being useful', () => {
    expect(relativeTime('2026-05-01T15:00:00.000Z', now)).toMatch(/Mai/)
  })

  it('renders nothing for a timestamp that will not parse', () => {
    expect(relativeTime('not a date', now)).toBe('')
  })
})
