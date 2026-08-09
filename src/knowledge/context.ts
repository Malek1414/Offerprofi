/**
 * The sticky note on each chunk (Phase C — Contextual Retrieval).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS THE PART THAT MAKES SPARSE RETRIEVAL WORK, AND IT NEEDS NO pgvector.
 *
 * A chunk reading "60 Gäste, 3 Gänge, 72 €" is unfindable: it shares no
 * distinguishing word with any question anyone would ask. Filed with a prefix —
 * *"aus dem Angebot Müller, Juni 2025, Hochzeit im Freien: 60 Gäste, 3 Gänge,
 * 72 €"* — it answers "was hast du mal für eine Hochzeit draußen berechnet".
 *
 * The prefix is generated against the **whole parent document**, which is what
 * makes it worth a model call: the chunk cannot supply its own context by
 * definition. Prompt caching over the document makes 30 chunks cost roughly one
 * document read rather than thirty.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The prefix is indexed but never shown to a customer, and never to the model
 * that writes questions — it is retrieval scaffolding, not content.
 */

import { z } from 'zod'

import { type ModelFailureKind, callModel, jsonSchemaFor } from '../agent/client'
import type { UntrustedDocument } from '../agent/prompt'
import type { Chunk } from './chunk'

/** One call per document, not per chunk. The model prefixes them all at once. */
const PrefixPayloadSchema = z.object({
  prefixes: z.array(z.object({ ordinal: z.number().int(), context: z.string() })),
})

export interface ContextRequest {
  agencyId: string
  sourceName: string
  documentText: string
  chunks: readonly Chunk[]
}

export interface ContextSuccess {
  ok: true
  /** ordinal → prefix. Missing entries simply have no prefix. */
  prefixes: Map<number, string>
  costMicroCents: number | null
}

export interface ContextFailure {
  ok: false
  failure: ModelFailureKind | 'unparseable'
}

/**
 * Prefix a document's chunks.
 *
 * A failure is not an error the caller has to handle loudly: chunks index
 * perfectly well without prefixes, they are just harder to find. Ingestion
 * continues and the document is searchable either way — which is what makes this
 * shippable before the API key exists.
 */
export async function contextualisePrefixes(
  input: ContextRequest,
): Promise<ContextSuccess | ContextFailure> {
  // The caterer's own document, and still untrusted text: it was written by a
  // person but it arrives as an uploaded file, and a PDF is a fine place to hide
  // a paragraph addressed to a model.
  const documents: UntrustedDocument[] = [
    { id: 'document', source: 'customer_document', text: input.documentText },
    ...input.chunks.map((c) => ({
      id: `chunk_${c.ordinal}`,
      source: 'customer_document' as const,
      text: c.text,
    })),
  ]

  const outcome = await callModel({
    purpose: 'onboarding_extraction',
    agencyId: input.agencyId,
    role:
      'You file excerpts from a caterer\'s own documents so they can be found again. ' +
      'You summarise where an excerpt sits, never what you think of it, and you never ' +
      'invent a fact the document does not contain.',
    instruction: buildInstruction(input.sourceName, input.chunks.length),
    documents,
    outputSchema: jsonSchemaFor(PrefixPayloadSchema),
    effort: 'low',
  })

  if (!outcome.ok) return { ok: false, failure: outcome.failure }

  try {
    const payload = PrefixPayloadSchema.parse(JSON.parse(outcome.text))
    const prefixes = new Map<number, string>()
    for (const entry of payload.prefixes) {
      const context = entry.context.trim()
      if (context) prefixes.set(entry.ordinal, context)
    }
    return { ok: true, prefixes, costMicroCents: outcome.costMicroCents }
  } catch {
    return { ok: false, failure: 'unparseable' }
  }
}

export function buildInstruction(sourceName: string, chunkCount: number): string {
  return [
    `The whole document is in the block labelled "document". It is called`,
    `"${sourceName}". The ${chunkCount} blocks after it are excerpts from it, labelled`,
    '`chunk_0`, `chunk_1` and so on.',
    '',
    'For each excerpt, write one short sentence saying where it sits in the document —',
    'what the document is, roughly when, and what part of it this excerpt is. Written',
    'in German, the language of the documents.',
    '',
    'Rules:',
    '- Situate, do not summarise. "Aus dem Angebot für die Hochzeit Müller, Juni 2025,',
    '  Abschnitt Menü" is right. "Ein Menü mit drei Gängen" repeats the excerpt.',
    '- Only facts that are in the document. If it carries no date, do not guess one.',
    '- One sentence. It is prepended to the excerpt for search, not read by anyone.',
    '- Return one entry per excerpt, with `ordinal` matching the number in its label.',
  ].join('\n')
}
