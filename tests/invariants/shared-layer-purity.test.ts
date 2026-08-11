/**
 * SHARED LAYER — no price, no brand, no person. Ever.
 *
 * The product learns across tenants from the owner's verdict on what we read off
 * a source (EXECUTION_HANDOFF §4). "We read `<h3>` as the item name and the owner
 * renamed it" is knowledge about German catering documents and belongs to nobody.
 * "18,50 €" belongs to one caterer and stays inside their RLS boundary (D31).
 *
 * The whole cross-tenant layer is only defensible while that line holds. Break
 * it and this is no longer a pattern store — it is one caterer's price list
 * being read by their competitor, which is a data-protection incident and the
 * end of the feature, not a bug to fix in the next sprint.
 *
 * Checked three ways, because each catches a different mistake:
 *   1. the closed vocabulary — catches free text being admitted at all
 *   2. the locator scan — catches a value smuggled through the one free field
 *   3. the write path — catches a gate that exists but is not actually in front
 *      of the network call
 *
 * The blind spots are asserted too. A gate whose limits are only in a comment is
 * a gate whose limits are discovered in production.
 */

import { describe, expect, it } from 'vitest'

import {
  KNOWN_BLIND_SPOTS,
  checkObservationPurity,
  explainViolations,
  looksLikeQuantity,
} from '../../src/shared-layer/purity'
import { ROLE_VOCABULARY, parseObservation } from '../../src/shared-layer/observation'
import { recordObservation } from '../../src/shared-layer/cognee'

/** A verdict an owner might really have given, with nothing of theirs in it. */
const observation = (overrides: Record<string, unknown> = {}) => ({
  source_kind: 'html_page',
  locator: 'section.menu h3 > span',
  read_as: 'item_name',
  corrected_to: 'category_name',
  confidence_before: 0.82,
  language: 'de',
  ...overrides,
})

const refusalFor = (candidate: unknown): string => {
  const verdict = checkObservationPurity(candidate)
  return verdict.pure ? '' : explainViolations(verdict.violations)
}

describe('shared layer — nothing tenant-owned may be written', () => {
  it('admits the observations it exists to collect', () => {
    // Without this the whole file could pass by refusing everything, which is a
    // gate nobody would keep for a week.
    const legitimate = [
      'section.menu h3 > span',
      'ul.speisekarte li.gericht',
      'page[2] table[1] col[3]',
      'sheet[1] col[B] row[12]',
      'div[data-role=menu] h2',
      'article.preisliste dd',
    ]

    for (const locator of legitimate) {
      const verdict = checkObservationPurity(observation({ locator }))
      expect(
        verdict.pure,
        `refused a legitimate reading pattern "${locator}": ${refusalFor(observation({ locator }))}. ` +
          'Over-refusal costs the training signal the shared layer exists to collect.',
      ).toBe(true)
    }
  })

  it('refuses a price in every format a German catering page uses', () => {
    const prices = [
      'td:contains("18,50 €")',
      'td.betrag-18.50',
      'span.preis-eur-1850',
      'p:contains(achtzehn Euro)',
      'div.ab-18-50-euro',
      '.menu-item-1850',
      'span[data-preis=1850]',
      'td.chf-24-90',
    ]

    for (const locator of prices) {
      const verdict = checkObservationPurity(observation({ locator }))
      expect(
        verdict.pure,
        `admitted "${locator}" — a price entered the cross-tenant layer. ` +
          'D31: the shared layer records that a position holds a price, never the price.',
      ).toBe(false)
    }
  })

  it('refuses a price written the English way too', () => {
    for (const locator of ['td.usd-18-50', 'span:contains("$18.50")', 'p.eighteen-dollars', 'td.gbp-12-00']) {
      expect(
        checkObservationPurity(observation({ locator })).pure,
        `admitted "${locator}" — the rule is about money, not about the language it is written in`,
      ).toBe(false)
    }
  })

  it('refuses a brand', () => {
    const brands = [
      'https://mueller-catering.de/speisekarte',
      'www.mueller-catering.de',
      'mueller-catering.de',
      '.mueller-catering-gmbh h3',
      'div.gbr-menu',
      'section.alte-muehle-ltd',
    ]

    for (const locator of brands) {
      expect(
        checkObservationPurity(observation({ locator })).pure,
        `admitted "${locator}" — a brand identifies the tenant it came from, ` +
          'and a cross-tenant store that identifies its sources is not cross-tenant',
      ).toBe(false)
    }
  })

  it('refuses a person', () => {
    const people = [
      'div:contains("Lisa Meier")',
      'a[href=mailto:lisa]',
      'span.kontakt lisa@meier-catering.de',
      'p:contains(+49 170 1234567)',
      'div:contains(Frau Meier)',
      'section:contains(Dr. Weber)',
      'span:contains(Inhaberin Jana)',
    ]

    for (const locator of people) {
      expect(
        checkObservationPurity(observation({ locator })).pure,
        `admitted "${locator}" — invariant 2 keeps people out of anything that is not their own tenant`,
      ).toBe(false)
    }
  })

  it('will not let free text into read_as or corrected_to at all', () => {
    // The closed vocabulary is the primary defence: these fields cannot carry a
    // price because they cannot carry a string that is not a role.
    const attacks = ['18,50 €', 'achtzehn Euro', 'Müller GmbH', 'Lisa Meier', 'price_per_person ']

    for (const attack of attacks) {
      for (const field of ['read_as', 'corrected_to'] as const) {
        const verdict = checkObservationPurity(observation({ [field]: attack }))
        expect(
          verdict.pure,
          `admitted ${field}="${attack}". These fields are an enum, and an enum that ` +
            'accepts one unlisted string is a free-text field with a misleading type.',
        ).toBe(false)
        expect(explainViolations(verdict.pure ? [] : verdict.violations)).toContain(
          'closed role vocabulary',
        )
      }
    }
  })

  it('carries no digit in the role vocabulary itself', () => {
    for (const role of ROLE_VOCABULARY) {
      expect(/\d/.test(role), `role "${role}" contains a digit — a role names a kind, not an amount`).toBe(
        false,
      )
      expect(looksLikeQuantity(role), `role "${role}" reads as a quantity`).toBe(false)
    }
  })

  it('refuses any field the schema does not define, rather than stripping it', () => {
    // The realistic leak is not a price in `locator`. It is a well-meaning caller
    // attaching `source_text` or `tenant_id` "for debugging" and the object being
    // forwarded whole.
    for (const extra of ['tenant_id', 'agency_id', 'source_text', 'raw_html', 'customer_email']) {
      const verdict = parseObservation(observation({ [extra]: 'anything' }))
      expect(
        verdict.ok,
        `accepted an observation carrying "${extra}" — the shared-layer schema is exhaustive on purpose`,
      ).toBe(false)
    }
  })

  it('refuses before the network call, not after it', async () => {
    // A gate that runs after the request has left is not a gate. This is the
    // assertion that the ordering inside recordObservation is the enforcement.
    let calls = 0
    const spyFetch = (async () => {
      calls += 1
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    const outcome = await recordObservation(observation({ locator: 'td:contains("18,50 €")' }), {
      fetch: spyFetch,
      env: { COGNEE_URL: 'https://sidecar.test' },
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? '' : outcome.failure).toBe('impure')
    expect(calls, 'an impure observation reached the wire — refusal must precede transmission').toBe(0)
  })

  it('puts nothing on the wire but the six schema fields', async () => {
    let body = ''
    const captureFetch = (async (_url: string, init?: RequestInit) => {
      body = String(init?.body ?? '')
      return new Response(JSON.stringify({}), { status: 200 })
    }) as unknown as typeof fetch

    const outcome = await recordObservation(observation(), {
      fetch: captureFetch,
      env: { COGNEE_URL: 'https://sidecar.test' },
    })

    expect(outcome.ok, outcome.ok ? '' : outcome.detail).toBe(true)

    const sent = JSON.parse(body) as { dataset: string; observation: Record<string, unknown> }
    expect(Object.keys(sent).sort()).toEqual(['dataset', 'observation'])
    expect(Object.keys(sent.observation).sort()).toEqual([
      'confidence_before',
      'corrected_to',
      'language',
      'locator',
      'read_as',
      'source_kind',
    ])

    for (const marker of ['tenant', 'agency', 'user_id', '@', 'GmbH', '€']) {
      expect(body, `the write payload carried "${marker}"`).not.toContain(marker)
    }
  })

  it('states what it cannot catch, so the limit is a fact rather than a hope', () => {
    expect(KNOWN_BLIND_SPOTS.length).toBeGreaterThan(0)

    // Each of these really does get through the scan. They are safe today only
    // because the field that could carry them is enum-constrained. If a future
    // change opens a free-text field in this layer, these become live holes and
    // this test is where that is written down.
    const undetected = [
      'div.achtzehnfuenfzig',
      'section.zum-goldenen-hirschen',
      'div.mueller-menu',
    ]

    for (const locator of undetected) {
      expect(
        checkObservationPurity(observation({ locator })).pure,
        `"${locator}" is now detected — good. Remove it from KNOWN_BLIND_SPOTS ` +
          'so the documented limits stay true.',
      ).toBe(true)
    }
  })
})
