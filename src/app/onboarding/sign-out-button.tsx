'use client'

/**
 * Sign out.
 *
 * A POST, not a link. A GET sign-out can be fired by any `<img src>` on any page the
 * owner visits, and being mysteriously logged out mid-task is the kind of bug nobody
 * ever reports accurately. Combined with the staff cookie's `SameSite=Strict`, a
 * cross-site request cannot reach the endpoint at all.
 *
 * The navigation afterwards is a full page load rather than a router push: the
 * session cookie has just been cleared, and every cached server-rendered payload
 * still assumes it exists.
 */

import { useState } from 'react'

import styles from './onboarding.module.css'

export function SignOutButton() {
  const [busy, setBusy] = useState(false)

  return (
    <button
      type="button"
      className={styles.signOut}
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await fetch('/api/auth/logout', { method: 'POST' })
        } finally {
          // Even if the request failed, go to login. The alternative is leaving
          // someone on a page they believe they have left.
          window.location.assign('/login')
        }
      }}
    >
      {busy ? 'Abmelden …' : 'Abmelden'}
    </button>
  )
}
