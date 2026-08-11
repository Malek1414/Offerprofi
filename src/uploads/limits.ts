/**
 * What may be uploaded, by whom, and how big.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO SURFACES ARE NOT THE SAME, AND THE DIFFERENCE IS DELIBERATE (D2).
 *
 * **The client surface** is the caterer — Lisa, on her phone, at eleven at night.
 * She is the person we are trying to impress, and she is holding whatever her
 * business already has: a menu as a PDF, a price list as an Excel file, a photo
 * of a printed card, a voice note because typing is slow. Parity with what
 * Claude's own apps accept is the bar.
 *
 * **The customer surface** is the bride or the office manager asking for a quote.
 * They get documents and screenshots and nothing else. This was an explicit owner
 * correction, and the reasoning is worth keeping: voice on the customer side is
 * error-prone — accents, background noise at a venue, a half-second clip — and it
 * adds nothing a typed sentence does not already do. Getting an event date wrong
 * because a voice note was misheard is a real cost with no offsetting benefit.
 *
 * The asymmetry lives here rather than in an `accept` attribute on an input,
 * because an `accept` attribute is a hint to a file picker and not a check. A
 * customer surface that only *displays* the restriction is a customer surface
 * that accepts a voice note from anybody who posts to the endpoint directly.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type UploadSurface = 'client' | 'customer'

export interface AcceptedType {
  extension: string
  /** Every MIME type browsers have been observed to send for this extension. */
  mimeTypes: readonly string[]
  /** Shown in the German UI when a file is refused, so the message can name it. */
  label: string
  /**
   * D5: voice notes are captured, stored and flagged — never transcribed. This
   * marks the types that reach a human rather than a parser, so nothing downstream
   * can mistake an audio file for something it can read.
   */
  storedUnread?: boolean
}

const DOCUMENTS: readonly AcceptedType[] = [
  { extension: 'pdf', mimeTypes: ['application/pdf'], label: 'PDF' },
  {
    extension: 'docx',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    label: 'Word-Dokument',
  },
  {
    extension: 'xlsx',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    label: 'Excel-Tabelle',
  },
  // Browsers disagree about CSV more than about anything else here: Windows reports
  // the Excel type for a .csv the moment Excel is installed. Listing every observed
  // value is less work than explaining to a caterer why her file "is not a CSV".
  {
    extension: 'csv',
    mimeTypes: ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'],
    label: 'CSV-Datei',
  },
  { extension: 'txt', mimeTypes: ['text/plain'], label: 'Textdatei' },
  { extension: 'md', mimeTypes: ['text/markdown', 'text/plain'], label: 'Markdown' },
]

const IMAGES: readonly AcceptedType[] = [
  { extension: 'png', mimeTypes: ['image/png'], label: 'PNG-Bild' },
  { extension: 'jpg', mimeTypes: ['image/jpeg'], label: 'JPEG-Bild' },
  { extension: 'jpeg', mimeTypes: ['image/jpeg'], label: 'JPEG-Bild' },
  // Every photo taken on an iPhone with default settings. Excluding it would mean
  // rejecting the single most common way a screenshot or a photographed menu
  // actually arrives.
  { extension: 'heic', mimeTypes: ['image/heic', 'image/heif'], label: 'HEIC-Bild' },
  { extension: 'webp', mimeTypes: ['image/webp'], label: 'WebP-Bild' },
]

const VOICE: readonly AcceptedType[] = [
  { extension: 'm4a', mimeTypes: ['audio/mp4', 'audio/x-m4a'], label: 'Sprachnachricht', storedUnread: true },
  { extension: 'mp3', mimeTypes: ['audio/mpeg'], label: 'Sprachnachricht', storedUnread: true },
  { extension: 'ogg', mimeTypes: ['audio/ogg'], label: 'Sprachnachricht', storedUnread: true },
  { extension: 'webm', mimeTypes: ['audio/webm'], label: 'Sprachnachricht', storedUnread: true },
]

const BY_SURFACE: Record<UploadSurface, readonly AcceptedType[]> = {
  client: [...DOCUMENTS, ...IMAGES, ...VOICE],
  customer: [...DOCUMENTS, ...IMAGES],
}

export function acceptedTypes(surface: UploadSurface): readonly AcceptedType[] {
  return BY_SURFACE[surface]
}

/** The `accept` attribute for a file input. A convenience for the picker, never a check. */
export function acceptAttribute(surface: UploadSurface): string {
  const entries = acceptedTypes(surface)
  return [
    ...entries.map((type) => `.${type.extension}`),
    ...new Set(entries.flatMap((type) => type.mimeTypes)),
  ].join(',')
}

/**
 * 25 MB.
 *
 * Chunks are held as `bytea` rows in Postgres until a file is assembled (see
 * 0020), which is what makes a resumable upload survive a process restart without
 * asking S3 what it has. That trade buys durability and costs the ability to
 * accept unbounded files, so the bound is stated here and enforced before the
 * first chunk is accepted rather than discovered part-way through one.
 *
 * A menu, a price list, a photographed card and a two-minute voice note all sit
 * far below this. A wedding video does not, and is not something this product has
 * any reason to receive.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

/**
 * 1 MiB.
 *
 * Small enough that a chunk sent over a bad mobile connection usually completes,
 * which is the whole point — a failed chunk costs one retry of 1 MiB rather than a
 * restart of the file. Large enough that a 25 MB file is 25 round trips and not
 * 25,000.
 */
export const CHUNK_BYTES = 1024 * 1024

export function chunkCount(byteSize: number): number {
  return Math.max(1, Math.ceil(byteSize / CHUNK_BYTES))
}

export type RejectionReason =
  | { kind: 'too_large'; limitBytes: number; actualBytes: number }
  | { kind: 'empty' }
  | { kind: 'unsupported_type'; extension: string }
  | { kind: 'not_on_this_surface'; extension: string; surface: UploadSurface }

export type Acceptance = { accepted: true; type: AcceptedType } | { accepted: false; reason: RejectionReason }

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot <= 0 ? '' : filename.slice(dot + 1).toLowerCase()
}

/**
 * The check, and the only one that counts.
 *
 * Decided on the **extension**, not the reported MIME type. A browser's MIME type
 * is a guess derived from the extension and the operating system's file
 * associations, so trusting it means trusting a value the client controls anyway,
 * with the added downside that it varies between machines for the same file. The
 * extension is at least the thing the user can see.
 *
 * Note that `not_on_this_surface` is reported separately from `unsupported_type`.
 * They are different messages: one says "we cannot read this", the other says
 * "this is the wrong place for it", and telling a customer their voice note is an
 * unsupported file type when it is a type we accept from the caterer would be a
 * small lie that makes the product look broken.
 */
export function accepts(surface: UploadSurface, filename: string, byteSize: number): Acceptance {
  if (byteSize <= 0) {
    return { accepted: false, reason: { kind: 'empty' } }
  }
  if (byteSize > MAX_UPLOAD_BYTES) {
    return {
      accepted: false,
      reason: { kind: 'too_large', limitBytes: MAX_UPLOAD_BYTES, actualBytes: byteSize },
    }
  }

  const extension = extensionOf(filename)
  const onThisSurface = acceptedTypes(surface).find((type) => type.extension === extension)
  if (onThisSurface) return { accepted: true, type: onThisSurface }

  const onAnySurface = BY_SURFACE.client.find((type) => type.extension === extension)
  if (onAnySurface) {
    return { accepted: false, reason: { kind: 'not_on_this_surface', extension, surface } }
  }

  return { accepted: false, reason: { kind: 'unsupported_type', extension } }
}
