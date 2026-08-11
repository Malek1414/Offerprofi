/**
 * A workbook assembled from the parts Excel writes, at the level the reader reads.
 *
 * The worksheet XML is passed through verbatim rather than generated from a grid,
 * because the cases worth testing are exactly the ones a grid abstraction would
 * paper over: a row that skips a column reference, a row number that jumps, a cell
 * with a style index and no visible date anywhere. Those are properties of the
 * markup, so the tests state them as markup.
 */

import { buildZip, type ZipFileSpec } from './make-zip'

export interface XlsxSpec {
  sheets: ReadonlyArray<{ name: string; xml: string }>
  /** Entries of the string pool, in index order. */
  sharedStrings?: readonly string[]
  /** Raw `sharedStrings.xml`, when the pool itself is what is under test. */
  sharedStringsXml?: string
  /** Raw `styles.xml`. Omitted means no cell has a date format. */
  stylesXml?: string
  date1904?: boolean
  /** Drops `workbook.xml.rels`, exercising the positional fallback. */
  omitRelationships?: boolean
}

const escape = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const RELS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

export function sharedStringsXml(strings: readonly string[]): string {
  const items = strings.map((value) => `<si><t>${escape(value)}</t></si>`).join('')
  return `${DECLARATION}<sst xmlns="${MAIN}" count="${strings.length}" uniqueCount="${strings.length}">${items}</sst>`
}

/**
 * The minimum styles part that puts a date format at a known index.
 *
 * Index 0 is General, so a cell with no `s` attribute or `s="0"` is a plain number.
 * Index 1 uses built-in format 14 (`m/d/yyyy`) and index 2 a custom German
 * `dd.mm.yyyy`, which is what a DACH spreadsheet actually carries.
 */
export const DATE_STYLES_XML = `${DECLARATION}<styleSheet xmlns="${MAIN}">
<numFmts count="2"><numFmt numFmtId="164" formatCode="dd\\.mm\\.yyyy"/><numFmt numFmtId="165" formatCode="#,##0.00\\ &quot;€&quot;"/></numFmts>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
<xf numFmtId="14" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>
</cellXfs></styleSheet>`

export function worksheetXml(body: string): string {
  return `${DECLARATION}<worksheet xmlns="${MAIN}" xmlns:r="${RELS}"><sheetData>${body}</sheetData></worksheet>`
}

export function buildXlsx(spec: XlsxSpec): Uint8Array {
  const sheetEntries: ZipFileSpec[] = spec.sheets.map((sheet, index) => ({
    name: `xl/worksheets/sheet${index + 1}.xml`,
    data: sheet.xml,
  }))

  const sheetTags = spec.sheets
    .map((sheet, index) => `<sheet name="${escape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join('')

  const workbook =
    `${DECLARATION}<workbook xmlns="${MAIN}" xmlns:r="${RELS}">` +
    (spec.date1904 ? '<workbookPr date1904="1"/>' : '<workbookPr/>') +
    `<sheets>${sheetTags}</sheets></workbook>`

  const relationships =
    `${DECLARATION}<Relationships xmlns="${RELS}/relationships">` +
    spec.sheets
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 1}" Type="${RELS}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
      )
      .join('') +
    '</Relationships>'

  const files: ZipFileSpec[] = [
    {
      name: '[Content_Types].xml',
      data: `${DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
    },
    { name: 'xl/workbook.xml', data: workbook },
    ...sheetEntries,
  ]

  if (!spec.omitRelationships) {
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: relationships })
  }
  const pool = spec.sharedStringsXml ?? (spec.sharedStrings ? sharedStringsXml(spec.sharedStrings) : undefined)
  if (pool !== undefined) files.push({ name: 'xl/sharedStrings.xml', data: pool })
  if (spec.stylesXml !== undefined) files.push({ name: 'xl/styles.xml', data: spec.stylesXml })

  return buildZip(files)
}
