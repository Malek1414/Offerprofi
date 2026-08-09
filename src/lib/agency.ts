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
import { asAnonymous } from '../db/client'

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

  // `resolve_public_agency` is SECURITY DEFINER and returns a fixed column list, so
  // this path cannot read a column a stranger may not see even if someone later adds
  // one to `agencies`. It runs with no identity — `asAnonymous`, no
  // `app.current_user_id` — which is why a plain select would match nothing.
  const row = await asAnonymous(async (client) => {
    const result = await client.query('select * from public.resolve_public_agency($1)', [slug])
    return result.rows[0] ?? null
  })

  if (!row) return null

  return {
    id: String(row.agency_id),
    slug: String(row.slug),
    name: String(row.name),
    // The greeting says "Lisa" — falling back to the trading name is better than an
    // empty greeting for an agency that has not filled this in.
    ownerName: String(row.owner_display_name ?? row.name),
    brandColor: row.color_primary ? String(row.color_primary) : DEMO_BRAND_COLOR,
    // Logos are object storage (F0.5), which does not exist yet. Null renders the
    // wordmark, which is the same thing an agency that has not uploaded one gets.
    logoUrl: null,
    privacyNoticeUrl: row.privacy_notice_url ? String(row.privacy_notice_url) : '/datenschutz',
    imprintUrl: row.imprint_url ? String(row.imprint_url) : '/impressum',
    slaHours: Number(row.sla_hours),
    defaultLanguage: String(row.locale).toLowerCase().startsWith('en') ? 'en' : 'de',
    defaultFormality: row.default_formality === 'du' ? 'du' : 'sie',
    ...(row.force_formality === 'du' || row.force_formality === 'sie'
      ? { forceFormality: row.force_formality as 'du' | 'sie' }
      : {}),
  }
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
