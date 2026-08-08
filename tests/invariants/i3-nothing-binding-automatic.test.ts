/**
 * INVARIANT 3 — nothing binding is produced automatically.
 *
 * Every quote is freibleibend. No contract, right or obligation arises from anything
 * the agent does. The customer's legal position after an automated quote is identical
 * to before it. The only act with legal effect is the owner's confirmation.
 *
 * Prevents: a tenant setting that removes the clause "to look more confident".
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { LEGAL_TEXT_VERSION, quoteLegalBlock, syntheticContentMarking } from '../../src/domain/legal'

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../../src/${p}`, import.meta.url)), 'utf8')

const params = (language: 'de' | 'en') => ({
  agencyName: 'Lisa Meier Hochzeiten',
  validUntil: '2027-01-31',
  language,
})

describe('I3 — nothing binding is produced automatically', () => {
  it('states the quote is freibleibend, in German', () => {
    const block = quoteLegalBlock(params('de'), 'Lisa')
    expect(block.nonBinding).toContain('freibleibend')
    expect(block.nonBinding).toContain('unverbindlich')
    // The contract-formation trigger must be named explicitly.
    expect(block.nonBinding).toContain('ausdrücklicher Bestätigung')
    expect(block.nonBinding).toContain('31.01.2027')
  })

  it('states the quote is non-binding, in English', () => {
    const block = quoteLegalBlock(params('en'), 'Lisa')
    expect(block.nonBinding).toContain('non-binding')
    expect(block.nonBinding).toContain('express confirmation')
  })

  it('frames acceptance as an invitation to contract, not acceptance of an offer', () => {
    for (const lang of ['de', 'en'] as const) {
      const block = quoteLegalBlock(params(lang), 'Lisa')
      // The sub-line is what stops the click being acceptance under §145 BGB.
      expect(block.acceptSubline.length).toBeGreaterThan(20)
      expect(block.acceptLabel).toBeTruthy()
    }
    expect(quoteLegalBlock(params('de'), 'Lisa').acceptLabel).toBe('Angebot annehmen')
  })

  it('exposes no switch that disables the legal block', () => {
    const source = read('domain/legal.ts')
    for (const flag of [
      'disableLegal', 'hideLegal', 'skipDisclaimer', 'omitNonBinding',
      'showLegal', 'includeLegal', 'legalEnabled',
    ]) {
      expect(source, `"${flag}" would let a tenant remove the clause`).not.toContain(flag)
    }
    // The block is built unconditionally: no branch may return a partial object.
    const fnStart = source.indexOf('export function quoteLegalBlock')
    const body = source.slice(fnStart)
    expect(body).not.toMatch(/if\s*\([^)]*\)\s*return\s*(?:null|undefined|\{\s*\})/)
  })

  it('returns both paragraphs together so a renderer cannot print only one', () => {
    const block = quoteLegalBlock(params('de'), 'Lisa')
    expect(block.nonBinding).toBeTruthy()
    expect(block.aiDisclosure).toBeTruthy()
    expect(block.version).toBe(LEGAL_TEXT_VERSION)
  })

  it('marks the document as AI-generated and human-review-required', () => {
    const marking = syntheticContentMarking('2026-08-08T10:00:00Z')
    expect(marking['ai-generated']).toBe(true)
    expect(marking['human-review-required']).toBe(true)
  })
})
