/**
 * The confirmation queue, split the way the owner's attention should be spent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GOVERNING PRINCIPLE, AND WHY IT IS A QUERY RATHER THAN A UI DECISION.
 *
 * C3: owner attention is spent only where the model is uncertain; everything
 * else is a bulk gesture. The loop dies if owners disengage, and the fastest way
 * to make them disengage is twenty-nine identical cards each demanding a tap when
 * twenty-four of them were obviously right.
 *
 * So the split happens here, in the read, using the thresholds CLAUDE.md §7
 * already sets — required fields ≥0.8 and overall ≥0.75 to be treated as
 * confident, below 0.5 always individual and never guessed. A component that
 * received one flat list and sorted it would be one refactor away from losing the
 * distinction; a component that receives two lists cannot.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { hasDatabase, withUser } from '../db/client'

/**
 * The confident band. Matches the §7 auto-send gate rather than inventing a
 * second number, because two thresholds meaning "sure enough" that can drift
 * apart is how a product ends up with two different answers to one question.
 */
export const CONFIDENT_THRESHOLD = 0.75

/** Below this, never guessed and never bulk-accepted, no matter how the UI sorts. */
export const ALWAYS_ASK_THRESHOLD = 0.5

export interface SourceRef {
  assetId: string
  page?: number
  excerpt: string
}

export interface QueuedCandidate {
  id: string
  name: string
  description: string
  unit: string
  unitPriceCents: number
  vatRate: number | null
  quantityDriver: string
  confidence: number
  frequency: number
  quoteCount: number
  sourceRefs: SourceRef[]
}

export interface CandidateQueue {
  /** One row, one tap. Never hidden — collapsed, and expandable. */
  confident: QueuedCandidate[]
  /** The only ones that cost attention. */
  needsYou: QueuedCandidate[]
  /**
   * Decided so far, out of how many there ever were.
   *
   * This is what the progress bar reads, and it is counted across all verdicts
   * rather than within this session — C3 property 3 says partial state is valid,
   * so an owner who left at item 3 of 29 yesterday must come back to "3 done",
   * not to a bar that restarted at zero.
   */
  decided: number
  total: number
}

interface CandidateRow {
  id: string
  name: string
  description: string
  unit: string
  unit_price_cents: string
  vat_rate: number | null
  quantity_driver: string
  confidence: string
  frequency: number
  quote_count: number
  source_refs: SourceRef[]
}

const toCandidate = (row: CandidateRow): QueuedCandidate => ({
  id: row.id,
  name: row.name,
  description: row.description,
  unit: row.unit,
  unitPriceCents: Number(row.unit_price_cents),
  vatRate: row.vat_rate,
  quantityDriver: row.quantity_driver,
  confidence: Number(row.confidence),
  frequency: row.frequency,
  quoteCount: row.quote_count,
  sourceRefs: Array.isArray(row.source_refs) ? row.source_refs : [],
})

export async function loadQueue(userId: string): Promise<CandidateQueue> {
  if (!hasDatabase()) return { confident: [], needsYou: [], decided: 0, total: 0 }

  return withUser(userId, async (client) => {
    const pending = await client.query<CandidateRow>(
      `select id, name, description, unit, unit_price_cents, vat_rate, quantity_driver,
              confidence, frequency, quote_count, source_refs
         from catalogue_candidates
        where status = 'unconfirmed'
        order by confidence desc, name`,
    )

    const counts = await client.query<{ decided: string; total: string }>(
      `select count(*) filter (where status <> 'unconfirmed') as decided,
              count(*) as total
         from catalogue_candidates`,
    )

    const all = pending.rows.map(toCandidate)
    const row = counts.rows[0]

    return {
      confident: all.filter((candidate) => candidate.confidence >= CONFIDENT_THRESHOLD),
      needsYou: all.filter((candidate) => candidate.confidence < CONFIDENT_THRESHOLD),
      decided: Number(row?.decided ?? 0),
      total: Number(row?.total ?? 0),
    }
  })
}

export interface CandidateEdits {
  name?: string
  description?: string
  unit?: string
  unitPriceCents?: number
  floorPriceCents?: number
  vatRate?: number
  quantityDriver?: string
}

/**
 * Confirm one, with whatever the owner changed.
 *
 * `correctedFields` is derived here rather than trusted from the client, because
 * it is the training signal and a client that reported "nothing changed" while
 * sending edits would poison the shared layer with a false positive example.
 */
export async function confirmOne(
  userId: string,
  candidateId: string,
  edits: CandidateEdits,
): Promise<string> {
  const corrected = Object.entries(edits)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([field]) => field)

  return withUser(userId, async (client) => {
    const result = await client.query<{ catalog_item_id: string }>(
      'select * from confirm_candidate($1, $2::jsonb, $3::text[])',
      [candidateId, JSON.stringify(edits), corrected],
    )
    const row = result.rows[0]
    if (!row) throw new Error('confirmOne: confirm_candidate returned no row')
    return row.catalog_item_id
  })
}

export async function rejectOne(
  userId: string,
  candidateId: string,
  reason: string,
): Promise<void> {
  await withUser(userId, (client) =>
    client.query('select reject_candidate($1, $2)', [candidateId, reason || null]),
  )
}

/**
 * The bulk gesture.
 *
 * The ids are passed explicitly rather than the server re-deriving "everything
 * confident", so what gets confirmed is exactly what the owner was looking at
 * when he tapped. Re-deriving would mean a candidate that arrived between the
 * page render and the tap gets confirmed without ever having been on screen —
 * which is the one thing this screen exists to prevent.
 */
export async function confirmMany(userId: string, candidateIds: string[]): Promise<number> {
  if (candidateIds.length === 0) return 0

  return withUser(userId, async (client) => {
    const result = await client.query<{ confirm_candidates_bulk: number }>(
      'select confirm_candidates_bulk($1::uuid[])',
      [candidateIds],
    )
    return result.rows[0]?.confirm_candidates_bulk ?? 0
  })
}
