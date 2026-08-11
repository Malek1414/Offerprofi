/**
 * The Cognee sidecar — the shared layer's only door (D31).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING HERE MAY EVER THROW AT A CALLER, AND THAT IS A PRODUCT DECISION.
 *
 * D31 splits memory in two so that the sidecar can fail without stopping the
 * system. That sentence is only true if the code makes it true. A client that
 * throws on a connection refused turns "the pattern store is down" into "the
 * import crashed", and from there into a customer whose inquiry went nowhere —
 * which walks straight into invariant 1, because a customer who gets no offer
 * and no human because a sidecar was unreachable has been refused by software.
 * The shared layer is an *accelerator*. Extraction without it is the extraction
 * this product already ships; extraction with it is measurably better. Those are
 * the only two states, and there is no third state in which anything stops.
 *
 * So every failure — unset environment variable, DNS failure, 500, timeout, a
 * body that is not JSON — comes back as a typed value with `patterns: []`, and a
 * caller degrades by doing nothing special at all. `not_configured` is a
 * first-class result rather than an error, because it is the normal state of
 * every development machine and of the demo build.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SIDECAR IS NOT TRUSTED, INCLUDING BY US.
 *
 * This store is cross-tenant by design: what one tenant's extraction writes,
 * every other tenant reads. That inverts the usual assumption about a service we
 * operate ourselves. A single poisoned or buggy write — one observation whose
 * locator carries `18,50 €` — would otherwise become a figure in a stranger's
 * quote, and the rule in EXECUTION_HANDOFF §4 would have been broken by our own
 * infrastructure rather than by an attacker.
 *
 * Reads are therefore validated with exactly the same `checkObservationPurity`
 * that guards writes, and a pattern that fails is dropped silently rather than
 * surfaced. Silence is right here: a caller cannot act on "the shared store
 * returned something impure", and the alternative — passing it along with a
 * warning — is how impure data reaches a renderer.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * No SDK, no new dependency: two POSTs against two routes we define ourselves.
 * A thin contract we own is what keeps the sidecar replaceable, which matters
 * because D33 already rejected one store and may yet reject this one.
 */

import {
  type Language,
  type PatternObservation,
  type ReadingRole,
  type SourceKind,
  isLanguage,
  isReadingRole,
  isSourceKind,
} from './observation'
import { checkObservationPurity, type PurityViolation } from './purity'

export type EnvLike = Record<string, string | undefined>

/**
 * One dataset, shared by every tenant, named as a constant so that the absence
 * of a per-tenant dataset is visible rather than merely true. If a tenant id
 * ever needs to appear in this file, the two-layer split has been abandoned and
 * the change should be argued for, not made.
 */
export const SHARED_LAYER_DATASET = 'shared_reading_patterns'

const OBSERVATIONS_PATH = '/api/v1/observations'
const SEARCH_PATH = '/api/v1/patterns/search'

const DEFAULT_TIMEOUT_MS = 5_000
/** The sidecar improves extraction; it does not get to hold a request open. */
const MAX_TIMEOUT_MS = 15_000
const MAX_PATTERNS = 50

export type SharedLayerFailure =
  /** No `COGNEE_URL`. The ordinary state of a laptop, and not an error. */
  | 'not_configured'
  /** DNS, connection refused, TLS — the sidecar is not there. */
  | 'unreachable'
  | 'timeout'
  /** The sidecar answered, unhappily. */
  | 'rejected_upstream'
  /** A 200 whose body was not the shape we define. */
  | 'invalid_response'
  /** Our own gate refused the write. Not a transport failure — a caller bug. */
  | 'impure'

export type WriteOutcome =
  | { ok: true; latencyMs: number }
  | {
      ok: false
      failure: SharedLayerFailure
      detail: string
      /**
       * Populated only for `impure`, and only ever handled tenant-side: these
       * carry excerpts of the very price or name that was refused. See the note
       * on `PurityViolation.excerpt`.
       */
      violations: PurityViolation[]
      latencyMs: number
    }

/**
 * What a read gives back.
 *
 * A *pattern*, not a value: where to look, and what that position turned out to
 * mean once an owner had ruled on it. There is deliberately no field on this
 * type that could hold the text found at the locator, because the text found at
 * the locator is the tenant's data and stays behind RLS.
 */
export interface ReadingPattern {
  source_kind: SourceKind
  /** Structural, and re-validated on arrival by the same grammar that guards writes. */
  locator: string
  /** From the closed vocabulary. This is the only thing the shared layer asserts. */
  suggests: ReadingRole
  /**
   * How many owner verdicts stand behind this pattern.
   *
   * A number, in a layer whose whole rule is about numbers — so be precise about
   * what it is. It is evidence strength, used to order candidates before
   * extraction looks at them. It is not a quantity in the tenant's domain, it
   * cannot be rendered because `toExtractionHints` does not carry it, and
   * `shared-layer-no-numbers` exists to keep that true.
   */
  support: number
  language: Language
}

/**
 * What extraction is handed. Two strings, both from constrained sets.
 *
 * This is the narrowest useful shape and the narrowness is the point: a hint
 * says "look here, and read what you find as a per-person price". It does not
 * say what the price is, because the shared layer does not know and must never
 * know. The figure that eventually reaches a customer comes from the tenant's
 * own confirmed catalogue through the deterministic pricing engine (D6), and
 * this type is the reason a shared-layer read cannot get near that path.
 */
export interface ExtractionHint {
  locator: string
  role: ReadingRole
}

export type ReadOutcome =
  | { ok: true; patterns: ReadingPattern[]; latencyMs: number }
  | {
      ok: false
      failure: SharedLayerFailure
      detail: string
      /**
       * Always `[]`. Present on the failure branch on purpose, so that the
       * degrade path is `const { patterns } = await readPatterns(...)` and a
       * caller who forgets to check `ok` still behaves correctly instead of
       * reading `undefined`.
       */
      patterns: ReadingPattern[]
      latencyMs: number
    }

export interface PatternQuery {
  source_kind: SourceKind
  language: Language
  /** Narrow to the roles extraction is currently unsure about. */
  roles?: readonly ReadingRole[]
  limit?: number
}

export interface SharedLayerDeps {
  fetch?: typeof fetch
  env?: EnvLike
  timeoutMs?: number
}

/**
 * Exported so a caller can decide *not to try*.
 *
 * An onboarding screen that says "pattern learning is not connected" is telling
 * the truth; one that says "pattern learning failed" is describing a laptop with
 * no environment variable as a fault. Different sentence, different support
 * ticket.
 */
export function isSharedLayerConfigured(env: EnvLike = process.env): boolean {
  return Boolean(env.COGNEE_URL?.trim())
}

function baseUrl(env: EnvLike): string | null {
  const raw = env.COGNEE_URL?.trim()
  if (!raw) return null
  return raw.endsWith('/') ? raw.slice(0, -1) : raw
}

const elapsed = (startedAt: number): number => Date.now() - startedAt

/**
 * Classify a transport failure without ever letting it escape as an exception.
 *
 * `AbortError` is our own timeout firing; everything else that reaches here is
 * the network or the runtime, and the distinction a caller cares about is only
 * "not there" versus "too slow" — both of which mean the same thing to
 * extraction, which is: proceed without hints.
 */
function transportFailure(error: unknown): { failure: SharedLayerFailure; detail: string } {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error)
  if (name === 'AbortError' || name === 'TimeoutError') {
    return { failure: 'timeout', detail: 'the sidecar did not answer in time' }
  }
  return { failure: 'unreachable', detail: message.slice(0, 200) }
}

interface PostResult {
  ok: true
  body: unknown
}

interface PostFailure {
  ok: false
  failure: SharedLayerFailure
  detail: string
}

/**
 * One POST, with every way it can go wrong turned into a value.
 *
 * The timeout is enforced here rather than relied upon from the platform,
 * because a hung socket with no timeout is the failure mode that takes the whole
 * import down quietly — the one case where "never throws" is technically true
 * and completely useless.
 */
async function post(
  path: string,
  payload: unknown,
  deps: SharedLayerDeps,
): Promise<PostResult | PostFailure> {
  const env = deps.env ?? process.env
  const base = baseUrl(env)
  if (!base) {
    return { ok: false, failure: 'not_configured', detail: 'COGNEE_URL is not set' }
  }

  const doFetch = deps.fetch ?? globalThis.fetch
  if (typeof doFetch !== 'function') {
    return { ok: false, failure: 'not_configured', detail: 'no fetch implementation is available' }
  }

  const timeoutMs = Math.min(Math.max(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1), MAX_TIMEOUT_MS)
  const controller = new AbortController()
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const apiKey = env.COGNEE_API_KEY?.trim()
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`

    const response = await doFetch(`${base}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!response.ok) {
      return {
        ok: false,
        failure: 'rejected_upstream',
        detail: `sidecar answered ${response.status}`,
      }
    }

    // A 200 carrying HTML from a misrouted proxy is the realistic shape of this
    // failure, and `.json()` rejects on it — which is a throw, inside the one
    // function that is not allowed to produce any.
    const body: unknown = await response.json()
    return { ok: true, body }
  } catch (error) {
    return { ok: false, ...transportFailure(error) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Write one owner verdict to the shared layer.
 *
 * Note what this signature does not accept: a tenant id, an agency, a user, a
 * document, or the text that was read. Not "does not require" — has no parameter
 * for. The two-layer split is easiest to hold when the wrong thing has nowhere
 * to be passed (the same argument as `toPricingInput` under invariant 2).
 *
 * The purity gate runs *before* the network call, and a refusal means no request
 * is made at all. That ordering is the enforcement: a price cannot be written to
 * the shared layer because a request containing one is never sent, not because
 * something downstream would have caught it.
 */
export async function recordObservation(
  candidate: unknown,
  deps: SharedLayerDeps = {},
): Promise<WriteOutcome> {
  const startedAt = Date.now()

  const verdict = checkObservationPurity(candidate)
  if (!verdict.pure) {
    return {
      ok: false,
      failure: 'impure',
      detail: 'refused before transmission — the shared layer holds no price, brand or person',
      violations: verdict.violations,
      latencyMs: elapsed(startedAt),
    }
  }

  // Rebuilt field by field from the parsed value rather than forwarded, so that
  // anything the caller hung off the object alongside the schema — a tenant id,
  // the source text, a debug blob — is not on the wire by accident.
  const observation: PatternObservation = {
    source_kind: verdict.observation.source_kind,
    locator: verdict.observation.locator,
    read_as: verdict.observation.read_as,
    corrected_to: verdict.observation.corrected_to,
    confidence_before: verdict.observation.confidence_before,
    language: verdict.observation.language,
  }

  const result = await post(
    OBSERVATIONS_PATH,
    { dataset: SHARED_LAYER_DATASET, observation },
    deps,
  )

  if (!result.ok) {
    return {
      ok: false,
      failure: result.failure,
      detail: result.detail,
      violations: [],
      latencyMs: elapsed(startedAt),
    }
  }

  return { ok: true, latencyMs: elapsed(startedAt) }
}

/**
 * Validate one pattern off the wire.
 *
 * Every field is checked rather than cast, and the locator is put back through
 * the write-side gate. A pattern that fails any check is dropped — returning
 * `null` rather than a partial object, because a half-validated pattern is the
 * thing that ends up being trusted later by whoever reads the code and sees a
 * type annotation.
 */
function parsePattern(input: unknown): ReadingPattern | null {
  if (typeof input !== 'object' || input === null) return null
  const record = input as Record<string, unknown>

  if (!isSourceKind(record.source_kind)) return null
  if (!isLanguage(record.language)) return null
  if (!isReadingRole(record.suggests)) return null
  if (typeof record.locator !== 'string') return null

  // The same gate as the write path, assembled as an observation so there is
  // exactly one implementation of "is this pure" in the codebase.
  const verdict = checkObservationPurity({
    source_kind: record.source_kind,
    locator: record.locator,
    read_as: record.suggests,
    corrected_to: null,
    confidence_before: 0,
    language: record.language,
  })
  if (!verdict.pure) return null

  const support = record.support
  if (typeof support !== 'number' || !Number.isFinite(support) || support < 0) return null

  return {
    source_kind: record.source_kind,
    locator: record.locator,
    suggests: record.suggests,
    support: Math.floor(support),
    language: record.language,
  }
}

/**
 * Ask the shared layer how sources of this kind are usually read.
 *
 * On any failure this returns `{ ok: false, patterns: [] }` and extraction runs
 * exactly as it does today. That is the degrade path from EXECUTION_HANDOFF §4,
 * and it is one line of caller code rather than a branch.
 */
export async function readPatterns(
  query: PatternQuery,
  deps: SharedLayerDeps = {},
): Promise<ReadOutcome> {
  const startedAt = Date.now()

  const limit = Math.min(Math.max(Math.floor(query.limit ?? MAX_PATTERNS), 1), MAX_PATTERNS)
  const roles = (query.roles ?? []).filter(isReadingRole)

  const result = await post(
    SEARCH_PATH,
    {
      dataset: SHARED_LAYER_DATASET,
      source_kind: query.source_kind,
      language: query.language,
      ...(roles.length > 0 ? { roles } : {}),
      limit,
    },
    deps,
  )

  if (!result.ok) {
    return {
      ok: false,
      failure: result.failure,
      detail: result.detail,
      patterns: [],
      latencyMs: elapsed(startedAt),
    }
  }

  const body = result.body
  const raw =
    typeof body === 'object' && body !== null && Array.isArray((body as { patterns?: unknown }).patterns)
      ? ((body as { patterns: unknown[] }).patterns as unknown[])
      : null

  if (raw === null) {
    return {
      ok: false,
      failure: 'invalid_response',
      detail: 'body did not carry a patterns array',
      patterns: [],
      latencyMs: elapsed(startedAt),
    }
  }

  const patterns = raw
    .slice(0, MAX_PATTERNS)
    .map(parsePattern)
    .filter((pattern): pattern is ReadingPattern => pattern !== null)

  return { ok: true, patterns, latencyMs: elapsed(startedAt) }
}

/**
 * Reduce patterns to what extraction is allowed to see.
 *
 * The narrowing is deliberate and is the last structural step in the argument
 * that a shared-layer read cannot introduce a number into a customer-facing
 * turn. `support` and every other scalar is dropped here, so the only values
 * that continue downstream are a structural locator and a role name — and the
 * role vocabulary is checked digit-free by test.
 *
 * Sorted by support, descending, then by locator so the order is stable: an
 * unstable hint order makes extraction non-reproducible, and CLAUDE.md §7 asks
 * for a run that can be reconstructed.
 */
export function toExtractionHints(patterns: readonly ReadingPattern[]): ExtractionHint[] {
  return [...patterns]
    .sort((a, b) => (b.support - a.support) || a.locator.localeCompare(b.locator))
    .map((pattern) => ({ locator: pattern.locator, role: pattern.suggests }))
}
