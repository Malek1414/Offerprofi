/**
 * A3 — the spend meters, as the admission check sees them.
 *
 * The atomicity lives in `take_model_budget_slot` and is tested against a real
 * database by `db/test.sh`. What is under test here is the ordering, which is
 * where the leaks were: charge the attempt meters before anything can reject, and
 * never charge a paid meter for a call that will not happen.
 */

import { describe, expect, it, vi } from 'vitest'

import { admitModelCall, currentWindow, type TakeSlot } from '../../src/agent/budget'

const LIMITS = {
  attemptAgency: 60,
  attemptInquiry: 20,
  attemptPlatform: 2000,
  paidAgency: 40,
  paidInquiry: 12,
  paidPlatform: 1200,
}

/** A take function that admits everything, so a test can name its own refusal. */
function allowing(full: string[] = []): TakeSlot {
  return vi.fn((scope: string) => Promise.resolve(full.includes(scope) ? null : 1))
}

describe('currentWindow', () => {
  it('floors to the hour, so every caller in an hour shares one row', () => {
    const at = new Date('2026-08-11T14:37:52.418Z')
    expect(currentWindow(at).toISOString()).toBe('2026-08-11T14:00:00.000Z')
  })
})

describe('admitModelCall', () => {
  it('admits an ordinary call', async () => {
    const result = await admitModelCall(allowing(), LIMITS, {
      agencyId: 'a1',
      inquiryId: 'i1',
      now: new Date(),
    })
    expect(result.admitted).toBe(true)
  })

  it('charges the attempt meters before any meter can reject', async () => {
    // The expensive ordering bug. Reading and parsing untrusted documents costs
    // real work even when the call is refused for free afterwards, so an attempt
    // that trips a later meter must still have paid for the attempt. Charging
    // after a rejection leaves cheap rejections free to loop forever.
    const take = allowing(['paid:agency'])
    const result = await admitModelCall(take, LIMITS, {
      agencyId: 'a1',
      inquiryId: 'i1',
      now: new Date(),
    })

    expect(result.admitted).toBe(false)
    const charged = (take as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    expect(charged.slice(0, 3)).toEqual(['attempt:platform', 'attempt:agency', 'attempt:inquiry'])
  })

  it('never charges a paid meter once one of them has refused', async () => {
    const take = allowing(['paid:platform'])
    await admitModelCall(take, LIMITS, { agencyId: 'a1', inquiryId: 'i1', now: new Date() })

    const charged = (take as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    // Platform is charged first and refuses, so neither narrower paid meter is
    // touched: a caller must not spend agency capacity on a call that cannot run.
    expect(charged).not.toContain('paid:agency')
    expect(charged).not.toContain('paid:inquiry')
  })

  it('reports which meter refused, for the log and for nothing else', async () => {
    const result = await admitModelCall(allowing(['attempt:inquiry']), LIMITS, {
      agencyId: 'a1',
      inquiryId: 'i1',
      now: new Date(),
    })
    expect(result).toEqual({ admitted: false, scope: 'attempt:inquiry' })
  })

  it('meters the platform even with no inquiry, which is the demo tenant', async () => {
    const take = allowing()
    const result = await admitModelCall(take, LIMITS, {
      agencyId: 'a1',
      inquiryId: null,
      now: new Date(),
    })

    expect(result.admitted).toBe(true)
    const charged = (take as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    // No inquiry, so no per-inquiry meter — but the platform meter is the one that
    // stops a runaway loop, and it must not be skippable by omitting an id.
    expect(charged).toContain('attempt:platform')
    expect(charged).toContain('paid:platform')
    expect(charged).not.toContain('attempt:inquiry')
  })
})
