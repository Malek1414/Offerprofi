/**
 * Reading a workbook down to sheet names and rows of strings.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY EVERY CELL COMES BACK AS A STRING.
 *
 * The consumer is `headers.ts` and, after it, a prospect row: a business name, a
 * website, a city. Not one of those is a number. Handing back a discriminated union
 * of number | string | Date would push a type switch into every caller in exchange
 * for information no caller wants, and it would invite the one thing that must not
 * happen — a float round-trip through the parser. `18,50` typed into a German
 * Excel is stored as `18.5`; reading it into a JS number and printing it again is
 * lossless today and is exactly the habit that loses a trailing zero somewhere
 * downstream. The text of the `<v>` element is what Excel wrote, so the text of the
 * `<v>` element is what comes back.
 *
 * D6 is the other half of the reason: the model never does arithmetic and neither
 * does the importer. Nothing here computes; it transcribes.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DATES ARE CONVERTED, NOT PASSED THROUGH, AND THIS IS THE RISKIEST PART OF THE
 * FILE.
 *
 * A date in xlsx is not a date. It is a number — days since an epoch — that renders
 * as a date only because a *style* attached to the cell says so. `01.09.2026` on
 * screen is `46266` in the file. Passing the number through unread would be the
 * silent-wrong-value failure this module must not have: an import that turns every
 * event date into a five-digit integer, with nothing anywhere reporting a problem.
 *
 * So the styles part is read, the number-format of each cell style is resolved, and
 * a cell whose format is a date format is converted to ISO 8601. Three details are
 * load-bearing and each one is a real corpus of wrong software:
 *
 *   · **The 1900 leap-year bug.** Excel believes 1900 was a leap year, because
 *     Lotus 1-2-3 did and compatibility outlived the mistake. Serial 60 is
 *     "29 February 1900", a day that never happened. Every serial above it is
 *     therefore offset by one from a naive day count. Both branches are here, and
 *     serial 60 returns the literal string Excel displays rather than a real date —
 *     inventing 1900-03-01 for it would be quietly wrong.
 *   · **The 1904 date system.** Workbooks first saved by Excel for Mac before 2011
 *     count from 1904-01-01 instead. `workbookPr/@date1904` says which, and getting
 *     it wrong shifts every date in the file by 1,462 days.
 *   · **Fractions are times.** 0.5 is noon. A serial below 1 is a time with no date
 *     and comes back as `HH:MM:SS`, because printing `1899-12-31T12:00:00` for a
 *     cell that says `12:00` would be an invented date.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { attribute, attributesOf, localName, scanTags, unescapeXml } from './xml'
import { DEFAULT_ZIP_LIMITS, openZip, ZipError, type ZipLimits } from './zip'

export interface XlsxSheet {
  name: string
  /**
   * Ragged by design: a row is as wide as its last populated cell, and a row with
   * no cells at all is `[]`. Padding everything to the widest row would erase the
   * blank rows above a header, which is precisely the signal `headers.ts` uses to
   * find one.
   */
  rows: string[][]
}

export interface XlsxWorkbook {
  sheets: XlsxSheet[]
}

export interface XlsxOptions {
  zipLimits?: ZipLimits
  /**
   * A worksheet's row numbers are attacker-controlled: `<row r="1048576">` in a
   * two-kilobyte file asks for a million-element array. The gap-filling that makes
   * blank rows visible is what makes that possible, so it is bounded here.
   */
  maxRows?: number
  maxColumns?: number
}

const DEFAULT_MAX_ROWS = 200_000
const DEFAULT_MAX_COLUMNS = 4096

export class XlsxError extends Error {
  constructor(
    readonly problem: 'not_a_workbook' | 'too_many_rows' | 'too_many_columns',
    message: string,
  ) {
    super(message)
    this.name = 'XlsxError'
  }
}

/* ────────────────────────────── dates ────────────────────────────── */

/**
 * The built-in number formats that mean a date or a time.
 *
 * 14–22 are the western date and time formats; 45–47 are the elapsed-time ones.
 * 27–36 and 50–58 are the East Asian era formats and are deliberately absent: a
 * DACH prospect list will not contain one, and treating an unrecognised format as
 * "not a date" leaves a visible number rather than an invented day.
 */
const BUILT_IN_DATE_FORMATS: ReadonlySet<number> = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47,
])

/**
 * Whether a custom format code renders a date or a time.
 *
 * The test is "does a date or time token survive once the decoration is removed".
 * The removals matter more than the test: `#,##0.00 "Stück"` and `[$€-407]#,##0.00`
 * and `0.00\ €` all contain letters that would otherwise read as date tokens, and
 * every one of them is a currency column in a real German spreadsheet. Getting this
 * wrong turns a price into a day in 2026.
 */
function isDateFormatCode(code: string): boolean {
  const bare = code
    .replace(/"[^"]*"/g, '') // literal text
    .replace(/\\./g, '') // escaped single characters, e.g. `\.` and `\ `
    .replace(/\[[^\]]*\]/g, '') // colours, conditions, locale ids like [$-407]
    .replace(/_./g, '') // width placeholders
    .replace(/\*./g, '') // fill characters
  return /[ymdhs]/i.test(bare)
}

const DAY_MS = 86_400_000
const EPOCH_1900_EARLY = Date.UTC(1899, 11, 31)
const EPOCH_1900_LATE = Date.UTC(1899, 11, 30)
const EPOCH_1904 = Date.UTC(1904, 0, 1)

const pad = (value: number): string => String(value).padStart(2, '0')

export function serialToDateText(serial: number, date1904: boolean): string {
  if (!Number.isFinite(serial) || serial < 0) return String(serial)

  let days = Math.floor(serial)
  let seconds = Math.round((serial - days) * 86_400)
  if (seconds >= 86_400) {
    seconds -= 86_400
    days += 1
  }

  const time = `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`

  // Below one day there is no date, only a clock time. See the header comment.
  if (days === 0 && !date1904) return time

  if (!date1904 && days === 60) {
    // The day Lotus invented and Excel kept. It has no ISO representation because
    // it never existed; returning what the spreadsheet shows is the honest answer.
    return seconds === 0 ? '1900-02-29' : `1900-02-29T${time}`
  }

  const epoch = date1904 ? EPOCH_1904 : days < 60 ? EPOCH_1900_EARLY : EPOCH_1900_LATE
  const at = new Date(epoch + days * DAY_MS)
  const date = `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`
  return seconds === 0 ? date : `${date}T${time}`
}

/* ────────────────────────────── parts ────────────────────────────── */

/**
 * `sharedStrings.xml` is the string pool every text cell points into.
 *
 * A cell with `t="s"` holds an index, not text, which is why a workbook read
 * without this table produces a sheet full of small integers. An entry can be split
 * across several `<r>` runs when part of it is bold, so the runs are concatenated —
 * a business name typed with one bolded word is one name, not two cells.
 *
 * `<rPh>` is dropped: it holds furigana for Japanese text and is a *pronunciation
 * guide*, not content. Including it would append a phonetic gloss to the value.
 */
function readSharedStrings(xml: string): string[] {
  const strings: string[] = []
  let current: string[] | null = null
  let phonetic = false
  let textStart = -1

  for (const tag of scanTags(xml)) {
    const name = localName(tag.name)

    if (name === 'si') {
      if (tag.kind === 'open') current = []
      else if (tag.kind === 'self') strings.push('')
      else if (current) {
        strings.push(current.join(''))
        current = null
      }
      continue
    }
    if (name === 'rPh') {
      if (tag.kind === 'open') phonetic = true
      else if (tag.kind === 'close') phonetic = false
      continue
    }
    if (name === 't') {
      if (tag.kind === 'open') textStart = tag.end
      else if (tag.kind === 'close' && textStart >= 0) {
        if (current && !phonetic) current.push(unescapeXml(xml.slice(textStart, tag.start)))
        textStart = -1
      }
    }
  }
  return strings
}

/**
 * The set of cell-style indices that render as a date.
 *
 * One pass suffices because the schema fixes the order of the parts: `numFmts`
 * precedes `cellXfs`, so a custom format is always defined before the style that
 * uses it. The `cellXfs` guard is not optional — `<xf>` appears in `cellStyleXfs`
 * too, and counting both makes every index off by however many named styles the
 * workbook happens to define.
 */
function readDateStyles(xml: string): Set<number> {
  const customDateFormats = new Set<number>()
  const dateStyles = new Set<number>()
  let inCellXfs = false
  let styleIndex = 0

  for (const tag of scanTags(xml)) {
    const name = localName(tag.name)

    if (name === 'numFmt' && tag.kind !== 'close') {
      const attributes = attributesOf(tag.source)
      const id = Number(attribute(attributes, 'numFmtId'))
      const code = attribute(attributes, 'formatCode') ?? ''
      if (Number.isFinite(id) && isDateFormatCode(code)) customDateFormats.add(id)
      continue
    }
    if (name === 'cellXfs') {
      if (tag.kind === 'open') inCellXfs = true
      else if (tag.kind === 'close') inCellXfs = false
      continue
    }
    if (name === 'xf' && inCellXfs && tag.kind !== 'close') {
      const id = Number(attribute(attributesOf(tag.source), 'numFmtId') ?? '0')
      if (BUILT_IN_DATE_FORMATS.has(id) || customDateFormats.has(id)) dateStyles.add(styleIndex)
      styleIndex++
    }
  }
  return dateStyles
}

interface SheetRef {
  name: string
  relationshipId: string | undefined
}

function readWorkbookPart(xml: string): { sheets: SheetRef[]; date1904: boolean } {
  const sheets: SheetRef[] = []
  let date1904 = false

  for (const tag of scanTags(xml)) {
    const name = localName(tag.name)
    if (name === 'workbookPr' && tag.kind !== 'close') {
      const value = attribute(attributesOf(tag.source), 'date1904')
      date1904 = value === '1' || value === 'true'
      continue
    }
    if (name === 'sheet' && tag.kind !== 'close') {
      const attributes = attributesOf(tag.source)
      sheets.push({
        name: attribute(attributes, 'name') ?? `Tabelle${sheets.length + 1}`,
        relationshipId: attribute(attributes, 'id'),
      })
    }
  }
  return { sheets, date1904 }
}

function readRelationships(xml: string): Map<string, string> {
  const targets = new Map<string, string>()
  for (const tag of scanTags(xml)) {
    if (localName(tag.name) !== 'Relationship' || tag.kind === 'close') continue
    const attributes = attributesOf(tag.source)
    const id = attribute(attributes, 'Id')
    const target = attribute(attributes, 'Target')
    if (id && target) targets.set(id, target)
  }
  return targets
}

/** Relationship targets are relative to the part that declares them, or absolute. */
function resolvePart(target: string): string {
  const trimmed = target.replace(/^\.\//, '')
  return trimmed.startsWith('/') ? trimmed.slice(1) : `xl/${trimmed}`
}

/* ────────────────────────────── worksheet ────────────────────────────── */

/** `C` → 2, `AA` → 26. Returns null when the reference has no column letters. */
function columnIndexOf(reference: string): number | null {
  let index = 0
  let read = 0
  for (; read < reference.length; read++) {
    const code = reference.charCodeAt(read)
    if (code >= 65 && code <= 90) index = index * 26 + (code - 64)
    else if (code >= 97 && code <= 122) index = index * 26 + (code - 96)
    else break
  }
  return read === 0 ? null : index - 1
}

interface CellState {
  column: number
  type: string
  style: number
  value: string | null
  inline: string[]
}

function cellText(
  cell: CellState,
  shared: readonly string[],
  dateStyles: ReadonlySet<number>,
  date1904: boolean,
): string {
  switch (cell.type) {
    case 's': {
      const index = Number(cell.value)
      return Number.isInteger(index) ? (shared[index] ?? '') : ''
    }
    case 'inlineStr':
      return cell.inline.join('')
    case 'str':
      return cell.value ?? ''
    // Booleans are emitted uppercase and in English on purpose: they are a machine
    // value, and localising them here would mean the importer had to un-localise
    // them again. A German sheet showing WAHR stores `1`, not `WAHR`.
    case 'b':
      return cell.value === '1' ? 'TRUE' : 'FALSE'
    case 'e':
      return cell.value ?? ''
    // `t="d"` is already ISO 8601 in the file. Nothing to convert.
    case 'd':
      return cell.value ?? ''
    default: {
      if (cell.value === null) return ''
      if (cell.style >= 0 && dateStyles.has(cell.style)) {
        const serial = Number(cell.value)
        if (Number.isFinite(serial)) return serialToDateText(serial, date1904)
      }
      return cell.value
    }
  }
}

function readWorksheet(
  xml: string,
  shared: readonly string[],
  dateStyles: ReadonlySet<number>,
  date1904: boolean,
  maxRows: number,
  maxColumns: number,
): string[][] {
  const rows: Array<string[] | undefined> = []
  let row: string[] | null = null
  let rowNumber = 0
  let cell: CellState | null = null
  let textStart = -1
  let inInlineString = false

  const place = (text: string): void => {
    if (!row || !cell || cell.column < 0) return
    while (row.length <= cell.column) row.push('')
    row[cell.column] = text
  }

  for (const tag of scanTags(xml)) {
    const name = localName(tag.name)

    if (name === 'row') {
      if (tag.kind === 'close') {
        if (row) rows[rowNumber - 1] = row
        row = null
        continue
      }
      const declared = Number(attribute(attributesOf(tag.source), 'r'))
      rowNumber = Number.isInteger(declared) && declared > 0 ? declared : rowNumber + 1
      if (rowNumber > maxRows) {
        throw new XlsxError('too_many_rows', `worksheet declares row ${rowNumber}, limit is ${maxRows}`)
      }
      row = []
      cell = null
      if (tag.kind === 'self') {
        rows[rowNumber - 1] = row
        row = null
      }
      continue
    }

    if (name === 'c') {
      if (tag.kind === 'close') {
        if (cell) place(cellText(cell, shared, dateStyles, date1904))
        cell = null
        continue
      }
      const attributes = attributesOf(tag.source)
      const reference = attribute(attributes, 'r')
      // A missing `r` is legal — some writers omit it — and then position is
      // implied by order, which is why the previous column is carried forward.
      const column = reference ? columnIndexOf(reference) : null
      const next: number = column ?? (cell ? cell.column + 1 : row ? row.length : 0)
      if (next > maxColumns) {
        throw new XlsxError('too_many_columns', `worksheet reaches column ${next}, limit is ${maxColumns}`)
      }
      const styleAttribute = attribute(attributes, 's')
      cell = {
        column: next,
        type: attribute(attributes, 't') ?? 'n',
        style: styleAttribute === undefined ? -1 : Number(styleAttribute),
        value: null,
        inline: [],
      }
      if (tag.kind === 'self') {
        place('')
        // Kept, not nulled: an empty `<c r="D1"/>` still fixes where the next
        // reference-less cell sits.
      }
      continue
    }

    if (name === 'is') {
      if (tag.kind === 'open') inInlineString = true
      else if (tag.kind === 'close') inInlineString = false
      continue
    }

    if (name === 'v' && cell) {
      if (tag.kind === 'open') textStart = tag.end
      else if (tag.kind === 'close' && textStart >= 0) {
        cell.value = unescapeXml(xml.slice(textStart, tag.start))
        textStart = -1
      }
      continue
    }

    if (name === 't' && cell && inInlineString) {
      if (tag.kind === 'open') textStart = tag.end
      else if (tag.kind === 'close' && textStart >= 0) {
        cell.inline.push(unescapeXml(xml.slice(textStart, tag.start)))
        textStart = -1
      }
    }
  }

  const dense: string[][] = []
  for (let index = 0; index < rows.length; index++) {
    dense.push(rows[index] ?? [])
  }
  return dense
}

/* ────────────────────────────── entry point ────────────────────────────── */

export function readXlsx(bytes: Uint8Array, options: XlsxOptions = {}): XlsxWorkbook {
  const archive = openZip(bytes, options.zipLimits ?? DEFAULT_ZIP_LIMITS)
  if (!archive.has('xl/workbook.xml')) {
    throw new XlsxError('not_a_workbook', 'archive has no xl/workbook.xml')
  }

  const { sheets: sheetRefs, date1904 } = readWorkbookPart(archive.readText('xl/workbook.xml'))
  const relationships = archive.has('xl/_rels/workbook.xml.rels')
    ? readRelationships(archive.readText('xl/_rels/workbook.xml.rels'))
    : new Map<string, string>()
  const shared = archive.has('xl/sharedStrings.xml')
    ? readSharedStrings(archive.readText('xl/sharedStrings.xml'))
    : []
  const dateStyles = archive.has('xl/styles.xml')
    ? readDateStyles(archive.readText('xl/styles.xml'))
    : new Set<number>()

  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS
  const maxColumns = options.maxColumns ?? DEFAULT_MAX_COLUMNS

  const sheets: XlsxSheet[] = []
  sheetRefs.forEach((reference, position) => {
    const target = reference.relationshipId ? relationships.get(reference.relationshipId) : undefined
    // The positional fallback covers workbooks written without relationships, which
    // are rare from Excel and common from generators. An unreadable sheet becomes an
    // empty sheet rather than a failed import: one broken tab must not cost the
    // eleven good ones, and an empty sheet is visible in the mapping step.
    const part = target ? resolvePart(target) : `xl/worksheets/sheet${position + 1}.xml`
    let rows: string[][] = []
    if (archive.has(part)) {
      rows = readWorksheet(archive.readText(part), shared, dateStyles, date1904, maxRows, maxColumns)
    }
    sheets.push({ name: reference.name, rows })
  })

  return { sheets }
}

/** Sheet names without inflating a single worksheet. */
export function xlsxSheetNames(bytes: Uint8Array, options: XlsxOptions = {}): string[] {
  const archive = openZip(bytes, options.zipLimits ?? DEFAULT_ZIP_LIMITS)
  if (!archive.has('xl/workbook.xml')) {
    throw new XlsxError('not_a_workbook', 'archive has no xl/workbook.xml')
  }
  return readWorkbookPart(archive.readText('xl/workbook.xml')).sheets.map((sheet) => sheet.name)
}

export { ZipError }
