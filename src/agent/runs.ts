/**
 * Writing a model call down (F0.11, X6).
 *
 * One row per call, successful or not, through the SECURITY DEFINER function in
 * db/migrations/0008 — the caller is in the customer path and has no identity.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A FAILED LOG WRITE MUST NOT FAIL THE MODEL CALL.
 *
 * Same reasoning as chat persistence: the work succeeded, the customer is owed
 * the result, and our bookkeeping is not her problem. Errors are swallowed and
 * logged loudly for us. The cost row is how open question #3 gets answered, so
 * losing one matters — it just never matters more than the inquiry.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createHash } from 'node:crypto'

import { asAnonymous } from '../db/client'
import { hasDatabase } from '../lib/demo'
import { costCentsColumn } from './cost'

export interface AgentRunRecord {
  agencyId: string
  inquiryId?: string | null
  purpose: string
  model: string
  /** Hash of the rendered prompt. Never the prompt. */
  inputRef?: string | null
  /** Hash of the completion, or a failure marker when there was none. */
  outputRef?: string | null
  tokensIn?: number | null
  tokensOut?: number | null
  latencyMs?: number | null
  costMicroCents?: number | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A correlation handle for a piece of text.
 *
 * Truncated sha256. Not a secret-keeping measure — the customer's message is
 * stored in `messages` in plain text either way, and pretending otherwise would
 * be worse than saying so. What this buys is that `agent_runs` never becomes a
 * second copy of personal data with its own retention story, while still letting
 * anyone prove which text produced which run.
 */
export function contentRef(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 32)}`
}

/** Marker used as `output_ref` when the call produced no completion. */
export function failureRef(kind: string): string {
  return `failure:${kind}`
}

/**
 * Returns the new run id, or null when there was nothing to write to — the demo
 * tenant path, where the surface is walkable but nothing is stored.
 */
export async function recordAgentRun(run: AgentRunRecord): Promise<string | null> {
  if (!hasDatabase()) return null
  if (!UUID.test(run.agencyId)) {
    // The demo agency has a name where a uuid belongs. Not an error — there is
    // simply no tenant to bill this to.
    return null
  }

  try {
    return await asAnonymous(async (client) => {
      const result = await client.query<{ record_agent_run: string }>(
        `select public.record_agent_run(
           $1::uuid, $2::text, $3::text, $4::uuid,
           $5::text, $6::text, $7::integer, $8::integer, $9::integer, $10::numeric
         ) as record_agent_run`,
        [
          run.agencyId,
          run.purpose,
          run.model,
          run.inquiryId ?? null,
          run.inputRef ?? null,
          run.outputRef ?? null,
          run.tokensIn ?? null,
          run.tokensOut ?? null,
          run.latencyMs ?? null,
          costCentsColumn(run.costMicroCents ?? null),
        ],
      )
      return result.rows[0]?.record_agent_run ?? null
    })
  } catch (error) {
    console.error('[agent_runs] failed to record a model call', {
      purpose: run.purpose,
      model: run.model,
      error,
    })
    return null
  }
}
