/**
 * The caterer's reply becomes an offer (Phase E, N2).
 *
 * He types *"Samstag geht nicht, Sonntag ja. 78 pro Kopf statt 85, Getränke
 * extra, Anzahlung 30%"* into WhatsApp, standing in a kitchen. This turns that
 * into something a customer can read.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MODEL FORMATS. IT DOES NOT NEGOTIATE, AND IT DOES NOT PRICE.
 *
 * Every figure in the output must be one *he* wrote. The model may not round,
 * convert, total, discount, or add a number he did not say — including a number
 * it could correctly derive, because "78 × 80 = 6,240" is arithmetic, and
 * arithmetic is code's job (D6). If a total is wanted, he types one.
 *
 * D7 imagined an agent that concedes ground on its own. That does not exist here
 * and is not wanted: the concessions are his, made in his own words, and the
 * agent is a typist with good manners.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HE SEES IT BEFORE SHE DOES.
 *
 * `needsOwnerReview` is always true. Nothing this produces goes out unseen: it is
 * the human step that keeps the process non-automated (I3, I4), and it is also
 * plain professional sense — it is his business's voice.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { z } from 'zod'

import type { CateringRequest } from '../domain/catering-request'
import type { Formality, Language } from '../domain/event-brief'
import { type ModelFailureKind, callModel, jsonSchemaFor } from './client'
import type { UntrustedDocument } from './prompt'
import { renderState } from './qualify'

export const REWORK_VERSION = '2026-08-09.1'

const ReworkPayloadSchema = z.object({
  /** The offer, ready to send, in his voice and her language. */
  message: z.string(),
  /**
   * Every figure the draft contains, quoted from his reply. Not for display —
   * it is what makes the "no invented numbers" check possible in code rather
   * than by reading the prose.
   */
  figuresUsed: z.array(z.string()),
  /**
   * What he did not answer. Shown to him beside the draft, never to her: a draft
   * that quietly omits her allergy question is worse than one that flags it.
   */
  openPoints: z.array(z.string()),
})

export type ReworkPayload = z.infer<typeof ReworkPayloadSchema>

export interface ReworkRequest {
  agencyId: string
  inquiryId?: string | null
  /** What she asked for. Typed values only reach the prompt as our own text. */
  request: CateringRequest
  /** What he typed, verbatim. Untrusted in the prompt-injection sense — see below. */
  ownerReply: string
  agencyName: string
  ownerName: string
  language?: Language
  formality?: Exclude<Formality, 'unknown'>
}

export interface ReworkSuccess {
  ok: true
  message: string
  openPoints: string[]
  /**
   * Figures in the draft that do not appear in what he wrote. Empty is the
   * expected case; anything here is shown to him as a warning above the draft.
   */
  unsupportedFigures: string[]
  /** Always true. There is no path where a draft goes out unseen (I3, I4). */
  needsOwnerReview: true
  runId: string | null
  costMicroCents: number | null
}

export interface ReworkFailure {
  ok: false
  failure: ModelFailureKind | 'unparseable' | 'empty_reply'
  detail: string
}

export type ReworkOutcome = ReworkSuccess | ReworkFailure

/**
 * His reply is untrusted too, and that is not an insult.
 *
 * He is a trusted person, but the text is pasted through a third-party webhook we
 * do not control, and treating one text channel as trusted and another as not is
 * how the framing eventually gets skipped on the wrong one.
 */
const ROLE = [
  'You write a catering offer in the caterer\'s own voice, from notes he dictated.',
  'You are a typist, not a salesperson and not a calculator: you never invent a',
  'price, never compute a total he did not state, never offer a discount, and never',
  'agree to anything he did not say. If he did not answer something, you leave it out',
  'and report it rather than filling the gap.',
].join(' ')

export async function reworkReply(input: ReworkRequest): Promise<ReworkOutcome> {
  if (!input.ownerReply.trim()) {
    return { ok: false, failure: 'empty_reply', detail: 'the owner reply is empty' }
  }

  const documents: UntrustedDocument[] = [
    { id: 'owner_reply', source: 'owner_message', text: input.ownerReply },
  ]

  const outcome = await callModel({
    purpose: 'reply_drafting',
    agencyId: input.agencyId,
    inquiryId: input.inquiryId,
    role: ROLE,
    instruction: buildInstruction(input),
    documents,
    outputSchema: jsonSchemaFor(ReworkPayloadSchema),
    effort: 'low',
  })

  if (!outcome.ok) return { ok: false, failure: outcome.failure, detail: outcome.detail }

  let payload: ReworkPayload
  try {
    payload = ReworkPayloadSchema.parse(JSON.parse(outcome.text))
  } catch (error) {
    return {
      ok: false,
      failure: 'unparseable',
      detail: error instanceof Error ? error.message : String(error),
    }
  }

  return {
    ok: true,
    message: payload.message.trim(),
    openPoints: payload.openPoints.map((p) => p.trim()).filter(Boolean),
    unsupportedFigures: unsupportedFigures(payload.message, input.ownerReply),
    needsOwnerReview: true,
    runId: outcome.runId,
    costMicroCents: outcome.costMicroCents,
  }
}

/**
 * Numbers in the draft that he did not write.
 *
 * Checked in code, over the rendered message, because the model reporting its own
 * `figuresUsed` is the model marking its own homework. Digits are compared after
 * stripping separators, so `6.240` in the draft matches `6240` in his reply and a
 * genuinely new figure stands out.
 *
 * Reported, never corrected: silently editing his offer is worse than showing him
 * a warning above it.
 */
export function unsupportedFigures(draft: string, ownerReply: string): string[] {
  const said = new Set(numbersIn(ownerReply))
  const unsupported: string[] = []
  for (const figure of numbersIn(draft)) {
    if (!said.has(figure)) unsupported.push(figure)
  }
  return [...new Set(unsupported)]
}

/**
 * Every number in a piece of text, normalised.
 *
 * German and English thousands separators both collapse, so `6.240`, `6,240` and
 * `6240` are one figure. Percentages keep their sign as a plain number: 30% and
 * 30 are the same claim about a figure he stated.
 */
function numbersIn(text: string): string[] {
  const matches = text.match(/\d[\d.,]*/g) ?? []
  return matches
    .map((raw) => raw.replace(/[.,](?=\d{3}\b)/g, '').replace(/[.,]$/, ''))
    .map((raw) => raw.replace(',', '.'))
    .filter(Boolean)
}

export function buildInstruction(input: ReworkRequest): string {
  const language = input.language ?? input.request.language
  const formality = input.formality ?? input.request.formality
  const de = language === 'de'

  return [
    `Write to the customer in ${de ? 'German' : 'English'}`,
    formality === 'du'
      ? ', addressing her with du.'
      : formality === 'sie'
        ? ', addressing her with Sie.'
        : ', matching how she has been addressing the business.',
    '',
    `You are writing as ${input.agencyName}. Sign off as ${input.ownerName}.`,
    '',
    'This is what she asked for:',
    '',
    // Typed values only. Her free text is not repeated back through a second model
    // call; the caterer has read it and is answering it.
    renderState(input.request),
    '',
    "His reply is in the block below, in his own words. Turn it into a clear offer.",
    '',
    'Rules, in order of importance:',
    '- Every price, percentage, date and quantity in your message must be one he',
    '  wrote. Do not compute totals, do not convert per-head into a sum, do not round.',
    '  If he wrote "78 pro Kopf", the offer says 78 per head and no total appears.',
    '- Do not add a service, a condition or a concession he did not mention.',
    '- Where he said no to something, say so plainly and warmly. A "Samstag geht',
    '  nicht" is not a rejection of her — it is a date that does not work.',
    '- Keep his tone. If he is brief, the offer is brief.',
    '- List anything of hers he did not address in `openPoints`. Do not answer it',
    '  yourself and do not mention it in the message.',
    '- Put every figure that appears in your message into `figuresUsed`, exactly as',
    '  you wrote it.',
  ].join('\n')
}
