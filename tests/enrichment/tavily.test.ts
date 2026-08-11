/**
 * The Tavily client (C1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PROPERTY UNDER TEST IS THAT THE PRODUCT RUNS WITHOUT IT.
 *
 * Every developer laptop and the demo build have no `TAVILY_API_KEY`. If an
 * unconfigured search throws, the first thing anybody without a key sees is a
 * stack trace from a feature they were not using. So `not_configured` is a
 * result, and the assertions below cover every other way a vendor can fail too —
 * a 429, a timeout, a 200 carrying nonsense — because each of them reaches a
 * caller as a typed outcome or it reaches it as an exception, and there is no
 * third option.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, expect, it } from 'vitest'

import { TAVILY_BASIC_SEARCH_MICRO_CENTS } from '../../src/enrichment/ledger'
import {
  failureFromStatus,
  isTavilyConfigured,
  searchCostMicroCents,
  searchTavily,
} from '../../src/enrichment/tavily'

const KEY = { TAVILY_API_KEY: 'tvly-test-key' }

function respondWith(body: unknown, init: ResponseInit = {}): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
        ...init,
      }),
    )) as unknown as typeof fetch
}

function rejectWith(error: Error): typeof fetch {
  return (() => Promise.reject(error)) as unknown as typeof fetch
}

describe('degrading when unconfigured', () => {
  it('reports not_configured instead of throwing when there is no API key', async () => {
    const outcome = await searchTavily({ query: 'Catering Meier Berlin' }, { env: {} })
    expect(outcome).toMatchObject({ ok: false, failure: 'not_configured' })
  })

  it('treats a blank key as no key', async () => {
    const outcome = await searchTavily(
      { query: 'x' },
      { env: { TAVILY_API_KEY: '   ' } },
    )
    expect(outcome).toMatchObject({ ok: false, failure: 'not_configured' })
  })

  it('makes no network call at all when unconfigured', async () => {
    let called = false
    const spy = (() => {
      called = true
      return Promise.reject(new Error('should not be reached'))
    }) as unknown as typeof fetch

    await searchTavily({ query: 'x' }, { env: {}, fetch: spy })
    expect(called).toBe(false)
  })

  it('lets a caller ask first, so the UI can say "not connected" not "failed"', () => {
    expect(isTavilyConfigured({})).toBe(false)
    expect(isTavilyConfigured({ TAVILY_API_KEY: 'k' })).toBe(true)
  })

  it('degrades rather than throwing when there is no fetch implementation', async () => {
    // A runtime without a global `fetch`, which is not hypothetical: this module
    // is imported by a worker that may one day run somewhere older than Node 18.
    // `not_configured` is the honest answer, and it must not be a TypeError.
    const outcome = await searchTavily(
      { query: 'x' },
      { env: KEY, fetch: {} as unknown as typeof fetch },
    )
    expect(outcome).toMatchObject({ ok: false, failure: 'not_configured' })
  })
})

describe('a successful search', () => {
  it('returns validated results with a normalised cache key', async () => {
    const outcome = await searchTavily(
      { query: 'Catering Meier Berlin' },
      {
        env: KEY,
        fetch: respondWith({
          results: [
            {
              title: 'Catering Meier',
              url: 'https://WWW.cateringmeier.de/?utm_source=google#top',
              content: 'Fingerfood und Buffet in Berlin',
              score: 0.91,
            },
          ],
        }),
      },
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.results).toHaveLength(1)
    expect(outcome.results[0]).toMatchObject({
      url: 'https://WWW.cateringmeier.de/?utm_source=google#top',
      urlNorm: 'https://cateringmeier.de',
      title: 'Catering Meier',
      score: 0.91,
    })
  })

  it('prices the search in integer micro-cents', async () => {
    const outcome = await searchTavily({ query: 'x' }, { env: KEY, fetch: respondWith({ results: [] }) })
    expect(outcome.ok && outcome.costMicroCents).toBe(TAVILY_BASIC_SEARCH_MICRO_CENTS)
    expect(searchCostMicroCents('advanced')).toBe(TAVILY_BASIC_SEARCH_MICRO_CENTS * 2)
  })

  it('drops malformed entries rather than emitting objects full of undefined', async () => {
    // A result that renders as the string "undefined" on an operator's screen is
    // worse than a result that is not there.
    const outcome = await searchTavily(
      { query: 'x' },
      {
        env: KEY,
        fetch: respondWith({
          results: [null, 42, {}, { url: '' }, { url: 'https://ok.example/' }],
        }),
      },
    )
    expect(outcome.ok && outcome.results.map((r) => r.urlNorm)).toEqual(['https://ok.example'])
  })

  it('keeps an unfetchable url visible but marks it as having no cache key', async () => {
    const outcome = await searchTavily(
      { query: 'x' },
      { env: KEY, fetch: respondWith({ results: [{ url: 'mailto:info@example.com' }] }) },
    )
    expect(outcome.ok && outcome.results[0]).toMatchObject({
      url: 'mailto:info@example.com',
      urlNorm: null,
    })
  })

  it('truncates a snippet rather than carrying whatever the vendor sent', async () => {
    // These end up in a prompt and on a screen. A vendor that starts returning a
    // 40MB `content` field must cost a truncated string, not a dead worker.
    const outcome = await searchTavily(
      { query: 'x' },
      {
        env: KEY,
        fetch: respondWith({ results: [{ url: 'https://a.example/', content: 'x'.repeat(50_000) }] }),
      },
    )
    expect(outcome.ok && (outcome.results[0]?.snippet.length ?? 0)).toBeLessThanOrEqual(2_001)
  })

  it('never asks the vendor for a generated answer', async () => {
    // `include_answer` is a summary from somebody else's model. One model door —
    // src/agent/client.ts — or the boundary means nothing.
    let sentBody = ''
    const spy = ((_url: string, init: RequestInit) => {
      sentBody = String(init.body)
      return Promise.resolve(
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }) as unknown as typeof fetch

    await searchTavily({ query: 'x' }, { env: KEY, fetch: spy })
    expect(JSON.parse(sentBody)).toMatchObject({ include_answer: false, include_raw_content: false })
  })

  it('clamps max_results into the range the vendor accepts', async () => {
    let sentBody = ''
    const spy = ((_url: string, init: RequestInit) => {
      sentBody = String(init.body)
      return Promise.resolve(
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }) as unknown as typeof fetch

    await searchTavily({ query: 'x', maxResults: 5_000 }, { env: KEY, fetch: spy })
    expect(JSON.parse(sentBody).max_results).toBe(20)
  })
})

describe('every way the vendor can fail', () => {
  it('maps statuses to kinds worth telling apart', () => {
    // A busy minute read as a broken integration means nobody investigates the
    // right thing — the same argument as `failureFromStatus` in src/agent/client.ts.
    expect(failureFromStatus(401)).toBe('unauthorised')
    expect(failureFromStatus(403)).toBe('unauthorised')
    expect(failureFromStatus(429)).toBe('rate_limited')
    expect(failureFromStatus(500)).toBe('transport')
    expect(failureFromStatus(503)).toBe('transport')
    expect(failureFromStatus(400)).toBe('invalid_response')
  })

  it('returns a failure for a non-200 rather than throwing', async () => {
    const outcome = await searchTavily(
      { query: 'x' },
      { env: KEY, fetch: respondWith({}, { status: 429 }) },
    )
    expect(outcome).toMatchObject({ ok: false, failure: 'rate_limited' })
  })

  it('returns a failure for a body that is not JSON', async () => {
    const outcome = await searchTavily(
      { query: 'x' },
      { env: KEY, fetch: respondWith('<html>maintenance</html>') },
    )
    expect(outcome).toMatchObject({ ok: false, failure: 'invalid_response' })
  })

  it('returns a failure for a 200 carrying no results array', async () => {
    const outcome = await searchTavily(
      { query: 'x' },
      { env: KEY, fetch: respondWith({ answer: 'hello' }) },
    )
    expect(outcome).toMatchObject({ ok: false, failure: 'invalid_response' })
  })

  it('distinguishes a timeout from a transport failure', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    expect(await searchTavily({ query: 'x' }, { env: KEY, fetch: rejectWith(timeout) })).toMatchObject(
      { ok: false, failure: 'timeout' },
    )

    const reset = Object.assign(new Error('ECONNRESET'), { name: 'TypeError' })
    expect(await searchTavily({ query: 'x' }, { env: KEY, fetch: rejectWith(reset) })).toMatchObject({
      ok: false,
      failure: 'transport',
    })
  })

  it('refuses an empty query without asking the vendor', async () => {
    const outcome = await searchTavily({ query: '   ' }, { env: KEY, fetch: rejectWith(new Error('x')) })
    expect(outcome).toMatchObject({ ok: false, failure: 'invalid_response' })
  })

  it('throws under no circumstance a caller can construct', async () => {
    const nasty = [
      respondWith(null as unknown as string),
      respondWith({ results: [{ url: {} }] }),
      rejectWith(new Error('boom')),
      respondWith({}, { status: 500 }),
    ]
    for (const fetchImpl of nasty) {
      await expect(searchTavily({ query: 'x' }, { env: KEY, fetch: fetchImpl })).resolves.toBeTruthy()
    }
  })
})
