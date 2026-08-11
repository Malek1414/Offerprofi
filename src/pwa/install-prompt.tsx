'use client'

/**
 * "App installieren", for the three browsers that mean three different things by it.
 *
 * Mounted only on the app's front door — see `isInstallSurface` — and only ever on the
 * owner surface. A customer must never be asked to install anything
 * (docs/research/INSTALL_METHOD.md §4).
 *
 * The whole component is a switch over `detectInstallPath`, and each branch is written
 * on the assumption that the owner will do exactly what it says and nothing more. Copy
 * is German and uses *Sie*, matching the rest of the owner surface.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import styles from './install-prompt.module.css'
import { type BrowserEnv, detectInstallPath, readBrowserEnv } from './platform'

/**
 * Chromium's install event. Not in lib.dom, because it is not in any specification —
 * it is a Chromium extension that Safari and Firefox never implemented, which is the
 * entire reason the other branches of this component exist.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * The deferred event is captured at **module scope**, not in an effect.
 *
 * Chromium fires `beforeinstallprompt` once, early, and never replays it. A listener
 * attached inside `useEffect` runs after hydration and routinely misses it on a fast
 * connection — the symptom is an install button that works on a throttled dev machine
 * and is silently absent in production. Module evaluation happens as soon as this
 * chunk is parsed, which is the earliest point React code can be listening.
 *
 * `preventDefault()` suppresses Chrome's own mini-infobar so the offer appears where
 * we put it, at a moment we chose, rather than sliding up over the inbox unannounced.
 */
let deferredPrompt: BeforeInstallPromptEvent | null = null
const subscribers = new Set<() => void>()

function publish(): void {
  for (const notify of subscribers) notify()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    publish()
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    publish()
  })
}

function subscribe(notify: () => void): () => void {
  subscribers.add(notify)
  return () => {
    subscribers.delete(notify)
  }
}

function getSnapshot(): BeforeInstallPromptEvent | null {
  return deferredPrompt
}

/** There is no install prompt on a server. Returning null keeps hydration honest. */
function getServerSnapshot(): BeforeInstallPromptEvent | null {
  return null
}

/**
 * Dismissal is remembered, because the research asks for "once, dismissible" and
 * because an owner who has said no to this twice has said no.
 *
 * Wrapped in try/catch: Safari throws on `localStorage` in some privacy configurations,
 * and an install nudge is not worth a crashed inbox.
 */
const DISMISSED_KEY = 'pwa-install-dismissed'

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

function rememberDismissed(): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, '1')
  } catch {
    // Nothing to do. Worst case she sees the card again next time.
  }
}

/** The iOS share sheet, as a shape rather than as the word "Teilen". */
function ShareGlyph() {
  return (
    <svg
      className={styles.glyph}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 3.25v10.5" />
      <path d="M8.5 6.75 12 3.25l3.5 3.5" />
      <path d="M7.5 10.5H5.25A1.75 1.75 0 0 0 3.5 12.25v6.5c0 .966.784 1.75 1.75 1.75h13.5a1.75 1.75 0 0 0 1.75-1.75v-6.5a1.75 1.75 0 0 0-1.75-1.75H16.5" />
    </svg>
  )
}

/** "Zum Home-Bildschirm", as the row she is looking for in that sheet. */
function AddToHomeGlyph() {
  return (
    <svg
      className={styles.glyph}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3.75" y="3.75" width="16.5" height="16.5" rx="4.5" />
      <path d="M12 8.25v7.5" />
      <path d="M8.25 12h7.5" />
    </svg>
  )
}

export function InstallPrompt() {
  const promptEvent = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  /**
   * The environment is read after mount, never during render. Everything below depends
   * on the user agent, and rendering a user-agent-dependent tree on the server is a
   * hydration mismatch — which React resolves by throwing the server markup away, so
   * the bug shows up as a flicker rather than as an error anyone reports.
   */
  const [env, setEnv] = useState<BrowserEnv | null>(null)
  const [dismissed, setDismissed] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setEnv(readBrowserEnv())
    setDismissed(readDismissed())
  }, [])

  const dismiss = useCallback(() => {
    rememberDismissed()
    setDismissed(true)
  }, [])

  const install = useCallback(async () => {
    if (!deferredPrompt) return
    const event = deferredPrompt
    setBusy(true)
    try {
      await event.prompt()
      await event.userChoice
    } catch {
      // The prompt can reject if the browser has decided it is no longer valid. There
      // is nothing useful to tell the owner about that, and nothing is broken.
    } finally {
      // A deferred prompt is single-use. Dropping it hides this card; Chromium will
      // offer the event again on a later visit if she declined.
      deferredPrompt = null
      publish()
      setBusy(false)
    }
  }, [])

  if (!env || dismissed) return null

  const path = detectInstallPath(env, promptEvent !== null)

  if (path.kind === 'standalone' || path.kind === 'unavailable') return null

  if (path.kind === 'prompt') {
    return (
      <aside className={styles.card} aria-label="App installieren">
        <p className={styles.title}>App installieren</p>
        <p className={styles.body}>
          Legen Sie den Posteingang auf den Startbildschirm. Er öffnet dann ohne Browserleiste und
          ist mit einem Tippen da — nützlich, wenn zwischen zwei Terminen eine Anfrage hereinkommt.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.install} onClick={install} disabled={busy}>
            {busy ? 'Wird installiert …' : 'Installieren'}
          </button>
          <button type="button" className={styles.dismiss} onClick={dismiss}>
            Nicht jetzt
          </button>
        </div>
      </aside>
    )
  }

  if (path.kind === 'ios-safari') {
    return (
      <aside className={styles.card} aria-label="Zum Home-Bildschirm hinzufügen">
        <p className={styles.title}>Zum Home-Bildschirm</p>
        <p className={styles.body}>
          Auf dem iPhone und iPad legen Sie die App selbst ab — zwei Schritte:
        </p>
        <ol className={styles.steps}>
          <li>
            Unten in Safari auf <ShareGlyph />
            <strong>Teilen</strong> tippen.
          </li>
          <li>
            In der Liste nach unten scrollen und <AddToHomeGlyph />
            <strong>„Zum Home-Bildschirm“</strong> wählen.
          </li>
        </ol>
        <div className={styles.actions}>
          <button type="button" className={styles.dismiss} onClick={dismiss}>
            Verstanden
          </button>
        </div>
      </aside>
    )
  }

  if (path.kind === 'ios-other') {
    return (
      <aside className={styles.card} aria-label="Zum Home-Bildschirm hinzufügen">
        <p className={styles.title}>In Safari öffnen</p>
        <p className={styles.body}>
          Auf dem iPhone kann nur <strong>Safari</strong> eine App auf den Home-Bildschirm legen —
          alle anderen Browser dürfen das dort nicht. Öffnen Sie diese Seite in Safari; die Anleitung
          erscheint dann hier.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.dismiss} onClick={dismiss}>
            Verstanden
          </button>
        </div>
      </aside>
    )
  }

  /**
   * The in-app browser. No button, because there is nothing a button could do here.
   *
   * Instagram's WebView is where a large share of this product's traffic arrives, and
   * it is the one environment where the install option does not exist and does not say
   * so. Naming the app she is in is what makes the instruction followable — she is
   * looking for a specific menu in a specific corner, not a generic "your browser".
   */
  const escapeLabel = path.ios ? '„In Safari öffnen“' : '„Im Browser öffnen“'

  return (
    <aside className={styles.card} aria-label="Im Browser öffnen">
      <p className={styles.title}>Im Browser öffnen</p>
      <p className={styles.body}>
        Sie sind gerade im internen Browser von <strong>{path.app}</strong>. Öffnen Sie das Menü
        (meist <strong>⋯</strong> oben rechts) und wählen Sie {escapeLabel}.
      </p>
      <p className={styles.hint}>
        Aus {path.app} heraus lässt sich die App nicht installieren — diese Funktion fehlt dort
        vollständig, ohne Hinweis. Erst im richtigen Browser erscheint sie.
      </p>
      <div className={styles.actions}>
        <button type="button" className={styles.dismiss} onClick={dismiss}>
          Verstanden
        </button>
      </div>
    </aside>
  )
}
