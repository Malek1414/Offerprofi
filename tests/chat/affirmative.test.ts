/**
 * A1 — is her reply a "send it"?
 *
 * Deterministic, because the answer decides whether an enquiry leaves for the
 * caterer. No model reads this: a misclassification here sends something she did
 * not mean to send, and `send/route.ts` is explicit that the send is hers alone.
 */

import { describe, expect, it } from 'vitest'

import { isSendAffirmative } from '../../src/chat/affirmative'

describe('isSendAffirmative', () => {
  it('recognises a bare "Ja"', () => {
    expect(isSendAffirmative('Ja', 'de')).toBe(true)
  })

  // The sentence a real tester typed on 10 Aug 2026, on inquiry 6ce639a5, which
  // sat in `qualifying` because nothing recognised it.
  it('recognises an affirmative that carries a courtesy instruction', () => {
    expect(isSendAffirmative('Ja, das passt genau so. Bitte an Johannes weitergeben.', 'de')).toBe(
      true,
    )
  })

  // The expensive false positive. "Ja, aber …" is a correction wearing a yes, and
  // sending on it hands the caterer a request she was in the middle of fixing.
  it('does not send when the affirmative is qualified by a correction', () => {
    expect(isSendAffirmative('Ja, aber die Uhrzeit stimmt nicht', 'de')).toBe(false)
    expect(isSendAffirmative('Ja, nur die Personenzahl muss noch geändert werden', 'de')).toBe(false)
    expect(isSendAffirmative('yes, but the venue is wrong', 'en')).toBe(false)
  })

  it('does not send on a negation or on a substantive message', () => {
    expect(isSendAffirmative('Nein, das stimmt nicht', 'de')).toBe(false)
    expect(isSendAffirmative('Wir sind doch 90 Personen', 'de')).toBe(false)
    expect(isSendAffirmative('', 'de')).toBe(false)
  })
})
