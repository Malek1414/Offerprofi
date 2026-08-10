/**
 * The qualifying loop — keep asking until the caterer could actually answer.
 *
 * This is the product. Everything else is plumbing around it: a customer describes an
 * event in whatever order it occurs to her, and something has to notice what is still
 * missing and ask for it without turning the conversation into a form.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MODEL WRITES THE QUESTIONS. IT DOES NOT DECIDE WHEN TO STOP.
 *
 * `readyToSend` is computed here from `evaluateRequest`, the same confidence table
 * the spec has had since §4.10, and the model is never asked for it. It is told
 * which fields are missing; it chooses the wording and the order. That split is the
 * D6 rule applied to conversation instead of arithmetic — the part where being wrong
 * is expensive stays in code, and the part where being human matters goes to the
 * model.
 *
 * Given the same request state, this function always agrees with itself about whether
 * the enquiry is ready. A model asked "is this enough?" would not.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CONTEXT IS BOUNDED, WHICH IS WHY IT CANNOT DRIFT.
 *
 * The AI's memory is not the chat log. Each turn it receives the structured request
 * (small, typed, and the accumulated result of every previous turn), the list of
 * fields still missing, and the last few messages. A conversation eighty messages
 * long sends no more context than one four messages long, because the state carries
 * forward and the transcript does not. Nothing load-bearing lives only in scrolled-off
 * history, so there is no window to overflow and nothing to hallucinate back.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { z } from 'zod'

import {
  type CateringRequest,
  type RequiredRequestField,
  evaluateRequest,
} from '../domain/catering-request'
import { requestRows } from '../requests/summary'
import { type ModelFailureKind, callModel, jsonSchemaFor } from './client'
import type { UntrustedDocument } from './prompt'
import { normaliseModelText } from './text'

export const QUALIFY_VERSION = '2026-08-10.2'

/** Two at a time. Three reads as an interrogation and she stops answering. */
export const MAX_QUESTIONS_PER_TURN = 2
export const MAX_QUESTION_CHARS = 280

/** How much transcript to send. A qualifying conversation is short; the state carries the rest. */
export const TRANSCRIPT_WINDOW = 10

/**
 * Fields worth a question even though a caterer could answer without them.
 *
 * Ordered by how much they change the answer he gives. Dietary is first because it is
 * the thing caterers most often get wrong and the most expensive to discover late.
 */
const VALUABLE_OPTIONAL = [
  'dietary',
  'fulfilment',
  'durationHours',
  'requestedItems',
  'budgetIndication',
] as const satisfies readonly (keyof CateringRequest)[]

export type AskableField = RequiredRequestField | (typeof VALUABLE_OPTIONAL)[number]

const QualifyPayloadSchema = z.object({
  /**
   * Deliberately no field by which the model can decline an enquiry, route it away,
   * or judge it not worth pursuing. Invariant 1 in the output schema: there are two
   * outcomes, a question or a summary, and neither of them is "no".
   */
  questions: z.array(z.object({ field: z.string(), text: z.string() })),
})

export type QualifyPayload = z.infer<typeof QualifyPayloadSchema>

export interface QualifyInput {
  agencyId: string
  inquiryId?: string | null
  request: CateringRequest
  /** Oldest first; only the tail is sent. Untrusted, every one of them. */
  messages: readonly { id: string; text: string }[]
  agencyName: string
  ownerName: string
  /**
   * Facts about this caterer, already confirmed by him. Phase C fills this from the
   * knowledge layer; an empty list simply produces more generic questions.
   */
  facts?: readonly string[]
}

export interface QualifySuccess {
  ok: true
  /** Computed here, never by the model. */
  readyToSend: boolean
  /** Empty when ready. At most MAX_QUESTIONS_PER_TURN. */
  questions: { field: AskableField; text: string }[]
  summary: string
  missingRequired: RequiredRequestField[]
  runId: string | null
  costMicroCents: number | null
}

export interface QualifyFailure {
  ok: false
  failure: ModelFailureKind | 'unparseable'
  escalate: true
  detail: string
}

export type QualifyOutcome = QualifySuccess | QualifyFailure

/** Required fields that are missing or too uncertain to rely on. */
export function missingRequired(request: CateringRequest): RequiredRequestField[] {
  const verdict = evaluateRequest(request)
  if (verdict.action === 'auto_price') return []
  return verdict.fields
}

/** What it is worth asking about right now, most important first. */
export function askableFields(request: CateringRequest): AskableField[] {
  const missing = missingRequired(request)
  const optional = VALUABLE_OPTIONAL.filter((field) => {
    const value = request[field]
    return Array.isArray(value) ? value.length === 0 : value === undefined
  })
  return [...missing, ...optional]
}

export async function qualify(input: QualifyInput): Promise<QualifyOutcome> {
  const missing = missingRequired(input.request)
  const readyToSend = missing.length === 0
  const askable = askableFields(input.request)

  // Once code says the request is ready, no prose-generation call is needed. The
  // summary comes from the typed request, so it cannot invent a service, condition,
  // contact detail or location caveat, and its layout is stable on every run.
  if (readyToSend) {
    return {
      ok: true,
      readyToSend: true,
      questions: [],
      summary: customerSummary(input.request),
      missingRequired: [],
      runId: null,
      costMicroCents: null,
    }
  }

  const documents: UntrustedDocument[] = input.messages
    .slice(-TRANSCRIPT_WINDOW)
    .map((m) => ({ id: m.id, source: 'customer_message', text: m.text }))

  const outcome = await callModel({
    purpose: 'qualifying_question',
    agencyId: input.agencyId,
    inquiryId: input.inquiryId,
    role: buildRole(input),
    instruction: buildInstruction(input.request, askable, readyToSend, input.facts ?? []),
    documents,
    outputSchema: jsonSchemaFor(QualifyPayloadSchema),
    effort: 'low',
  })

  if (!outcome.ok) {
    return { ok: false, failure: outcome.failure, escalate: true, detail: outcome.detail }
  }

  let payload: QualifyPayload
  try {
    payload = QualifyPayloadSchema.parse(JSON.parse(outcome.text))
  } catch (error) {
    return {
      ok: false,
      failure: 'unparseable',
      escalate: true,
      detail: error instanceof Error ? error.message : String(error),
    }
  }

  return {
    ok: true,
    readyToSend,
    // Filtered and capped here rather than trusted from the response. A question about
    // something she already told us reads as not listening, which is the fastest way
    // to lose a conversation this product exists to keep.
    questions: readyToSend ? [] : selectQuestions(payload.questions, askable),
    summary: '',
    missingRequired: missing,
    runId: outcome.runId,
    costMicroCents: outcome.costMicroCents,
  }
}

export function selectQuestions(
  proposed: readonly { field: string; text: string }[],
  askable: readonly AskableField[],
): { field: AskableField; text: string }[] {
  const allowed = new Set<string>(askable)
  const seen = new Set<string>()
  const kept: { field: AskableField; text: string }[] = []

  for (const q of proposed) {
    if (!allowed.has(q.field) || seen.has(q.field)) continue
    const text = normaliseModelText(q.text)
    if (!text) continue
    if (text.length > MAX_QUESTION_CHARS) continue
    if ((text.match(/\?/g)?.length ?? 0) > 1) continue
    seen.add(q.field)
    kept.push({ field: q.field as AskableField, text })
    if (kept.length === MAX_QUESTIONS_PER_TURN) break
  }
  return kept
}

/** A compact, grounded recap from the same rows used in the request document. */
export function customerSummary(request: CateringRequest): string {
  const language = request.language === 'en' ? 'en' : 'de'
  const rows = requestRows(request, 'customer', language)
  const heading = language === 'de' ? 'Das habe ich verstanden:' : 'Here’s what I understood:'
  return [heading, '', ...rows.map((row) => `• ${row.label}: ${row.value}`)].join('\n')
}

// ── Prompt ───────────────────────────────────────────────────────────────────

export function buildRole(input: QualifyInput): string {
  return [
    `You are the assistant for ${input.agencyName}, a caterer. You are talking to someone`,
    `who wants to book catering, and your only job is to understand what they want well`,
    `enough that ${input.ownerName} can answer properly.`,
    '',
    'You never state, estimate, imply or hint at a price, a rate, a per-head figure or a',
    'discount — not a range, not "usually around", not even to be helpful. Pricing is',
    `${input.ownerName}'s and only ${input.ownerName}'s. If asked what it costs, say plainly`,
    'that he will price it himself and that the request is on its way to him.',
    '',
    'You never turn anyone away, never say an enquiry is too small, too late, too far or',
    'not a fit, and never suggest they try someone else. If something looks difficult,',
    'that is his call to make and he will make it.',
  ].join(' ')
}

/**
 * The structured state goes in as **our** text, not hers.
 *
 * Only typed values are rendered here — enums, numbers, booleans, dates. They came
 * from her conversation but they have been through a schema on the way, so there is
 * no arrangement of characters she can type that ends up in this paragraph. Her free
 * text stays where it belongs, inside the untrusted blocks.
 */
export function renderState(request: CateringRequest): string {
  const lines: string[] = []
  const add = (label: string, value: unknown) => {
    if (value !== undefined && value !== null) lines.push(`- ${label}: ${value}`)
  }

  add('occasion', request.occasion?.value)
  add('date', request.eventDate?.value)
  add('date is flexible', request.dateFlexible?.value)
  add('headcount', request.headcount?.value)
  add('service style', request.serviceStyle?.value)
  add('meal', request.mealType?.value)
  add('fulfilment', request.fulfilment?.value)
  add('duration in hours', request.durationHours?.value)
  add('staff needed', request.staffingNeeded?.value)
  add('venue given', request.venue ? 'yes' : undefined)
  add('dietary notes given', request.dietary?.length)
  add('specific items requested', request.requestedItems?.length)
  add(
    'budget she mentioned',
    request.budgetIndication
      ? `${request.budgetIndication.value.amount} EUR ${request.budgetIndication.value.basis}`
      : undefined,
  )

  return lines.length ? lines.join('\n') : '- nothing yet'
}

export function buildInstruction(
  request: CateringRequest,
  askable: readonly AskableField[],
  readyToSend: boolean,
  /** Confirmed facts about this caterer (Phase C). Ours, so not an untrusted block. */
  facts: readonly string[] = [],
): string {
  const voice = [
    `Write in ${request.language === 'de' ? 'German' : 'English'}`,
    request.formality === 'du'
      ? 'using du'
      : request.formality === 'sie'
        ? 'using Sie'
        : 'matching how she has been addressing you',
  ].join(', ')

  const parts = [
    'Here is what we already understand about this enquiry, gathered from the whole',
    'conversation so far:',
    '',
    renderState(request),
    '',
    `${voice}.`,
    '',
  ]

  if (facts.length) {
    parts.push(
      'Facts about this caterer, confirmed by him. Use them to ask better questions —',
      'if he only delivers within a radius, ask where before asking anything else.',
      '',
      ...facts.map((fact) => `- ${fact}`),
      '',
      // Without this, a minimum order becomes a refusal within two turns: the model
      // reads "at least 20 people", sees 12, and helpfully tells her she is too
      // small. That is the exact sentence Invariant 1 exists to make impossible,
      // and a fact is the most natural-sounding reason to produce it.
      'These tell you what to ask about. They are never a reason to turn someone away,',
      'and you never quote one back as a rule she has broken. If her enquiry sits',
      'outside one of them, that is his decision to make and you simply pass it on.',
      '',
    )
  }

  if (readyToSend) {
    parts.push(
      'We now have everything needed. Return an empty questions array and write the',
      'summary: a short, warm, readable recap of what she has asked for, in prose or a',
      'few short lines, so she can check it before it goes to the caterer. Mention',
      'anything you are unsure about so she can correct it. Do not mention money.',
    )
  } else {
    parts.push(
      `Ask at most ${MAX_QUESTIONS_PER_TURN} questions, choosing from these fields and no`,
      `others: ${askable.join(', ')}.`,
      '',
      'Rules for the questions:',
      '- Ask about what is genuinely still open. Never ask about something already',
      '  listed above — she told you once and asking again reads as not listening.',
      '- One field per question, and set `field` to the exact name from the list.',
      '- Write them the way a person would ask, not as form labels. Each question text',
      '  must contain exactly one question, one question mark, and no more than 280',
      '  characters. Never join a second question with "and", "und" or a new clause.',
      '- A brief acknowledgement plus one concise question is enough. No numbered list,',
      '  no markdown, no filler and no recap of details that are not needed for it.',
      '- If she has just said something significant, acknowledge it in a few words',
      '  before asking. She is describing her wedding, not filling in a ticket.',
    )
  }

  return parts.join('\n')
}
