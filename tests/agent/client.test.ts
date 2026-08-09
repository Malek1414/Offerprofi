import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { callModel, failureFromStatus, resetClient } from '../../src/agent/client'
import { contentRef, failureRef } from '../../src/agent/runs'

describe('failureFromStatus', () => {
  it('separates a busy minute from a broken integration', () => {
    // These land in the same place for the customer — a human takes over — but
    // they mean completely different things to us, and collapsing them is how a
    // rate limit gets investigated as an outage for a week.
    expect(failureFromStatus(429, 'RateLimitError')).toBe('rate_limited')
    expect(failureFromStatus(529, 'InternalServerError')).toBe('overloaded')
    expect(failureFromStatus(503, 'InternalServerError')).toBe('overloaded')
    expect(failureFromStatus(500, 'InternalServerError')).toBe('transport')
  })

  it('reads a 401 as our configuration problem, not a customer problem', () => {
    expect(failureFromStatus(401, 'AuthenticationError')).toBe('not_configured')
    expect(failureFromStatus(403, 'PermissionDeniedError')).toBe('not_configured')
  })

  it('recognises a timeout by name, since there is no status on one', () => {
    expect(failureFromStatus(undefined, 'APIConnectionTimeoutError')).toBe('timeout')
    expect(failureFromStatus(undefined, 'AbortError')).toBe('timeout')
  })

  it('falls back to transport when there is nothing to go on', () => {
    expect(failureFromStatus(undefined, 'TypeError')).toBe('transport')
  })

  it('reports a malformed request as ours to fix', () => {
    expect(failureFromStatus(400, 'BadRequestError')).toBe('invalid_request')
    expect(failureFromStatus(404, 'NotFoundError')).toBe('invalid_request')
  })
})

describe('callModel', () => {
  const key = process.env.ANTHROPIC_API_KEY

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY
    resetClient()
  })

  afterEach(() => {
    if (key === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = key
    resetClient()
  })

  const request = {
    purpose: 'extraction' as const,
    agencyId: '11111111-1111-1111-1111-111111111111',
    role: 'Du bist die Assistenz einer Eventagentur.',
    instruction: 'Extrahiere die Eckdaten der Anfrage.',
    documents: [
      { id: 'msg_1', source: 'customer_message' as const, text: 'Hochzeit im Juni, 80 Gäste' },
    ],
  }

  it('returns a failure instead of throwing when there is no API key', async () => {
    // Invariant 1 at the transport layer. A missing key is our fault and it must
    // reach the customer as a human taking over, never as an error page and never
    // as a rejection of her inquiry.
    const outcome = await callModel(request)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.failure).toBe('not_configured')
    expect(outcome.escalate).toBe(true)
  })

  it('refuses a model that has no zero-retention path (D17)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-not-a-real-key'
    resetClient()
    const outcome = await callModel({
      ...request,
      // Typed as ModelId elsewhere; the cast is the point of the test — the check
      // has to hold against a value that got past the type system.
      model: 'claude-fable-5' as never,
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.failure).toBe('not_configured')
    expect(outcome.detail).toContain('D17')
  })

  it('never produces an outcome that a customer could read as a refusal', async () => {
    const outcome = await callModel(request)
    if (outcome.ok) return
    // There is no failure kind meaning "decline this customer", and every one of
    // them carries escalate. If a kind is ever added that does not, this fails.
    expect(outcome.escalate).toBe(true)
    expect(outcome.failure).not.toMatch(/declin|reject|refus.*customer/i)
  })
})

describe('what agent_runs stores', () => {
  it('hashes content rather than copying it', () => {
    const ref = contentRef('Hochzeit im Juni, 80 Gäste, Budget 12.000 €')
    expect(ref).toMatch(/^sha256:[0-9a-f]{32}$/)
    expect(ref).not.toContain('Hochzeit')
  })

  it('is stable, so the same prompt is recognisably the same run', () => {
    expect(contentRef('same text')).toBe(contentRef('same text'))
    expect(contentRef('same text')).not.toBe(contentRef('other text'))
  })

  it('marks a call that produced nothing, rather than leaving the column empty', () => {
    // A timeout still burned input tokens. A blank output_ref would make that row
    // look like missing data instead of a real, paid-for failure.
    expect(failureRef('timeout')).toBe('failure:timeout')
  })
})
