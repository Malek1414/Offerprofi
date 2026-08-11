/**
 * A spreadsheet does not store what it shows.
 *
 * Every case here is a gap between the two. Text cells hold an *index* into a pool
 * and read as small integers without it. A row that skips column B has no B element
 * at all, so a reader that takes cells in order shifts every value left of the gap.
 * A date is a number. A number that reads `18,50` on a German screen is `18.5` in
 * the file. Each of those, got wrong, produces an import that succeeds and is wrong
 * — which is the only failure mode this module is not allowed to have, because the
 * owner confirming a column mapping cannot see any of it.
 */

import { describe, expect, it } from 'vitest'

import { readXlsx, serialToDateText, xlsxSheetNames } from '../../src/parsing/xlsx'
import { buildXlsx, DATE_STYLES_XML, worksheetXml } from './make-xlsx'

describe('readXlsx — the shared string pool', () => {
  it('resolves shared strings instead of returning their indices', () => {
    const workbook = readXlsx(
      buildXlsx({
        sharedStrings: ['Firma', 'Ort', 'Café Kranzler', 'Berlin'],
        sheets: [
          {
            name: 'Leads',
            xml: worksheetXml(
              '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
                '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>',
            ),
          },
        ],
      }),
    )

    expect(workbook.sheets[0]?.rows).toEqual([
      ['Firma', 'Ort'],
      ['Café Kranzler', 'Berlin'],
    ])
  })

  it('joins the runs of a part-formatted string back into one value', () => {
    // Bolding one word splits the entry into several `<r>` runs. A business name
    // with a bold first word is one name.
    const workbook = readXlsx(
      buildXlsx({
        sharedStringsXml:
          '<sst><si><r><rPr><b/></rPr><t>Café</t></r><r><t xml:space="preserve"> Kranzler</t></r></si></sst>',
        sheets: [{ name: 'Leads', xml: worksheetXml('<row r="1"><c r="A1" t="s"><v>0</v></c></row>') }],
      }),
    )

    expect(workbook.sheets[0]?.rows[0]).toEqual(['Café Kranzler'])
  })

  it('drops the phonetic gloss rather than appending it to the value', () => {
    const workbook = readXlsx(
      buildXlsx({
        sharedStringsXml: '<sst><si><t>Berlin</t><rPh sb="0" eb="6"><t>ベルリン</t></rPh></si></sst>',
        sheets: [{ name: 'Leads', xml: worksheetXml('<row r="1"><c r="A1" t="s"><v>0</v></c></row>') }],
      }),
    )

    expect(workbook.sheets[0]?.rows[0]).toEqual(['Berlin'])
  })

  it('reads an inline string, which is what a cell carries when there is no pool', () => {
    const workbook = readXlsx(
      buildXlsx({
        sheets: [
          {
            name: 'Leads',
            xml: worksheetXml('<row r="1"><c r="A1" t="inlineStr"><is><t>Firma</t></is></c></row>'),
          },
        ],
      }),
    )

    expect(workbook.sheets[0]?.rows[0]).toEqual(['Firma'])
  })
})

describe('readXlsx — sparseness', () => {
  it('fills the gap when a row skips a column', () => {
    // `A1` and `C1` with no `B1`. Taking cells in order would put the C value in B.
    const workbook = readXlsx(
      buildXlsx({
        sharedStrings: ['Firma', 'Ort'],
        sheets: [
          {
            name: 'Leads',
            xml: worksheetXml('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>'),
          },
        ],
      }),
    )

    expect(workbook.sheets[0]?.rows[0]).toEqual(['Firma', '', 'Ort'])
  })

  it('keeps a skipped row as a blank row, because a blank row is a signal', () => {
    // The gap between a title row and a header row is how `headers.ts` finds the
    // header. Collapsing rows 1 and 3 into two adjacent rows deletes that.
    const workbook = readXlsx(
      buildXlsx({
        sharedStrings: ['Leads Berlin', 'Firma'],
        sheets: [
          {
            name: 'Leads',
            xml: worksheetXml(
              '<row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="3"><c r="A3" t="s"><v>1</v></c></row>',
            ),
          },
        ],
      }),
    )

    expect(workbook.sheets[0]?.rows).toEqual([['Leads Berlin'], [], ['Firma']])
  })

  it('follows the cell reference rather than the cell order', () => {
    const workbook = readXlsx(
      buildXlsx({
        sharedStrings: ['spät', 'früh'],
        sheets: [
          {
            name: 'Leads',
            // Deliberately written out of order, which the format permits.
            xml: worksheetXml('<row r="1"><c r="B1" t="s"><v>0</v></c><c r="A1" t="s"><v>1</v></c></row>'),
          },
        ],
      }),
    )

    expect(workbook.sheets[0]?.rows[0]).toEqual(['früh', 'spät'])
  })

  it('refuses a row number that would allocate an array nobody asked for', () => {
    const bomb = buildXlsx({
      sheets: [{ name: 'Leads', xml: worksheetXml('<row r="1048576"><c r="A1048576"><v>1</v></c></row>') }],
    })

    expect(() => readXlsx(bomb, { maxRows: 1000 })).toThrow(/too many rows|limit is 1000/i)
  })
})

describe('readXlsx — numbers and dates', () => {
  it('returns a number as the text the file holds, with no round trip through a float', () => {
    const workbook = readXlsx(
      buildXlsx({
        stylesXml: DATE_STYLES_XML,
        sheets: [
          {
            name: 'Preise',
            // `18,50` typed into a German Excel, and a currency format on top of it.
            xml: worksheetXml('<row r="1"><c r="A1" s="3"><v>18.5</v></c><c r="B1"><v>1200</v></c></row>'),
          },
        ],
      }),
    )

    expect(workbook.sheets[0]?.rows[0]).toEqual(['18.5', '1200'])
  })

  it('converts a serial number to a date when the cell style says it is one', () => {
    const workbook = readXlsx(
      buildXlsx({
        stylesXml: DATE_STYLES_XML,
        sheets: [
          {
            name: 'Termine',
            xml: worksheetXml(
              // s="1" is built-in format 14; s="2" is the custom dd.mm.yyyy;
              // s="0" is General, so the same number stays a number.
              '<row r="1"><c r="A1" s="1"><v>46266</v></c><c r="B1" s="2"><v>46266</v></c><c r="C1" s="0"><v>46266</v></c></row>',
            ),
          },
        ],
      }),
    )

    expect(workbook.sheets[0]?.rows[0]).toEqual(['2026-09-01', '2026-09-01', '46266'])
  })

  it('does not treat a currency format as a date', () => {
    // `#,##0.00 "€"` contains no date token once the literal is removed. Reading it
    // as one would turn every price in the file into a day.
    const workbook = readXlsx(
      buildXlsx({
        stylesXml: DATE_STYLES_XML,
        sheets: [{ name: 'Preise', xml: worksheetXml('<row r="1"><c r="A1" s="3"><v>46266</v></c></row>') }],
      }),
    )

    expect(workbook.sheets[0]?.rows[0]).toEqual(['46266'])
  })

  it('shifts every date when the workbook uses the 1904 system, because Excel does', () => {
    const spec = {
      stylesXml: DATE_STYLES_XML,
      sheets: [{ name: 'Termine', xml: worksheetXml('<row r="1"><c r="A1" s="1"><v>46266</v></c></row>') }],
    }

    expect(readXlsx(buildXlsx(spec)).sheets[0]?.rows[0]).toEqual(['2026-09-01'])
    expect(readXlsx(buildXlsx({ ...spec, date1904: true })).sheets[0]?.rows[0]).toEqual(['2030-09-02'])
  })
})

describe('serialToDateText', () => {
  it('accounts for the leap year 1900 did not have', () => {
    // Serial 59 is 28 Feb 1900. Serial 61 is 1 Mar 1900. Serial 60 is the day Lotus
    // invented, which Excel still shows and which has no ISO form.
    expect(serialToDateText(59, false)).toBe('1900-02-28')
    expect(serialToDateText(60, false)).toBe('1900-02-29')
    expect(serialToDateText(61, false)).toBe('1900-03-01')
  })

  it('keeps a time as a time rather than inventing a date for it', () => {
    expect(serialToDateText(0.5, false)).toBe('12:00:00')
    expect(serialToDateText(0.75, false)).toBe('18:00:00')
  })

  it('emits a full timestamp when a serial has both halves', () => {
    expect(serialToDateText(46266.5, false)).toBe('2026-09-01T12:00:00')
  })
})

describe('readXlsx — the workbook', () => {
  it('lists sheet names in workbook order without inflating a worksheet', () => {
    const bytes = buildXlsx({
      sheets: [
        { name: 'Leads Berlin', xml: worksheetXml('') },
        { name: 'Notizen', xml: worksheetXml('') },
      ],
    })

    expect(xlsxSheetNames(bytes)).toEqual(['Leads Berlin', 'Notizen'])
  })

  it('falls back to sheet position when the workbook carries no relationships', () => {
    const bytes = buildXlsx({
      omitRelationships: true,
      sharedStrings: ['Firma'],
      sheets: [{ name: 'Leads', xml: worksheetXml('<row r="1"><c r="A1" t="s"><v>0</v></c></row>') }],
    })

    expect(readXlsx(bytes).sheets[0]?.rows[0]).toEqual(['Firma'])
  })

  it('refuses an archive that is not a workbook', () => {
    expect(() => readXlsx(new TextEncoder().encode('Firma;Ort'))).toThrow()
  })
})
