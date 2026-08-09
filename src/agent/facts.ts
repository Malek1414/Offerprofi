/**
 * The caterer's confirmed facts, as the agent reads them (Phase C, structured half).
 *
 * `qualify()` has taken a `facts` parameter since Phase B with a note saying the
 * knowledge layer would fill it. This fills it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THESE ARE READ AS DATA, NOT RETRIEVED AS TEXT.
 *
 * A minimum order or a delivery radius is a fact with one right answer, and the
 * cost of getting it wrong in front of a customer is a promise the caterer has to
 * either honour or retract. So it does not go through search, ranking or
 * paraphrase — it is a row he confirmed, rendered verbatim into the prompt.
 *
 * The searchable half (how he describes his food, past menu wording) is where
 * retrieval belongs, and it is not built: it needs pgvector, an embeddings call
 * and a worker container to ingest his documents. The split is the point — the
 * expensive-to-get-wrong pile is the one that never touches a ranker.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { asAnonymous } from '../db/client'
import { hasDatabase } from '../lib/demo'

/** How many facts to send. Bounded for the same reason the transcript is. */
const MAX_FACTS = 20

/**
 * Confirmed facts, as sentences.
 *
 * Empty is a perfectly good answer: the qualifying loop asks more generic
 * questions and nothing breaks. A caterer who has confirmed nothing still has a
 * working product, which is what keeps this off the critical path.
 */
export async function loadAgencyFacts(agencyId: string): Promise<string[]> {
  if (!hasDatabase()) return []

  try {
    return await asAnonymous(async (client) => {
      const result = await client.query(
        `select key, value from public.facts_for_agent($1::uuid) limit $2`,
        [agencyId, MAX_FACTS],
      )
      return result.rows.map((row) => String(row.value)).filter(Boolean)
    })
  } catch (error) {
    // A fact read that fails costs better questions, not the conversation.
    console.error(
      JSON.stringify({
        event: 'agency_facts_read_failed',
        agencyId,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    return []
  }
}
