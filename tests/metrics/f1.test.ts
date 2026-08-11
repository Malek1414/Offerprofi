/**
 * The "% smarter" measurement (C5).
 *
 * The handoff's instruction is "build it, but honestly, because a judge will take
 * apart anything else", and it names the property that makes it credible: **the
 * number can go down**. That is the first test here, and it is the one that would
 * catch this being quietly turned back into a counter of scraped pages.
 *
 * The rest guard the ways a metric gets flattering without anyone deciding to
 * cheat: an exam that changed between runs, a set too small to mean anything, and
 * an averaging choice that hides the hard cases.
 */

import { describe, expect, it } from 'vitest'

import {
  MIN_PUBLISHABLE_EXAMPLES,
  fingerprint,
  publishable,
  scoreOne,
  scoreSet,
  type ExtractedField,
  type GoldenExample,
  type MetricRun,
} from '../../src/metrics/f1'

const field = (itemKey: string, name: string, value: string): ExtractedField => ({
  itemKey,
  field: name,
  value,
})

const example = (id: string, expected: ExtractedField[]): GoldenExample => ({
  id,
  stratum: 'catering',
  sourceKind: 'web_page',
  expected,
})

const run = (over: Partial<MetricRun> = {}): MetricRun => ({
  score: { precision: 0.9, recall: 0.9, f1: 0.9, truePositives: 9, falsePositives: 1, falseNegatives: 1 },
  exampleCount: MIN_PUBLISHABLE_EXAMPLES,
  setFingerprint: 'abc123',
  confirmedCandidates: 100,
  measuredAt: '2026-08-11T00:00:00Z',
  ...over,
})

describe('the number can go down', () => {
  it('reports a negative delta when extraction got worse', () => {
    // The property the whole design turns on. If this ever cannot be expressed,
    // the metric has become theatre.
    const before = run({ score: { ...run().score, f1: 0.88 } })
    const after = run({ score: { ...run().score, f1: 0.71 } })

    const verdict = publishable(after, before)

    expect(verdict.publish).toBe(true)
    expect(verdict.publish && verdict.delta).toBeLessThan(0)
  })

  it('scores a regression lower than the run before it', () => {
    const golden = [example('a', [field('menu', 'price', '18,50'), field('menu', 'unit', 'person')])]

    const good = scoreSet(golden, () => [
      field('menu', 'price', '18,50'),
      field('menu', 'unit', 'person'),
    ])
    // Extraction regresses: it now reads the price as a whole number of cents.
    const bad = scoreSet(golden, () => [
      field('menu', 'price', '1850'),
      field('menu', 'unit', 'person'),
    ])

    expect(bad.f1).toBeLessThan(good.f1)
  })
})

describe('scoring', () => {
  it('counts a missed field as a miss and an invented one as a false positive', () => {
    const score = scoreOne(
      [field('a', 'price', '10'), field('a', 'unit', 'person')],
      [field('a', 'price', '10'), field('a', 'name', 'erfunden')],
    )

    expect(score.truePositives).toBe(1)
    expect(score.falsePositives).toBe(1)
    expect(score.falseNegatives).toBe(1)
    expect(score.f1).toBeCloseTo(0.5)
  })

  it('treats an empty page read as empty as correct, not as zero', () => {
    // A third of any real crawl is pages with no services on them. Scoring the
    // one honest answer as 0 would punish exactly the behaviour we want.
    expect(scoreOne([], []).f1).toBe(1)
  })

  it('does not normalise a decimal comma away', () => {
    // Reading "18,50" as 1850 is precisely the mistake this metric exists to
    // catch, so the comparison must not be generous about it.
    const score = scoreOne([field('a', 'price', '18,50')], [field('a', 'price', '18.50')])
    expect(score.truePositives).toBe(0)
  })

  it('ignores case and surrounding whitespace, which no reading would differ on', () => {
    const score = scoreOne([field('a', 'name', 'Buffet')], [field('a', 'name', '  buffet ')])
    expect(score.truePositives).toBe(1)
  })

  it('micro-averages, so a thin page cannot outvote a dense one', () => {
    const golden = [
      // One easy field, extracted perfectly.
      example('thin', [field('a', 'name', 'Kaffee')]),
      // Ten fields, all missed.
      example('dense', Array.from({ length: 10 }, (_, n) => field('b', `f${n}`, String(n)))),
    ]

    const score = scoreSet(golden, (candidate) =>
      candidate.id === 'thin' ? [field('a', 'name', 'Kaffee')] : [],
    )

    // Macro-averaging would report (1.0 + 0.0) / 2 = 0.5 and make failing ten
    // fields look like a passing grade. Micro sees 1 of 11.
    expect(score.f1).toBeLessThan(0.25)
  })
})

describe('the frozen set', () => {
  it('fingerprints the same set identically regardless of order', () => {
    const a = [example('1', [field('x', 'p', '1')]), example('2', [field('y', 'p', '2')])]
    const b = [example('2', [field('y', 'p', '2')]), example('1', [field('x', 'p', '1')])]

    expect(fingerprint(a)).toBe(fingerprint(b))
  })

  it('changes when an example is added', () => {
    const before = [example('1', [field('x', 'p', '1')])]
    const after = [...before, example('2', [field('y', 'p', '2')])]

    // Without this, "extraction improved" and "we deleted the hard examples" look
    // identical from outside.
    expect(fingerprint(after)).not.toBe(fingerprint(before))
  })

  it('changes when an example is quietly edited', () => {
    const before = [example('1', [field('x', 'p', '18,50')])]
    const after = [example('1', [field('x', 'p', '18')])]

    expect(fingerprint(after)).not.toBe(fingerprint(before))
  })
})

describe('publishing', () => {
  it('refuses to publish a number derived from too few examples', () => {
    const verdict = publishable(run({ exampleCount: 11 }), null)

    expect(verdict.publish).toBe(false)
    expect(verdict.publish === false && verdict.reason).toBe('set_too_small')
  })

  it('refuses to compare across a set that changed underneath the runs', () => {
    const before = run({ setFingerprint: 'old' })
    const after = run({ setFingerprint: 'new' })

    const verdict = publishable(after, before)

    expect(verdict.publish).toBe(false)
    expect(verdict.publish === false && verdict.reason).toBe('set_changed')
  })

  it('publishes a first run with no delta rather than inventing one', () => {
    const verdict = publishable(run(), null)

    expect(verdict.publish).toBe(true)
    expect(verdict.publish && verdict.delta).toBeNull()
  })
})
