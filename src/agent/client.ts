/**
 * The Anthropic client (F0.11).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS THE ONLY FILE IN THE PRODUCT THAT MAY IMPORT `@anthropic-ai/sdk`.
 *
 * F0.11's acceptance criterion is "no model call exists outside the wrapper",
 * enforced two ways: a lint rule in eslint.config.mjs, and a test in
 * tests/agent/boundary.test.ts that walks the tree. The boundary is worth that
 * much because three things hang off it and each is invisible if a second call
 * site appears — the `agent_runs` row that answers open question #3, the
 * untrusted-input framing that keeps customer text as data (F3.11), and the
 * guarantee below that a model failure never reaches a customer as a refusal.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FUNCTION DOES NOT THROW, AND THAT IS INVARIANT 1 IN THE TYPE SYSTEM.
 *
 * Every outcome is `{ ok: true }` or a failure carrying `escalate: true`. There is
 * no third case, and no failure kind means "tell the customer no" — because the
 * two outcomes a customer may ever see are an offer or a human, and an API
 * timeout is emphatically not a reason to turn her away. A throw here would
 * surface as a 500 on the chat surface, which reads to a bride as "this agency's
 * system rejected me" — the exact thing §2 exists to make impossible.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * D17: processing runs under the Anthropic DPA with no training use and zero
 * retention where available. Zero retention is an account-level setting rather
 * than a request parameter, so it cannot be asserted from here — what can be
 * asserted is that no model ineligible for it is reachable, which is the check in
 * `supportsZeroRetention` below.
 */

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { ZodType } from 'zod'

import {
  type ModelId,
  type TokenUsage,
  costMicroCents,
  isKnownModel,
  supportsZeroRetention,
} from './cost'
import { type UntrustedDocument, buildPrompt } from './prompt'
import { contentRef, failureRef, recordAgentRun } from './runs'

/**
 * What the call was for. Written to `agent_runs.purpose`, which is what makes
 * cost attributable per stage rather than per month.
 */
export type AgentPurpose =
  | 'extraction'
  | 'qualifying_question'
  | 'service_mapping'
  | 'reply_drafting'
  | 'onboarding_extraction'

export const DEFAULT_MODEL: ModelId = 'claude-opus-5'

/**
 * Defaults tuned for the calls this product actually makes: one short structured
 * answer about one inquiry. Callers that need more raise them explicitly.
 */
const DEFAULT_MAX_TOKENS = 8_000
const DEFAULT_TIMEOUT_MS = 45_000
/**
 * One retry, not the SDK's default two. Retries are worth having on a 429 or a
 * 529, and the worst case here is two timeouts back to back — 90 seconds. At the
 * SDK default it would be 135, and the customer has been promised a quote in
 * five minutes, not a spinner for two of them.
 */
const MAX_RETRIES = 1

export interface ModelRequest {
  purpose: AgentPurpose
  /** Whose bill this is. Required — an unattributed call is an unanswerable cost question. */
  agencyId: string
  inquiryId?: string | null
  /** Trusted. Ours. Who the model is for this call. */
  role: string
  /** Trusted. Ours. What to do with the customer content. */
  instruction: string
  /** Untrusted. Escaped and labelled by buildPrompt — see prompt.ts. */
  documents?: readonly UntrustedDocument[]
  model?: ModelId
  maxTokens?: number
  timeoutMs?: number
  /** Lower effort is cheaper and faster; these are short, well-specified tasks. */
  effort?: 'low' | 'medium' | 'high'
  /**
   * When present, the model is constrained to this JSON schema and `text` is
   * guaranteed parseable. Callers still validate the parsed value — a schema
   * constrains shape, not sense.
   */
  outputSchema?: Record<string, unknown>
}

export type ModelFailureKind =
  | 'not_configured'
  | 'timeout'
  | 'rate_limited'
  | 'overloaded'
  | 'refused'
  | 'invalid_request'
  | 'transport'
  | 'empty_response'

export interface ModelSuccess {
  ok: true
  text: string
  model: string
  usage: TokenUsage
  latencyMs: number
  costMicroCents: number | null
  /** Null when nothing was written — the demo tenant path. */
  runId: string | null
}

export interface ModelFailure {
  ok: false
  failure: ModelFailureKind
  /**
   * Always true. Present as a field rather than implied so that a caller reading
   * `outcome.escalate` at the call site sees the rule, and so that a future kind
   * cannot be added that quietly means something else.
   */
  escalate: true
  /** For our logs. Never shown to a customer. */
  detail: string
  latencyMs: number
  runId: string | null
}

export type ModelOutcome = ModelSuccess | ModelFailure

/**
 * Map a transport failure to a kind.
 *
 * Split out and exported because it is the part worth testing: the SDK call
 * itself is a single line, but getting `429` wrong means a busy minute looks like
 * a broken integration and nobody investigates the right thing.
 */
export function failureFromStatus(status: number | undefined, name: string): ModelFailureKind {
  if (name === 'APIConnectionTimeoutError' || name === 'AbortError' || name === 'TimeoutError') {
    return 'timeout'
  }
  if (status === undefined) return 'transport'
  if (status === 429) return 'rate_limited'
  if (status === 529 || status === 503) return 'overloaded'
  if (status >= 500) return 'transport'
  if (status === 401 || status === 403) return 'not_configured'
  if (status >= 400) return 'invalid_request'
  return 'transport'
}

let client: Anthropic | null = null

function getClient(): Anthropic | null {
  if (client) return client
  if (!process.env.ANTHROPIC_API_KEY) return null
  client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: MAX_RETRIES })
  return client
}

/** Test seam. Resets the memoised client so a changed environment is picked up. */
export function resetClient(): void {
  client = null
}

/**
 * The JSON schema for `outputSchema`, derived from the zod schema the caller
 * already validates with.
 *
 * Here rather than at the call site because it is the SDK's converter, and the SDK
 * lives behind this file. It also means the schema sent to the model and the schema
 * the response is checked against cannot drift — hand-writing the JSON version
 * beside a zod version is two descriptions of one thing, and they diverge on the
 * first field anyone adds.
 */
export function jsonSchemaFor(schema: ZodType): Record<string, unknown> {
  return zodOutputFormat(schema).schema as Record<string, unknown>
}

export async function callModel(request: ModelRequest): Promise<ModelOutcome> {
  const model = request.model ?? DEFAULT_MODEL
  const startedAt = Date.now()

  if (!isKnownModel(model) || !supportsZeroRetention(model)) {
    // D17. A model with no zero-retention path is not one this product may use,
    // and the agencies' GDPR records name the sub-processor on that basis.
    return failed('not_configured', `model ${model} is not permitted under D17`, startedAt, null)
  }

  const anthropic = getClient()
  if (!anthropic) {
    return failed('not_configured', 'ANTHROPIC_API_KEY is not set', startedAt, null)
  }

  const { system, user } = buildPrompt(request.role, request.instruction, request.documents ?? [])
  const inputRef = contentRef(`${system}\n${user}`)

  try {
    const response = await anthropic.messages.create(
      {
        model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: user }],
        thinking: { type: 'adaptive' },
        output_config: {
          effort: request.effort ?? 'low',
          ...(request.outputSchema
            ? { format: { type: 'json_schema' as const, schema: request.outputSchema } }
            : {}),
        },
      },
      { timeout: request.timeoutMs ?? DEFAULT_TIMEOUT_MS },
    )

    const latencyMs = Date.now() - startedAt
    const usage: TokenUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    }
    const cost = costMicroCents(model, usage)

    // A refusal is a content outcome, not an error — check it before reading text.
    // It is also not a decision about the customer: the human takes over.
    if (response.stop_reason === 'refusal') {
      const runId = await recordAgentRun({
        agencyId: request.agencyId,
        inquiryId: request.inquiryId,
        purpose: request.purpose,
        model,
        inputRef,
        outputRef: failureRef('refused'),
        tokensIn: usage.inputTokens,
        tokensOut: usage.outputTokens,
        latencyMs,
        costMicroCents: cost,
      })
      return { ok: false, failure: 'refused', escalate: true, detail: 'stop_reason refusal', latencyMs, runId }
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim()

    const runId = await recordAgentRun({
      agencyId: request.agencyId,
      inquiryId: request.inquiryId,
      purpose: request.purpose,
      model,
      inputRef,
      outputRef: text ? contentRef(text) : failureRef('empty_response'),
      tokensIn: usage.inputTokens,
      tokensOut: usage.outputTokens,
      latencyMs,
      costMicroCents: cost,
    })

    if (!text) {
      return {
        ok: false,
        failure: 'empty_response',
        escalate: true,
        detail: `stop_reason ${response.stop_reason ?? 'unknown'} with no text block`,
        latencyMs,
        runId,
      }
    }

    return { ok: true, text, model, usage, latencyMs, costMicroCents: cost, runId }
  } catch (error) {
    const status = error instanceof Anthropic.APIError ? error.status : undefined
    const name = error instanceof Error ? error.name : 'UnknownError'
    const kind = failureFromStatus(status, name)
    const latencyMs = Date.now() - startedAt

    // Logged even though there is no completion and often no token count: a call
    // that timed out after the model started generating still cost money, and a
    // month of them is exactly the kind of thing that would otherwise never show
    // up in the unit economics.
    const runId = await recordAgentRun({
      agencyId: request.agencyId,
      inquiryId: request.inquiryId,
      purpose: request.purpose,
      model,
      inputRef,
      outputRef: failureRef(kind),
      latencyMs,
    })

    return {
      ok: false,
      failure: kind,
      escalate: true,
      detail: error instanceof Error ? `${name}: ${error.message}` : String(error),
      latencyMs,
      runId,
    }
  }
}

function failed(
  failure: ModelFailureKind,
  detail: string,
  startedAt: number,
  runId: string | null,
): ModelFailure {
  return { ok: false, failure, escalate: true, detail, latencyMs: Date.now() - startedAt, runId }
}
