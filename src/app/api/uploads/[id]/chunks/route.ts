/**
 * One chunk.
 *
 * The body is raw bytes rather than multipart, because a chunk is not a form — it
 * is a slice of a file the server already knows the shape of. Multipart would add
 * a parse step, a boundary to get wrong, and roughly a third more bytes on the
 * wire, all to carry an integer that fits in the URL.
 *
 * PUT, not POST, and the reason is the whole design: sending the same chunk twice
 * must have the same effect as sending it once. A client whose connection dropped
 * mid-chunk cannot know whether the chunk landed, so it re-sends — and if that
 * were an error, the resume path would be the failure path.
 */

import { type NextRequest } from 'next/server'

import { currentUserId } from '../../../../../auth/current-user'
import { CHUNK_BYTES } from '../../../../../uploads/limits'
import { putChunk } from '../../../../../uploads/repository'

export const runtime = 'nodejs'

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const userId = await currentUserId()
  if (!userId) return Response.json({ status: 'unauthenticated' }, { status: 401 })

  const { id } = await context.params

  const index = Number(request.nextUrl.searchParams.get('index'))
  if (!Number.isInteger(index) || index < 0) {
    return Response.json({ status: 'invalid', problem: 'bad_index' }, { status: 400 })
  }

  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength === 0) {
    return Response.json({ status: 'invalid', problem: 'empty_chunk' }, { status: 400 })
  }
  // The last chunk is short; no chunk is ever long. A client sending more than the
  // agreed size is either broken or trying to get around the file-size cap by
  // declaring a small file and then sending a large one.
  if (bytes.byteLength > CHUNK_BYTES) {
    return Response.json({ status: 'invalid', problem: 'chunk_too_large' }, { status: 413 })
  }

  try {
    const outcome = await putChunk(userId, id, index, bytes)
    if (!outcome) return Response.json({ status: 'unavailable' }, { status: 503 })

    return Response.json({
      status: 'ok',
      received: outcome.received,
      total: outcome.total,
      state: outcome.job.state,
      // Present only once the file is whole and stored. Its absence is how the
      // client knows there is more to send.
      objectKey: outcome.job.objectKey,
      failureReason: outcome.job.failureReason,
    })
  } catch (error) {
    // A job the caller cannot see is indistinguishable from one that does not
    // exist, which is what RLS already guarantees and what this preserves: the
    // response must not let one tenant probe for another tenant's job ids.
    const message = error instanceof Error ? error.message : ''
    if (message.includes('no such upload job')) {
      return Response.json({ status: 'not_found' }, { status: 404 })
    }
    if (message.includes('beyond the declared total')) {
      return Response.json({ status: 'invalid', problem: 'bad_index' }, { status: 400 })
    }
    throw error
  }
}
