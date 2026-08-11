/**
 * Where the installable app is, and — more importantly — where it is not.
 *
 * docs/research/INSTALL_METHOD.md §4 settles the shape: a PWA on the **owner** surface
 * only. Customer surfaces (`/a/{slug}`, `/q/{token}`, `/r/{token}`) stay plain fast
 * pages with no service worker and no install affordance. Two reasons, and the second
 * is the one that would be expensive to get wrong:
 *
 *   1. A bride opening a chat link from an Instagram bio must never be asked to
 *      install anything. Zero-install is the whole distribution model.
 *   2. A service worker on a quote page is a mechanism for serving a stale price from
 *      a *freibleibend* offer. That is a §2 problem wearing a caching costume.
 *
 * This module is the single place that decides which paths are which. Both the
 * service-worker registration and the install affordance read from here, so there is
 * one list to update when a route moves, not two that can disagree.
 */

/**
 * The paths an authenticated agency user is allowed to be on for PWA behaviour to
 * switch on at all.
 *
 * `/login` and `/signup` are deliberately absent: nobody installs an app they have
 * not signed into yet, and registering a worker for an anonymous visitor is a cache
 * on a device we know nothing about. `/` is absent because it is a redirector, not a
 * page (see src/app/page.tsx).
 */
export const OWNER_SURFACES = ['/inbox', '/onboarding'] as const

/**
 * The manifest scope, and with it the service-worker scope.
 *
 * **A web app manifest has exactly one `scope` string, and it is a path prefix.** It
 * cannot enumerate two sibling roots, so `/inbox` and `/onboarding` cannot both be in
 * scope without widening to `/` — and `/` swallows every customer surface: Chrome
 * would offer to install the app from a customer's quote page, and the installed
 * window would treat tokenised customer links as part of the app. That is precisely
 * the outcome the research rules out, so the narrow scope wins and `/onboarding`
 * pays for it: opened from the installed app it lands in a browser tab rather than in
 * the app window.
 *
 * That is a wart, not a defect, and it has an obvious fix whenever owner routes are
 * next touched: move them under one prefix (`/app/inbox`, `/app/onboarding`) and set
 * this to `/app`. Nothing else in this module changes.
 *
 * No trailing slash, on purpose. `start_url` must be inside `scope`, Next serves
 * `/inbox` and 308-redirects `/inbox/`, and a redirect at `start_url` is the classic
 * way to make an installed app open on an error when the network is slow.
 */
export const APP_SCOPE = '/inbox'

/**
 * Where the installed app opens.
 *
 * The inbox, not `/`. `/` decides between `/login`, `/onboarding` and `/inbox` by
 * querying the database, so using it as `start_url` would put a database round trip
 * and two redirects in front of every cold launch of the app.
 */
export const APP_START_URL = '/inbox'

/**
 * The manifest `id`, which is what the browser uses to decide whether a manifest it
 * has just read describes an app it already installed. Pinning it means `start_url`
 * can be changed later without the browser deciding it has met a second, different
 * app and offering to install it again alongside the first.
 */
export const APP_ID = '/inbox'

/** Served from `public/sw.js`, i.e. from the origin root, so it may claim any scope. */
export const SERVICE_WORKER_URL = '/sw.js'

/**
 * May this path register the service worker?
 *
 * Matched per path segment rather than by raw prefix, so `/inbox/42` counts and a
 * future `/inboxes` route does not silently inherit app behaviour.
 */
export function isOwnerSurface(pathname: string): boolean {
  return OWNER_SURFACES.some((root) => pathname === root || pathname.startsWith(`${root}/`))
}

/**
 * May this path show the install affordance?
 *
 * Stricter than `isOwnerSurface`, and stricter on purpose. iOS "Zum Home-Bildschirm"
 * adds **the URL currently open**, not the manifest's `start_url`. Offering it on
 * `/inbox/42` would put one customer's inquiry on the owner's home screen forever;
 * offering it on `/onboarding` would bookmark a page that is outside the app scope and
 * therefore opens in a browser tab. Only the app's own front door qualifies.
 */
export function isInstallSurface(pathname: string): boolean {
  return pathname === APP_START_URL
}
