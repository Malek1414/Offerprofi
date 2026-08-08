/**
 * Language and formality detection (F1.15, decision D19).
 *
 * We mirror the customer: they write German, we answer German; they write "du", we
 * answer "du". Getting Sie/Du wrong is not a rounding error to a German speaker —
 * an unsolicited "du" from a business reads as presumptuous, and a stiff "Sie" from
 * a wedding planner reads as cold. This is the first impression, on the surface
 * whose whole job is to feel like a fast, human reply.
 *
 * Deterministic on purpose. This runs on the first message, inside the sub-10s
 * acknowledgement budget (F1.9), so it cannot wait on a model round-trip. It is
 * also code we can unit-test, which "ask Claude what language this is" is not.
 *
 * The agency override always wins (F1.15 acceptance). An agency that has set
 * `sie` gets `sie` even from a customer who opens with "hey ihr :)".
 */

import type { Formality, Language } from '../domain/event-brief'

export interface DetectionResult {
  language: Language
  formality: Formality
  /** 0–1. Below `MIN_CONFIDENCE` the caller should fall back to the agency default. */
  confidence: number
}

export interface AgencyLanguageDefaults {
  /** Fallback when detection is unsure. */
  language: Language
  /** Fallback when the customer has given no formality signal. */
  formality: Exclude<Formality, 'unknown'>
  /** Hard override — the agency always writes this way regardless of the customer. */
  forceLanguage?: Language
  /** Hard override — e.g. a corporate agency that is never "du". */
  forceFormality?: Exclude<Formality, 'unknown'>
}

export const MIN_CONFIDENCE = 0.6

/**
 * Function words, not topic words.
 *
 * Content words travel between languages — a German inquiry says "Event",
 * "Catering", "Location" and "Team" as readily as an English one. Articles,
 * pronouns and prepositions do not, so they are what actually separates the two.
 */
const GERMAN_MARKERS = [
  'und', 'oder', 'aber', 'nicht', 'auch', 'noch', 'schon', 'sehr', 'mit', 'ohne',
  'für', 'von', 'bei', 'nach', 'über', 'unter', 'wir', 'uns', 'unsere', 'unser',
  'ich', 'mein', 'meine', 'ist', 'sind', 'wäre', 'wären', 'hätte', 'haben', 'hat',
  'werden', 'wird', 'können', 'könnten', 'möchte', 'möchten', 'brauchen', 'suchen',
  'gerne', 'bitte', 'danke', 'hallo', 'guten', 'liebe', 'lieber', 'grüße', 'viele',
  'das', 'der', 'die', 'ein', 'eine', 'einen', 'einem', 'dass', 'wenn', 'weil',
  'hochzeit', 'anfrage', 'angebot', 'gäste', 'personen', 'termin', 'uhrzeit',
]

const ENGLISH_MARKERS = [
  'and', 'or', 'but', 'not', 'also', 'still', 'already', 'very', 'with', 'without',
  'for', 'from', 'at', 'after', 'about', 'under', 'we', 'us', 'our', 'ours',
  'i', 'my', 'mine', 'is', 'are', 'would', 'could', 'have', 'has', 'had',
  'will', 'can', 'want', 'need', 'looking', 'please', 'thanks', 'hello', 'hi',
  'the', 'a', 'an', 'that', 'if', 'because', 'wedding', 'inquiry', 'quote',
  'guests', 'people', 'date', 'time',
]

/**
 * Characters that only German uses here. Worth extra weight because a single "ä"
 * settles a short message that has too few words to count reliably — and short
 * messages are the common case ("Hi, Hochzeit für 80 Gäste im Juni?").
 */
const GERMAN_CHARS = /[äöüßÄÖÜ]/

const DU_MARKERS = [
  'du', 'dich', 'dir', 'dein', 'deine', 'deinen', 'deinem', 'deiner', 'deins',
  'ihr', 'euch', 'euer', 'eure', 'euren', 'eurem',
]

/**
 * The formal pronouns, matched **case-sensitively**.
 *
 * This is the whole difficulty of German formality detection: lowercase "sie" is
 * "she" or "they" and says nothing about register, while capitalised "Sie" mid-
 * sentence is the formal address. "Ich habe sie gesehen" is not formal; "Können Sie
 * mir helfen" is. A case-insensitive match would read almost every German message
 * as formal and quietly destroy the mirroring.
 */
const SIE_MARKERS = ['Sie', 'Ihnen', 'Ihr', 'Ihre', 'Ihren', 'Ihrem', 'Ihrer', 'Ihres']

/** Sentence-initial "Sie" is ambiguous — capitalisation there is just grammar. */
function countFormalPronouns(text: string): number {
  let count = 0
  // Split on sentence boundaries so the first token of each sentence can be skipped.
  for (const sentence of text.split(/(?<=[.!?…])\s+|\n+/)) {
    const tokens = sentence.trim().split(/[^A-Za-zÄÖÜäöüß]+/).filter(Boolean)
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      if (token === undefined) continue
      if (i === 0) continue
      if (SIE_MARKERS.includes(token)) count++
    }
  }
  return count
}

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-zäöüß]+/)
    .filter(Boolean)
}

/**
 * Detect from raw customer text.
 *
 * The text is data, never instruction (CLAUDE.md §7). Nothing here interprets what
 * the message asks for — it counts tokens.
 */
export function detectLanguageAndFormality(text: string): DetectionResult {
  const tokens = tokenise(text)

  if (tokens.length === 0) {
    return { language: 'de', formality: 'unknown', confidence: 0 }
  }

  const unique = new Set(tokens)
  let germanHits = 0
  let englishHits = 0
  for (const token of unique) {
    if (GERMAN_MARKERS.includes(token)) germanHits++
    if (ENGLISH_MARKERS.includes(token)) englishHits++
  }

  // An umlaut or ß is near-conclusive; weight it like three function words so it
  // can carry a message too short for the token counts to mean anything.
  if (GERMAN_CHARS.test(text)) germanHits += 3

  const totalHits = germanHits + englishHits
  const language: Language = germanHits >= englishHits ? 'de' : 'en'

  // Confidence is the winning share of the evidence, scaled down when there is
  // barely any evidence at all. "Hi" matches one English marker and should not
  // come back as certain.
  const share = totalHits === 0 ? 0.5 : Math.max(germanHits, englishHits) / totalHits
  const evidenceScale = Math.min(1, totalHits / 4)
  const confidence = Number((share * evidenceScale).toFixed(2))

  return { language, formality: detectFormality(text, language), confidence }
}

/**
 * Formality only exists as a distinction in German. An English speaker gets
 * `unknown`, and the renderer simply writes English — there is no "du" to get wrong.
 */
function detectFormality(text: string, language: Language): Formality {
  if (language !== 'de') return 'unknown'

  const formal = countFormalPronouns(text)
  const informal = tokenise(text).filter((t) => DU_MARKERS.includes(t)).length

  if (formal === 0 && informal === 0) return 'unknown'
  if (formal > informal) return 'sie'
  if (informal > formal) return 'du'
  // A tie means genuinely mixed signals. Resolving it to `unknown` sends the
  // decision to the agency default, which is the safe place for it — guessing
  // "du" at a customer who also wrote "Sie" is the expensive mistake.
  return 'unknown'
}

/**
 * Resolve what we will actually write in, combining detection with agency policy.
 *
 * Order: hard override → confident detection → agency default. The override exists
 * because a corporate-event agency addressing procurement departments may never say
 * "du", whatever the customer does.
 */
export function resolveVoice(
  detection: DetectionResult,
  defaults: AgencyLanguageDefaults,
): { language: Language; formality: Exclude<Formality, 'unknown'> } {
  const language =
    defaults.forceLanguage ??
    (detection.confidence >= MIN_CONFIDENCE ? detection.language : defaults.language)

  const formality =
    defaults.forceFormality ??
    (detection.formality === 'unknown' ? defaults.formality : detection.formality)

  return { language, formality }
}
