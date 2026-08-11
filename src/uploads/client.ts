/**
 * The browser half of the resumable upload.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RESUME IS THE ORDINARY PATH, NOT A RECOVERY MODE.
 *
 * `src/uploads/jobs.ts` keys a job on the file's own sha256 and answers "which
 * chunks do I already hold?" on every start. That turns two operations most
 * uploaders keep apart — begin and resume — into one request, and this file is
 * written to take that seriously: there is no `resumeUpload`, no `isResuming`
 * flag, no second code path. `uploadFile` posts the digest, reads `chunksHeld`,
 * and sends the complement. A first attempt is the case where the complement
 * happens to be all of them.
 *
 * That matters because a resume path that only runs after a failure is a path
 * that is only exercised after a failure, which is to say never in testing and
 * always on a caterer's phone in a tunnel.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE RETRY BUDGET IS ABOUT A MINUTE AND NOT INFINITE.
 *
 * A tab is not a queue. Retrying forever inside a page means a spinner that
 * outlives the user's patience, a battery drain nobody asked for, and — the real
 * cost — a false sense that the upload is being looked after by something durable
 * when the durable thing is the row on the server. So the in-page budget is eight
 * attempts, roughly thirty to sixty seconds of backoff, and after that the file
 * shows a failure with a reason and a retry control. Reopening the page resumes
 * from whatever landed, because the job row outlived the tab.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THERE IS NO WEB WORKER, EVEN THOUGH HASHING WOULD LIKE ONE.
 *
 * `next.config.ts` serves `default-src 'self'` with no `worker-src`, so a worker
 * booted from a `blob:` URL — the only way to ship one without a file in
 * `public/` — is blocked by the Content Security Policy. That policy is what
 * makes the TDDDG §25 "no consent banner" position true rather than merely
 * claimed (F1.12), and it is not worth weakening to move a hash off the main
 * thread. The read is sliced and yields instead; see `sha256Hex`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { UploadState } from './jobs'
import {
  CHUNK_BYTES,
  accepts,
  type RejectionReason,
  type UploadSurface,
} from './limits'

/**
 * A thing with bytes in it, without saying it is a `File`.
 *
 * Two reasons, both practical. A voice note arrives from `MediaRecorder` as a
 * `Blob` with no name, so the uploader would otherwise need a `File` constructor
 * dance on a surface that already has enough going on. And a test can implement
 * three members in four lines, where faking a `File` well enough to slice it
 * means faking `Blob` too.
 */
export interface UploadSource {
  readonly filename: string
  readonly contentType: string
  readonly byteSize: number
  /** Bytes in `[start, end)`. */
  read(_start: number, _end: number): Promise<Uint8Array>
}

export function sourceFromBlob(blob: Blob, filename: string, contentType?: string): UploadSource {
  return {
    filename,
    contentType: contentType || blob.type || 'application/octet-stream',
    byteSize: blob.size,
    read: async (start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer()),
  }
}

export function sourceFromFile(file: File): UploadSource {
  return sourceFromBlob(file, file.name, file.type)
}

export type UploadPhase =
  | 'hashing'
  | 'starting'
  | 'sending'
  | 'assembling'
  | 'done'
  | 'failed'

export interface UploadProgress {
  phase: UploadPhase
  filename: string
  byteSize: number
  /** Includes bytes the server already held, so a resume jumps forward rather than restarting. */
  bytesSent: number
  chunksSent: number
  chunksResumed: number
  chunkTotal: number
  jobId: string | null
  state: UploadState | null
  /** 1 on the first try. Rises only while a transient failure is being waited out. */
  attempt: number
  /** Milliseconds still to wait before the next attempt; 0 when nothing is being waited for. */
  waitingMs: number
}

export type UploadResult =
  | {
      ok: true
      jobId: string
      state: UploadState
      /** True when the server already had part or all of this file. */
      resumed: boolean
      chunksResumed: number
      /** D5 — a voice note is stored and flagged, never transcribed. */
      storedUnread: boolean
    }
  | { ok: false; jobId: string | null; reason: string; retryable: boolean }

/* ─── Failure classification ─────────────────────────────────────────────────
 *
 * The split is the load-bearing part of the retry, not the backoff curve.
 * Without it a `.pages` file is retried until somebody notices the bill, and a
 * dropped connection is reported to the user as a permanent error she cannot
 * act on. Both failures look identical at the call site; only the status code
 * tells them apart.
 */

export type FailureClass = 'transient' | 'permanent'

export function classify(status: number): FailureClass {
  // 408 request timeout, 425 too early, 429 rate limited: the server is saying
  // "not now", which is a different sentence from "not ever".
  if (status === 408 || status === 425 || status === 429) return 'transient'
  // Everything 5xx is the server's problem and may well be gone in a second.
  if (status >= 500) return 'transient'
  // Every remaining 4xx is a statement about *this request*. Sending it again
  // unchanged produces the same answer, so the only honest thing is to stop and
  // say why.
  return 'permanent'
}

const megabytes = (bytes: number): string =>
  `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MB`

/**
 * The German a user actually reads, for a rejection `limits.ts` decided.
 *
 * The rules are not restated here and must not be — `accepts()` is the check and
 * this is only its translation. In particular `not_on_this_surface` gets its own
 * sentence: telling an end customer that her voice note is an unsupported file
 * type, when it is a type the caterer's side accepts, is a small lie that makes
 * the product look broken rather than opinionated.
 */
export function describeRejection(reason: RejectionReason): string {
  switch (reason.kind) {
    case 'empty':
      return 'Diese Datei enthält keine Daten.'
    case 'too_large':
      return `Diese Datei ist ${megabytes(reason.actualBytes)} groß. Mehr als ${megabytes(reason.limitBytes)} können wir nicht annehmen.`
    case 'not_on_this_surface':
      // On the customer surface the only types in this class are the voice ones,
      // so the message can name what it means instead of being vague about it.
      return reason.surface === 'customer'
        ? 'Sprachnachrichten nehmen wir hier nicht entgegen — schreiben Sie es bitte kurz, dann geht bei Datum und Personenzahl nichts verloren. Dokumente und Screenshots sind willkommen.'
        : `Dateien vom Typ .${reason.extension} können an dieser Stelle nicht hochgeladen werden.`
    case 'unsupported_type':
      return reason.extension
        ? `Das Format .${reason.extension} können wir nicht lesen. PDF, Word, Excel, CSV oder ein Foto funktionieren.`
        : 'Diese Datei hat keine erkennbare Endung. PDF, Word, Excel, CSV oder ein Foto funktionieren.'
  }
}

export function describeStatus(status: number): string {
  if (status === 401) return 'Die Sitzung ist abgelaufen. Bitte neu anmelden und den Upload wiederholen.'
  if (status === 403) return 'Für diesen Upload fehlt die Berechtigung.'
  if (status === 404) return 'Dieser Upload ist auf dem Server nicht mehr vorhanden. Bitte die Datei erneut auswählen.'
  if (status === 409) return 'Diesem Konto ist noch keine Agentur zugeordnet. Bitte zuerst die Einrichtung abschließen.'
  if (status === 413) return 'Die Datei ist zu groß.'
  if (status === 422) return 'Dieses Dateiformat können wir nicht annehmen.'
  if (status === 429) return 'Gerade sind zu viele Uploads unterwegs. Wir versuchen es gleich noch einmal.'
  if (status === 503) return 'Der Upload-Dienst ist gerade nicht erreichbar. Wir versuchen es gleich noch einmal.'
  if (status >= 500) return 'Der Server antwortet gerade nicht. Wir versuchen es gleich noch einmal.'
  return `Der Upload wurde abgelehnt (Fehler ${status}).`
}

const OFFLINE = 'Keine Verbindung. Der Upload wird fortgesetzt, sobald das Netz zurück ist.'

/* ─── Backoff ─────────────────────────────────────────────────────────────── */

/** Eight tries: ~30–60s of waiting in total before the file is handed back to the user. */
export const MAX_ATTEMPTS = 8

/**
 * Equal jitter: half the ceiling, plus a random half.
 *
 * Pure exponential backoff synchronises clients. A train comes out of a tunnel
 * and every phone on it retries in the same millisecond, which is how a recovering
 * server is knocked over by the recovery. Half the delay is fixed so the curve
 * still doubles, half is random so the herd spreads out.
 *
 * Capped at 30s: the thing being waited for is a network or a server, and neither
 * improves between the thirtieth second and the sixtieth in a way a user waiting
 * on a progress bar would forgive.
 */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(30_000, 500 * 2 ** Math.max(0, attempt - 1))
  return Math.round(ceiling / 2 + random() * (ceiling / 2))
}

/**
 * Which chunk indices the client still owes the server.
 *
 * `chunksHeld` is a list rather than a count for a reason worth restating here,
 * because this function is where the reason pays off: an upload that dies does
 * not necessarily die at the end. Chunk 7 of 20 can be the one that was in flight
 * while 8 through 20 had already landed, and a count would make this re-send
 * thirteen chunks that are already on disk.
 */
export function missingChunks(chunkTotal: number, held: readonly number[]): number[] {
  const have = new Set(held)
  const missing: number[] = []
  for (let index = 0; index < chunkTotal; index += 1) {
    if (!have.has(index)) missing.push(index)
  }
  return missing
}

/**
 * States in which the bytes are already on the server and must not be re-sent.
 *
 * This exists because of an easy and expensive mistake. `assemble` deletes the
 * staging chunks once the object is written, so a *completed* job answers a fresh
 * start with `chunksHeld: []` — identical to a job that has received nothing. A
 * client that looked only at the list would cheerfully re-upload 25 MB of a file
 * the server finished with yesterday. The state is what tells the two apart.
 */
const ALREADY_STORED: ReadonlySet<UploadState> = new Set<UploadState>([
  'parsing',
  'needs_mapping',
  'imported',
])

/* ─── Environment seams ──────────────────────────────────────────────────── */

export interface UploaderDeps {
  fetch: typeof fetch
  /** Resolves after `ms` — or sooner, if the tab comes back to the foreground. */
  sleep(_ms: number): Promise<void>
  /** Hands the main thread back, so a 25 MB read does not freeze the caret. */
  yieldToBrowser(): Promise<void>
  digest(_bytes: Uint8Array): Promise<ArrayBuffer>
  random(): number
}

/**
 * A sleep that a returning user can cut short.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SURVIVING A BACKGROUNDED TAB IS MOSTLY ABOUT NOT DEPENDING ON TIMERS.
 *
 * Mobile browsers clamp `setTimeout` in a hidden tab to about a second, and
 * Chrome's intensive throttling drops that to once a minute after five minutes
 * hidden. `fetch` is not throttled that way. So the upload loop is written as a
 * chain of awaited `fetch` calls with no timer between them: it keeps making
 * progress while the caterer is answering a WhatsApp message, which is exactly
 * when uploads used to die.
 *
 * The one place a timer is unavoidable is the backoff, and a sixteen-second wait
 * that a hidden tab stretches to sixty is a user who comes back to a stalled bar.
 * So the wait also listens for `visibilitychange` and resolves early when the tab
 * is looked at again — the moment the browser un-throttles everything anyway.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function foregroundAwareSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const listening = typeof document !== 'undefined'
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false

    const finish = () => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      if (listening) document.removeEventListener('visibilitychange', onVisibility)
      resolve()
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') finish()
    }

    if (listening) document.addEventListener('visibilitychange', onVisibility)
    timer = setTimeout(finish, ms)
  })
}

async function yieldToBrowser(): Promise<void> {
  // A hidden tab has no caret to keep responsive and a clamped `setTimeout`, so
  // yielding there costs a second per slice and buys nothing. Twenty-five slices
  // of that is twenty-five seconds of a phone doing nothing in the user's pocket.
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return

  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  // `scheduler.yield()` returns to the event loop at the *front* of the queue, so
  // the main thread gets its turn without this loop losing its place behind every
  // other pending task. `setTimeout(0)` is the fallback where it does not exist.
  if (typeof scheduler?.yield === 'function') {
    await scheduler.yield()
    return
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

function browserDeps(): UploaderDeps {
  return {
    fetch: (...args) => fetch(...args),
    sleep: foregroundAwareSleep,
    yieldToBrowser,
    digest: (bytes) => crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource),
    random: Math.random,
  }
}

/* ─── Hashing ────────────────────────────────────────────────────────────── */

const hex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')

/**
 * The file's sha256, computed before a single byte is sent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS SLICED WHEN `crypto.subtle.digest` TAKES THE WHOLE BUFFER ANYWAY.
 *
 * D1 says typing never blocks and no synchronous work sits in the keystroke path.
 * A UI frozen for a second while a 25 MB file is hashed is the same failure by a
 * different route, and it lands on the worst possible screen: the one where the
 * user has just dropped a file and is about to type a note about it.
 *
 * WebCrypto has no streaming interface — `digest` is one call over one buffer —
 * so the part that can be broken up is the *read*, and it is the expensive part
 * on a phone: pulling 25 MB off flash through the main thread in one go is what
 * produces the visible stall. Here it is pulled a chunk at a time, with the main
 * thread handed back between slices, so the longest uninterrupted piece of work
 * is one megabyte. The digest itself is a promise the engine is free to run off
 * the main thread, and the shipping ones do.
 *
 * The slice size is `CHUNK_BYTES` rather than an independent constant on purpose:
 * it is the same 1 MiB the wire uses, so there is one number to reason about and
 * no second one to drift.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function sha256Hex(source: UploadSource, deps: UploaderDeps): Promise<string> {
  const whole = new Uint8Array(source.byteSize)
  let offset = 0

  while (offset < source.byteSize) {
    const end = Math.min(offset + CHUNK_BYTES, source.byteSize)
    whole.set(await source.read(offset, end), offset)
    offset = end
    await deps.yieldToBrowser()
  }

  return hex(await deps.digest(whole))
}

/* ─── The upload ─────────────────────────────────────────────────────────── */

type Step<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'transient'; reason: string }
  | { kind: 'permanent'; reason: string }

interface StartAnswer {
  jobId: string
  chunkSize: number
  chunkTotal: number
  chunksHeld: number[]
  state: UploadState
  storedUnread: boolean
  resumed: boolean
}

export interface UploadOptions {
  /** Defaults to the caterer's side. Named rather than inferred — see `limits.ts`. */
  surface?: UploadSurface
  onProgress?: (_progress: UploadProgress) => void
  signal?: AbortSignal
  maxAttempts?: number
  /** Test seam. Anything omitted falls back to the real browser API. */
  deps?: Partial<UploaderDeps>
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await response.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

const numbers = (value: unknown): number[] =>
  Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === 'number') : []

/**
 * Start, or rejoin. One request, and the client cannot tell which happened —
 * which is the point, because a resume it cannot tell apart is a resume it cannot
 * get wrong.
 */
async function startJob(
  deps: UploaderDeps,
  source: UploadSource,
  sha256: string,
): Promise<Step<StartAnswer>> {
  let response: Response
  try {
    response = await deps.fetch('/api/uploads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        filename: source.filename,
        contentType: source.contentType,
        byteSize: source.byteSize,
        sha256,
      }),
    })
  } catch {
    return { kind: 'transient', reason: OFFLINE }
  }

  if (!response.ok) {
    // 413 and 422 carry the structured `RejectionReason` the server decided, and
    // that is worth unpacking rather than flattening to "abgelehnt": the user can
    // act on "this file is 31 MB" and cannot act on "422".
    if (response.status === 413 || response.status === 422) {
      const body = await readJson(response)
      const reason = body?.reason as RejectionReason | undefined
      return {
        kind: 'permanent',
        reason: reason ? describeRejection(reason) : describeStatus(response.status),
      }
    }
    return { kind: classify(response.status), reason: describeStatus(response.status) }
  }

  const body = await readJson(response)
  const jobId = typeof body?.jobId === 'string' ? body.jobId : ''
  const chunkTotal = typeof body?.chunkTotal === 'number' ? body.chunkTotal : 0
  if (!body || !jobId || chunkTotal <= 0) {
    // A 200 whose body is not what the contract promises is a proxy or a captive
    // portal far more often than it is the server, and both are worth retrying.
    // `!body` is checked here rather than only where it is read, so everything
    // below can treat the body as present — a null check per field would be five
    // chances to forget one.
    return { kind: 'transient', reason: 'Unerwartete Antwort vom Server.' }
  }

  return {
    kind: 'ok',
    value: {
      jobId,
      chunkSize: typeof body.chunkSize === 'number' ? body.chunkSize : CHUNK_BYTES,
      chunkTotal,
      chunksHeld: numbers(body.chunksHeld),
      state: (typeof body.state === 'string' ? body.state : 'queued') as UploadState,
      storedUnread: body.storedUnread === true,
      resumed: body.status === 'resumed',
    },
  }
}

interface ChunkAnswer {
  received: number
  total: number
  state: UploadState
  objectKey: string | null
  failureReason: string | null
}

async function putChunk(
  deps: UploaderDeps,
  jobId: string,
  index: number,
  bytes: Uint8Array,
): Promise<Step<ChunkAnswer>> {
  let response: Response
  try {
    response = await deps.fetch(`/api/uploads/${jobId}/chunks?index=${index}`, {
      method: 'PUT',
      // Raw bytes, not multipart: a chunk is a slice of a file whose shape the
      // server already knows, and the only metadata is an integer that fits in
      // the query string. `keepalive` is not an option here — it caps bodies at
      // 64 KB, and these are 1 MiB.
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes as unknown as BodyInit,
    })
  } catch {
    return { kind: 'transient', reason: OFFLINE }
  }

  if (!response.ok) {
    return { kind: classify(response.status), reason: describeStatus(response.status) }
  }

  const body = await readJson(response)
  return {
    kind: 'ok',
    value: {
      received: typeof body?.received === 'number' ? body.received : 0,
      total: typeof body?.total === 'number' ? body.total : 0,
      state: (typeof body?.state === 'string' ? body.state : 'uploading') as UploadState,
      objectKey: typeof body?.objectKey === 'string' ? body.objectKey : null,
      failureReason: typeof body?.failureReason === 'string' ? body.failureReason : null,
    },
  }
}

/**
 * Whether the server is willing to try this failed job again.
 *
 * Asked rather than guessed. `retryable` is a server fact — a digest mismatch is
 * permanent, a short read is not — and the chunk endpoint does not carry it, so
 * the one place it matters costs one extra request on a path that has already
 * gone wrong. Guessing here would produce exactly the retry button that appears
 * to work and changes nothing.
 */
async function askRetryable(deps: UploaderDeps, jobId: string): Promise<boolean> {
  try {
    const response = await deps.fetch(`/api/uploads/${jobId}`, { method: 'GET' })
    if (!response.ok) return false
    const body = await readJson(response)
    const job = body?.job as { retryable?: unknown } | undefined
    return job?.retryable === true
  } catch {
    return false
  }
}

export async function uploadFile(
  source: UploadSource,
  options: UploadOptions = {},
): Promise<UploadResult> {
  const deps: UploaderDeps = { ...browserDeps(), ...options.deps }
  const surface: UploadSurface = options.surface ?? 'client'
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS

  const progress: UploadProgress = {
    phase: 'hashing',
    filename: source.filename,
    byteSize: source.byteSize,
    bytesSent: 0,
    chunksSent: 0,
    chunksResumed: 0,
    chunkTotal: 0,
    jobId: null,
    state: null,
    attempt: 1,
    waitingMs: 0,
  }

  const report = (patch: Partial<UploadProgress>): void => {
    Object.assign(progress, patch)
    options.onProgress?.({ ...progress })
  }

  const fail = (reason: string, retryable: boolean): UploadResult => {
    report({ phase: 'failed', waitingMs: 0 })
    return { ok: false, jobId: progress.jobId, reason, retryable }
  }

  /**
   * Run one request until it succeeds, fails permanently, or runs out of tries.
   *
   * The attempt counter and the wait are reported as they happen, because a
   * progress bar that sits still for sixteen seconds without saying why is
   * indistinguishable from one that has died.
   */
  const persist = async <T>(run: () => Promise<Step<T>>): Promise<Step<T>> => {
    let last: Step<T> = { kind: 'transient', reason: OFFLINE }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (options.signal?.aborted) return { kind: 'permanent', reason: 'Abgebrochen.' }

      last = await run()
      if (last.kind !== 'transient') {
        report({ attempt: 1, waitingMs: 0 })
        return last
      }
      if (attempt === maxAttempts) break

      const wait = backoffMs(attempt, deps.random)
      report({ attempt: attempt + 1, waitingMs: wait })
      await deps.sleep(wait)
    }

    return last
  }

  // The same check the server runs, run early so a file the surface will not take
  // is never hashed and never sent. `limits.ts` owns the rules; this is not a
  // second opinion, it is the first one arriving sooner.
  const verdict = accepts(surface, source.filename, source.byteSize)
  if (!verdict.accepted) return fail(describeRejection(verdict.reason), false)

  let sha256: string
  try {
    sha256 = await sha256Hex(source, deps)
  } catch {
    // Reading the file failed: it was moved, a permission was revoked, or the
    // pick came from a cloud provider that had gone offline. Re-picking is the
    // only cure, so this is not offered as a retry.
    return fail('Die Datei konnte nicht gelesen werden. Bitte erneut auswählen.', false)
  }

  report({ phase: 'starting' })
  const started = await persist(() => startJob(deps, source, sha256))
  if (started.kind !== 'ok') {
    return fail(started.reason, started.kind === 'transient')
  }

  const job = started.value
  report({
    jobId: job.jobId,
    state: job.state,
    chunkTotal: job.chunkTotal,
    chunksResumed: job.chunksHeld.length,
    bytesSent: Math.min(job.chunksHeld.length * job.chunkSize, source.byteSize),
    phase: 'sending',
  })

  // Already assembled and stored. The chunk rows are gone precisely *because* it
  // succeeded, so an empty `chunksHeld` here means finished, not untouched.
  if (ALREADY_STORED.has(job.state) && job.chunksHeld.length < job.chunkTotal) {
    report({ phase: 'done', bytesSent: source.byteSize, chunksSent: 0 })
    return {
      ok: true,
      jobId: job.jobId,
      state: job.state,
      resumed: true,
      chunksResumed: job.chunkTotal,
      storedUnread: job.storedUnread,
    }
  }

  let outstanding = missingChunks(job.chunkTotal, job.chunksHeld)

  // Every chunk is staged and the object was never written: assembly runs in its
  // own transaction (see repository.ts), so a process killed in that window
  // leaves exactly this state. Re-sending the last chunk is free — the insert is
  // `on conflict do nothing` — and re-triggers assembly, which is the recovery
  // the split was designed to leave open.
  if (outstanding.length === 0) outstanding = [job.chunkTotal - 1]

  let last: ChunkAnswer | null = null

  for (const index of outstanding) {
    if (options.signal?.aborted) return fail('Abgebrochen.', true)

    const start = index * job.chunkSize
    const end = Math.min(start + job.chunkSize, source.byteSize)

    let bytes: Uint8Array
    try {
      bytes = await source.read(start, end)
    } catch {
      return fail('Die Datei konnte nicht gelesen werden. Bitte erneut auswählen.', false)
    }

    const sent = await persist(() => putChunk(deps, job.jobId, index, bytes))
    if (sent.kind !== 'ok') {
      return fail(sent.reason, sent.kind === 'transient')
    }

    last = sent.value
    report({
      chunksSent: progress.chunksSent + 1,
      bytesSent: Math.min(progress.bytesSent + (end - start), source.byteSize),
      state: sent.value.state,
      phase: sent.value.received >= sent.value.total ? 'assembling' : 'sending',
    })
  }

  // The digest is verified server-side during assembly, so the last chunk's reply
  // is where "the bytes that arrived are not the bytes you promised" surfaces.
  if (last?.state === 'failed') {
    const reason = last.failureReason ?? 'Der Upload ist fehlgeschlagen.'
    return fail(reason, await askRetryable(deps, job.jobId))
  }

  const state = last?.state ?? job.state
  report({ phase: 'done', state, bytesSent: source.byteSize, waitingMs: 0 })

  return {
    ok: true,
    jobId: job.jobId,
    state,
    resumed: job.resumed || job.chunksHeld.length > 0,
    chunksResumed: job.chunksHeld.length,
    storedUnread: job.storedUnread,
  }
}
