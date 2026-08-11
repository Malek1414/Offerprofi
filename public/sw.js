/* global self, caches, clients, fetch, Response, URL */

/**
 * ============================================================================
 * READ THIS BEFORE ADDING A SINGLE URL TO A CACHE HERE.
 * ============================================================================
 *
 * This service worker exists to make the installed owner app open instantly and
 * survive a dead signal. It does **not** exist to make the app work offline, and the
 * difference is not a UX preference — it is the §2 invariants of this product.
 *
 * Every quote this product issues is *freibleibend* (D9, §145 BGB). Its price is the
 * output of the deterministic engine run against the catalogue **as it stood at that
 * moment**, and the owner is free to renegotiate or decline. A cached quote page, a
 * cached price, a cached catalogue row or a cached inquiry is therefore not a stale
 * pixel; it is a number the customer can screenshot and hold us to, produced by a
 * layer that has no idea what the current answer is. There is no code path in this
 * file that can produce one, and there must never be.
 *
 * That is why the caching policy is an **allowlist of two things**:
 *
 *   1. `/_next/static/…` — build artefacts whose filenames contain a content hash.
 *      They are immutable by construction: a changed file gets a new URL, so a cached
 *      copy can never be the wrong copy.
 *   2. A fixed, hand-written list of files in `public/` (icons, the offline page).
 *      Tenant data cannot reach them because nothing writes them at runtime.
 *
 * Everything else is network, every time. HTML documents included — the inbox is
 * server-rendered and its markup contains customer names, event dates and inquiry
 * summaries, so "just precache the app shell" is, in this product, precaching
 * personal data onto a device with no expiry and no deletion path (§6, GDPR).
 *
 * ── The mistake this file is built to prevent ────────────────────────────────
 *
 * The next person here will be tempted to "improve" this with a stale-while-
 * revalidate rule on `/api/…`, or to precache `/inbox`, or to reach for Workbox and
 * let its defaults decide. Each of those is a five-line change that silently converts
 * a compliance property into a caching bug, and it will not fail any test, because
 * the failure only appears on someone else's phone in a tunnel. If you want offline
 * inbox reading, that is a product decision with a data-retention answer attached —
 * take it to the owner, do not take it here.
 *
 * ── The subtlety that catches people ─────────────────────────────────────────
 *
 * The registration scope (`/inbox`, see src/pwa/owner-surface.ts) controls which
 * **documents** this worker owns. It does **not** limit which **URLs** those documents
 * may request. A page at `/inbox` that calls `fetch('/api/quotes/…')`, or that
 * prefetches a `<Link>` to `/q/{token}`, sends those requests through this worker.
 * So the deny-list below is not redundant with the scope. It is the actual guard.
 */

/**
 * Bump this on any change to the caching rules or the precache list.
 *
 * `activate` deletes every cache that is not this one, so a rename is also the
 * eviction mechanism. Combined with `skipWaiting` + `clients.claim()` below it means a
 * corrected worker takes effect on the next load rather than whenever the owner
 * happens to close every tab — which matters, because if we ever do ship a caching
 * bug here, "wait for all tabs to close" is not an acceptable remediation window.
 */
const SHELL_CACHE = 'app-shell-v1'

const OFFLINE_URL = '/offline.html'

/**
 * The precache. Static files only, and each one is here because the app is visibly
 * broken without it when the network is gone.
 */
const PRECACHE = [
  OFFLINE_URL,
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable.svg',
  '/icon-maskable-192.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
]

/**
 * Never touched. Not cached, not read from cache, not even fallen back to the offline
 * page — these requests are handed straight back to the browser untouched.
 *
 *   /api  — everything with data in it: quotes, pricing, inquiries, catalogue,
 *           guardrails, auth. The whole product surface.
 *   /q    — the tokenised quote a customer opens. The stale-price case, literally.
 *   /r    — the formal request handed to the owner.
 *   /a    — the customer chat.
 *   /f    — tokenised file downloads.
 *
 * The last three are customer surfaces, which per docs/research/INSTALL_METHOD.md get
 * no service worker at all. They are listed anyway because the owner's own browser is
 * the one running this worker, and she opens her customers' links from it.
 */
const NEVER_CACHE = ['/api', '/q', '/r', '/a', '/f']

/** The one runtime-cacheable prefix. Content-hashed, therefore immutable. */
const IMMUTABLE_PREFIX = '/_next/static/'

/**
 * Path is under one of the deny-listed roots.
 *
 * Segment-aware on purpose: `/api` and `/api/…` match, a hypothetical `/agb` does not
 * match `/a`. A plain `startsWith` would quietly pull the legal pages under the
 * customer-chat rule, which is harmless today and would not be after the next route
 * is added.
 */
function isNeverCache(pathname) {
  return NEVER_CACHE.some((root) => pathname === root || pathname.startsWith(`${root}/`))
}

/**
 * Path is a build artefact or one of our own static files.
 *
 * The query-string check is the important half. Next serves React Server Component
 * payloads from the *page's own* URL with a `_rsc` parameter, and those payloads carry
 * exactly the data this file refuses to keep. Requiring an empty query string means a
 * data payload can never be mistaken for the document it was rendered from.
 */
function isImmutableAsset(url) {
  if (url.search !== '') return false
  if (url.pathname.startsWith(IMMUTABLE_PREFIX)) return true
  return PRECACHE.includes(url.pathname)
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      // A missing precache entry must not wedge the worker in "installing" forever;
      // the app is perfectly usable online without it, and a hard failure here would
      // mean one renamed icon breaks the install path for everyone.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== SHELL_CACHE).map((name) => caches.delete(name))),
      )
      .then(() => clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request

  // Not calling `event.respondWith` hands the request back to the browser unchanged.
  // That is the default outcome in this file, and every early return below is one.
  if (request.method !== 'GET') return

  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }

  // Cross-origin is somebody else's cache to manage, and the CSP in next.config.ts
  // means there should not be any.
  if (url.origin !== self.location.origin) return

  if (isNeverCache(url.pathname)) return

  /**
   * Documents are always fetched live, and fall back to the offline page rather than
   * to a previous render. This is the rule that keeps inquiry and quote markup off
   * the device: there is no branch here that reads an HTML document from a cache.
   */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((cached) => cached ?? Response.error()),
      ),
    )
    return
  }

  if (isImmutableAsset(url)) {
    event.respondWith(cacheFirst(request))
  }

  // Anything left — RSC payloads, `/_next/image`, anything a future route adds —
  // falls through to the network uncached. Silence is the safe default here.
})

/**
 * Cache-first, and only ever reached for URLs that cannot change meaning.
 *
 * `response.type === 'basic'` rejects opaque cross-origin responses, which cannot be
 * inspected and so cannot be reasoned about; storing one is storing something unknown.
 */
async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response.ok && response.type === 'basic') {
    const copy = response.clone()
    const cache = await caches.open(SHELL_CACHE)
    await cache.put(request, copy)
  }
  return response
}
