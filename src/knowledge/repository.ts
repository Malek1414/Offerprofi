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
  sha256: string
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
): Promise<{ documentId: string; chunkCount: number; duplicate: boolean } | null> {
  if (!hasDatabase()) return null

  return withUser(userId, async (client) => {
    // `withUser` already owns the transaction. Starting a second transaction here
    // commits the outer one early in PostgreSQL and drops the RLS identity before
    // the callback returns.
    const doc = await client.query<{ id: string }>(
      `insert into knowledge_documents
         (agency_id, source_name, sha256, body_text, chunk_count)
       values ($1, $2, $3, $4, $5)
       on conflict (agency_id, sha256) where sha256 is not null do nothing
       returning id`,
      [input.agencyId, input.sourceName, input.sha256, input.bodyText, input.chunks.length],
    )

    if (!doc.rows[0]) {
      const existing = await client.query<{ id: string; chunk_count: number }>(
        `select id, chunk_count
           from knowledge_documents
          where agency_id = $1 and sha256 = $2
          limit 1`,
        [input.agencyId, input.sha256],
      )
      const row = existing.rows[0]
      if (!row) throw new Error('duplicate knowledge document could not be resolved')
      return { documentId: row.id, chunkCount: Number(row.chunk_count), duplicate: true }
    }

    const documentId = doc.rows[0].id
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

    return { documentId, chunkCount: input.chunks.length, duplicate: false }
  })
}

export interface KnowledgeDocumentSummary {
  documentId: string
  sourceName: string
  chunkCount: number
  ingestedAt: string
}

export async function findKnowledgeDocumentByHash(
  userId: string,
  sha256: string,
): Promise<KnowledgeDocumentSummary | null> {
  if (!hasDatabase()) return null

  return withUser(userId, async (client) => {
    const result = await client.query<{
      id: string
      source_name: string
      chunk_count: number
      ingested_at: Date | string
    }>(
      `select id, source_name, chunk_count, ingested_at
         from knowledge_documents
        where sha256 = $1
        limit 1`,
      [sha256],
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      documentId: row.id,
      sourceName: row.source_name,
      chunkCount: Number(row.chunk_count),
      ingestedAt:
        row.ingested_at instanceof Date ? row.ingested_at.toISOString() : String(row.ingested_at),
    }
  })
}

export async function listKnowledgeDocuments(userId: string): Promise<KnowledgeDocumentSummary[]> {
  if (!hasDatabase()) return []

  return withUser(userId, async (client) => {
    const result = await client.query<{
      id: string
      source_name: string
      chunk_count: number
      ingested_at: Date | string
    }>(
      `select id, source_name, chunk_count, ingested_at
         from knowledge_documents
        where kind = 'past_offer'
        order by ingested_at desc, id`,
    )
    return result.rows.map((row) => ({
      documentId: row.id,
      sourceName: row.source_name,
      chunkCount: Number(row.chunk_count),
      ingestedAt:
        row.ingested_at instanceof Date ? row.ingested_at.toISOString() : String(row.ingested_at),
    }))
  })
}

export async function deleteKnowledgeDocument(userId: string, documentId: string): Promise<boolean> {
  if (!hasDatabase()) return false
  return withUser(userId, async (client) => {
    const result = await client.query('delete from knowledge_documents where id = $1', [documentId])
    return result.rowCount === 1
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
