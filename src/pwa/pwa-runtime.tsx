'use client'

/**
 * The one place the PWA layer attaches itself to the running app.
 *
 * It is mounted from the root layout, which means it is evaluated on **every** page —
 * the customer chat, every tokenised quote, the legal pages. That is exactly why the
 * gate lives here rather than at the call site: there is one component, and it refuses
 * to do anything at all unless the current path is an owner surface.
 *
 * The refusal is enforced twice, deliberately, because the two mechanisms fail
 * differently:
 *
 *   1. **Path gate (this file).** `registerServiceWorker` is never called from a
 *      customer surface, so a browser that only ever loads `/q/{token}` — every
 *      customer's browser — ends the visit with no worker registered and no cache
 *      storage created. Nothing to go stale, nothing to delete.
 *   2. **Scope (`APP_SCOPE`).** Even if some future refactor calls this from the wrong
 *      place, a worker scoped to `/inbox` cannot control a customer document. The
 *      browser enforces that, not us.
 *
 * A runtime path check is the honest tool here rather than mounting the component in
 * an owner-only layout: this is a client-side concern about which document is on
 * screen, and it has to survive client-side navigation between the two kinds of
 * surface within one session.
 */

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

import { InstallPrompt } from './install-prompt'
import { APP_SCOPE, SERVICE_WORKER_URL, isInstallSurface, isOwnerSurface } from './owner-surface'

export function PwaRuntime() {
  const pathname = usePathname()
  const owner = isOwnerSurface(pathname)

  useEffect(() => {
    if (!owner) return
    if (!('serviceWorker' in navigator)) return

    /**
     * Registration waits for `load`.
     *
     * A registering service worker competes for bandwidth and main-thread time with
     * the page the owner is actually waiting for, and D1's requirement is that the
     * inbox feels instant. Deferring costs nothing — the worker is for the *next*
     * visit, never this one.
     */
    const register = () => {
      navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: APP_SCOPE }).catch(() => {
        // Registration fails on http:// origins other than localhost, in private
        // windows, and wherever the user has disabled it. Every one of those is a
        // browser that simply does not get the offline fallback; none of them is a
        // reason to surface anything, because nothing the owner can see is worse.
      })
    }

    if (document.readyState === 'complete') {
      register()
      return
    }

    window.addEventListener('load', register, { once: true })
    return () => {
      window.removeEventListener('load', register)
    }
  }, [owner])

  if (!isInstallSurface(pathname)) return null

  return <InstallPrompt />
}
