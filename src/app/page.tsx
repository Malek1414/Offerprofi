/**
 * The root, which is a router rather than a page.
 *
 * Where an owner belongs depends on state that only the database knows, so nothing
 * upstream should have to guess: login, signup and any expired-session redirect all
 * point here, and this decides.
 *
 *   not signed in            → /login
 *   onboarding incomplete    → /onboarding
 *   onboarding complete      → /inbox
 *
 * There is deliberately no marketing page at `/`. The product is sold before anyone
 * reaches this domain; a logged-out visitor here is an owner whose session expired,
 * and showing her a landing page instead of the login form is a small daily insult.
 */

import { redirect } from 'next/navigation'

import { currentUserId } from '../auth/current-user'
import { onboardingProgress } from '../onboarding/progress'
import { onboardingState } from '../onboarding/repository'

export default async function RootPage() {
  const userId = await currentUserId()
  if (!userId) redirect('/login')

  const progress = onboardingProgress(await onboardingState(userId))
  redirect(progress.complete ? '/inbox' : '/onboarding')
}
