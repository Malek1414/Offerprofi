/**
 * Storing and searching the knowledge layer (Phase C).
 *
 * Ingestion is owner-side and goes through `withUser`; retrieval is customer-path
 * and goes through a definer function, the same split every other pair of reads
 * in this product uses.
 */

import { asAnonymous, withUser } from '../db/client'
import { hasDatabase } from '../lib/demo'
import type { Chunk } from './chunk'

export interface IngestInput {
  agencyId: string
  sourceName: string
  /** Extracted text. The file it came from is already gone — see migration 0015. */
  bodyText: string
  chunks: readonly Chunk[]
  /** ordinal → context prefix. Absent entries index without one. */
  prefixes?: ReadonlyMap<number, string>
}

/**
 * Write a document and its chunks.
 *
 * One transaction, because a document row with no chunks is a file the owner
 * believes he uploaded and nothing can find.
 */
export async function ingestDocument(
  userId: string,
  input: IngestInput,
): Promise<{ documentId: string; chunkCount: number } | null> {
  if (!hasDatabase()) return null

  return withUser(userId, async (client) => {
    await client.query('begin')
    try {
      const doc = await client.query(
        `insert into knowledge_documents (agency_id, source_name, body_text, chunk_count)
         values ($1, $2, $3, $4) returning id`,
        [input.agencyId, input.sourceName, input.bodyText, input.chunks.length],
      )
      const documentId = String(doc.rows[0].id)

      for (const chunk of input.chunks) {
        await client.query(
          `insert into knowledge_chunks
             (agency_id, document_id, ordinal, body_text, context_prefix)
           values ($1, $2, $3, $4, $5)`,
          [
            input.agencyId,
            documentId,
            chunk.ordinal,
            chunk.text,
            input.prefixes?.get(chunk.ordinal) ?? null,
          ],
        )
      }

      await client.query('commit')
      return { documentId, chunkCount: input.chunks.length }
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  })
}

export interface RetrievedChunk {
  chunkId: string
  sourceName: string
  contextPrefix: string | null
  text: string
  score: number
}

/**
 * The snippets one qualifying turn is given.
 *
 * Empty is a fine answer and the common one before any document is ingested: the
 * questions are more generic and nothing breaks. Failure is swallowed for the
 * same reason — a retrieval outage costs question quality, never the
 * conversation.
 */
export async function searchKnowledge(
  agencyId: string,
  query: string,
  limit = 5,
): Promise<RetrievedChunk[]> {
  if (!hasDatabase() || !query.trim()) return []

  try {
    return await asAnonymous(async (client) => {
      const result = await client.query(
        `select chunk_id, source_name, context_prefix, body_text, score
           from public.search_knowledge($1::uuid, $2::text, $3::int)`,
        [agencyId, query, limit],
      )
      return result.rows.map((row) => ({
        chunkId: String(row.chunk_id),
        sourceName: String(row.source_name),
        contextPrefix: row.context_prefix ? String(row.context_prefix) : null,
        text: String(row.body_text),
        score: Number(row.score),
      }))
    })
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'knowledge_search_failed',
        agencyId,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    return []
  }
}

/**
 * What the qualifying loop is handed: the retrieved text, with its provenance.
 *
 * The prefix is scaffolding for the index, not content — but the *source name*
 * is worth passing on, because "aus Ihrem Angebot Müller" is how the caterer
 * later recognises where a suggestion came from.
 */
export function asSnippets(chunks: readonly RetrievedChunk[]): string[] {
  return chunks.map((c) => `${c.sourceName}: ${c.text}`)
}
