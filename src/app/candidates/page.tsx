/**
 * `/candidates` — confirming what extraction proposed (C2, C3).
 *
 * Server component: the queue is loaded and split before anything reaches the
 * browser, so the first paint is the real thing rather than a spinner that
 * becomes it. The split itself lives in the repository, not here — see the note
 * there about why a component that receives one flat list is one refactor away
 * from losing the distinction it exists to make.
 */

import type { Metadata } from 'next'

import { requireUserId } from '../../auth/current-user'
import { loadQueue } from '../../candidates/repository'
import { CandidatesClient } from './candidates-client'

export const metadata: Metadata = {
  title: 'Leistungen bestätigen',
}

export const dynamic = 'force-dynamic'

export default async function CandidatesPage() {
  const userId = await requireUserId('/candidates')
  const queue = await loadQueue(userId)

  return <CandidatesClient initial={queue} />
}
