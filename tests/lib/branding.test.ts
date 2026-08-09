/**
 * The product name is not hardcoded anywhere (CLAUDE.md open question #1).
 *
 * This is the test `src/lib/branding.ts` promises. Open question #1 is blocking
 * precisely because the name is customer-visible from day one — the chat URL in an
 * Instagram bio, the alias on a business card, the Meta-approved WhatsApp display
 * name. The cost of closing it must stay "set three environment variables", and it
 * only stays that if nothing quietly writes a name into a component while waiting.
 *
 * The test reads the source rather than the behaviour, because the failure it guards
 * against is a literal string in a file, which no runtime assertion can see.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { branding, isPlaceholderBranding } from '../../src/lib/branding'

const SRC = join(import.meta.dirname, '..', '..', 'src')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (/\.(ts|tsx|css)$/.test(entry)) out.push(path)
  }
  return out
}

/**
 * The names that have been floated for this product (CLAUDE.md, working title).
 * If one of them is chosen, this list is what has to be revisited — deliberately,
 * with the environment variable set, rather than by a literal appearing in a
 * component.
 */
const CANDIDATE_NAMES = ['OfferPing', 'EventSnap', 'AngebotBot']

describe('open question #1 — the product name is still a placeholder', () => {
  it('appears in no source file', () => {
    const offenders: string[] = []

    for (const file of sourceFiles(SRC)) {
      const contents = readFileSync(file, 'utf8')
      for (const name of CANDIDATE_NAMES) {
        // The branding module names them in a comment explaining the rule, and this
        // test names them too. Everywhere else is a leak.
        if (contents.includes(name) && !file.endsWith('branding.ts')) {
          offenders.push(`${file.replace(SRC, 'src')} contains "${name}"`)
        }
      }
    }

    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('resolves every customer-visible domain from configuration', () => {
    const b = branding()
    expect(b.productName).toBeTruthy()
    for (const host of [b.chatDomain, b.inboundDomain, b.sendingDomain]) {
      expect(host).toBeTruthy()
      expect(host).not.toContain(' ')
    }
  })

  it('knows it is running on placeholders, so a surface can say so', () => {
    // A pilot agency shown `chat.example.invalid/a/lisa-meier` as though it were a
    // working link would reasonably conclude the product is broken.
    expect(isPlaceholderBranding(branding())).toBe(true)

    expect(
      isPlaceholderBranding({
        productName: 'Chosen',
        chatDomain: 'chat.chosen.de',
        inboundDomain: 'in.chosen.de',
        sendingDomain: 'mail.chosen.de',
      }),
    ).toBe(false)
  })

  it('uses a domain that provably cannot resolve until it is set', () => {
    // `.invalid` is reserved by RFC 2606. A plausible-looking default would survive
    // into production unnoticed; this one cannot.
    expect(branding().chatDomain).toMatch(/\.invalid$/)
  })
})
