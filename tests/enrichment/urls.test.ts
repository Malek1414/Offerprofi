/**
 * URL normalisation (C1).
 *
 * Tested at length because this function *is* the crawl cache. Two spellings of
 * one page that normalise differently cost a fetch, an extraction and a model
 * call — about 2.7¢ — every week, for every prospect. Two different pages that
 * normalise the same put one page's evidence under the other page's URL on a
 * caterer's confirmation screen, which corrupts the §4 training signal.
 *
 * The asymmetry between those two failures is why several assertions below check
 * that a transformation *did not* happen.
 */

import { describe, expect, it } from 'vitest'

import { isSameHost, isSameOrSubdomain, normaliseUrl, urlCacheKey } from '../../src/enrichment/urls'

function key(raw: string, base?: string): string | null {
  return urlCacheKey(raw, base)
}

describe('normaliseUrl — the host', () => {
  it('lowercases the scheme and the host, and keeps the path case', () => {
    // Paths are case-sensitive on most servers. Lowercasing `/Speisekarte.pdf`
    // produces a 404, or somebody else's file.
    expect(key('HTTPS://WWW.Example.COM/Speisekarte.PDF')).toBe(
      'https://example.com/Speisekarte.PDF',
    )
  })

  it('treats www and the bare domain as one site', () => {
    expect(key('https://www.cateringmeier.de/menue')).toBe('https://cateringmeier.de/menue')
    expect(key('https://cateringmeier.de/menue')).toBe('https://cateringmeier.de/menue')
  })

  it('keeps www when removing it would leave a bare TLD', () => {
    // `www.de` is a real registrable domain. Reducing it to `de` is nonsense.
    expect(key('https://www.de/')).toBe('https://www.de')
  })

  it('does not confuse a subdomain called www-something with the www prefix', () => {
    expect(key('https://www2.example.com/')).toBe('https://www2.example.com')
    expect(key('https://wwwshop.example.com/')).toBe('https://wwwshop.example.com')
  })

  it('drops the fully-qualified trailing dot', () => {
    expect(key('https://example.com./menu')).toBe('https://example.com/menu')
  })

  it('drops the default port and keeps a real one', () => {
    expect(key('https://example.com:443/menu')).toBe('https://example.com/menu')
    expect(key('http://example.com:80/menu')).toBe('http://example.com/menu')
    expect(key('https://example.com:8443/menu')).toBe('https://example.com:8443/menu')
  })

  it('punycodes an internationalised domain, so both spellings share a key', () => {
    const unicode = key('https://münchen-catering.de/menü')
    const punycode = key('https://xn--mnchen-catering-zvb.de/menü')
    expect(unicode).toBe(punycode)
    expect(unicode).toBe('https://xn--mnchen-catering-zvb.de/men%C3%BC')
  })

  it('does not fold http and https together', () => {
    // Same bytes today, possibly a redirect to a different site tomorrow, and one
    // is a plaintext request. Not our call to make.
    expect(key('http://example.com/a')).not.toBe(key('https://example.com/a'))
  })
})

describe('normaliseUrl — the path', () => {
  it('removes one trailing slash', () => {
    expect(key('https://example.com/menu/')).toBe('https://example.com/menu')
  })

  it('collapses the root to nothing, so both spellings of a homepage agree', () => {
    expect(key('https://example.com/')).toBe('https://example.com')
    expect(key('https://example.com')).toBe('https://example.com')
  })

  it('leaves a deeper path alone apart from that one slash', () => {
    expect(key('https://example.com/a/b//c/')).toBe('https://example.com/a/b//c')
  })
})

describe('normaliseUrl — the query', () => {
  it('drops utm_ parameters, whatever they are called', () => {
    expect(key('https://example.com/m?utm_source=insta&utm_medium=bio&utm_wibble=1')).toBe(
      'https://example.com/m',
    )
  })

  it('drops the click-id family, case-insensitively', () => {
    expect(key('https://example.com/m?FBCLID=x&gclid=y&msclkid=z')).toBe('https://example.com/m')
  })

  it('keeps ref, on purpose', () => {
    // Every other normaliser drops it. On a real fraction of sites `?ref=`
    // selects content, and folding two different pages onto one cache key is the
    // failure that must not happen. We pay for the occasional extra fetch instead.
    expect(key('https://example.com/m?ref=partner')).toBe('https://example.com/m?ref=partner')
  })

  it('keeps a parameter that selects content', () => {
    expect(key('https://example.com/menu?page=2')).toBe('https://example.com/menu?page=2')
  })

  it('sorts the remaining parameters, so order is not a second cache entry', () => {
    expect(key('https://example.com/m?b=2&a=1')).toBe(key('https://example.com/m?a=1&b=2'))
    expect(key('https://example.com/m?b=2&a=1')).toBe('https://example.com/m?a=1&b=2')
  })

  it('sorts repeated names by value, so the order is total', () => {
    expect(key('https://example.com/m?a=2&a=1')).toBe('https://example.com/m?a=1&a=2')
  })

  it('drops a lone question mark', () => {
    expect(key('https://example.com/menu?')).toBe('https://example.com/menu')
  })

  it('keeps a parameter with an empty value', () => {
    expect(key('https://example.com/m?q=')).toBe('https://example.com/m?q=')
  })
})

describe('normaliseUrl — the fragment', () => {
  it('is always dropped, because it never reaches a server', () => {
    expect(key('https://example.com/menu#preise')).toBe('https://example.com/menu')
    expect(key('https://example.com/menu#')).toBe('https://example.com/menu')
  })
})

describe('normaliseUrl — what a spreadsheet actually contains', () => {
  it('accepts a bare host, because that is how a human writes a website', () => {
    expect(key('cateringmeier.de')).toBe('https://cateringmeier.de')
    expect(key('  www.cateringmeier.de/menue  ')).toBe('https://cateringmeier.de/menue')
  })

  it('assumes https rather than http for a bare host', () => {
    // Being wrong costs one redirect. The other way round is a plaintext request
    // to a site that may not answer on port 80 at all.
    expect(key('example.com')).toBe('https://example.com')
  })

  it('rejects the other things that end up in a website column', () => {
    expect(normaliseUrl('')).toEqual({ ok: false, reason: 'empty' })
    expect(normaliseUrl('   ')).toEqual({ ok: false, reason: 'empty' })
    expect(normaliseUrl('mailto:info@example.com')).toEqual({
      ok: false,
      reason: 'unsupported_scheme',
    })
    expect(normaliseUrl('tel:+4922155443')).toEqual({ ok: false, reason: 'unsupported_scheme' })
    expect(normaliseUrl('javascript:alert(1)')).toEqual({
      ok: false,
      reason: 'unsupported_scheme',
    })
    expect(normaliseUrl('data:text/html,<b>x</b>')).toEqual({
      ok: false,
      reason: 'unsupported_scheme',
    })
  })

  it('rejects a scheme with no host', () => {
    expect(normaliseUrl('https://').ok).toBe(false)
  })

  it('never throws, whatever it is handed', () => {
    for (const nonsense of ['n/a', 'siehe Instagram', '???', 'http://', '//', '::::']) {
      expect(() => normaliseUrl(nonsense)).not.toThrow()
    }
  })
})

describe('normaliseUrl — resolving a link found while crawling', () => {
  it('resolves a relative href against the page it was found on', () => {
    expect(key('/speisekarte', 'https://example.com/ueber-uns')).toBe(
      'https://example.com/speisekarte',
    )
    expect(key('../preise', 'https://example.com/a/b/c')).toBe('https://example.com/a/preise')
  })

  it('lets an absolute href win over the base', () => {
    expect(key('https://other.example/x', 'https://example.com/')).toBe('https://other.example/x')
  })

  it('normalises the resolved result the same way as a direct one', () => {
    expect(key('./menu/?utm_source=x#top', 'https://www.example.com/')).toBe(
      'https://example.com/menu',
    )
  })
})

describe('normaliseUrl — the result carries the parts a crawler needs', () => {
  it('reports the host and the origin alongside the key', () => {
    const result = normaliseUrl('https://WWW.Example.com:8443/a/b/?z=1#x')
    expect(result).toEqual({
      ok: true,
      url: 'https://example.com:8443/a/b?z=1',
      host: 'example.com',
      origin: 'https://example.com:8443',
    })
  })

  it('produces a key whose origin prefix can be sliced off to get the path', () => {
    // `createCrawlSession` does exactly this to ask robots.txt about a path.
    const result = normaliseUrl('https://example.com/menu?a=1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.url.slice(result.origin.length)).toBe('/menu?a=1')
  })
})

describe('isSameHost / isSameOrSubdomain', () => {
  it('sees through www and case', () => {
    expect(isSameHost('https://WWW.Example.com/a', 'http://example.com/b')).toBe(true)
  })

  it('does not treat a different host as the same site', () => {
    expect(isSameHost('https://example.com', 'https://example.org')).toBe(false)
  })

  it('accepts a subdomain, because menus live on shop.example.com', () => {
    expect(isSameOrSubdomain('shop.example.com', 'example.com')).toBe(true)
    expect(isSameOrSubdomain('example.com', 'example.com')).toBe(true)
  })

  it('will not be fooled by a suffix that is not a dot boundary', () => {
    expect(isSameOrSubdomain('notexample.com', 'example.com')).toBe(false)
    expect(isSameOrSubdomain('example.com.evil.test', 'example.com')).toBe(false)
  })

  it('does not relate two different sites under one public suffix', () => {
    expect(isSameOrSubdomain('other.co.uk', 'co.uk')).toBe(true) // literal, and known
    expect(isSameOrSubdomain('example.co.uk', 'other.co.uk')).toBe(false)
  })
})
