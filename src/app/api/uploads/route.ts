/**
 * Starting — or rejoining — an upload.
 *
 * The client computes the file's sha256 before it sends a single byte and posts it
 * here. That is what turns "start an upload" and "resume an upload" into the same
 * request: this endpoint either creates the job or finds the one that already
 * exists, and answers with the list of chunks the server already holds.
 *
 * The client never has to know which of the two happened, which means there is no
 * resume *path* to get wrong — the ordinary path is the resume path.
 */

import { type NextRequest } from 'next/server'

import { currentUserId } from '../../../auth/current-user'
import { currentAgency } from '../../../onboarding/repository'
import { CHUNK_BYTES, accepts, type UploadSurface } from '../../../uploads/limits'
import { beginUpload, getJobs } from '../../../uploads/repository'

export const runtime = 'nodejs'

const SHA256 = /^[0-9a-f]{64}$/

export async function POST(request: NextRequest): Promise<Response> {
  const userId = await currentUserId()
  if (!userId) return Response.json({ status: 'unauthenticated' }, { status: 401 })

  const agency = await currentAgency(userId)
  if (!agency) return Response.json({ status: 'no_agency' }, { status: 409 })

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return Response.json({ status: 'invalid', problem: 'invalid_json' }, { status: 400 })
  }

  const filename = typeof body.filename === 'string' ? body.filename : ''
  const contentType = typeof body.contentType === 'string' ? body.contentType : 'application/octet-stream'
  const byteSize = typeof body.byteSize === 'number' ? body.byteSize : -1
  const sha256 = typeof body.sha256 === 'string' ? body.sha256.toLowerCase() : ''

  if (!filename || !SHA256.test(sha256)) {
    return Response.json({ status: 'invalid', problem: 'missing_fields' }, { status: 400 })
  }

  // This route is only reachable by an authenticated agency member, so the surface
  // is the client one. It is named rather than assumed, because the customer
  // surface will post to its own endpoint and the two must not converge on a
  // shared handler that decides the rules from a request field the caller sets.
  const surface: UploadSurface = 'client'

  const verdict = accepts(surface, filename, byteSize)
  if (!verdict.accepted) {
    const status = verdict.reason.kind === 'too_large' ? 413 : 422
    return Response.json({ status: 'rejected', reason: verdict.reason }, { status })
  }

  const started = await beginUpload(userId, {
    agencyId: agency.agencyId,
    userId,
    filename,
    contentType,
    byteSize,
    sha256,
  })
  if (!started) return Response.json({ status: 'unavailable' }, { status: 503 })

  return Response.json(
    {
      status: started.resumed ? 'resumed' : 'created',
      jobId: started.job.id,
      chunkSize: CHUNK_BYTES,
      chunkTotal: started.job.chunkTotal,
      chunksHeld: started.chunksHeld,
      state: started.job.state,
      storedUnread: verdict.type.storedUnread === true,
    },
    { status: started.resumed ? 200 : 201 },
  )
}

/** Every upload this agency has going, so the UI can show state that survived a reload. */
export async function GET(): Promise<Response> {
  const userId = await currentUserId()
  if (!userId) return Response.json({ status: 'unauthenticated' }, { status: 401 })

  const agency = await currentAgency(userId)
  if (!agency) return Response.json({ status: 'no_agency' }, { status: 409 })

  const jobs = await getJobs(userId, agency.agencyId)

  return Response.json({
    status: 'ok',
    jobs: jobs.map((job) => ({
      id: job.id,
      filename: job.filename,
      byteSize: job.byteSize,
      state: job.state,
      chunksReceived: job.chunksReceived,
      chunkTotal: job.chunkTotal,
      failureReason: job.failureReason,
      // The UI needs this to decide whether to offer a retry at all. A retry button
      // that appears to work and changes nothing is worse than no button.
      retryable: job.state === 'failed' && !job.failurePermanent,
      rowsImported: job.rowsImported,
      updatedAt: job.updatedAt.toISOString(),
    })),
  })
}
