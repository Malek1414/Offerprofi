/**
 * What the agent says on a turn (F1.7, F1.8, F1.13, F1.14).
 *
 * Pure. The route handler streams whatever this returns; it makes no wording
 * decisions of its own. Keeping composition out of the transport means the copy —
 * which carries the AI disclosure, the privacy notice and the non-binding framing —
 * is unit-tested rather than inspected by eye in a browser.
 *
 * **Phase 1 scope.** There is no model call here yet. Everything on this path is
 * deterministic text assembled from data we already hold, which is exactly what the
 * sub-10s acknowledgement requires (F1.9). The qualifying loop that asks about guest
 * counts and dates is Phase 3, and it will slot in after the ack rather than in
 * front of it — the ack must never come to depend on a model round-trip.
 */

import type { Formality, Language } from '../domain/event-brief'
import type { AckPlan } from './ack'
import type { TriageResult } from './abuse'
import { type RateLimitDecision, throttleNotice } from './rate-limit'

export type AgentTurnKind =
  /** F1.8 / D25 — the AI disclosure. Always the first thing said, on turn one. */
  | 'disclosure'
  /** F1.13 — Art. 13 privacy link, at first contact. */
  | 'privacy'
  /** F1.9 — the acknowledgement. */
  | 'ack'
  /** F1.6 — reassurance while catching up. Never a reproach. */
  | 'throttle_notice'
  /** F1.14 / I5 — confirmation that a person has been brought in. */
  | 'paused'

export interface AgentTurn {
  kind: AgentTurnKind
  text: string
}

export interface ComposeInput {
  /** True only for the very first assistant turn of a conversation. */
  isFirstTurn: boolean
  ack: AckPlan
  triage: TriageResult
  rate: RateLimitDecision
  language: Language
  formality: Exclude<Formality, 'unknown'>
  /** True when the customer has asked for a human (I5). */
  automationPaused: boolean
}

export function composeAgentTurns(input: ComposeInput): AgentTurn[] {
  const turns: AgentTurn[] = []

  // The disclosure leads. Not a footer, not a tooltip, not after she has shared her
  // wedding date — the first thing the assistant says (D25, Art. 50(1)).
  if (input.isFirstTurn) {
    turns.push({ kind: 'disclosure', text: input.ack.disclosure.openingLine })
    turns.push({ kind: 'privacy', text: input.ack.disclosure.privacyLine })
  }

  if (input.automationPaused) {
    // Once a person is involved, the agent stops offering to build a quote. It
    // confirms the handover and gets out of the way.
    turns.push({ kind: 'paused', text: input.ack.ackText })
    return turns
  }

  turns.push({ kind: 'ack', text: input.ack.ackText })

  if (input.rate.outcome === 'accept_throttled') {
    turns.push({
      kind: 'throttle_notice',
      text: throttleNotice(input.language, input.formality),
    })
  }

  return turns
}

/**
 * Chunk a turn for streaming (F1.7).
 *
 * Split on whitespace, keeping the trailing space on each chunk so the reassembled
 * text is byte-identical to the input. A streamed message that renders differently
 * from the stored one would make the disclosure record — which must be provable —
 * a record of something the customer did not quite see.
 */
export function streamChunks(text: string): string[] {
  const chunks = text.match(/\S+\s*/g)
  return chunks ?? []
}

/**
 * What the customer sees the moment they tap "mit {Owner} sprechen" (F1.14).
 *
 * Available on every turn, including mid-stream, so it is composed independently of
 * the turn pipeline — it must work when the pipeline is the thing being interrupted.
 */
export function humanRequestedNotice(
  language: Language,
  formality: Exclude<Formality, 'unknown'>,
  ownerName: string,
): string {
  if (language === 'de') {
    return formality === 'du'
      ? `Ich habe ${ownerName} Bescheid gegeben — sie meldet sich persönlich bei dir. ` +
          `Bis dahin schreibe ich hier nichts mehr automatisch.`
      : `Ich habe ${ownerName} Bescheid gegeben — sie meldet sich persönlich bei Ihnen. ` +
          `Bis dahin schreibe ich hier nichts mehr automatisch.`
  }
  return (
    `I've let ${ownerName} know — she'll get back to you personally. ` +
    `I won't post anything automatically here in the meantime.`
  )
}

/** Static UI strings for the chat surface, in both languages at real German length. */
export function chatStrings(language: Language, formality: Exclude<Formality, 'unknown'>) {
  if (language === 'de') {
    const du = formality === 'du'
    return {
      inputLabel: 'Nachricht',
      inputPlaceholder: du
        ? 'Erzähl kurz, was du planst …'
        : 'Erzählen Sie kurz, was Sie planen …',
      send: 'Senden',
      sending: 'Wird gesendet …',
      attach: 'Datei anhängen',
      attachHint: 'Bilder, PDF oder Screenshots — bis 25 MB',
      typing: 'schreibt …',
      emptyTitle: 'Anfrage starten',
      emptyBody: du
        ? 'Schreib einfach, was du vorhast — Datum, ungefähre Personenzahl und was du brauchst. ' +
          'Der Rest ergibt sich im Gespräch.'
        : 'Schreiben Sie einfach, was Sie vorhaben — Datum, ungefähre Personenzahl und was Sie ' +
          'brauchen. Der Rest ergibt sich im Gespräch.',
      privacy: 'Datenschutz',
      imprint: 'Impressum',
      errorTitle: 'Das hat gerade nicht geklappt',
      errorBody: du
        ? 'Deine Nachricht ist nicht angekommen. Versuch es bitte noch einmal — ' +
          'oder sprich direkt mit uns.'
        : 'Ihre Nachricht ist nicht angekommen. Versuchen Sie es bitte noch einmal — ' +
          'oder sprechen Sie direkt mit uns.',
      retry: 'Nochmal senden',
      uploading: 'Wird hochgeladen …',
      scanning: 'Wird geprüft …',
      uploadTooLarge: 'Die Datei ist größer als 25 MB.',
      uploadTooMany: 'Mehr als 10 Dateien gehen leider nicht.',
      uploadUnsupported: 'Dieses Dateiformat können wir nicht lesen.',
      uploadEmpty: 'Die Datei ist leer.',
    }
  }
  return {
    inputLabel: 'Message',
    inputPlaceholder: 'Tell us briefly what you are planning …',
    send: 'Send',
    sending: 'Sending …',
    attach: 'Attach a file',
    attachHint: 'Images, PDF or screenshots — up to 25 MB',
    typing: 'typing …',
    emptyTitle: 'Start your inquiry',
    emptyBody:
      'Just write what you have in mind — the date, roughly how many people, and what you ' +
      'need. We can work out the rest as we go.',
    privacy: 'Privacy',
    imprint: 'Imprint',
    errorTitle: "That didn't go through",
    errorBody: 'Your message did not arrive. Please try again — or talk to us directly.',
    retry: 'Send again',
    uploading: 'Uploading …',
    scanning: 'Checking …',
    uploadTooLarge: 'That file is larger than 25 MB.',
    uploadTooMany: 'Sorry, 10 files is the maximum.',
    uploadUnsupported: "We can't read that file format.",
    uploadEmpty: 'That file is empty.',
  }
}
