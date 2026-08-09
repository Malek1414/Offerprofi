/**
 * Slug derivation and collision handling (F0.7).
 *
 * Acceptance under test: "Slug collision is handled with a suggestion, not an error
 * page." The suggestion half is here; the "not an error page" half is in the route.
 *
 * The names below are real German agency-name shapes, because that is where the
 * interesting failures are. An English test corpus would pass a slugifier that
 * mangles every umlaut.
 */

import { describe, expect, it } from 'vitest'

import {
  aliasEmailForSlug,
  checkSlug,
  isReservedSlug,
  MAX_SLUG_LENGTH,
  slugify,
  suggestSlugs,
} from '../../src/auth/slug'
import { isPlausibleSlug } from '../../src/lib/agency'

describe('F0.7 — slugify', () => {
  it('romanises German umlauts the way a German reader expects', () => {
    // The failure this prevents: NFD alone gives `blten-bnder`, which Lisa would not
    // recognise as her own business.
    expect(slugify('Blüten & Bänder')).toBe('blueten-und-baender')
    expect(slugify('Schröder Events')).toBe('schroeder-events')
    expect(slugify('Weiß & Söhne')).toBe('weiss-und-soehne')
    expect(slugify('Café Größenwahn')).toBe('cafe-groessenwahn')
  })

  it('strips diacritics that have no German expansion', () => {
    expect(slugify('Événements Privé')).toBe('evenements-prive')
    expect(slugify('Niña Bonita')).toBe('nina-bonita')
  })

  it('collapses punctuation and whitespace into single hyphens', () => {
    expect(slugify('  Lisa   Meier – Hochzeiten!!  ')).toBe('lisa-meier-hochzeiten')
    expect(slugify('DJ / Photo-Box GmbH')).toBe('dj-photo-box-gmbh')
  })

  it('never emits a leading or trailing hyphen', () => {
    for (const name of ['-Lisa-', '...Events...', '   &   ', 'A—']) {
      const s = slugify(name)
      expect(s.startsWith('-'), `"${name}" → "${s}"`).toBe(false)
      expect(s.endsWith('-'), `"${name}" → "${s}"`).toBe(false)
    }
  })

  it('returns empty rather than inventing something for an unromanisable name', () => {
    // The contract: the caller must then ask the owner to type one. A slug she
    // cannot read is worse than a slug she has to choose.
    expect(slugify('株式会社')).toBe('')
    expect(slugify('***')).toBe('')
  })

  it('produces something the public route will accept', () => {
    const names = [
      'Lisa Meier Hochzeiten',
      'Blüten & Bänder',
      'Markus Corporate Events GmbH & Co. KG',
      'Jana’s Photo-Box',
    ]
    for (const name of names) {
      const slug = slugify(name)
      expect(checkSlug(slug).ok, `checkSlug rejected "${slug}"`).toBe(true)
      // The two shape checks must agree, or a slug can be reserved at signup and
      // then 404 on the customer-facing route.
      expect(isPlausibleSlug(slug), `isPlausibleSlug rejected "${slug}"`).toBe(true)
    }
  })

  it('truncates a very long name without leaving a trailing hyphen', () => {
    const slug = slugify(`${'Hochzeitsplanung '.repeat(12)}GmbH`)
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH)
    expect(slug.endsWith('-')).toBe(false)
    expect(checkSlug(slug).ok).toBe(true)
  })
})

describe('F0.7 — checkSlug', () => {
  it('rejects the shapes the route cannot serve', () => {
    expect(checkSlug('a').reason).toBe('too_short')
    expect(checkSlug('x'.repeat(64)).reason).toBe('too_long')
    expect(checkSlug('-lisa').reason).toBe('malformed')
    expect(checkSlug('lisa-').reason).toBe('malformed')
    expect(checkSlug('Lisa').reason).toBe('malformed')
    expect(checkSlug('lisa meier').reason).toBe('malformed')
  })

  it('reserves the words that would shadow a route or a system mailbox', () => {
    // `demo` matters today: /a/demo is the fallback tenant, and an agency holding it
    // would take over the demo surface.
    for (const word of ['api', 'admin', 'demo', 'anfragen', 'postmaster', 'datenschutz']) {
      expect(isReservedSlug(word), `"${word}" was not reserved`).toBe(true)
      expect(checkSlug(word).reason).toBe('reserved')
    }
  })

  it('accepts an ordinary agency slug', () => {
    expect(checkSlug('lisa-meier-hochzeiten')).toEqual({ ok: true })
  })
})

describe('F0.7 — suggestSlugs', () => {
  it('offers numbered alternatives in order', () => {
    expect(suggestSlugs('lisa-meier', new Set())).toEqual([
      'lisa-meier-2',
      'lisa-meier-3',
      'lisa-meier-4',
    ])
  })

  it('skips the ones that are also taken', () => {
    const taken = new Set(['lisa-meier-2', 'lisa-meier-3', 'lisa-meier-5'])
    expect(suggestSlugs('lisa-meier', taken)).toEqual([
      'lisa-meier-4',
      'lisa-meier-6',
      'lisa-meier-7',
    ])
  })

  it('is deterministic — the same collision offers the same options twice', () => {
    // A random suffix would change on every page refresh, so the option the owner
    // was about to click disappears when she reloads.
    expect(suggestSlugs('lisa-meier', new Set())).toEqual(suggestSlugs('lisa-meier', new Set()))
  })

  it('keeps suggestions within the length limit and still valid', () => {
    const long = 'a'.repeat(MAX_SLUG_LENGTH)
    for (const s of suggestSlugs(long, new Set())) {
      expect(s.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH)
      expect(checkSlug(s).ok).toBe(true)
    }
  })

  it('always returns something to click — the acceptance criterion', () => {
    // "Handled with a suggestion, not an error page" means the list is never empty
    // for any plausible base, however many neighbours already exist.
    const taken = new Set(Array.from({ length: 40 }, (_, i) => `lisa-meier-${i + 2}`))
    expect(suggestSlugs('lisa-meier', taken).length).toBe(3)
  })
})

describe('F7.1 — alias derivation', () => {
  it('pairs the slug with its inbound address', () => {
    expect(aliasEmailForSlug('lisa-meier', 'in.example.com')).toBe(
      'anfragen-lisa-meier@in.example.com',
    )
  })
})
