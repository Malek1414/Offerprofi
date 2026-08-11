/**
 * What the agent says on a turn (F1.7, F1.8, F1.13, F1.14).
 *
 * Pure. The route handler streams whatever this returns; it makes no wording
 * decisions of its own. Keeping composition out of the transport means the copy —
 * which carries the AI disclosure, the privacy notice and the non-binding framing —
 * is unit-tested rather than inspected by eye in a browser.
 *
 * **Everything in this file is deterministic, and that is the point.** The
 * acknowledgement, the disclosure, the privacy line and the handoff are assembled
 * from data we already hold, so they cost nothing and cannot fail — which is what
 * the sub-10s acknowledgement requires (F1.9). The model-written turns come from
 * `qualifying-turn.ts` and arrive on the same stream *behind* these, never in
 * front of them.
 */

import type { RequiredRequestField } from '../domain/catering-request'
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
  /** Phase B — the qualifying question the model wrote. */
  | 'question'
  /** Phase B — what we understood, for her to check before it goes to the caterer. */
  | 'summary'
  /** Phase B — the deterministic line under the summary. Never mentions money. */
  | 'summary_prompt'
  /**
   * A1 — she answered the summary with a yes, so the surface presses send for her.
   * Carries no authority of its own: the browser still calls the session-scoped
   * send endpoint, which is the one place an enquiry may leave from.
   */
  | 'send_now'
  /** Phase B / I5 — the agent could not continue, so a person is coming. Not a refusal. */
  | 'handoff'

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

  turns.push({
    kind: 'ack',
    text:
      input.isFirstTurn || input.triage.handling === 'owner_tray'
        ? input.ack.ackText
        : continuationAck(input.language, input.formality),
  })

  if (input.rate.outcome === 'accept_throttled') {
    turns.push({
      kind: 'throttle_notice',
      text: throttleNotice(input.language, input.formality),
    })
  }

  return turns
}

/** Later turns need confirmation, not the full first-contact SLA repeated verbatim. */
export function continuationAck(
  language: Language,
  formality: Exclude<Formality, 'unknown'>,
): string {
  if (language === 'de') {
    return formality === 'du' ? 'Danke, ich habe das ergänzt.' : 'Vielen Dank, ich habe das ergänzt.'
  }
  return 'Thank you, I’ve added that.'
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

/**
 * What the customer sees when the agent cannot continue (Phase B, I1 + I5).
 *
 * Every failure inside a qualifying turn lands here: a model timeout, an
 * unparseable response, a suspected injection, a write that would not go through.
 * They deliberately share one line, because the customer's situation is identical
 * in all of them — a person is taking over — and because a message that varied by
 * failure kind would eventually leak one that sounded like a rejection.
 *
 * It says nothing is wrong with her enquiry, names no fault, and promises the one
 * thing that is unconditionally true: what she wrote arrived, and a human has it.
 * No owner pronoun, because we do not know one.
 */
export function handoffNotice(
  language: Language,
  formality: Exclude<Formality, 'unknown'>,
  ownerName: string,
): string {
  if (language === 'de') {
    return formality === 'du'
      ? `Hier gebe ich lieber an einen Menschen ab: ${ownerName} hat deine Anfrage und ` +
          `meldet sich persönlich bei dir. Alles, was du geschrieben hast, ist angekommen.`
      : `Hier gebe ich lieber an einen Menschen ab: ${ownerName} hat Ihre Anfrage und ` +
          `meldet sich persönlich bei Ihnen. Alles, was Sie geschrieben haben, ist angekommen.`
  }
  return (
    `I'd rather hand this to a person: ${ownerName} has your enquiry and will get back ` +
    `to you personally. Everything you've written has come through.`
  )
}

/**
 * The line under the summary, once the request is complete enough to send.
 *
 * Deterministic rather than model-written, because it carries two commitments the
 * product cannot let a model phrase freshly each time: that she can still correct
 * anything, and that the price comes from the caterer himself. The second is the
 * customer-facing half of N1 — the assistant never prices, and it says so before
 * she has to ask.
 */
export function readyToSendLine(
  language: Language,
  formality: Exclude<Formality, 'unknown'>,
  ownerName: string,
): string {
  if (language === 'de') {
    return formality === 'du'
      ? `Passt das so? Dann schick es unten ab — oder schreib mir einfach "Ja". ` +
          `Sag gern Bescheid, wenn etwas fehlt oder anders ist. ` +
          `Das Angebot mit den Preisen macht ${ownerName} selbst — das kommt als Nächstes.`
      : `Passt das so? Dann schicken Sie es unten ab — oder schreiben Sie mir einfach "Ja". ` +
          `Sagen Sie gern Bescheid, wenn etwas fehlt oder anders ist. ` +
          `Das Angebot mit den Preisen macht ${ownerName} selbst — das kommt als Nächstes.`
  }
  return (
    `Does that look right? Send it below — or just reply "yes". ` +
    `Tell me if anything is missing or different. ` +
    `${ownerName} puts the offer and the prices together himself — that comes next.`
  )
}

/**
 * What she is told at the moment her yes is taken as a send.
 *
 * Deliberately past tense and free of any conditional: by the time this is on
 * screen the browser is already calling the send endpoint, and a line that hedged
 * would read as a question she has now answered twice.
 */
export function sendingNowLine(
  language: Language,
  formality: Exclude<Formality, 'unknown'>,
  ownerName: string,
): string {
  if (language === 'de') {
    return formality === 'du'
      ? `Alles klar — ich gebe deine Anfrage an ${ownerName} weiter.`
      : `Alles klar — ich gebe Ihre Anfrage an ${ownerName} weiter.`
  }
  return `Got it — I am passing your enquiry to ${ownerName}.`
}

/**
 * Our own wording for a missing field, used when the model returned no usable
 * question.
 *
 * A rare path, and worth having: the alternative to a plain question here is an
 * empty bubble or an escalation over a formatting slip. The fields are known in
 * code — the model was only ever adding the phrasing.
 */
export function missingFieldQuestion(
  field: RequiredRequestField,
  language: Language,
  formality: Exclude<Formality, 'unknown'>,
): string {
  const du = formality === 'du'
  if (language === 'de') {
    switch (field) {
      case 'eventDate':
        return 'Wann soll das Ganze stattfinden?'
      case 'headcount':
        return du ? 'Für wie viele Personen planst du?' : 'Für wie viele Personen planen Sie?'
      case 'venue':
        return 'Und wo findet es statt — Ort oder Location?'
      case 'serviceStyle':
        return 'Soll es ein Buffet werden, am Tisch serviert, oder eher Fingerfood?'
      case 'mealType':
        return 'Geht es um ein Abendessen, ein Mittagessen oder etwas Kleineres?'
    }
  }
  switch (field) {
    case 'eventDate':
      return 'When is it taking place?'
    case 'headcount':
      return 'Roughly how many people are you planning for?'
    case 'venue':
      return 'And where is it — the town or the venue?'
    case 'serviceStyle':
      return 'Would you like a buffet, plated service, or something more like finger food?'
    case 'mealType':
      return 'Is this dinner, lunch, or something lighter?'
  }
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
      // Phase D — the send control. Never says the request is "complete enough":
      // she decides when it is ready, and the button appears rather than unlocks.
      sendRequest: 'Anfrage jetzt senden',
      sendHint: du
        ? 'Du kannst vorher noch etwas ergänzen oder korrigieren.'
        : 'Sie können vorher noch etwas ergänzen oder korrigieren.',
      sentTitle: 'Anfrage ist raus.',
      sentBody: du
        ? 'Du bekommst Antwort auf dem Weg, den du angegeben hast.'
        : 'Sie bekommen Antwort auf dem Weg, den Sie angegeben haben.',
      viewSummary: 'Zusammenfassung ansehen',
      sendFailed: 'Das Senden hat gerade nicht geklappt. Bitte noch einmal versuchen.',
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
    sendRequest: 'Send my enquiry',
    sendHint: 'You can still add or correct anything first.',
    sentTitle: 'Your enquiry is on its way.',
    sentBody: "You'll hear back on whichever way you gave us.",
    viewSummary: 'View summary',
    sendFailed: "That didn't send. Please try again.",
  }
}
