/**
 * The `{BRAND}` and `{DOMAIN}` placeholders, in one place.
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
 * The defaults below are obviously placeholders on purpose. A plausible-looking
 * default would survive into production unnoticed; `example.invalid` cannot, because
 * `.invalid` is reserved by RFC 2606 and never resolves.
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

const PLACEHOLDER_HOST = 'example.invalid'

export function branding(): Branding {
  return {
    productName: process.env.PRODUCT_NAME ?? '{BRAND}',
    chatDomain: process.env.CHAT_DOMAIN ?? `chat.${PLACEHOLDER_HOST}`,
    inboundDomain: process.env.INBOUND_DOMAIN ?? `in.${PLACEHOLDER_HOST}`,
    sendingDomain: process.env.SENDING_DOMAIN ?? `mail.${PLACEHOLDER_HOST}`,
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
  return b.chatDomain.includes(PLACEHOLDER_HOST) || b.productName === '{BRAND}'
}
