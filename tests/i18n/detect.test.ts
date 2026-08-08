/**
 * F1.15 — language and formality detection.
 *
 * Acceptance: "Mirrors the customer's first message; agency override wins."
 */

import { describe, expect, it } from 'vitest'

import {
  type AgencyLanguageDefaults,
  MIN_CONFIDENCE,
  detectLanguageAndFormality,
  resolveVoice,
} from '../../src/i18n/detect'

const DEFAULTS: AgencyLanguageDefaults = { language: 'de', formality: 'sie' }

describe('F1.15 — language detection', () => {
  it('detects German from a realistic first message', () => {
    const result = detectLanguageAndFormality(
      'Hallo, wir heiraten am 12. September 2027 und suchen noch Unterstützung ' +
        'für die Planung. Wir rechnen mit etwa 80 Gästen.',
    )
    expect(result.language).toBe('de')
    expect(result.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE)
  })

  it('detects English from a realistic first message', () => {
    const result = detectLanguageAndFormality(
      "Hi, we're getting married next June and we are looking for a planner. " +
        'We expect about 80 guests. Could you send us a quote?',
    )
    expect(result.language).toBe('en')
    expect(result.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE)
  })

  it('uses an umlaut to settle a message too short to count words', () => {
    // "Hochzeit für 80 Gäste?" — barely any function words, but unambiguous.
    const result = detectLanguageAndFormality('Hochzeit für 80 Gäste?')
    expect(result.language).toBe('de')
    expect(result.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE)
  })

  it('is not confident about a message with no evidence', () => {
    expect(detectLanguageAndFormality('Hi').confidence).toBeLessThan(MIN_CONFIDENCE)
    expect(detectLanguageAndFormality('?!').confidence).toBeLessThan(MIN_CONFIDENCE)
    expect(detectLanguageAndFormality('').confidence).toBe(0)
  })

  it('is not confused by English loanwords in German text', () => {
    // German event inquiries are full of "Event", "Catering", "Location", "Team".
    // Function words, not topic words, are what actually separate the languages.
    const result = detectLanguageAndFormality(
      'Wir planen ein Corporate Event mit Catering und suchen noch eine Location ' +
        'für unser Team von 60 Personen.',
    )
    expect(result.language).toBe('de')
  })
})

describe('F1.15 — formality detection', () => {
  it('detects Sie from capitalised formal pronouns', () => {
    const result = detectLanguageAndFormality(
      'Guten Tag, können Sie uns ein Angebot machen? Wir freuen uns auf Ihre Rückmeldung.',
    )
    expect(result.formality).toBe('sie')
  })

  it('detects du', () => {
    const result = detectLanguageAndFormality(
      'Hey, kannst du uns ein Angebot schicken? Wir würden uns über deine Antwort freuen.',
    )
    expect(result.formality).toBe('du')
  })

  it('does not read lowercase "sie" as formal', () => {
    // "Ich habe sie gestern gesehen" is "her"/"them", not a register signal.
    // A case-insensitive match would read nearly every German message as formal
    // and silently destroy the mirroring.
    const result = detectLanguageAndFormality(
      'Meine Schwester heiratet, ich habe sie gestern gefragt und sie hätte gerne Blumen.',
    )
    expect(result.formality).not.toBe('sie')
  })

  it('does not read a sentence-initial "Sie" as formal', () => {
    // Capitalisation at the start of a sentence is grammar, not register.
    const result = detectLanguageAndFormality('Sie kommt aus Köln. Meine Freundin heiratet dort.')
    expect(result.formality).not.toBe('sie')
  })

  it('returns unknown for genuinely mixed signals rather than guessing', () => {
    const result = detectLanguageAndFormality('Hallo, kannst du uns helfen? Danke für Ihre Zeit.')
    expect(result.formality).toBe('unknown')
  })

  it('returns unknown for English — there is no du/Sie to get wrong', () => {
    expect(detectLanguageAndFormality('Could you send us a quote please?').formality).toBe(
      'unknown',
    )
  })

  it('treats plural "ihr/euch" as informal', () => {
    const result = detectLanguageAndFormality('Hallo, könnt ihr uns ein Angebot schicken? Danke euch!')
    expect(result.formality).toBe('du')
  })
})

describe('F1.15 — resolving the voice we actually write in', () => {
  it('mirrors a confident detection', () => {
    const detection = detectLanguageAndFormality(
      "Hi, we're getting married next June and we are looking for a planner for about 80 guests.",
    )
    expect(resolveVoice(detection, DEFAULTS).language).toBe('en')
  })

  it('falls back to the agency default when detection is unsure', () => {
    const detection = detectLanguageAndFormality('Hi')
    expect(resolveVoice(detection, DEFAULTS).language).toBe('de')
  })

  it('falls back to the agency default formality when the customer gave no signal', () => {
    const detection = detectLanguageAndFormality('Hallo, wir suchen ein Angebot für eine Hochzeit.')
    expect(detection.formality).toBe('unknown')
    expect(resolveVoice(detection, DEFAULTS).formality).toBe('sie')
  })

  it('agency override wins over a confident detection', () => {
    // Markus's corporate agency addresses procurement departments. It is never "du",
    // whatever the customer writes.
    const detection = detectLanguageAndFormality(
      'Hey, kannst du uns ein Angebot schicken? Wir würden uns über deine Antwort freuen.',
    )
    expect(detection.formality).toBe('du')

    const resolved = resolveVoice(detection, {
      ...DEFAULTS,
      forceFormality: 'sie',
      forceLanguage: 'de',
    })
    expect(resolved.formality).toBe('sie')
    expect(resolved.language).toBe('de')
  })
})
