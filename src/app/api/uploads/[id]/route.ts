/**
 * One job: what state is it in, and try it again.
 *
 * `GET` exists because a per-file state machine that only lives in a browser tab
 * is not a state machine, it is a spinner. Reloading the page, or opening it on a
 * different device, must show the same truth.
 */

import { type NextRequest } from 'next/server'

import { currentUserId } from '../../../../auth/current-user'
import { getJob, retry } from '../../../../uploads/repository'

export const runtime = 'nodejs'

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const userId = await currentUserId()
  if (!userId) return Response.json({ status: 'unauthenticated' }, { status: 401 })

  const { id } = await context.params
  const job = await getJob(userId, id)
  // RLS already makes another tenant's job invisible. Reporting that as "not
  // found" rather than "forbidden" is what stops the response distinguishing
  // between a job that does not exist and one that belongs to somebody else.
  if (!job) return Response.json({ status: 'not_found' }, { status: 404 })

  return Response.json({
    status: 'ok',
    job: {
      id: job.id,
      filename: job.filename,
      byteSize: job.byteSize,
      state: job.state,
      chunksReceived: job.chunksReceived,
      chunkTotal: job.chunkTotal,
      failureReason: job.failureReason,
      retryable: job.state === 'failed' && !job.failurePermanent,
      rowsImported: job.rowsImported,
      updatedAt: job.updatedAt.toISOString(),
    },
  })
}

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const userId = await currentUserId()
  if (!userId) return Response.json({ status: 'unauthenticated' }, { status: 401 })

  const { id } = await context.params

  try {
    const job = await retry(userId, id)
    if (!job) return Response.json({ status: 'unavailable' }, { status: 503 })
    return Response.json({ status: 'ok', state: job.state })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('no such upload job')) {
      return Response.json({ status: 'not_found' }, { status: 404 })
    }
    // A permanent failure is not retryable, and saying so is more useful than
    // pretending to retry: the file has to be uploaded again, and the user needs
    // to be told that rather than left pressing a button.
    if (message.includes('cannot be retried')) {
      return Response.json({ status: 'not_retryable' }, { status: 409 })
    }
    throw error
  }
}
