/**
 * URL normalisation for the crawl cache key (C1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FUNCTION IS THE CACHE. THE TABLE IS JUST STORAGE.
 *
 * `crawl_cache` is keyed on `(url_norm, content_hash)`. If two spellings of the
 * same page normalise differently, the cache misses, the page is fetched again,
 * the extraction runs again and the model call — around 2.7¢ at the rates in
 * src/agent/cost.ts — is paid again. The C4 weekly re-crawl multiplies that by
 * every prospect, every week, forever.
 *
 * The opposite mistake is worse and quieter. If two *different* pages normalise
 * to the same string, the cache returns one page's extract for the other page's
 * URL, and a caterer's confirmation screen shows evidence that was never on the
 * page it cites. A miss costs money; a false hit corrupts the training signal in
 * §4, which is the thing the whole phase exists to produce. Every rule below is
 * written with that asymmetry in mind: when a transformation is *probably* safe,
 * it is not applied.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Everything here is pure. No network, no clock, no database — the entire module
 * is a string function, which is why it can be tested exhaustively and why it is
 * worth testing exhaustively.
 */

/**
 * Why a URL was rejected. Rejection is not failure: a lead spreadsheet contains
 * `n/a`, `siehe Instagram` and a phone number in the website column, and the
 * import must carry on past all three.
 */
export type UrlRejection =
  | 'empty'
  | 'unparseable'
  /** mailto:, tel:, javascript:, data: — nothing this crawler can fetch. */
  | 'unsupported_scheme'
  | 'no_host'

export type NormalisedUrl =
  | { ok: true; url: string; host: string; origin: string }
  | { ok: false; reason: UrlRejection }

/**
 * Parameters dropped before the key is built.
 *
 * All of them identify *how someone arrived*, never *what they see*. That is the
 * entire test for membership of this list, and it is why it is short.
 *
 * `ref` is deliberately absent, though every other normaliser drops it. On a
 * real fraction of sites `?ref=` selects content — a referral landing page, a
 * different price block — and dropping it would map two genuinely different
 * pages onto one cache entry. Per the asymmetry above, that is the failure mode
 * that must not happen, so `ref` survives and we occasionally pay for a fetch we
 * did not need.
 */
const TRACKING_PARAMS = new Set([
  'gclid',
  'gbraid',
  'wbraid',
  'dclid',
  'fbclid',
  'msclkid',
  'yclid',
  'twclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
  'vero_id',
  'oly_anon_id',
  'oly_enc_id',
  'hsa_cam',
  'hsa_grp',
  'hsa_ad',
  '_hsenc',
  '_hsmi',
  'piwik_campaign',
  'pk_campaign',
  'pk_kwd',
  'mtm_campaign',
  'mtm_source',
  'mtm_medium',
])

/** `utm_source`, `utm_medium`, and every future one Google invents. */
function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)
}

/**
 * Does this look like it already carries a scheme?
 *
 * Needed because the website column of a lead list is written by a human, and
 * "cateringmeier.de" is by far the most common way a human writes a website.
 * Refusing those would throw away a large share of every import for a reason the
 * operator would rightly consider pedantic.
 */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

/**
 * Strip `www.` — but only when something recognisable is left.
 *
 * `www.example.com` and `example.com` are the same site in practice, and treating
 * them as different doubles the cost of every prospect whose spreadsheet entry
 * disagrees with their own canonical link. But `www.de` and `www.com` are real
 * registrable domains, and reducing them to `de` and `com` would be nonsense, so
 * the prefix only comes off when a dot survives it.
 */
function stripWww(host: string): string {
  if (!host.startsWith('www.')) return host
  const rest = host.slice(4)
  return rest.includes('.') ? rest : host
}

/**
 * Normalise a URL into the form used as a cache key and as the thing actually
 * fetched.
 *
 * Both, on purpose. A normaliser that produces a key different from the URL that
 * gets requested has two representations of one page, and the day they disagree
 * is the day the cache stores an extract under a key nothing will ever look up.
 *
 * `base` resolves a relative href found while crawling. Absolute inputs ignore it.
 */
export function normaliseUrl(raw: string, base?: string): NormalisedUrl {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return { ok: false, reason: 'empty' }

  // A bare host gets https, not http. Being wrong costs one redirect; the other
  // way round costs a plaintext request to a site that may not answer on 80.
  const candidate = HAS_SCHEME.test(trimmed) || base ? trimmed : `https://${trimmed}`

  let url: URL
  try {
    url = base ? new URL(candidate, base) : new URL(candidate)
  } catch {
    return { ok: false, reason: 'unparseable' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'unsupported_scheme' }
  }

  // `hostname` is already lowercased and punycoded by the URL parser, so an IDN
  // written in Unicode and the same domain written in punycode land on one key.
  // The trailing dot is the fully-qualified form of the same name.
  let host = url.hostname.replace(/\.$/, '')
  if (!host) return { ok: false, reason: 'no_host' }
  host = stripWww(host)

  // The URL parser already drops :80 for http and :443 for https. A non-default
  // port stays: it is a different server.
  const port = url.port ? `:${url.port}` : ''

  // ─── The query ────────────────────────────────────────────────────────────
  //
  // Tracking parameters out, then sorted. Sorting is the one rule here that is
  // not strictly safe — a server is entitled to care about parameter order —
  // but in practice none do, and without it `?a=1&b=2` and `?b=2&a=1` are two
  // cache entries for one page, which is the expensive failure. Sorted by name
  // and then by value, so repeated names keep a stable order too.
  const params: Array<[string, string]> = []
  for (const [name, value] of url.searchParams) {
    if (!isTrackingParam(name)) params.push([name, value])
  }
  params.sort((a, b) => (a[0] === b[0] ? compare(a[1], b[1]) : compare(a[0], b[0])))

  const search = new URLSearchParams(params).toString()

  // ─── The path ─────────────────────────────────────────────────────────────
  //
  // One trailing slash comes off, and only one: `/menu/` and `/menu` are the
  // same page on every server anyone will meet. The root collapses to the empty
  // string so `https://example.com/` and `https://example.com` agree.
  //
  // Case is preserved. Paths are case-sensitive on most servers, and lowercasing
  // `/Speisekarte.pdf` produces a 404 or, worse, somebody else's file.
  let path = url.pathname
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  if (path === '/') path = ''

  const origin = `${url.protocol}//${host}${port}`
  return {
    ok: true,
    // The fragment is gone: it is never sent to a server, so two URLs differing
    // only in their fragment cannot be different documents.
    url: `${origin}${path}${search ? `?${search}` : ''}`,
    host,
    origin,
  }
}

/** Locale-independent ordering. `localeCompare` would make the key depend on ICU data. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** The normalised form, or null. For callers that only want the key. */
export function urlCacheKey(raw: string, base?: string): string | null {
  const result = normaliseUrl(raw, base)
  return result.ok ? result.url : null
}

/**
 * Same host, after normalisation.
 *
 * Crawl breadth is bounded by this: an enrichment run reads the prospect's own
 * site, not whatever it links to. Following outbound links would mean spending a
 * caterer's budget crawling Instagram, and — because §4 makes the extract into
 * training signal — filing a third party's content as a fact about this business.
 */
export function isSameHost(a: string, b: string): boolean {
  const left = normaliseUrl(a)
  const right = normaliseUrl(b)
  return left.ok && right.ok && left.host === right.host
}

/**
 * Whether `host` is `parent` or a subdomain of it.
 *
 * Separate from `isSameHost` because menus genuinely live on `shop.example.com`
 * while the site is `example.com`, and a crawler that cannot follow that link
 * misses the one page worth reading. Kept deliberately literal — no public-suffix
 * list, so `example.co.uk` and `other.co.uk` are correctly *not* related, because
 * neither is a suffix of the other at a dot boundary.
 */
export function isSameOrSubdomain(host: string, parent: string): boolean {
  const h = stripWww(host.toLowerCase().replace(/\.$/, ''))
  const p = stripWww(parent.toLowerCase().replace(/\.$/, ''))
  return h === p || h.endsWith(`.${p}`)
}
