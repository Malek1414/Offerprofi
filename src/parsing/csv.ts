/**
 * CSV as it is written in Germany, which is not quite CSV as it is specified.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DELIMITER IS DETECTED, NEVER ASSUMED.
 *
 * RFC 4180 says comma. Excel on a German-locale Windows writes semicolons, and it
 * does so for a reason that cannot be argued with: in that locale the decimal
 * separator *is* the comma, so `18,50` is a number and a comma-delimited file would
 * split it. Every prospect list exported by a German agency is therefore
 * semicolon-delimited, and a parser that assumes the RFC produces one column
 * containing the whole row — which does not look like an error, it looks like a
 * file with one strangely-named column, and a human confirms it and imports
 * garbage.
 *
 * Detection is not sniffing a character. It parses the sample once per candidate
 * and scores how *consistent* the resulting shape is, because that is the property
 * that actually separates the true delimiter from a coincidence. A file of
 * `Firma;Preis` / `Müller;18,50` has one comma in some rows and none in others, so
 * the comma scores badly on consistency while the semicolon splits every row into
 * the same three fields. This is why `18,50` survives: nothing here special-cases a
 * decimal comma, the shape argument handles it and would handle the next locale
 * quirk too.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The rest is RFC 4180 plus the four things real files do that it does not
 * describe: a UTF-8 byte-order mark from Excel's "CSV UTF-8" export, CRLF and lone
 * CR line endings, a bare `"` inside an unquoted field, and a last line without a
 * terminator. All four are accepted silently. A parser that rejects a file a
 * spreadsheet just produced is a parser the owner works around by editing the file,
 * and then we are importing whatever their workaround produced.
 */

export const CSV_DELIMITERS = [';', ',', '\t', '|'] as const
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number]

export interface CsvDocument {
  rows: string[][]
  delimiter: CsvDelimiter
  /**
   * How consistent the shape was under the chosen delimiter, 0…1. A low number is
   * not a parse failure — it is the mapping step's cue to show the raw rows and ask
   * rather than proceed. 0 means no delimiter split anything: a single-column file.
   */
  delimiterConfidence: number
  /** True when Excel's "CSV UTF-8" export mark was present and stripped. */
  hadByteOrderMark: boolean
}

export interface CsvOptions {
  /** Owner-supplied, so it wins outright and detection does not run (CLAUDE.md §7). */
  delimiter?: CsvDelimiter
  /** How many records the detector reads before deciding. */
  sampleRows?: number
}

const DEFAULT_SAMPLE_ROWS = 50
const BYTE_ORDER_MARK = '\uFEFF'

const utf8 = new TextDecoder('utf-8')

/**
 * Decoding is UTF-8 and only UTF-8.
 *
 * A German file saved as Windows-1252 exists and will arrive one day; it decodes
 * here with replacement characters where the umlauts were, which is visible in the
 * mapping preview — `M?ller` in front of a human who knows the name. Guessing an
 * encoding is the alternative, and a wrong guess is invisible: it produces
 * plausible-looking mojibake that gets confirmed and stored. Visible damage beats
 * silent damage.
 */
export function decodeCsvText(bytes: Uint8Array): { text: string; hadByteOrderMark: boolean } {
  const decoded = utf8.decode(bytes)
  // TextDecoder strips the mark itself, so its presence is read from the bytes.
  const hadByteOrderMark =
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  return { text: decoded.startsWith(BYTE_ORDER_MARK) ? decoded.slice(1) : decoded, hadByteOrderMark }
}

/**
 * One RFC 4180 state machine, used both for the real parse and for scoring a
 * candidate delimiter. Sharing it is deliberate: a detector that counts characters
 * with a different notion of quoting than the parser will confidently pick a
 * delimiter the parser then splits differently.
 */
function parseRecords(text: string, delimiter: string, limit: number): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let index = 0

  const endRecord = (): void => {
    row.push(field)
    field = ''
    rows.push(row)
    row = []
  }

  while (index < text.length && rows.length < limit) {
    const character = text.charAt(index)

    if (quoted) {
      if (character === '"') {
        // `""` inside a quoted field is one literal quote — the RFC's only escape.
        if (text.charAt(index + 1) === '"') {
          field += '"'
          index += 2
        } else {
          quoted = false
          index += 1
        }
      } else {
        field += character
        index += 1
      }
      continue
    }

    if (character === '"' && field === '') {
      quoted = true
      index += 1
    } else if (character === delimiter) {
      row.push(field)
      field = ''
      index += 1
    } else if (character === '\r') {
      endRecord()
      index += text.charAt(index + 1) === '\n' ? 2 : 1
    } else if (character === '\n') {
      endRecord()
      index += 1
    } else {
      // Reached for a `"` that is not at the start of a field. Excel never writes
      // one; humans editing a file in Notepad do, and `5" Teller` is a plausible
      // catalogue line. Taken literally rather than treated as an error.
      field += character
      index += 1
    }
  }

  // A trailing newline leaves nothing pending, and must not become a phantom
  // empty row — a header detector counting rows would be off by one for every
  // file that ends the way every file ends.
  if (rows.length < limit && (field !== '' || row.length > 0 || quoted)) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function scoreDelimiter(text: string, delimiter: CsvDelimiter, sampleRows: number): number {
  const rows = parseRecords(text, delimiter, sampleRows).filter(
    (row) => row.length > 1 || (row[0] ?? '') !== '',
  )
  if (rows.length === 0) return 0

  const counts = new Map<number, number>()
  for (const row of rows) counts.set(row.length, (counts.get(row.length) ?? 0) + 1)

  let modalWidth = 0
  let modalRows = 0
  for (const [width, rowsAtWidth] of counts) {
    if (rowsAtWidth > modalRows || (rowsAtWidth === modalRows && width > modalWidth)) {
      modalWidth = width
      modalRows = rowsAtWidth
    }
  }
  // A delimiter that never splits anything has not been found, whatever its
  // consistency: every row being one field is perfectly consistent and useless.
  if (modalWidth < 2) return 0

  // Consistency dominates; width breaks ties, so `a;b;c` beats a comma that happens
  // to split the same rows into two. The width term is deliberately small — a
  // delimiter that shatters one row into fifteen fields must not outrank one that
  // splits every row into three.
  return (modalRows / rows.length) * 1 + Math.min(modalWidth, 20) / 1000
}

export function detectDelimiter(
  text: string,
  sampleRows: number = DEFAULT_SAMPLE_ROWS,
): { delimiter: CsvDelimiter; confidence: number } {
  let best: CsvDelimiter = ','
  let bestScore = 0

  for (const candidate of CSV_DELIMITERS) {
    const score = scoreDelimiter(text, candidate, sampleRows)
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }

  // Nothing split: a one-column file. The comma is reported because it is the
  // RFC's answer and because the confidence of 0 is the part a caller should read.
  if (bestScore === 0) return { delimiter: ',', confidence: 0 }
  return { delimiter: best, confidence: Math.min(bestScore, 1) }
}

export function parseCsv(input: string | Uint8Array, options: CsvOptions = {}): CsvDocument {
  const decoded =
    typeof input === 'string'
      ? { text: input.startsWith(BYTE_ORDER_MARK) ? input.slice(1) : input, hadByteOrderMark: input.startsWith(BYTE_ORDER_MARK) }
      : decodeCsvText(input)

  const sampleRows = options.sampleRows ?? DEFAULT_SAMPLE_ROWS
  const chosen = options.delimiter
    ? { delimiter: options.delimiter, confidence: 1 }
    : detectDelimiter(decoded.text, sampleRows)

  return {
    rows: parseRecords(decoded.text, chosen.delimiter, Number.POSITIVE_INFINITY),
    delimiter: chosen.delimiter,
    delimiterConfidence: chosen.confidence,
    hadByteOrderMark: decoded.hadByteOrderMark,
  }
}
