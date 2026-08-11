import type { Metadata, Viewport } from 'next'
import './globals.css'

import { branding } from '../lib/branding'
import { PwaRuntime } from '../pwa/pwa-runtime'
import { CHASSIS_DARK, CHASSIS_LIGHT } from '../pwa/theme'

export const metadata: Metadata = {
  title: { default: branding().productName, template: `%s · ${branding().productName}` },
  // Customer-facing quote pages must never be indexed — they carry a named
  // customer, an event date and a price. A tokenised URL is not a secret if
  // a crawler publishes it.
  robots: { index: false, follow: false },

  /**
   * The manifest is linked from every page, and that is safe *because* its `scope` is
   * `/inbox` (src/pwa/owner-surface.ts). A browser ignores a manifest on a document
   * outside its scope, so a customer sitting on `/q/{token}` is never offered an
   * install — the narrow scope is what keeps this one line from leaking the app onto
   * customer surfaces. Widening the scope would silently change that.
   *
   * The URL is Next's own convention for `src/app/manifest.ts`; it is generated rather
   * than a static file so the product name resolves through branding() instead of
   * being written out. See src/pwa/manifest.ts.
   */
  manifest: '/manifest.webmanifest',

  /**
   * The Apple link is not optional: iOS reads no manifest icons before 16.4 and still
   * prefers `apple-touch-icon` afterwards. Without it, "Zum Home-Bildschirm"
   * screenshots the page and uses that — which is how a home screen ends up with a
   * thumbnail of somebody's inbox on it.
   *
   * `icon` has to be repeated here even though src/app/icon.svg already declares the
   * favicon by file convention, because declaring `icons` at all **replaces** the
   * convention's output rather than adding to it; naming only `apple` silently drops
   * the tab icon from every page. The one thing lost by restating it is the fingerprint
   * Next appends to the URL, and that costs nothing: the route already answers with
   * `cache-control: max-age=0, must-revalidate`, so a changed mark is picked up on the
   * next request either way.
   */
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml', sizes: 'any' }],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },

  /**
   * Only the home-screen label. `statusBarStyle: 'default'` keeps the iOS status bar
   * legible against `--paper` instead of letting content run under it, which is what
   * `black-translucent` does and what makes an installed PWA's first row unreadable.
   */
  appleWebApp: { title: branding().productName, statusBarStyle: 'default' },
}

/**
 * The colour the operating system paints around the document.
 *
 * Two entries because the chassis has two grounds and a manifest can only carry one:
 * `theme_color` there is the light value, and these media-scoped tags are the only
 * place the dark one can be expressed. Both are lifted from globals.css — see
 * src/pwa/theme.ts for why they are duplicated rather than referenced.
 *
 * Deliberately *not* setting `viewportFit: 'cover'`. It would let the installed app
 * paint into the notch, and it would do so for every page in the product, including
 * customer quote and chat surfaces that were laid out on the assumption the browser
 * insets them. Gaining a few pixels on the owner's inbox is not worth auditing every
 * customer surface on a notched phone.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: CHASSIS_LIGHT },
    { media: '(prefers-color-scheme: dark)', color: CHASSIS_DARK },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>
        {children}
        {/* Renders nothing and registers nothing outside the owner surface. The gate
            is in the component so there is exactly one of it. */}
        <PwaRuntime />
      </body>
    </html>
  )
}
