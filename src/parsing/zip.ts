/**
 * A ZIP reader in one file, with no dependency, because .xlsx and .docx are the
 * same container.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS HAND-WRITTEN.
 *
 * The same judgement that produced `src/storage/sigv4.ts` rather than a 20 MB AWS
 * SDK applies here, and more strongly. Every JavaScript spreadsheet and Word reader
 * ships its own bundled ZIP layer; adopting one to read a header row would pull a
 * general-purpose office-document engine into a product whose only question of the
 * file is "what is in the cells". The format that matters is small and frozen:
 * PKWARE APPNOTE, a central directory of fixed-layout records, two compression
 * methods in practice, and `node:zlib` already implements the hard half.
 *
 * One reader serves both file types because both file types *are* this: a ZIP of
 * XML parts. `xlsx.ts` and `docx.ts` differ only in which part names they ask for.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ARCHIVE IS UNTRUSTED INPUT AND IS TREATED AS SUCH.
 *
 * CLAUDE.md §7: customer input is data, never instructions. A ZIP is the sharpest
 * form of that rule, because a ZIP is *self-describing about its own size*. The
 * classic bomb — 42.zip — is a few kilobytes that declares petabytes, and the naive
 * reader allocates the declared size before it discovers the problem. Three bounds
 * exist here, and the order they run in is the whole defence:
 *
 *   1. **Declared sizes are checked at `openZip`, before a single byte is
 *      decompressed.** A bomb that tells the truth about its expansion — which
 *      42.zip does — is rejected while it is still a few kilobytes on the heap.
 *   2. **`maxOutputLength` bounds the inflate itself.** A bomb that *lies* in the
 *      central directory gets past step 1; zlib stops it at the cap instead of
 *      growing a buffer until the process dies.
 *   3. **The inflated length must match what the directory declared.** An archive
 *      whose two answers disagree is rejected rather than half-believed.
 *
 * The caps are absolute byte counts and not compression ratios. A ratio cap sounds
 * safer and is worse: legitimate Office XML is enormously repetitive — a
 * sharedStrings part routinely compresses better than 100:1 — so a ratio cap
 * rejects exactly the well-formed files this product exists to read, while a bomb
 * tuned just under the ratio still runs the machine out of memory. Bytes are what
 * exhausts a process, so bytes are what is bounded.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { inflateRawSync } from 'node:zlib'

export type ZipProblem =
  /** No end-of-central-directory record. Not a ZIP, or truncated past saving. */
  | 'not_a_zip'
  /** Offsets in the directory point outside the bytes we were handed. */
  | 'truncated'
  /** Encrypted entries need a password we will never have. */
  | 'encrypted'
  /** ZIP64. See the note on `readCentralDirectory`. */
  | 'zip64_unsupported'
  /** Something other than stored or deflate — bzip2, LZMA, PPMd. */
  | 'unsupported_method'
  | 'too_many_entries'
  | 'entry_too_large'
  | 'archive_too_large'
  /** The directory and the compressed stream disagree about the entry's size. */
  | 'size_mismatch'
  | 'entry_not_found'

export class ZipError extends Error {
  constructor(
    readonly problem: ZipProblem,
    message: string,
  ) {
    super(message)
    this.name = 'ZipError'
  }
}

export interface ZipLimits {
  maxEntries: number
  /** Cap on one entry's uncompressed size. */
  maxEntryBytes: number
  /** Cap on the sum of every entry's uncompressed size. */
  maxTotalBytes: number
}

/**
 * Sized against what actually arrives, not against what the format allows.
 *
 * `MAX_UPLOAD_BYTES` in `src/uploads/limits.ts` caps an upload at 25 MB, so a
 * legitimate spreadsheet reaching this code is at most that compressed. 64 MiB per
 * part and 128 MiB across the archive leaves a real prospect list — tens of
 * thousands of rows, one large sharedStrings part — comfortable room, while
 * bounding the worst case to something a Node process survives. A file that needs
 * more than this is not a prospect list.
 */
export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 4096,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
}

export interface ZipEntry {
  /** The stored path, e.g. `xl/worksheets/sheet1.xml`. */
  name: string
  /** 0 = stored, 8 = deflate. Anything else is rejected on read. */
  method: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

export interface ZipArchive {
  readonly entries: readonly ZipEntry[]
  has(name: string): boolean
  find(name: string): ZipEntry | undefined
  /** Decompresses on demand. Throws `ZipError('entry_not_found')` for a missing name. */
  read(name: string): Uint8Array
  /** As `read`, decoded as UTF-8. A leading byte-order mark is dropped. */
  readText(name: string): string
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const EOCD_MIN_SIZE = 22
const CENTRAL_MIN_SIZE = 46
const LOCAL_MIN_SIZE = 30
const MAX_COMMENT_SIZE = 0xffff
const ZIP64_SENTINEL = 0xffffffff

const METHOD_STORED = 0
const METHOD_DEFLATE = 8

const utf8 = new TextDecoder('utf-8')

/**
 * Finds the end-of-central-directory record by scanning backwards.
 *
 * Backwards is the only option: the record sits at the very end but is followed by
 * a variable-length comment, so its position is not computable. The scan validates
 * each candidate rather than trusting the first signature it meets, because a ZIP
 * comment — or, for a file we did not write, any trailing bytes at all — is allowed
 * to contain those four bytes. A false positive here means reading a directory out
 * of arbitrary attacker-chosen bytes.
 */
function findEndOfCentralDirectory(view: DataView, length: number): number {
  const earliest = Math.max(0, length - (EOCD_MIN_SIZE + MAX_COMMENT_SIZE))
  for (let offset = length - EOCD_MIN_SIZE; offset >= earliest; offset--) {
    if (view.getUint32(offset, true) !== EOCD_SIGNATURE) continue

    const directorySize = view.getUint32(offset + 12, true)
    const directoryOffset = view.getUint32(offset + 16, true)
    const entryCount = view.getUint16(offset + 10, true)

    if (directoryOffset === ZIP64_SENTINEL || directorySize === ZIP64_SENTINEL) return offset
    if (directoryOffset + directorySize > offset) continue
    if (entryCount > 0 && view.getUint32(directoryOffset, true) !== CENTRAL_SIGNATURE) continue
    return offset
  }
  throw new ZipError('not_a_zip', 'no end-of-central-directory record found')
}

/**
 * ZIP64 is refused rather than implemented.
 *
 * It exists for archives above 4 GB or above 65,535 entries. `MAX_UPLOAD_BYTES` is
 * 25 MB, so a ZIP64 file arriving here is either a mislabelled upload or someone
 * probing. Refusing it explicitly is honest; silently reading the truncated 32-bit
 * fields would produce an archive that parses and lies about where its data is.
 */
function readCentralDirectory(
  bytes: Uint8Array,
  view: DataView,
  eocdOffset: number,
  limits: ZipLimits,
): ZipEntry[] {
  const declaredCount = view.getUint16(eocdOffset + 10, true)
  const directorySize = view.getUint32(eocdOffset + 12, true)
  const directoryOffset = view.getUint32(eocdOffset + 16, true)

  if (
    declaredCount === 0xffff ||
    directorySize === ZIP64_SENTINEL ||
    directoryOffset === ZIP64_SENTINEL
  ) {
    throw new ZipError('zip64_unsupported', 'zip64 archives are not read here')
  }
  if (declaredCount > limits.maxEntries) {
    throw new ZipError(
      'too_many_entries',
      `archive declares ${declaredCount} entries, limit is ${limits.maxEntries}`,
    )
  }
  if (directoryOffset + directorySize > bytes.length) {
    throw new ZipError('truncated', 'central directory runs past the end of the file')
  }

  const entries: ZipEntry[] = []
  let totalUncompressed = 0
  let pointer = directoryOffset

  for (let index = 0; index < declaredCount; index++) {
    if (pointer + CENTRAL_MIN_SIZE > bytes.length) {
      throw new ZipError('truncated', 'central directory record runs past the end of the file')
    }
    if (view.getUint32(pointer, true) !== CENTRAL_SIGNATURE) {
      throw new ZipError('not_a_zip', `central directory record ${index} has a bad signature`)
    }

    const flags = view.getUint16(pointer + 8, true)
    const method = view.getUint16(pointer + 10, true)
    const compressedSize = view.getUint32(pointer + 20, true)
    const uncompressedSize = view.getUint32(pointer + 24, true)
    const nameLength = view.getUint16(pointer + 28, true)
    const extraLength = view.getUint16(pointer + 30, true)
    const commentLength = view.getUint16(pointer + 32, true)
    const localHeaderOffset = view.getUint32(pointer + 42, true)

    // Bit 0 is the general-purpose encryption flag. There is no path in this
    // product that supplies a password, so an encrypted member is a dead end and
    // saying so beats handing zlib ciphertext and reporting a corrupt file.
    if (flags & 0x0001) {
      throw new ZipError('encrypted', 'encrypted archives are not read here')
    }
    if (
      compressedSize === ZIP64_SENTINEL ||
      uncompressedSize === ZIP64_SENTINEL ||
      localHeaderOffset === ZIP64_SENTINEL
    ) {
      throw new ZipError('zip64_unsupported', 'zip64 entry sizes are not read here')
    }

    // ── Bound 1: the declared size, checked before anything is decompressed. ──
    if (uncompressedSize > limits.maxEntryBytes) {
      throw new ZipError(
        'entry_too_large',
        `entry declares ${uncompressedSize} bytes, limit is ${limits.maxEntryBytes}`,
      )
    }
    totalUncompressed += uncompressedSize
    if (totalUncompressed > limits.maxTotalBytes) {
      throw new ZipError(
        'archive_too_large',
        `archive declares more than ${limits.maxTotalBytes} uncompressed bytes`,
      )
    }

    const nameStart = pointer + CENTRAL_MIN_SIZE
    if (nameStart + nameLength > bytes.length) {
      throw new ZipError('truncated', 'entry name runs past the end of the file')
    }

    // Names are decoded as UTF-8 unconditionally. Bit 11 of the flags is meant to
    // say so and older writers use CP437 instead, but the only names ever looked
    // up here — `xl/workbook.xml`, `word/document.xml` — are pure ASCII, where the
    // two encodings agree byte for byte. Guessing CP437 would change nothing that
    // matters and would add a table.
    entries.push({
      name: utf8.decode(bytes.subarray(nameStart, nameStart + nameLength)),
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    })

    pointer = nameStart + nameLength + extraLength + commentLength
  }

  return entries
}

function inflateEntry(bytes: Uint8Array, entry: ZipEntry, limits: ZipLimits): Uint8Array {
  const header = entry.localHeaderOffset
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  if (header + LOCAL_MIN_SIZE > bytes.length) {
    throw new ZipError('truncated', `local header for ${entry.name} runs past the end of the file`)
  }
  if (view.getUint32(header, true) !== LOCAL_SIGNATURE) {
    throw new ZipError('not_a_zip', `local header for ${entry.name} has a bad signature`)
  }

  // The *local* header's sizes are read from the central directory instead,
  // deliberately. A writer that streams — which is most of them — sets bit 3 and
  // leaves the local sizes at zero, putting the real values in a data descriptor
  // after the payload. The central directory always has them.
  const nameLength = view.getUint16(header + 26, true)
  const extraLength = view.getUint16(header + 28, true)
  const dataStart = header + LOCAL_MIN_SIZE + nameLength + extraLength
  if (dataStart + entry.compressedSize > bytes.length) {
    throw new ZipError('truncated', `data for ${entry.name} runs past the end of the file`)
  }

  const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize)

  if (entry.method === METHOD_STORED) {
    if (entry.compressedSize !== entry.uncompressedSize) {
      throw new ZipError('size_mismatch', `stored entry ${entry.name} declares two different sizes`)
    }
    return compressed
  }
  if (entry.method !== METHOD_DEFLATE) {
    throw new ZipError('unsupported_method', `entry ${entry.name} uses compression method ${entry.method}`)
  }

  let inflated: Uint8Array
  try {
    // ── Bound 2: zlib stops growing the buffer at the cap. This is what catches
    // an archive that under-declares its uncompressed size to get past bound 1. ──
    inflated = inflateRawSync(compressed, { maxOutputLength: limits.maxEntryBytes })
  } catch (cause) {
    // Node raises ERR_BUFFER_TOO_LARGE for the cap and a zlib error for corruption.
    // Both are "this file is not readable"; only the first is worth naming.
    const code = (cause as { code?: string } | null)?.code
    if (code === 'ERR_BUFFER_TOO_LARGE') {
      throw new ZipError(
        'entry_too_large',
        `entry ${entry.name} inflates past the ${limits.maxEntryBytes} byte limit`,
      )
    }
    throw new ZipError('truncated', `entry ${entry.name} could not be inflated: ${String(cause)}`)
  }

  // ── Bound 3: the two answers must agree. ──
  if (inflated.length !== entry.uncompressedSize) {
    throw new ZipError(
      'size_mismatch',
      `entry ${entry.name} declared ${entry.uncompressedSize} bytes and inflated to ${inflated.length}`,
    )
  }
  return inflated
}

export function openZip(bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipArchive {
  if (bytes.length < EOCD_MIN_SIZE) {
    throw new ZipError('not_a_zip', `input is ${bytes.length} bytes, too short to be a zip`)
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const entries = readCentralDirectory(
    bytes,
    view,
    findEndOfCentralDirectory(view, bytes.length),
    limits,
  )

  // Later entries win, matching what every unzip implementation does with a
  // duplicated name. The lookup is a map because a worksheet read is one lookup
  // per sheet and a linear scan over four thousand entries is not free.
  const byName = new Map<string, ZipEntry>()
  for (const entry of entries) byName.set(entry.name, entry)

  return {
    entries,
    has: (name) => byName.has(name),
    find: (name) => byName.get(name),
    read(name) {
      const entry = byName.get(name)
      if (!entry) throw new ZipError('entry_not_found', `archive has no entry named ${name}`)
      return inflateEntry(bytes, entry, limits)
    },
    readText(name) {
      return utf8.decode(this.read(name))
    },
  }
}
