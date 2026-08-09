/**
 * The product name is decided once and still resolved through the branding boundary.
 *
 * This is the test `src/lib/branding.ts` promises. Open question #1 is blocking
 * precisely because the name is customer-visible from day one — the chat URL in an
 * Instagram bio, the alias on a business card, the Meta-approved WhatsApp display
 * name. The cost of closing it must stay "set three environment variables", and it
 * only stays that if nothing quietly writes a name into a component while waiting.
 *
 * The test reads the source rather than the behaviour, because the failure it guards
 * against is a literal string bypassing that boundary, which no runtime assertion can see.
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

describe('Offerprofi branding', () => {
  it('keeps the chosen product name behind the branding module', () => {
    const offenders: string[] = []

    for (const file of sourceFiles(SRC)) {
      const contents = readFileSync(file, 'utf8')
      if (contents.includes('Offerprofi') && !file.endsWith('branding.ts')) {
        offenders.push(`${file.replace(SRC, 'src')} bypasses branding()`)
      }
    }

    expect(offenders, offenders.join('\n')).toEqual([])
    expect(branding().productName).toBe('Offerprofi')
  })

  it('resolves every customer-visible domain from configuration', () => {
    const b = branding()
    expect(b.productName).toBeTruthy()
    for (const host of [b.chatDomain, b.inboundDomain, b.sendingDomain]) {
      expect(host).toBeTruthy()
      expect(host).not.toContain(' ')
    }
  })

  it('knows local development is not a public deployment', () => {
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

  it('uses a working local chat URL until a deployment domain is set', () => {
    expect(branding().chatDomain).toBe('http://localhost:3000')
  })
})
