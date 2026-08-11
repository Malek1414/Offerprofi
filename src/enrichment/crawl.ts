/**
 * Fetching a prospect's own pages (C1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WE ARE A GUEST ON A SMALL BUSINESS'S SHARED HOSTING.
 *
 * The sites this reads belong to the people we are hoping to sell to. Every one
 * of them is a solo caterer or a two-person agency on €5-a-month hosting, and
 * three things follow that are not negotiable:
 *
 *   1. **robots.txt is obeyed**, including the RFC 9309 rule that a 5xx on
 *      robots.txt means *stay out* — a server that cannot tell us its rules gets
 *      the benefit of the doubt.
 *   2. **The User-Agent is real and contactable.** A crawler that hides behind a
 *      browser string is one nobody can ask to stop, and the first thing a hosting
 *      provider does with an unidentifiable crawler is block the whole range — at
 *      which point we lose every prospect on that provider, not just this one.
 *   3. **Breadth, size and rate are all capped.** A page cap on the job, a byte
 *      cap on the response, and a delay between requests to one host.
 *
 * None of this is politeness for its own sake. Getting blocked is the single
 * cheapest way to make Phase C stop working, and it happens quietly.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HASH IS OVER EXTRACTED TEXT, NOT OVER RAW BYTES.
 *
 * The obvious implementation hashes the response body. It produces a cache that
 * never hits: a CSRF nonce, a rotating ad slot, a "generated at 14:03" footer or
 * a cache-busting asset URL changes the bytes on literally every fetch, and a
 * cache that never hits is worse than no cache, because it costs a lookup and
 * then does all the work anyway.
 *
 * Hashing the visible text after tags, scripts and whitespace are gone answers
 * the question actually being asked — *has what this page says changed?* — which
 * is also the exact question C4's drift cards are built on. The cost is that a
 * pure layout change is invisible to us; that is the right trade, because a
 * layout change is not a fact about the business.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createHash } from 'node:crypto'

import { branding, isPlaceholderBranding } from '../lib/branding'
import { CRAWL_FETCH_MICRO_CENTS, type ChargeRefusal, chargeEnrichment } from './ledger'
import { type EnvLike, type Queryable, asOperator } from './queue'
import { isSameOrSubdomain, normaliseUrl } from './urls'

// ─── Limits ─────────────────────────────────────────────────────────────────

/**
 * 2 MB. A restaurant menu page is a few dozen kilobytes; anything past this is a
 * misconfigured server, an image served as HTML, or a deliberate attempt to make
 * a crawler run out of memory. The cap is enforced *while streaming*, so an
 * advertised `content-length` of 4 GB never gets a chance to be believed.
 */
export const MAX_PAGE_BYTES = 2_000_000

/** Beyond this the excerpt is not evidence for the C3 UI, it is a payload. */
const MAX_EXCERPT_CHARS = 4_000

/** A hung server must not hold a worker's lease open. */
const DEFAULT_TIMEOUT_MS = 20_000

/**
 * A page checked within a day is not checked again.
 *
 * C4's cadence is weekly, so this window never suppresses a real re-crawl. What
 * it does suppress is the same URL being reached twice inside one run — via the
 * navigation and again via a footer link — which is the common case and is pure
 * waste.
 */
export const DEFAULT_FRESH_FOR_MS = 24 * 60 * 60 * 1000

/**
 * One second between requests to the same host, unless robots.txt asks for more.
 *
 * Not derived from anything except restraint. A dozen pages a second is nothing
 * to a CDN and is a visible spike to a shared PHP host, and we gain nothing by
 * finishing a crawl in four seconds instead of fifteen.
 */
export const DEFAULT_HOST_DELAY_MS = 1_000

// ─── Identity ───────────────────────────────────────────────────────────────

/**
 * The crawler's name, built from the product's own branding.
 *
 * Not a literal, and not only because tests/lib/branding.test.ts forbids one.
 * Open question #1 — the product name and its domain — is still open, and the
 * whole point of `src/lib/branding.ts` is that closing it costs three
 * environment variables. A crawler that introduced itself by a hardcoded name
 * would be one more place to remember, and the place where forgetting is least
 * visible: nobody reads their own User-Agent.
 */
export function defaultUserAgent(): string {
  const identity = branding()
  // No spaces in the product token: robots.txt group matching is per token, and
  // a two-word name would produce a token nobody could write a rule against.
  const token = identity.productName.replace(/\s+/g, '')
  return `${token}Bot/1.0 (+${identity.chatDomain.replace(/\/$/, '')}/bot)`
}

export function crawlerUserAgent(env: EnvLike = process.env): string {
  return env.CRAWLER_USER_AGENT?.trim() || defaultUserAgent()
}

/**
 * Can an administrator who wants us to stop actually reach anybody?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DO NOT CRAWL A STRANGER'S SITE WHEN THIS IS FALSE.
 *
 * On placeholder branding the derived User-Agent points at `localhost` or at a
 * `.invalid` domain, which is worse than a generic crawler string: it looks like
 * a real contact address and leads nowhere. The first thing a hosting provider
 * does with a crawler nobody can reach is block the range, and that costs us
 * every prospect on that provider.
 *
 * A predicate rather than a hard refusal inside `createCrawlSession`, because
 * crawling our own fixtures on a laptop is a legitimate thing to do. It is the
 * caller running a real import that has to check.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function crawlerIsContactable(env: EnvLike = process.env): boolean {
  return Boolean(env.CRAWLER_USER_AGENT?.trim()) || !isPlaceholderBranding()
}

/** The product token robots.txt groups are matched against: everything before the slash. */
export function userAgentToken(userAgent: string = crawlerUserAgent()): string {
  const first = userAgent.trim().split(/[\s/]/)[0] ?? ''
  return first.toLowerCase()
}

// ─── Hashing and text extraction ────────────────────────────────────────────

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

const BLOCK_ELEMENTS =
  /<\/?(?:p|div|br|li|tr|h[1-6]|section|article|header|footer|nav|table|ul|ol|dl|dt|dd|blockquote|pre)\b[^>]*>/gi

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  euro: '€',
  eacute: 'é',
  ndash: '–',
  mdash: '—',
}

/**
 * HTML to the text a person would see.
 *
 * Deliberately a small, dependency-free function rather than a parser. It is not
 * trying to be correct about HTML — it is producing the input to a hash and to a
 * short evidence excerpt, and for both of those, "close enough, and identical
 * every time for identical input" is the whole requirement. Determinism matters
 * far more than fidelity here: an extractor whose output wobbles would break the
 * cache in exactly the way hashing raw bytes does.
 *
 * `script` and `style` bodies go first and completely. They are where the nonces,
 * the build hashes and the analytics ids live, and leaving them in would put the
 * byte-hash problem straight back.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(BLOCK_ELEMENTS, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_match, code: string) => safeCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => safeCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? match)
    // Whitespace last, and aggressively: a reformatted template that changes only
    // indentation must produce a byte-identical result, or the reformat looks
    // like a price change to C4.
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return ''
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}

// ─── robots.txt ─────────────────────────────────────────────────────────────

export interface RobotsRules {
  allows(_path: string): boolean
  crawlDelayMs: number | null
}

/** Nothing forbidden. What a 404 on robots.txt means, per RFC 9309 §2.3.1.3. */
export const ROBOTS_ALLOW_ALL: RobotsRules = { allows: () => true, crawlDelayMs: null }
/** Everything forbidden. What an unreachable robots.txt means, per RFC 9309 §2.3.1.4. */
export const ROBOTS_DENY_ALL: RobotsRules = { allows: () => false, crawlDelayMs: null }

interface RobotsGroup {
  allow: string[]
  disallow: string[]
  crawlDelaySeconds: number | null
}

/**
 * Parse robots.txt for one user-agent token.
 *
 * Follows RFC 9309 on the two rules that actually decide outcomes:
 *
 *   * **Longest match wins**, measured on the pattern, not on the path.
 *   * **Allow beats Disallow on a tie.** This is what makes the extremely common
 *     `Disallow: /` + `Allow: /menu` pattern work, and getting it backwards means
 *     silently refusing to read the one page worth reading.
 *
 * Group selection prefers a group naming our token over `*`. An empty
 * `Disallow:` value means "nothing is disallowed" and is not a prefix match on
 * everything — a distinction that, read wrongly, locks the crawler out of the
 * whole web.
 */
export function parseRobots(text: string, token: string): RobotsRules {
  const groups = new Map<string, RobotsGroup>()
  let currentAgents: string[] = []
  let expectingAgents = false

  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() ?? ''
    if (!line) continue

    const separator = line.indexOf(':')
    if (separator === -1) continue
    const field = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()

    if (field === 'user-agent') {
      // Consecutive user-agent lines share one group; a user-agent line after a
      // rule line starts a new one.
      if (!expectingAgents) currentAgents = []
      currentAgents.push(value.toLowerCase())
      expectingAgents = true
      continue
    }

    expectingAgents = false
    if (!currentAgents.length) continue

    for (const agent of currentAgents) {
      const group = groups.get(agent) ?? { allow: [], disallow: [], crawlDelaySeconds: null }
      if (field === 'allow' && value) group.allow.push(value)
      else if (field === 'disallow') {
        // An empty value is an explicit "nothing is disallowed", not a match on
        // every path. Dropping the distinction bans the crawler from everywhere.
        if (value) group.disallow.push(value)
      } else if (field === 'crawl-delay') {
        const seconds = Number.parseFloat(value)
        if (Number.isFinite(seconds) && seconds >= 0) group.crawlDelaySeconds = seconds
      }
      groups.set(agent, group)
    }
  }

  const selected = selectGroup(groups, token)
  if (!selected) return ROBOTS_ALLOW_ALL

  return {
    allows(path: string): boolean {
      const allow = bestMatch(selected.allow, path)
      const disallow = bestMatch(selected.disallow, path)
      if (disallow === null) return true
      if (allow === null) return false
      // Ties go to Allow. `Disallow: /` with `Allow: /menu` has to let /menu
      // through, and on an exact-length tie the permissive rule is the intended one.
      return allow >= disallow
    },
    crawlDelayMs:
      selected.crawlDelaySeconds === null ? null : Math.round(selected.crawlDelaySeconds * 1000),
  }
}

function selectGroup(groups: Map<string, RobotsGroup>, token: string): RobotsGroup | null {
  const lower = token.toLowerCase()
  // Exact first, then the longest declared token that prefixes ours — RFC 9309
  // matches on the product token, so `offerprofibot` is covered by `offerprofi`.
  const exact = groups.get(lower)
  if (exact) return exact

  let best: RobotsGroup | null = null
  let bestLength = -1
  for (const [agent, group] of groups) {
    if (agent === '*') continue
    if (lower.startsWith(agent) && agent.length > bestLength) {
      best = group
      bestLength = agent.length
    }
  }
  return best ?? groups.get('*') ?? null
}

/** Length of the longest matching pattern, or null when none match. */
function bestMatch(patterns: readonly string[], path: string): number | null {
  let best: number | null = null
  for (const pattern of patterns) {
    if (matchesRobotsPattern(pattern, path) && (best === null || pattern.length > best)) {
      best = pattern.length
    }
  }
  return best
}

/** `*` is any run of characters, a trailing `$` anchors the end. RFC 9309 §2.2.3. */
export function matchesRobotsPattern(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern
  const source = body
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  try {
    return new RegExp(`^${source}${anchored ? '$' : ''}`).test(path)
  } catch {
    // An unparseable pattern must not crash a crawl. Treat it as not matching,
    // which for a Disallow rule is the permissive reading — but a malformed rule
    // is vanishingly rare and a crashed worker is not.
    return false
  }
}

// ─── The cache ──────────────────────────────────────────────────────────────

export interface CachedPage {
  contentHash: string
  httpStatus: number
  etag: string | null
  lastModified: string | null
  textExcerpt: string
  lastCheckedAt: Date
  fetchCount: number
}

export interface RecordPageInput {
  urlNorm: string
  contentHash: string
  httpStatus: number
  contentType?: string
  byteSize?: number
  etag?: string | null
  lastModified?: string | null
  textExcerpt?: string
}

export interface CrawlCache {
  lookup(_urlNorm: string): Promise<CachedPage | null>
  record(
    _entry: RecordPageInput,
  ): Promise<{ changed: boolean; firstSeen: boolean; fetchCount: number }>
}

/**
 * The real cache, over `crawl_cache`.
 *
 * An interface rather than direct calls because every branch of `crawlPage` — hit,
 * miss, 304, changed, unchanged — has to be tested, and none of those tests
 * should need Postgres to say something true about the crawler's control flow.
 */
export function databaseCrawlCache(db?: Queryable): CrawlCache {
  return {
    async lookup(urlNorm: string): Promise<CachedPage | null> {
      const run = async (client: Queryable) => {
        const result = await client.query(
          `select content_hash, http_status, etag, last_modified, text_excerpt,
                  last_checked_at, fetch_count
             from public.crawl_cache_lookup($1::text)`,
          [urlNorm],
        )
        const row = result.rows[0]
        if (!row) return null
        return {
          contentHash: String(row.content_hash),
          httpStatus: Number(row.http_status),
          etag: row.etag === null || row.etag === undefined ? null : String(row.etag),
          lastModified:
            row.last_modified === null || row.last_modified === undefined
              ? null
              : String(row.last_modified),
          textExcerpt: String(row.text_excerpt ?? ''),
          lastCheckedAt: new Date(String(row.last_checked_at)),
          fetchCount: Number(row.fetch_count ?? 1),
        }
      }
      return db ? run(db) : asOperator(run, null)
    },

    async record(entry: RecordPageInput) {
      const run = async (client: Queryable) => {
        const result = await client.query(
          `select changed, first_seen, fetch_count from public.record_crawl_fetch(
             $1::text, $2::text, $3::int, $4::text, $5::int, $6::text, $7::text, $8::text)`,
          [
            entry.urlNorm,
            entry.contentHash,
            entry.httpStatus,
            entry.contentType ?? '',
            Math.min(entry.byteSize ?? 0, MAX_PAGE_BYTES),
            entry.etag ?? null,
            entry.lastModified ?? null,
            entry.textExcerpt ?? '',
          ],
        )
        const row = result.rows[0]
        return {
          changed: row?.changed === true || row?.changed === 't',
          firstSeen: row?.first_seen === true || row?.first_seen === 't',
          fetchCount: Number(row?.fetch_count ?? 1),
        }
      }
      // Not recorded means not cached, which is a miss next time — costly, not
      // wrong. `changed: true` keeps the caller on the safe path.
      return db ? run(db) : asOperator(run, { changed: true, firstSeen: true, fetchCount: 1 })
    },
  }
}

// ─── Fetching, with the size cap enforced while streaming ───────────────────

export type FetchFailure = 'timeout' | 'transport' | 'http_error' | 'too_large' | 'not_text'

export type PageFetch =
  | {
      ok: true
      status: number
      /** Null on a 304: there is no body, which is the entire point of a 304. */
      text: string | null
      contentType: string
      byteSize: number
      etag: string | null
      lastModified: string | null
      /** The URL after redirects, normalised. Cache under this, not the request URL. */
      finalUrl: string
    }
  | { ok: false; failure: FetchFailure; status: number | null; detail: string; retryable: boolean }

/**
 * One HTTP GET, capped.
 *
 * The cap is applied to the stream rather than to `content-length`, because
 * `content-length` is a claim made by the server being defended against. A body
 * that exceeds it is abandoned mid-flight and the connection cancelled — the
 * bytes already read are discarded, not truncated and used, since half a page is
 * a different page and would hash to something meaningless.
 */
export async function fetchPage(
  url: string,
  options: {
    userAgent?: string
    timeoutMs?: number
    maxBytes?: number
    etag?: string | null
    lastModified?: string | null
    fetch?: typeof fetch
  } = {},
): Promise<PageFetch> {
  const doFetch = options.fetch ?? globalThis.fetch
  if (typeof doFetch !== 'function') {
    return { ok: false, failure: 'transport', status: null, detail: 'no fetch available', retryable: false }
  }
  const maxBytes = options.maxBytes ?? MAX_PAGE_BYTES

  const headers: Record<string, string> = {
    'User-Agent': options.userAgent ?? crawlerUserAgent(),
    Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1',
    'Accept-Language': 'de,en;q=0.8',
  }
  // The conditional request. A 304 costs the prospect's server almost nothing and
  // tells us the page is unchanged without transferring it — the politest
  // possible re-crawl, and the cheapest.
  if (options.etag) headers['If-None-Match'] = options.etag
  if (options.lastModified) headers['If-Modified-Since'] = options.lastModified

  let response: Response
  try {
    response = await doFetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
  } catch (error) {
    const name = error instanceof Error ? error.name : 'UnknownError'
    const timedOut = name === 'TimeoutError' || name === 'AbortError'
    return {
      ok: false,
      failure: timedOut ? 'timeout' : 'transport',
      status: null,
      detail: error instanceof Error ? `${name}: ${error.message}` : String(error),
      retryable: true,
    }
  }

  const finalUrl = normaliseUrl(response.url || url)
  const contentType = response.headers.get('content-type') ?? ''
  const etag = response.headers.get('etag')
  const lastModified = response.headers.get('last-modified')

  if (response.status === 304) {
    return {
      ok: true,
      status: 304,
      text: null,
      contentType,
      byteSize: 0,
      etag,
      lastModified,
      finalUrl: finalUrl.ok ? finalUrl.url : url,
    }
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    return {
      ok: false,
      failure: 'http_error',
      status: response.status,
      detail: `status ${response.status}`,
      // 4xx is the site telling us something true about itself; retrying will
      // produce the same answer. 5xx and 429 are worth another attempt later.
      retryable: response.status >= 500 || response.status === 429,
    }
  }

  if (contentType && !/^(text\/|application\/xhtml)/i.test(contentType)) {
    // A PDF menu is worth reading and is not this function's job — src/parsing
    // owns document bytes. Anything else binary is not worth a byte of budget.
    await response.body?.cancel().catch(() => undefined)
    return {
      ok: false,
      failure: 'not_text',
      status: response.status,
      detail: contentType,
      retryable: false,
    }
  }

  const body = await readCapped(response, maxBytes, contentType)
  if (!body.ok) {
    return { ok: false, failure: 'too_large', status: response.status, detail: body.detail, retryable: false }
  }

  return {
    ok: true,
    status: response.status,
    text: body.text,
    contentType,
    byteSize: body.byteSize,
    etag,
    lastModified,
    finalUrl: finalUrl.ok ? finalUrl.url : url,
  }
}

async function readCapped(
  response: Response,
  maxBytes: number,
  contentType: string,
): Promise<{ ok: true; text: string; byteSize: number } | { ok: false; detail: string }> {
  const declared = Number.parseInt(response.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    return { ok: false, detail: `content-length ${declared} exceeds ${maxBytes}` }
  }

  const decoder = makeDecoder(contentType)
  const reader = response.body?.getReader()
  if (!reader) return { ok: true, text: '', byteSize: 0 }

  let byteSize = 0
  let text = ''
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      const value = chunk.value
      if (!value) continue
      byteSize += value.byteLength
      if (byteSize > maxBytes) {
        await reader.cancel().catch(() => undefined)
        // Deliberately discarded rather than truncated: half a page is a
        // different page, and hashing it would poison the cache with a hash that
        // corresponds to nothing anyone ever published.
        return { ok: false, detail: `body exceeded ${maxBytes} bytes` }
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }

  return { ok: true, text, byteSize }
}

function makeDecoder(contentType: string): TextDecoder {
  const declared = /charset=([^;\s]+)/i.exec(contentType)?.[1]?.replace(/["']/g, '')
  if (!declared) return new TextDecoder('utf-8')
  try {
    // German sites on older hosting really do still serve iso-8859-1, and
    // decoding those as UTF-8 turns every umlaut into a replacement character —
    // which changes the extracted text, and therefore the hash, and therefore
    // makes the page look different from itself.
    return new TextDecoder(declared)
  } catch {
    return new TextDecoder('utf-8')
  }
}

// ─── A crawl session ────────────────────────────────────────────────────────

export type CrawlSkipReason = 'bad_url' | 'off_site' | 'robots' | 'not_text' | 'already_seen'

export type CrawlOutcome =
  | {
      status: 'fetched'
      urlNorm: string
      contentHash: string
      /**
       * Null when nothing changed. Deliberately: an unchanged page must not be
       * re-extracted, and handing back the text would invite exactly that.
       */
      text: string | null
      changed: boolean
      source: 'network' | 'cache'
      byteSize: number
    }
  | { status: 'skipped'; urlNorm: string | null; reason: CrawlSkipReason }
  | { status: 'capped'; urlNorm: string; refused: ChargeRefusal; detail: string }
  | {
      status: 'error'
      urlNorm: string
      failure: FetchFailure
      detail: string
      retryable: boolean
    }

export interface CrawlSessionOptions {
  /** The job whose ledger every fetch is charged against. */
  jobId: string
  /** Restrict crawling to this host and its subdomains. Null disables the check. */
  host: string | null
  cache?: CrawlCache
  db?: Queryable
  fetch?: typeof fetch
  userAgent?: string
  freshForMs?: number
  hostDelayMs?: number
  maxBytes?: number
  timeoutMs?: number
  /** Injected so tests never actually wait. */
  sleep?: (_ms: number) => Promise<void>
  now?: () => number
}

export interface CrawlSession {
  fetch(_url: string): Promise<CrawlOutcome>
  /** URLs already handled in this run, normalised. */
  seen(): ReadonlySet<string>
}

/**
 * A crawl bound to one job.
 *
 * The session holds the three pieces of state that must not be per-call: which
 * URLs this run has already handled (a footer link to the homepage should not
 * cost a second fetch), the parsed robots.txt per host, and when this host may
 * next be asked for something.
 *
 * Everything expensive stays behind the ledger. The order inside `fetch` is
 * load-bearing and matches `charge_enrichment`: the cheap, free refusals — a
 * malformed URL, an off-site link, a robots.txt ban, a fresh cache entry — are
 * all decided *before* a micro-cent is charged, because charging for work that
 * was never going to happen makes the per-prospect cost figure a fiction.
 */
export function createCrawlSession(options: CrawlSessionOptions): CrawlSession {
  const cache = options.cache ?? databaseCrawlCache(options.db)
  const now = options.now ?? (() => Date.now())
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const userAgent = options.userAgent ?? crawlerUserAgent()
  const token = userAgentToken(userAgent)
  const freshFor = options.freshForMs ?? DEFAULT_FRESH_FOR_MS
  const baseDelay = options.hostDelayMs ?? DEFAULT_HOST_DELAY_MS

  const seen = new Set<string>()
  const robotsByOrigin = new Map<string, RobotsRules>()
  const nextAllowedAt = new Map<string, number>()

  async function robotsFor(origin: string): Promise<RobotsRules> {
    const cached = robotsByOrigin.get(origin)
    if (cached) return cached

    const result = await fetchPage(`${origin}/robots.txt`, {
      userAgent,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      // robots.txt is a small text file. A megabyte of it is not robots.txt.
      maxBytes: 512_000,
    })

    let rules: RobotsRules
    if (result.ok) {
      rules = parseRobots(result.text ?? '', token)
    } else if (result.failure === 'http_error' && result.status !== null && result.status < 500) {
      // 404 and friends: no rules published, so nothing is forbidden (RFC 9309).
      rules = ROBOTS_ALLOW_ALL
    } else {
      // Unreachable or 5xx: the server cannot tell us its rules, so we stay out.
      // Conservative on purpose — see the header of this file.
      rules = ROBOTS_DENY_ALL
    }

    robotsByOrigin.set(origin, rules)
    return rules
  }

  async function waitForHost(host: string, delayMs: number): Promise<void> {
    const earliest = nextAllowedAt.get(host) ?? 0
    const wait = earliest - now()
    if (wait > 0) await sleep(wait)
    nextAllowedAt.set(host, now() + delayMs)
  }

  return {
    seen: () => seen,

    async fetch(rawUrl: string): Promise<CrawlOutcome> {
      const parsed = normaliseUrl(rawUrl)
      if (!parsed.ok) return { status: 'skipped', urlNorm: null, reason: 'bad_url' }
      const { url: urlNorm, host, origin } = parsed

      if (seen.has(urlNorm)) return { status: 'skipped', urlNorm, reason: 'already_seen' }
      if (options.host && !isSameOrSubdomain(host, options.host)) {
        // Following outbound links would spend this prospect's budget crawling
        // Instagram, and — because §4 turns extracts into training signal — file
        // a third party's content as a fact about this business.
        return { status: 'skipped', urlNorm, reason: 'off_site' }
      }

      const rules = await robotsFor(origin)
      const path = urlNorm.slice(origin.length) || '/'
      if (!rules.allows(path)) {
        seen.add(urlNorm)
        return { status: 'skipped', urlNorm, reason: 'robots' }
      }

      const cached = await cache.lookup(urlNorm)
      if (cached && now() - cached.lastCheckedAt.getTime() < freshFor) {
        // The free path, and the whole point of the cache: no request, no charge,
        // no extraction, no model call.
        seen.add(urlNorm)
        return {
          status: 'fetched',
          urlNorm,
          contentHash: cached.contentHash,
          text: null,
          changed: false,
          source: 'cache',
          byteSize: 0,
        }
      }

      const charge = await chargeEnrichment(
        {
          jobId: options.jobId,
          kind: 'crawl_fetch',
          microCents: CRAWL_FETCH_MICRO_CENTS,
          detail: urlNorm,
        },
        options.db,
      )
      if (!charge.ok) {
        return { status: 'capped', urlNorm, refused: charge.refused, detail: charge.detail }
      }

      seen.add(urlNorm)
      await waitForHost(host, Math.max(rules.crawlDelayMs ?? 0, baseDelay))

      const result = await fetchPage(urlNorm, {
        userAgent,
        ...(options.fetch ? { fetch: options.fetch } : {}),
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBytes: options.maxBytes ?? MAX_PAGE_BYTES,
        etag: cached?.etag ?? null,
        lastModified: cached?.lastModified ?? null,
      })

      if (!result.ok) {
        if (result.failure === 'not_text') {
          return { status: 'skipped', urlNorm, reason: 'not_text' }
        }
        return {
          status: 'error',
          urlNorm,
          failure: result.failure,
          detail: result.detail,
          retryable: result.retryable,
        }
      }

      // 304: the server confirmed nothing changed. Touch the cache row so the
      // freshness window restarts, and tell the caller not to re-extract.
      if (result.status === 304 && cached) {
        await cache.record({
          urlNorm,
          contentHash: cached.contentHash,
          httpStatus: 304,
          contentType: result.contentType,
          byteSize: 0,
          etag: result.etag ?? cached.etag,
          lastModified: result.lastModified ?? cached.lastModified,
          textExcerpt: cached.textExcerpt,
        })
        return {
          status: 'fetched',
          urlNorm,
          contentHash: cached.contentHash,
          text: null,
          changed: false,
          source: 'network',
          byteSize: 0,
        }
      }

      const text = htmlToText(result.text ?? '')
      const contentHash = sha256Hex(text)
      const recorded = await cache.record({
        urlNorm,
        contentHash,
        httpStatus: result.status,
        contentType: result.contentType,
        byteSize: result.byteSize,
        etag: result.etag,
        lastModified: result.lastModified,
        textExcerpt: text.slice(0, MAX_EXCERPT_CHARS),
      })

      return {
        status: 'fetched',
        urlNorm,
        contentHash,
        // Same rule as the 304 branch: unchanged means do not re-extract, and the
        // cheapest way to guarantee that is to give the caller nothing to extract.
        text: recorded.changed ? text : null,
        changed: recorded.changed,
        source: 'network',
        byteSize: result.byteSize,
      }
    },
  }
}
