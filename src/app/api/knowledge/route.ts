import { createHash } from 'node:crypto'
import { type NextRequest } from 'next/server'

import { currentUserId } from '../../../auth/current-user'
import { chunkDocument } from '../../../knowledge/chunk'
import { contextualisePrefixes } from '../../../knowledge/context'
import {
  DocumentParseError,
  MAX_DOCUMENT_BYTES,
  extractDocumentText,
  validateDocumentUpload,
} from '../../../knowledge/document'
import {
  deleteKnowledgeDocument,
  findKnowledgeDocumentByHash,
  ingestDocument,
} from '../../../knowledge/repository'
import { currentAgency } from '../../../onboarding/repository'

export const runtime = 'nodejs'

export async function POST(request: NextRequest): Promise<Response> {
  const userId = await currentUserId()
  if (!userId) return json({ status: 'unauthenticated' }, 401)

  const agency = await currentAgency(userId)
  if (!agency) return json({ status: 'no_agency' }, 409)
  if (agency.role !== 'owner') return json({ status: 'forbidden' }, 403)

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json({ status: 'invalid', problem: 'invalid_form' }, 400)
  }

  const entry = form.get('file')
  if (!(entry instanceof File)) return json({ status: 'invalid', problem: 'missing_file' }, 400)
  if (entry.size > MAX_DOCUMENT_BYTES) {
    return json({ status: 'invalid', problem: 'too_large' }, 413)
  }

  const bytes = new Uint8Array(await entry.arrayBuffer())
  const verdict = validateDocumentUpload({
    filename: entry.name,
    declaredMime: entry.type,
    bytes: entry.size,
    head: bytes.subarray(0, 32),
  })
  if (!verdict.ok) {
    const status = verdict.problem === 'too_large' ? 413 : 422
    return json({ status: 'invalid', problem: verdict.problem }, status)
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const existing = await findKnowledgeDocumentByHash(userId, sha256)
  if (existing) {
    return json({ status: 'duplicate', document: existing, contextualised: null })
  }

  let bodyText: string
  try {
    bodyText = await extractDocumentText(bytes, verdict.mime)
  } catch (error) {
    const problem = error instanceof DocumentParseError ? error.problem : 'unreadable_pdf'
    return json({ status: 'invalid', problem }, 422)
  }

  const chunks = chunkDocument(bodyText)
  if (chunks.length === 0) return json({ status: 'invalid', problem: 'no_text' }, 422)

  const prefixes = await contextualisePrefixes({
    agencyId: agency.agencyId,
    sourceName: verdict.sourceName,
    documentText: bodyText,
    chunks,
  })

  const stored = await ingestDocument(userId, {
    agencyId: agency.agencyId,
    sourceName: verdict.sourceName,
    sha256,
    bodyText,
    chunks,
    prefixes: prefixes.ok ? prefixes.prefixes : undefined,
  })
  if (!stored) return json({ status: 'unavailable' }, 503)

  return json(
    {
      status: stored.duplicate ? 'duplicate' : 'ingested',
      document: {
        documentId: stored.documentId,
        sourceName: verdict.sourceName,
        chunkCount: stored.chunkCount,
        ingestedAt: new Date().toISOString(),
      },
      contextualised: prefixes.ok,
      contextStatus: prefixes.ok ? 'ready' : prefixes.failure,
    },
    stored.duplicate ? 200 : 201,
  )
}

export async function DELETE(request: NextRequest): Promise<Response> {
  const userId = await currentUserId()
  if (!userId) return json({ status: 'unauthenticated' }, 401)

  const agency = await currentAgency(userId)
  if (!agency) return json({ status: 'no_agency' }, 409)
  if (agency.role !== 'owner') return json({ status: 'forbidden' }, 403)

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ status: 'invalid' }, 400)
  }

  const documentId = typeof body.documentId === 'string' ? body.documentId : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(documentId)) {
    return json({ status: 'invalid' }, 400)
  }

  try {
    const deleted = await deleteKnowledgeDocument(userId, documentId)
    return deleted ? json({ status: 'deleted' }) : json({ status: 'not_found' }, 404)
  } catch {
    return json({ status: 'forbidden' }, 403)
  }
}

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, { status })
}
