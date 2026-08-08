/**
 * Slug → agency resolution (F1.4).
 *
 * Acceptance: "Tampering with a client-supplied tenant id is impossible because
 * none is accepted."
 *
 * The whole tenancy story on the public surface rests on this file. `/a/{slug}` is
 * unauthenticated and reachable by anyone with the link, so the only trustworthy
 * tenant identifier is the one *we* look up from the path. No request body, header,
 * query parameter or cookie is ever consulted for an agency id — and because the
 * adapter contract (see channels/registry.ts) takes `agencyId` from its context
 * rather than its payload, there is nowhere downstream for a client-supplied one to
 * enter either.
 */

import { DEMO_AGENCY, DEMO_BRAND_COLOR, hasDatabase } from './demo'

export interface PublicAgency {
  id: string
  slug: string
  name: string
  ownerName: string
  brandColor: string
  logoUrl: string | null
  privacyNoticeUrl: string
  imprintUrl: string
  /** The SLA the agency advertises in its acknowledgement. */
  slaHours: number
  /** Agency voice defaults; the customer's own language still wins (F1.15). */
  defaultLanguage: 'de' | 'en'
  defaultFormality: 'du' | 'sie'
  forceFormality?: 'du' | 'sie'
}

const DEMO_SLUG = 'demo'

/**
 * Resolve a public slug.
 *
 * Returns null for anything unknown, and the caller renders a neutral not-found.
 * It must not distinguish "no such agency" from "agency is suspended": a public
 * endpoint that tells strangers which tenants exist is an enumeration oracle, and
 * the slug is guessable by design (it goes in an Instagram bio).
 */
export async function resolveAgencyBySlug(slug: string): Promise<PublicAgency | null> {
  if (!isPlausibleSlug(slug)) return null

  if (!hasDatabase()) {
    // Demo tenant, so the surface can be walked through before Postgres exists.
    // With a database configured this branch is dead.
    if (slug !== DEMO_SLUG) return null
    return {
      id: 'demo',
      slug: DEMO_SLUG,
      name: DEMO_AGENCY.name,
      ownerName: DEMO_AGENCY.ownerName,
      brandColor: DEMO_BRAND_COLOR,
      logoUrl: DEMO_AGENCY.logoUrl,
      privacyNoticeUrl: '/datenschutz',
      imprintUrl: '/impressum',
      slaHours: 24,
      defaultLanguage: 'de',
      defaultFormality: 'sie',
    }
  }

  // TODO(Phase 1, database): select from agency_slugs join agencies join
  // brand_profiles, filtered to active tenants, via `asAnonymous` — this runs
  // before anyone has authenticated, so it must read only columns a stranger may
  // see. Not implemented until Postgres is provisioned — see docs/BUILD_STATUS.md.
  return null
}

/**
 * Cheap shape check before any lookup.
 *
 * Not a security control on its own — the query is parameterised regardless — but
 * it keeps obviously junk paths from reaching the database at all, which matters on
 * an endpoint anyone can hammer.
 */
export function isPlausibleSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)
}
