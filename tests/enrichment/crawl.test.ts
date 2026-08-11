/**
 * Crawling a prospect's own pages (C1).
 *
 * Three claims are being tested, and they are the three that cost real money or
 * real goodwill if they are wrong:
 *
 *   1. **The hash is stable across the noise a real page carries.** If it is not,
 *      the cache never hits and every weekly re-crawl pays for a model call it
 *      did not need.
 *   2. **robots.txt is obeyed, including the awkward parts** — Allow beating
 *      Disallow on a tie, and an unreachable robots.txt meaning stay out.
 *   3. **The size cap is enforced while streaming**, not against a header the
 *      server is free to lie about.
 *
 * No test here touches the network: `fetch` is a parameter throughout.
 */

import { describe, expect, it } from 'vitest'

import { branding, isPlaceholderBranding } from '../../src/lib/branding'
import {
  MAX_PAGE_BYTES,
  ROBOTS_ALLOW_ALL,
  type CrawlCache,
  createCrawlSession,
  crawlerIsContactable,
  crawlerUserAgent,
  defaultUserAgent,
  fetchPage,
  htmlToText,
  matchesRobotsPattern,
  parseRobots,
  sha256Hex,
  userAgentToken,
} from '../../src/enrichment/crawl'
import type { Queryable } from '../../src/enrichment/queue'

// ─── Fakes ──────────────────────────────────────────────────────────────────

/** A ledger that always says yes, so crawl tests are about crawling. */
const generousLedger: Queryable = {
  query: () =>
    Promise.resolve({
      rows: [
        {
          charged: true,
          refused: null,
          run_spent: '2000',
          run_remaining: '24998000',
          prospect_spent: '2000',
          prospect_remaining: '99998000',
        },
      ],
    }),
}

/** A ledger with nothing left. */
const exhaustedLedger: Queryable = {
  query: () =>
    Promise.resolve({
      rows: [
        {
          charged: false,
          refused: 'run_budget',
          run_spent: '25000000',
          run_remaining: '0',
          prospect_spent: '25000000',
          prospect_remaining: '75000000',
        },
      ],
    }),
}

type CachedRow = Awaited<ReturnType<CrawlCache['lookup']>> & object

function memoryCache(seed: Record<string, { hash: string; checkedAt: Date; etag?: string }> = {}) {
  const store = new Map<string, CachedRow>(
    Object.entries(seed).map(([url, value]) => [
      url,
      {
        contentHash: value.hash,
        httpStatus: 200,
        etag: value.etag ?? null,
        lastModified: null,
        textExcerpt: '',
        lastCheckedAt: value.checkedAt,
        fetchCount: 1,
      },
    ]),
  )
  const recorded: string[] = []
  const cache: CrawlCache & { recorded: string[] } = {
    recorded,
    lookup: (url) => Promise.resolve(store.get(url) ?? null),
    record: (entry) => {
      recorded.push(entry.contentHash)
      const previous = store.get(entry.urlNorm)
      const changed = previous?.contentHash !== entry.contentHash
      store.set(entry.urlNorm, {
        contentHash: entry.contentHash,
        httpStatus: entry.httpStatus,
        etag: entry.etag ?? null,
        lastModified: entry.lastModified ?? null,
        textExcerpt: entry.textExcerpt ?? '',
        lastCheckedAt: new Date(),
        fetchCount: (previous?.fetchCount ?? 0) + 1,
      })
      return Promise.resolve({ changed, firstSeen: !previous, fetchCount: 1 })
    },
  }
  return cache
}

function html(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  })
}

/** A fake site: a map of URL to Response factory. Anything else is a 404. */
function site(routes: Record<string, () => Response>): typeof fetch {
  return ((url: string) => {
    const route = routes[String(url)]
    if (!route) return Promise.resolve(new Response('nope', { status: 404 }))
    return Promise.resolve(route())
  }) as unknown as typeof fetch
}

const noSleep = () => Promise.resolve()

// ─── Text extraction and hashing ────────────────────────────────────────────

describe('htmlToText', () => {
  it('keeps the words a person would read', () => {
    expect(htmlToText('<h1>Menü</h1><p>Fingerfood ab <b>18,50</b> € p.P.</p>')).toBe(
      'Menü\nFingerfood ab 18,50 € p.P.',
    )
  })

  it('removes script and style bodies completely', () => {
    // This is where the nonces, build hashes and analytics ids live. Leaving them
    // in puts the byte-hash problem straight back.
    const text = htmlToText(
      '<style>.a{color:red}</style><script>var nonce="abc123"</script><p>Preise</p>',
    )
    expect(text).toBe('Preise')
  })

  it('decodes the entities a German site actually uses', () => {
    expect(htmlToText('<p>Gr&uuml;&szlig;e &amp; Men&#252; f&#xFC;r 20&euro;</p>')).toBe(
      'Grüße & Menü für 20€',
    )
  })

  it('leaves an unknown entity alone rather than eating it', () => {
    expect(htmlToText('<p>&nichtsowas; 5</p>')).toBe('&nichtsowas; 5')
  })

  it('is unmoved by reformatting, which is what makes the hash stable', () => {
    // A template reindented by a designer must not look like a price change to
    // C4's drift cards.
    const compact = '<div><p>Buffet</p><p>18,50 €</p></div>'
    const pretty = '<div>\n    <p>Buffet</p>\n\n    <p>18,50 €</p>\n</div>\n'
    expect(htmlToText(compact)).toBe(htmlToText(pretty))
  })

  it('is unmoved by a rotating nonce, which is why the hash is over text', () => {
    const first = '<html><head><script>window.csrf="a1b2"</script></head><body><p>Menü</p></body></html>'
    const second = '<html><head><script>window.csrf="z9y8"</script></head><body><p>Menü</p></body></html>'
    expect(sha256Hex(htmlToText(first))).toBe(sha256Hex(htmlToText(second)))
  })

  it('does notice an actual price change', () => {
    expect(sha256Hex(htmlToText('<p>18,50 €</p>'))).not.toBe(
      sha256Hex(htmlToText('<p>19,50 €</p>')),
    )
  })

  it('produces a 64-character lowercase hex digest', () => {
    expect(sha256Hex('x')).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ─── Identity ───────────────────────────────────────────────────────────────

describe('the User-Agent', () => {
  it('carries a contact URL and the product name from branding, not a literal', () => {
    // Open question #1 is still open, and `src/lib/branding.ts` exists so that
    // closing it costs three environment variables. A crawler introducing itself
    // by a hardcoded name would be the place where forgetting is least visible:
    // nobody reads their own User-Agent.
    expect(defaultUserAgent()).toMatch(/^\w+Bot\/1\.0 \(\+https?:\/\/\S+\/bot\)$/)
    expect(defaultUserAgent()).toContain(branding().productName)
  })

  it('lets the environment override it outright', () => {
    expect(crawlerUserAgent({ CRAWLER_USER_AGENT: 'X/2 (+https://x.test)' })).toBe(
      'X/2 (+https://x.test)',
    )
  })

  it('knows when nobody could actually reach us', () => {
    // On placeholder branding the contact URL points at localhost. That is worse
    // than a generic string: it looks like a real address and leads nowhere.
    expect(crawlerIsContactable({})).toBe(isPlaceholderBranding() ? false : true)
    expect(crawlerIsContactable({ CRAWLER_USER_AGENT: 'X/2 (+https://x.test)' })).toBe(true)
  })

  it('yields the product token robots.txt groups are matched against', () => {
    // Group matching is per token, so a two-word product name must not produce a
    // token nobody can write a rule against.
    expect(userAgentToken('OfferprofiBot/1.0 (+https://x.test)')).toBe('offerprofibot')
    expect(userAgentToken(defaultUserAgent())).toMatch(/^[a-z0-9]+bot$/)
  })
})

// ─── robots.txt ─────────────────────────────────────────────────────────────

describe('parseRobots', () => {
  it('applies the group naming us over the wildcard group', () => {
    const rules = parseRobots(
      ['User-agent: *', 'Disallow: /', '', 'User-agent: offerprofibot', 'Disallow: /intern'].join('\n'),
      'offerprofibot',
    )
    expect(rules.allows('/speisekarte')).toBe(true)
    expect(rules.allows('/intern/preise')).toBe(false)
  })

  it('falls back to the wildcard group when nobody names us', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /admin', 'offerprofibot')
    expect(rules.allows('/admin/x')).toBe(false)
    expect(rules.allows('/menu')).toBe(true)
  })

  it('lets Allow beat Disallow on a longer match', () => {
    // The extremely common `Disallow: /` plus `Allow: /menu`. Getting this
    // backwards means silently refusing to read the one page worth reading.
    const rules = parseRobots('User-agent: *\nDisallow: /\nAllow: /menu', 'bot')
    expect(rules.allows('/menu')).toBe(true)
    expect(rules.allows('/menu/lunch')).toBe(true)
    expect(rules.allows('/intern')).toBe(false)
  })

  it('lets Allow win an exact-length tie', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /a\nAllow: /a', 'bot')
    expect(rules.allows('/a')).toBe(true)
  })

  it('reads an empty Disallow as "nothing is forbidden"', () => {
    // Read as a prefix match on everything — which is the easy mistake — this
    // line would lock the crawler out of the entire web.
    const rules = parseRobots('User-agent: *\nDisallow:', 'bot')
    expect(rules.allows('/anything')).toBe(true)
  })

  it('ignores comments and blank lines', () => {
    const rules = parseRobots('# hello\nUser-agent: *   # everyone\nDisallow: /x  # not this', 'bot')
    expect(rules.allows('/x')).toBe(false)
    expect(rules.allows('/y')).toBe(true)
  })

  it('groups consecutive user-agent lines together', () => {
    const rules = parseRobots('User-agent: googlebot\nUser-agent: bot\nDisallow: /p', 'bot')
    expect(rules.allows('/p')).toBe(false)
  })

  it('reads Crawl-delay when a site asks for one', () => {
    expect(parseRobots('User-agent: *\nCrawl-delay: 2.5', 'bot').crawlDelayMs).toBe(2_500)
    expect(parseRobots('User-agent: *\nDisallow:', 'bot').crawlDelayMs).toBeNull()
  })

  it('treats an empty file as permission', () => {
    expect(parseRobots('', 'bot').allows('/x')).toBe(true)
    expect(ROBOTS_ALLOW_ALL.allows('/x')).toBe(true)
  })

  it('supports the wildcard and the end anchor', () => {
    expect(matchesRobotsPattern('/*.pdf$', '/menu/karte.pdf')).toBe(true)
    expect(matchesRobotsPattern('/*.pdf$', '/menu/karte.pdf?v=2')).toBe(false)
    expect(matchesRobotsPattern('/a/*/c', '/a/b/c')).toBe(true)
    expect(matchesRobotsPattern('/a', '/ab')).toBe(true)
  })

  it('never throws on a malformed file', () => {
    for (const nonsense of ['::::', 'Disallow: /x', 'User-agent\nDisallow', ' ']) {
      expect(() => parseRobots(nonsense, 'bot').allows('/x')).not.toThrow()
    }
  })
})

// ─── fetchPage ──────────────────────────────────────────────────────────────

describe('fetchPage', () => {
  it('sends the real User-Agent and the conditional headers', async () => {
    let seen: Record<string, string> = {}
    const spy = ((_url: string, init: RequestInit) => {
      seen = init.headers as Record<string, string>
      return Promise.resolve(html('<p>hi</p>'))
    }) as unknown as typeof fetch

    await fetchPage('https://example.com/', {
      fetch: spy,
      userAgent: 'TestBot/1.0 (+https://x.test)',
      etag: 'W/"abc"',
      lastModified: 'Mon, 10 Aug 2026 10:00:00 GMT',
    })

    expect(seen['User-Agent']).toBe('TestBot/1.0 (+https://x.test)')
    expect(seen['If-None-Match']).toBe('W/"abc"')
    expect(seen['If-Modified-Since']).toBe('Mon, 10 Aug 2026 10:00:00 GMT')
  })

  it('returns a bodyless success for a 304', async () => {
    const result = await fetchPage('https://example.com/', {
      fetch: (() => Promise.resolve(new Response(null, { status: 304 }))) as unknown as typeof fetch,
    })
    expect(result).toMatchObject({ ok: true, status: 304, text: null })
  })

  it('marks 5xx and 429 retryable and 4xx not', async () => {
    const status = async (code: number) =>
      fetchPage('https://example.com/', {
        fetch: (() => Promise.resolve(new Response('x', { status: code }))) as unknown as typeof fetch,
      })

    expect(await status(503)).toMatchObject({ ok: false, failure: 'http_error', retryable: true })
    expect(await status(429)).toMatchObject({ ok: false, retryable: true })
    // A 404 is the site telling us something true about itself. Retrying it will
    // produce the same answer.
    expect(await status(404)).toMatchObject({ ok: false, retryable: false })
  })

  it('refuses a binary response without reading it', async () => {
    const result = await fetchPage('https://example.com/x.pdf', {
      fetch: (() =>
        Promise.resolve(
          new Response('%PDF-1.4', { status: 200, headers: { 'content-type': 'application/pdf' } }),
        )) as unknown as typeof fetch,
    })
    expect(result).toMatchObject({ ok: false, failure: 'not_text' })
  })

  it('refuses a body that overruns the cap, and discards what it read', async () => {
    // Half a page is a different page. Hashing it would poison the cache with a
    // digest corresponding to nothing anyone published.
    const result = await fetchPage('https://example.com/', {
      maxBytes: 100,
      fetch: (() => Promise.resolve(html('x'.repeat(5_000)))) as unknown as typeof fetch,
    })
    expect(result).toMatchObject({ ok: false, failure: 'too_large' })
  })

  it('does not believe a content-length that is under the cap while the body is not', async () => {
    // The cap is enforced on the stream, because content-length is a claim made
    // by the server being defended against.
    const result = await fetchPage('https://example.com/', {
      maxBytes: 100,
      fetch: (() =>
        Promise.resolve(
          new Response('y'.repeat(5_000), {
            status: 200,
            headers: { 'content-type': 'text/html', 'content-length': '10' },
          }),
        )) as unknown as typeof fetch,
    })
    expect(result).toMatchObject({ ok: false, failure: 'too_large' })
  })

  it('rejects an advertised content-length over the cap before reading anything', async () => {
    const result = await fetchPage('https://example.com/', {
      fetch: (() =>
        Promise.resolve(
          new Response('short', {
            status: 200,
            headers: { 'content-type': 'text/html', 'content-length': String(MAX_PAGE_BYTES + 1) },
          }),
        )) as unknown as typeof fetch,
    })
    expect(result).toMatchObject({ ok: false, failure: 'too_large' })
  })

  it('turns a transport failure into a result, never an exception', async () => {
    const timeout = Object.assign(new Error('slow'), { name: 'TimeoutError' })
    await expect(
      fetchPage('https://example.com/', {
        fetch: (() => Promise.reject(timeout)) as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({ ok: false, failure: 'timeout', retryable: true })
  })
})

// ─── The session ────────────────────────────────────────────────────────────

describe('createCrawlSession', () => {
  const ROBOTS = 'https://example.com/robots.txt'

  function session(
    routes: Record<string, () => Response>,
    overrides: Partial<Parameters<typeof createCrawlSession>[0]> = {},
  ) {
    return createCrawlSession({
      jobId: 'job-1',
      host: 'example.com',
      db: generousLedger,
      cache: memoryCache(),
      fetch: site(routes),
      sleep: noSleep,
      hostDelayMs: 0,
      ...overrides,
    })
  }

  it('fetches a page, extracts it and reports it as changed', async () => {
    const crawler = session({
      [ROBOTS]: () => new Response('', { status: 404 }),
      'https://example.com/menu': () => html('<h1>Buffet</h1><p>18,50 €</p>'),
    })

    const result = await crawler.fetch('https://www.example.com/menu/?utm_source=x')
    expect(result).toMatchObject({ status: 'fetched', urlNorm: 'https://example.com/menu', changed: true })
    expect(result.status === 'fetched' && result.text).toContain('18,50 €')
  })

  it('obeys a robots.txt that forbids the path', async () => {
    const crawler = session({
      [ROBOTS]: () => new Response('User-agent: *\nDisallow: /intern', { status: 200 }),
      'https://example.com/intern': () => html('<p>secret</p>'),
    })
    expect(await crawler.fetch('https://example.com/intern')).toMatchObject({
      status: 'skipped',
      reason: 'robots',
    })
  })

  it('stays out entirely when robots.txt is unreachable', async () => {
    // RFC 9309 §2.3.1.4. A server that cannot tell us its rules gets the benefit
    // of the doubt, because being blocked by a hosting provider costs us every
    // prospect on that provider.
    const crawler = session({
      [ROBOTS]: () => new Response('boom', { status: 500 }),
      'https://example.com/menu': () => html('<p>x</p>'),
    })
    expect(await crawler.fetch('https://example.com/menu')).toMatchObject({
      status: 'skipped',
      reason: 'robots',
    })
  })

  it('fetches robots.txt once per origin, not once per page', async () => {
    let robotsHits = 0
    const crawler = session({
      [ROBOTS]: () => {
        robotsHits += 1
        return new Response('', { status: 404 })
      },
      'https://example.com/a': () => html('<p>a</p>'),
      'https://example.com/b': () => html('<p>b</p>'),
    })

    await crawler.fetch('https://example.com/a')
    await crawler.fetch('https://example.com/b')
    expect(robotsHits).toBe(1)
  })

  it('does not follow an outbound link', async () => {
    // Following one would spend this prospect's budget crawling Instagram and —
    // because §4 turns extracts into training signal — file a third party's
    // content as a fact about this business.
    const crawler = session({ [ROBOTS]: () => new Response('', { status: 404 }) })
    expect(await crawler.fetch('https://instagram.com/cateringmeier')).toMatchObject({
      status: 'skipped',
      reason: 'off_site',
    })
  })

  it('follows a subdomain, because menus live on shop.example.com', async () => {
    const crawler = session({
      'https://shop.example.com/robots.txt': () => new Response('', { status: 404 }),
      'https://shop.example.com/karte': () => html('<p>Karte</p>'),
    })
    expect(await crawler.fetch('https://shop.example.com/karte')).toMatchObject({
      status: 'fetched',
    })
  })

  it('refuses a URL that is not one, without charging for it', async () => {
    const crawler = session({}, { db: exhaustedLedger })
    // Even against an exhausted ledger this is a skip, not a cap: the free
    // refusals are all decided before a micro-cent is charged.
    expect(await crawler.fetch('mailto:info@example.com')).toMatchObject({
      status: 'skipped',
      reason: 'bad_url',
    })
  })

  it('reads a URL once per run, however many times it is linked', async () => {
    let hits = 0
    const crawler = session({
      [ROBOTS]: () => new Response('', { status: 404 }),
      'https://example.com/menu': () => {
        hits += 1
        return html('<p>x</p>')
      },
    })

    await crawler.fetch('https://example.com/menu')
    const second = await crawler.fetch('https://www.example.com/menu/')
    expect(second).toMatchObject({ status: 'skipped', reason: 'already_seen' })
    expect(hits).toBe(1)
    expect(crawler.seen().has('https://example.com/menu')).toBe(true)
  })

  it('costs nothing at all for a page checked within the freshness window', async () => {
    // The whole point of the cache: no request, no charge, no extraction, and no
    // model call. Asserted by making both the ledger and the network hostile.
    let hits = 0
    const crawler = session(
      {
        [ROBOTS]: () => new Response('', { status: 404 }),
        'https://example.com/menu': () => {
          hits += 1
          return html('<p>x</p>')
        },
      },
      {
        db: exhaustedLedger,
        cache: memoryCache({
          'https://example.com/menu': { hash: 'a'.repeat(64), checkedAt: new Date() },
        }),
      },
    )

    const result = await crawler.fetch('https://example.com/menu')
    expect(result).toMatchObject({
      status: 'fetched',
      changed: false,
      source: 'cache',
      contentHash: 'a'.repeat(64),
    })
    // Unchanged means do not re-extract, so there is deliberately nothing to.
    expect(result.status === 'fetched' && result.text).toBeNull()
    expect(hits).toBe(0)
  })

  it('re-checks a stale page and reports it unchanged when the text has not moved', async () => {
    const text = htmlToText('<p>Buffet 18,50 €</p>')
    const cache = memoryCache({
      'https://example.com/menu': {
        hash: sha256Hex(text),
        checkedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      },
    })
    const crawler = session(
      {
        [ROBOTS]: () => new Response('', { status: 404 }),
        // Same words, different markup and a fresh nonce.
        'https://example.com/menu': () =>
          html('<script>var n="q7"</script>\n<div>\n  <p>Buffet 18,50 €</p>\n</div>'),
      },
      { cache },
    )

    const result = await crawler.fetch('https://example.com/menu')
    expect(result).toMatchObject({ status: 'fetched', changed: false, source: 'network' })
    expect(result.status === 'fetched' && result.text).toBeNull()
  })

  it('honours a 304 without re-extracting', async () => {
    const cache = memoryCache({
      'https://example.com/menu': {
        hash: 'b'.repeat(64),
        checkedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        etag: 'W/"v1"',
      },
    })
    const crawler = session(
      {
        [ROBOTS]: () => new Response('', { status: 404 }),
        'https://example.com/menu': () => new Response(null, { status: 304 }),
      },
      { cache },
    )

    expect(await crawler.fetch('https://example.com/menu')).toMatchObject({
      status: 'fetched',
      changed: false,
      contentHash: 'b'.repeat(64),
      text: null,
    })
    // The row is touched so the freshness window restarts.
    expect(cache.recorded).toEqual(['b'.repeat(64)])
  })

  it('stops with the cap reason when the ledger refuses', async () => {
    let hits = 0
    const crawler = session(
      {
        [ROBOTS]: () => new Response('', { status: 404 }),
        'https://example.com/menu': () => {
          hits += 1
          return html('<p>x</p>')
        },
      },
      { db: exhaustedLedger },
    )

    expect(await crawler.fetch('https://example.com/menu')).toMatchObject({
      status: 'capped',
      refused: 'run_budget',
    })
    // Charged first, fetched second. A refused charge must cost no request.
    expect(hits).toBe(0)
  })

  it('waits between requests to one host, and asks robots.txt how long', async () => {
    const waits: number[] = []
    let clock = 0
    const crawler = session(
      {
        [ROBOTS]: () => new Response('User-agent: *\nCrawl-delay: 3', { status: 200 }),
        'https://example.com/a': () => html('<p>a</p>'),
        'https://example.com/b': () => html('<p>b</p>'),
      },
      {
        hostDelayMs: 1_000,
        now: () => clock,
        sleep: (ms: number) => {
          waits.push(ms)
          clock += ms
          return Promise.resolve()
        },
      },
    )

    await crawler.fetch('https://example.com/a')
    await crawler.fetch('https://example.com/b')
    // The site asked for three seconds; our own floor of one is not a ceiling.
    expect(waits).toEqual([3_000])
  })

  it('reports a network failure as retryable rather than throwing', async () => {
    const crawler = session({
      [ROBOTS]: () => new Response('', { status: 404 }),
      'https://example.com/menu': () => new Response('nope', { status: 503 }),
    })
    expect(await crawler.fetch('https://example.com/menu')).toMatchObject({
      status: 'error',
      failure: 'http_error',
      retryable: true,
    })
  })
})
