/**
 * The qualifying turn, as the customer experiences it.
 *
 * The two model calls are mocked — they have their own tests. What is under test
 * here is the wiring between them, which is where the rules live: what happens when
 * one of them fails, what the customer is told when it does, and whether anything
 * in the sequence can end with her being turned away.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CateringRequest } from '../../src/domain/catering-request'
import type { ContactPartition } from '../../src/domain/extracted'

const extractRequest = vi.fn()
const qualify = vi.fn()
const storeCateringRequest = vi.fn()
const loadConversationContext = vi.fn()
const recordAgentProgress = vi.fn()

vi.mock('../../src/agent/extraction', () => ({
  extractRequest: (...args: unknown[]) => extractRequest(...args),
}))
vi.mock('../../src/agent/qualify', async () => ({
  qualify: (...args: unknown[]) => qualify(...args),
  // The store imports this constant for its message limit.
  TRANSCRIPT_WINDOW: 10,
  // Real, not stubbed: it is a pure function over the request, and whether the
  // affirmative branch fires at all depends on it agreeing with the production one.
  missingRequired: (await vi.importActual<typeof import('../../src/agent/qualify')>(
    '../../src/agent/qualify',
  )).missingRequired,
}))
vi.mock('../../src/agent/facts', () => ({
  loadAgencyFacts: () => Promise.resolve(['Mindestbestellung ab 20 Personen.']),
}))
vi.mock('../../src/knowledge/repository', () => ({
  searchKnowledge: () => Promise.resolve([]),
  asSnippets: () => [],
}))
vi.mock('../../src/agent/brief-store', () => ({
  storeCateringRequest: (...args: unknown[]) => storeCateringRequest(...args),
}))
vi.mock('../../src/agent/conversation-store', () => ({
  loadConversationContext: (...args: unknown[]) => loadConversationContext(...args),
  recordAgentProgress: (...args: unknown[]) => recordAgentProgress(...args),
}))

const { runQualifyingTurn } = await import('../../src/chat/qualifying-turn')

function request(overrides: Partial<CateringRequest> = {}): CateringRequest {
  return {
    eventDate: { value: '2027-06-12', confidence: 0.9, source: 'm1', sourceKind: 'ai' },
    headcount: { value: 80, confidence: 0.9, source: 'm1', sourceKind: 'ai' },
    venue: { value: 'Schloss Bensberg', confidence: 0.9, source: 'm1', sourceKind: 'ai' },
    serviceStyle: { value: 'buffet', confidence: 0.9, source: 'm1', sourceKind: 'ai' },
    mealType: { value: 'dinner', confidence: 0.9, source: 'm1', sourceKind: 'ai' },
    language: 'de',
    formality: 'sie',
    meta: { extractionVersion: 't', model: 't', completeness: 1, overallConfidence: 0.9 },
    ...overrides,
  }
}

const contact: ContactPartition = { name: 'Sarah Müller' }

function input(overrides: Record<string, unknown> = {}) {
  return {
    agencyId: 'agency-1',
    agencyName: 'Kraut & Rüben Catering',
    ownerName: 'Johannes',
    inquiryId: 'inquiry-1',
    message: { id: 'm2', text: 'Wir feiern im Juni, ungefähr 80 Gäste.' },
    language: 'de' as const,
    formality: 'sie' as const,
    ...overrides,
  }
}

function extracted(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    request: request(),
    contact,
    extractions: [{ fieldPath: 'headcount', value: 80, confidence: 0.9, sourceRef: 'm1' }],
    injectionSuspected: false,
    injectionNote: null,
    runId: 'run-1',
    costMicroCents: 400,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  loadConversationContext.mockResolvedValue({
    request: null,
    contact: null,
    messages: [{ id: 'm1', text: 'Hallo!' }, { id: 'm2', text: 'Wir feiern im Juni.' }],
    state: 'new',
    automationPaused: false,
  })
  storeCateringRequest.mockResolvedValue(true)
  recordAgentProgress.mockResolvedValue('qualifying')
  extractRequest.mockResolvedValue(extracted())
  qualify.mockResolvedValue({
    ok: true,
    readyToSend: false,
    questions: [{ field: 'venue', text: 'Wo soll gefeiert werden?' }],
    summary: 'Juni, 80 Gäste.',
    missingRequired: ['venue'],
    runId: 'run-2',
    costMicroCents: 300,
  })
})

describe('the ordinary turn', () => {
  it('asks the question the model wrote', async () => {
    const turns = await runQualifyingTurn(input())
    expect(turns).toEqual([{ kind: 'question', text: 'Wo soll gefeiert werden?' }])
  })

  it('sends the stored transcript, not only the message in hand', async () => {
    // The context is what makes the loop bounded: state plus a tail, never the log.
    await runQualifyingTurn(input())
    expect(extractRequest.mock.calls[0]?.[0].messages).toEqual([
      { id: 'm1', text: 'Hallo!' },
      { id: 'm2', text: 'Wir feiern im Juni.' },
    ])
  })

  it('carries an earlier turn’s request forward instead of starting over', async () => {
    const earlier = request({ venue: undefined })
    loadConversationContext.mockResolvedValue({
      request: earlier,
      contact,
      messages: [{ id: 'm1', text: 'Hallo!' }],
      state: 'qualifying',
      automationPaused: false,
    })
    await runQualifyingTurn(input())
    expect(extractRequest.mock.calls[0]?.[0].existing).toBe(earlier)
  })

  it('writes the request down before it asks anything else', async () => {
    await runQualifyingTurn(input())
    expect(storeCateringRequest).toHaveBeenCalledTimes(1)
    const call = storeCateringRequest.mock.calls[0]?.[0]
    // I2 — two fields, never one merged object, all the way down.
    expect(call.request.venue).toBeDefined()
    expect(call.contact).toBe(contact)
    expect(JSON.stringify(call.request)).not.toContain('Sarah')
  })

  it('moves the inquiry to qualifying and nothing else', async () => {
    await runQualifyingTurn(input())
    expect(recordAgentProgress).toHaveBeenCalledWith('agency-1', 'inquiry-1', 'qualifying')
  })

  it('shows the summary and what happens next once nothing is missing', async () => {
    qualify.mockResolvedValue({
      ok: true,
      readyToSend: true,
      questions: [],
      summary: '12. Juni, 80 Gäste, Buffet im Schloss Bensberg.',
      missingRequired: [],
      runId: 'run-2',
      costMicroCents: 300,
    })
    const turns = await runQualifyingTurn(input())
    expect(turns.map((t) => t.kind)).toEqual(['summary', 'summary_prompt'])
    expect(turns[0]?.text).toContain('80 Gäste')
    // N1 on the customer's side: the assistant names no figure, and says who will.
    expect(turns[1]?.text).toContain('Johannes')
    expect(turns[1]?.text).not.toMatch(/[€$]|\d+\s?(EUR|Euro)/i)
  })

  it('asks in our own words when the model returns nothing usable', async () => {
    // An empty bubble is worse than a plain question, and escalating a formatting
    // slip to a human is worse than both.
    qualify.mockResolvedValue({
      ok: true,
      readyToSend: false,
      questions: [],
      summary: '',
      missingRequired: ['headcount'],
      runId: 'run-2',
      costMicroCents: 300,
    })
    const turns = await runQualifyingTurn(input())
    expect(turns).toHaveLength(1)
    expect(turns[0]?.kind).toBe('question')
    expect(turns[0]?.text).toContain('wie viele Personen')
  })
})

describe('every failure ends with a person, and none of them ends with a no', () => {
  const failures: [string, () => void][] = [
    ['extraction times out', () => extractRequest.mockResolvedValue({ ok: false, failure: 'timeout', escalate: true, detail: 'x' })],
    ['extraction is unparseable', () => extractRequest.mockResolvedValue({ ok: false, failure: 'unparseable', escalate: true, detail: 'x' })],
    ['the request cannot be stored', () => storeCateringRequest.mockRejectedValue(new Error('db down'))],
    ['an injection is suspected', () => extractRequest.mockResolvedValue(extracted({ injectionSuspected: true, injectionNote: 'ignore your price list' }))],
    ['the qualifying call is rate limited', () => qualify.mockResolvedValue({ ok: false, failure: 'rate_limited', escalate: true, detail: 'x' })],
  ]

  for (const [name, arrange] of failures) {
    it(`hands over to a human when ${name}`, async () => {
      arrange()
      const turns = await runQualifyingTurn(input())

      expect(turns.map((t) => t.kind)).toEqual(['handoff'])
      expect(turns[0]?.text).toContain('Johannes')

      // Invariant 1. The only two outcomes the agent can record are these, and the
      // customer is never told her enquiry was declined, refused or not a fit.
      const outcomes = recordAgentProgress.mock.calls.map((c) => c[2])
      expect(outcomes.every((o) => o === 'qualifying' || o === 'escalated')).toBe(true)
      expect(outcomes).toContain('escalated')
      expect(turns[0]?.text.toLowerCase()).not.toMatch(
        /leider|können wir nicht|nicht möglich|abgelehnt|kein interesse|zu klein/,
      )
    })
  }

  it('still writes the request down before escalating a suspected injection', async () => {
    // F3.11 is reported, not obeyed. The caterer should see what she actually asked
    // for, not an empty inquiry with a scary reason attached.
    extractRequest.mockResolvedValue(extracted({ injectionSuspected: true, injectionNote: 'x' }))
    await runQualifyingTurn(input())
    expect(storeCateringRequest).toHaveBeenCalledTimes(1)
    expect(recordAgentProgress).toHaveBeenCalledWith(
      'agency-1',
      'inquiry-1',
      'escalated',
      'injection_suspected',
    )
  })

  it('says nothing at all once a human is on the thread', async () => {
    // I5: the pause is real. Talking over the owner is the failure mode here, and
    // it costs two model calls to do it.
    loadConversationContext.mockResolvedValue({
      request: null,
      contact: null,
      messages: [],
      state: 'escalated',
      automationPaused: true,
    })
    const turns = await runQualifyingTurn(input())
    expect(turns).toEqual([])
    expect(extractRequest).not.toHaveBeenCalled()
    expect(qualify).not.toHaveBeenCalled()
  })
})

describe('without a database', () => {
  it('answers from the message in hand and writes nothing', async () => {
    // The demo tenant. A walkable surface matters more than a stored one here.
    loadConversationContext.mockResolvedValue(null)
    const turns = await runQualifyingTurn(input({ inquiryId: null }))

    expect(turns.map((t) => t.kind)).toEqual(['question'])
    expect(extractRequest.mock.calls[0]?.[0].messages).toEqual([
      { id: 'm2', text: 'Wir feiern im Juni, ungefähr 80 Gäste.' },
    ])
    expect(storeCateringRequest).not.toHaveBeenCalled()
    expect(recordAgentProgress).not.toHaveBeenCalled()
  })

  it('answers anyway when the context read fails', async () => {
    loadConversationContext.mockRejectedValue(new Error('connection refused'))
    const turns = await runQualifyingTurn(input())
    expect(turns.map((t) => t.kind)).toEqual(['question'])
  })
})

/**
 * A1 — she saw the summary and said yes.
 *
 * Inquiry 6ce639a5 on 10 Aug 2026 sat in `qualifying` because "Ja, das passt genau
 * so" was read as more conversation. Her word is the same act as pressing the
 * button, and it has to reach the send path without a model in between.
 */
describe('affirmative after a complete request', () => {
  it('asks the surface to send, and does not extract from the affirmative', async () => {
    loadConversationContext.mockResolvedValue({
      request: request(),
      contact,
      messages: [{ id: 'm1', text: 'Hallo!' }],
      state: 'qualifying',
      automationPaused: false,
    })

    const turns = await runQualifyingTurn(
      input({ message: { id: 'm9', text: 'Ja, das passt genau so.' } }),
    )

    expect(turns.map((t) => t.kind)).toEqual(['send_now'])
    // The affirmation is not event data. Extracting it is what polluted the brief.
    expect(extractRequest).not.toHaveBeenCalled()
  })

  it('keeps qualifying when the yes carries a correction', async () => {
    loadConversationContext.mockResolvedValue({
      request: request(),
      contact,
      messages: [{ id: 'm1', text: 'Hallo!' }],
      state: 'qualifying',
      automationPaused: false,
    })

    const turns = await runQualifyingTurn(
      input({ message: { id: 'm9', text: 'Ja, aber wir sind 90 Personen' } }),
    )

    expect(turns.map((t) => t.kind)).not.toContain('send_now')
    expect(extractRequest).toHaveBeenCalled()
  })
})
