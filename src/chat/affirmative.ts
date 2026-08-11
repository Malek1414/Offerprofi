/**
 * Is her reply a "send it"? (A1)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO MODEL READS THIS, AND NONE EVER SHOULD.
 *
 * The answer decides whether an enquiry leaves for the caterer, and
 * `src/app/api/chat/[slug]/send/route.ts` is explicit that the send is hers
 * alone. A model classifying intent here would put a judgement call in the path
 * of an irreversible outward action, and a misread would send something she was
 * still editing. A closed word list is worse at unusual phrasings and cannot be
 * talked into anything — the send button remains, so an unmatched phrasing costs
 * her a tap, never a wrong send.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Only consulted once the request is already complete and the summary has been
 * shown. Before that a "ja" is an answer to a qualifying question, not a send.
 */

import type { Language } from '../domain/event-brief'

const AFFIRMATIVES: Readonly<Record<Language, readonly string[]>> = {
  de: ['ja', 'jo', 'jep', 'passt', 'passt so', 'genau', 'gerne', 'perfekt', 'stimmt', 'korrekt'],
  en: ['yes', 'yep', 'yeah', 'correct', 'right', 'looks right', 'send it', 'go ahead', 'ok', 'okay'],
}

/**
 * Words that turn a yes into a change request.
 *
 * "Ja, aber die Uhrzeit stimmt nicht" is a correction wearing a yes. Sending on it
 * hands the caterer a request she was in the middle of fixing, so anything
 * carrying one of these is treated as more conversation, not as a send.
 */
const QUALIFIERS: readonly string[] = [
  'aber',
  'nur',
  'allerdings',
  'jedoch',
  'außer',
  'ausser',
  'ändern',
  'aendern',
  'korrigieren',
  'but',
  'however',
  'except',
  'only',
  'change',
  'wrong',
  'instead',
]

export function isSendAffirmative(text: string, language: Language): boolean {
  const normalised = text.trim().toLowerCase()
  if (!normalised) return false

  const opensWithYes = AFFIRMATIVES[language].some(
    (word) =>
      normalised === word ||
      normalised.startsWith(`${word} `) ||
      normalised.startsWith(`${word},`) ||
      normalised.startsWith(`${word}.`) ||
      normalised.startsWith(`${word}!`),
  )
  if (!opensWithYes) return false

  return !QUALIFIERS.some((q) => new RegExp(`\\b${q}\\b`).test(normalised))
}
