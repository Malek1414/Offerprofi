/**
 * Offerprofi's product name and configurable deployment domains, in one place.
 *
 * Open question #1 in CLAUDE.md — the product name — is still unanswered, and it is
 * blocking precisely because it is customer-visible from the first day: it is in the
 * chat URL on an Instagram bio, in the inbound alias printed on a business card, and
 * in the WhatsApp display name that Meta approves and does not like changing.
 *
 * The whole point of this file is that closing that question is an edit to three
 * environment variables and nothing else. Nothing anywhere in the product hardcodes a
 * name — enforced by a test that greps the source (tests/lib/branding.test.ts).
 *
 * The product name is decided. Deployment-specific domains remain configurable;
 * local development gets a URL that actually opens instead of a dead placeholder.
 */

export interface Branding {
  /** The product name, as shown to owners. Never to customers — they see the agency. */
  productName: string
  /** Where the customer-facing chat lives: `{chatDomain}/a/{slug}`. */
  chatDomain: string
  /** The inbound mail domain: `anfragen-{slug}@{inboundDomain}` (F7.1). */
  inboundDomain: string
  /** The outbound sending domain: `{slug}@{sendingDomain}` (F7.6). */
  sendingDomain: string
}

const PLACEHOLDER_HOST = '.invalid'

function defaultChatDomain(): string {
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL
  return vercelHost ? `https://${vercelHost}` : 'http://localhost:3000'
}

export function branding(): Branding {
  return {
    productName: process.env.PRODUCT_NAME ?? 'Offerprofi',
    chatDomain: process.env.CHAT_DOMAIN ?? defaultChatDomain(),
    inboundDomain: process.env.INBOUND_DOMAIN ?? `in.offerprofi${PLACEHOLDER_HOST}`,
    sendingDomain: process.env.SENDING_DOMAIN ?? `mail.offerprofi${PLACEHOLDER_HOST}`,
  }
}

/**
 * Is the product still running on placeholders?
 *
 * Used by the owner-facing surfaces to say so plainly rather than printing
 * `chat.example.invalid/a/lisa-meier` as though it were a working link. A pilot
 * agency seeing a dead URL in her own signup flow would reasonably conclude the
 * product is broken.
 */
export function isPlaceholderBranding(b: Branding = branding()): boolean {
  return b.chatDomain.includes(PLACEHOLDER_HOST) || /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(b.chatDomain)
}
