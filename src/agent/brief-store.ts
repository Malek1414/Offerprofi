/**
 * Persisting a CateringRequest and its provenance (F3.3, F3.5).
 *
 * One call to `record_event_brief` (db/migrations/0009), which is SECURITY DEFINER
 * because extraction runs while a customer is in the chat and a customer has no
 * identity.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO HALVES ARE PASSED SEPARATELY, ALL THE WAY DOWN.
 *
 * `brief` and `contact` are two arguments here, two parameters in the function and
 * two columns in the table. There is no point in the path where they are one
 * object — which is what makes Invariant 2 something a reviewer can check by
 * reading, rather than something we assert in a document.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Unlike the chat-turn write, this one is awaited and its failure is reported. The
 * customer is not waiting on it — she is waiting on a quote, which cannot be built
 * from a brief that was never stored. A silent failure here produces an inquiry
 * that looks extracted and prices as empty.
 */

import { asAnonymous } from '../db/client'
import type { CateringRequest, ContactPartition } from '../domain/catering-request'
import { hasDatabase } from '../lib/demo'
import type { ExtractionRecord } from './extraction'

export interface StoreRequestInput {
  agencyId: string
  inquiryId: string
  request: CateringRequest
  contact: ContactPartition
  extractions: readonly ExtractionRecord[]
}

/** True when the brief was written; false when there was no database to write to. */
export async function storeCateringRequest(input: StoreRequestInput): Promise<boolean> {
  if (!hasDatabase()) return false

  const rows = input.extractions.map((e) => ({
    field_path: e.fieldPath,
    value: e.value,
    confidence: e.confidence,
    source_ref: e.sourceRef,
  }))

  await asAnonymous(async (client) => {
    await client.query(
      `select public.record_event_brief(
         $1::uuid, $2::uuid, $3::jsonb, $4::jsonb, $5::numeric, $6::numeric, $7::jsonb, 'ai')`,
      [
        input.agencyId,
        input.inquiryId,
        JSON.stringify(input.request),
        JSON.stringify(input.contact),
        input.request.meta.completeness,
        input.request.meta.overallConfidence,
        JSON.stringify(rows),
      ],
    )
  })

  return true
}
