/**
 * `/uploads` — the caterer's files (B1, B2, D2).
 *
 * Server component, so the list of existing jobs is in the first paint. That is
 * not a performance nicety here: the per-file state machine is the feature, and a
 * screen that starts empty and fills in a moment later tells a returning caterer
 * that her uploads are gone.
 */

import type { Metadata } from 'next'

import { requireUserId } from '../../auth/current-user'
import { currentAgency } from '../../onboarding/repository'
import { getJobs } from '../../uploads/repository'
import { UploadsClient } from './uploads-client'

export const metadata: Metadata = {
  title: 'Unterlagen',
}

export const dynamic = 'force-dynamic'

export default async function UploadsPage() {
  const userId = await requireUserId('/uploads')
  const agency = await currentAgency(userId)

  const jobs = agency ? await getJobs(userId, agency.agencyId) : []

  return (
    <UploadsClient
      initial={jobs.map((job) => ({
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
      }))}
    />
  )
}
