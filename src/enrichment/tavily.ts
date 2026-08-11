/**
 * Tavily search (C1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FUNCTION NEVER THROWS, AND THE PRODUCT RUNS WITHOUT IT.
 *
 * Same contract as `callModel` in src/agent/client.ts, for the same reason.
 * Enrichment is a sales-side convenience: it finds a caterer's website so an
 * operator does not have to. Nothing a customer sees depends on it, nothing in
 * the six invariants touches it, and there is no configuration of this product
 * in which "the search vendor is down" should be an exception anywhere.
 *
 * `not_configured` is therefore a first-class result, not an error. It is what
 * comes back on a laptop with no `TAVILY_API_KEY`, which is the normal state of
 * every development machine and of the demo build, and a caller handles it the
 * same way it handles zero results: carry on with what the import already knew.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY FIELD THAT COMES BACK IS UNTRUSTED INPUT.
 *
 * Titles and snippets are text a stranger wrote on a page a search engine found.
 * They end up in a prompt (through `buildPrompt`, which frames and escapes them
 * — see CLAUDE.md §7: customer input is data, never instructions), and they end
 * up on an operator's screen. So the response is validated field by field rather
 * than cast, anything that is not a string is dropped rather than coerced, and
 * snippets are truncated here rather than wherever they are eventually rendered.
 * A vendor that starts returning a 40MB `content` field must cost us a truncated
 * string, not an out-of-memory worker.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * No SDK. One `fetch` against one documented endpoint, no new dependency, and
 * nothing between us and the wire that could change behaviour on a minor version.
 */

import { TAVILY_ADVANCED_SEARCH_MICRO_CENTS, TAVILY_BASIC_SEARCH_MICRO_CENTS } from './ledger'
import type { EnvLike } from './queue'
import { normaliseUrl } from './urls'

const TAVILY_ENDPOINT = 'https://api.tavily.com/search'

/** Beyond this a snippet is not evidence, it is a payload. */
const MAX_SNIPPET_CHARS = 2_000
const MAX_TITLE_CHARS = 300
/** The vendor's own ceiling, and well past anything a prospect lookup needs. */
const MAX_RESULTS = 20
const DEFAULT_TIMEOUT_MS = 15_000

export type TavilyFailure =
  /** No API key. The ordinary state of a laptop, and not an error. */
  | 'not_configured'
  | 'unauthorised'
  | 'rate_limited'
  | 'timeout'
  | 'transport'
  /** A 200 whose body was not the shape the vendor documents. */
  | 'invalid_response'

export interface TavilyResult {
  /** As returned. Kept so an operator can see what the vendor actually said. */
  url: string
  /** The cache key form, or null when the vendor returned something unfetchable. */
  urlNorm: string | null
  title: string
  /** Untrusted, truncated. */
  snippet: string
  score: number | null
}

export type TavilyOutcome =
  | {
      ok: true
      results: TavilyResult[]
      /** What to charge the ledger. Integer micro-cents, like everything else. */
      costMicroCents: number
      latencyMs: number
    }
  | { ok: false; failure: TavilyFailure; detail: string; latencyMs: number }

export interface TavilySearchRequest {
  query: string
  maxResults?: number
  /** 'advanced' costs two credits and reads deeper. Default 'basic'. */
  depth?: 'basic' | 'advanced'
  /** Restrict to a known domain — the cheapest way to confirm a site is theirs. */
  includeDomains?: readonly string[]
  timeoutMs?: number
}

/**
 * Exported so a caller can decide *not to try*, rather than trying and reading a
 * failure. Onboarding UI can say "search is not connected" instead of "search
 * failed", which is a materially different sentence to put in front of a person.
 */
export function isTavilyConfigured(env: EnvLike = process.env): boolean {
  return Boolean(env.TAVILY_API_KEY?.trim())
}

/** What one search will cost, before deciding whether it is affordable. */
export function searchCostMicroCents(depth: 'basic' | 'advanced' = 'basic'): number {
  return depth === 'advanced'
    ? TAVILY_ADVANCED_SEARCH_MICRO_CENTS
    : TAVILY_BASIC_SEARCH_MICRO_CENTS
}

/**
 * One search.
 *
 * The `fetch` seam is a parameter so tests can drive every branch — a 429, a
 * timeout, a body that is not JSON — without a network and without mocking a
 * global. Defaults to the platform `fetch`.
 */
export async function searchTavily(
  request: TavilySearchRequest,
  deps: { fetch?: typeof fetch; env?: EnvLike } = {},
): Promise<TavilyOutcome> {
  const startedAt = Date.now()
  const env = deps.env ?? process.env
  const doFetch = deps.fetch ?? globalThis.fetch

  const apiKey = env.TAVILY_API_KEY?.trim()
  if (!apiKey) {
    return failed('not_configured', 'TAVILY_API_KEY is not set', startedAt)
  }
  if (typeof doFetch !== 'function') {
    // Older runtimes, or a caller that passed something odd. Degrade, do not throw.
    return failed('not_configured', 'no fetch implementation is available', startedAt)
  }

  const query = String(request.query ?? '').trim()
  if (!query) return failed('invalid_response', 'empty query', startedAt)

  const depth = request.depth ?? 'basic'
  const maxResults = clampResults(request.maxResults)

  try {
    const response = await doFetch(TAVILY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: depth,
        max_results: maxResults,
        // Both off deliberately. `include_answer` is a model-generated summary
        // produced by a vendor's model, which would be a second, unlogged model
        // in a product whose one model door is src/agent/client.ts. And
        // `include_raw_content` is the whole page, which is what our own crawler
        // fetches under robots.txt, a real User-Agent and a size cap.
        include_answer: false,
        include_raw_content: false,
        ...(request.includeDomains?.length ? { include_domains: [...request.includeDomains] } : {}),
      }),
      // A hung vendor must not hold a worker's lease open while it waits.
      signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })

    if (!response.ok) {
      return failed(failureFromStatus(response.status), `status ${response.status}`, startedAt)
    }

    const body: unknown = await response.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return failed('invalid_response', 'body was not a JSON object', startedAt)
    }

    const raw = (body as { results?: unknown }).results
    if (!Array.isArray(raw)) {
      return failed('invalid_response', 'body carried no results array', startedAt)
    }

    return {
      ok: true,
      results: raw.slice(0, maxResults).flatMap(toResult),
      costMicroCents: searchCostMicroCents(depth),
      latencyMs: Date.now() - startedAt,
    }
  } catch (error) {
    const name = error instanceof Error ? error.name : 'UnknownError'
    const detail = error instanceof Error ? `${name}: ${error.message}` : String(error)
    // `AbortSignal.timeout` rejects with a TimeoutError; an aborted request with
    // an AbortError. Both are "it did not answer in time", and telling them apart
    // from a genuine transport failure is what stops a slow minute being read as
    // a broken integration.
    const failure: TavilyFailure =
      name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'transport'
    return failed(failure, detail, startedAt)
  }
}

/**
 * Validate one result.
 *
 * Returns an array so it can be used with `flatMap` — a malformed entry
 * disappears rather than becoming an object full of `undefined` that something
 * downstream will render as the string "undefined" on an operator's screen.
 */
function toResult(entry: unknown): TavilyResult[] {
  if (!entry || typeof entry !== 'object') return []
  const record = entry as Record<string, unknown>

  const url = typeof record.url === 'string' ? record.url.trim() : ''
  if (!url) return []

  const normalised = normaliseUrl(url)
  const score = typeof record.score === 'number' && Number.isFinite(record.score) ? record.score : null

  return [
    {
      url,
      urlNorm: normalised.ok ? normalised.url : null,
      title: truncate(typeof record.title === 'string' ? record.title : '', MAX_TITLE_CHARS),
      snippet: truncate(typeof record.content === 'string' ? record.content : '', MAX_SNIPPET_CHARS),
      score,
    },
  ]
}

function truncate(value: string, limit: number): string {
  const trimmed = value.trim()
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}…`
}

function clampResults(requested: number | undefined): number {
  if (!Number.isFinite(requested ?? NaN)) return 5
  return Math.min(Math.max(Math.floor(requested as number), 1), MAX_RESULTS)
}

/** Split out because it is the part worth testing; the fetch itself is one line. */
export function failureFromStatus(status: number): TavilyFailure {
  if (status === 401 || status === 403) return 'unauthorised'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'transport'
  return 'invalid_response'
}

function failed(failure: TavilyFailure, detail: string, startedAt: number): TavilyOutcome {
  return { ok: false, failure, detail, latencyMs: Date.now() - startedAt }
}
