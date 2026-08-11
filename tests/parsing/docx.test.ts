/**
 * A .docx is the same container as an .xlsx with different parts inside, so the
 * fixture is built the same way — no binary checked in, and the markup under test
 * visible in the diff.
 *
 * The case that carries weight is the table. B2 hands `.docx` to a model to read
 * table structure; this module hands the model a table that is already a table, and
 * the assertion that matters is that an *empty* cell survives. A flattening
 * extractor drops it, every column after it shifts left by one, and the model reads
 * a grid that is wrong in a way it has no way to detect.
 */

import { describe, expect, it } from 'vitest'

import { readDocx, readDocxXml } from '../../src/parsing/docx'
import { buildZip } from './make-zip'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

const document = (body: string): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`

const buildDocx = (body: string): Uint8Array =>
  buildZip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'word/document.xml', data: document(body) },
  ])

const paragraph = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
const cell = (text: string): string => `<w:tc><w:tcPr/>${text ? paragraph(text) : '<w:p/>'}</w:tc>`
const row = (cells: readonly string[]): string => `<w:tr>${cells.map(cell).join('')}</w:tr>`

describe('readDocx', () => {
  it('turns each paragraph into a line', () => {
    const parsed = readDocx(
      buildDocx(paragraph('Anbieterliste Berlin') + paragraph('Stand: August 2026')),
    )

    expect(parsed.blocks).toEqual([
      { kind: 'paragraph', text: 'Anbieterliste Berlin' },
      { kind: 'paragraph', text: 'Stand: August 2026' },
    ])
    expect(parsed.text).toBe('Anbieterliste Berlin\nStand: August 2026')
  })

  it('joins the runs of one paragraph, because formatting is not a line break', () => {
    const parsed = readDocxXml(
      document(
        '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Café</w:t></w:r><w:r><w:t xml:space="preserve"> Kranzler</w:t></w:r></w:p>',
      ),
    )

    expect(parsed.blocks).toEqual([{ kind: 'paragraph', text: 'Café Kranzler' }])
  })

  it('keeps a table as rows and cells, including the empty ones', () => {
    const parsed = readDocx(
      buildDocx(
        `<w:tbl>${row(['Firma', 'Ort', 'Webseite'])}${row(['Café Kranzler', '', 'kranzler.example'])}</w:tbl>`,
      ),
    )

    expect(parsed.blocks).toEqual([
      {
        kind: 'table',
        rows: [
          ['Firma', 'Ort', 'Webseite'],
          ['Café Kranzler', '', 'kranzler.example'],
        ],
      },
    ])
  })

  it('keeps a multi-paragraph cell as one cell with a line break in it', () => {
    const parsed = readDocxXml(
      document(`<w:tbl><w:tr><w:tc>${paragraph('Café Kranzler')}${paragraph('Berlin')}</w:tc></w:tr></w:tbl>`),
    )

    expect(parsed.blocks).toEqual([{ kind: 'table', rows: [['Café Kranzler\nBerlin']] }])
  })

  it('flattens a nested table into the cell holding it, keeping the outer grid rectangular', () => {
    const inner = `<w:tbl>${row(['a', 'b'])}</w:tbl>`
    const parsed = readDocxXml(
      document(`<w:tbl><w:tr><w:tc>${inner}</w:tc>${cell('Berlin')}</w:tr></w:tbl>`),
    )

    expect(parsed.blocks).toEqual([{ kind: 'table', rows: [['a\tb', 'Berlin']] }])
  })

  it('reads tabs and breaks inside a run as the characters they are', () => {
    const parsed = readDocxXml(
      document('<w:p><w:r><w:t>Firma</w:t><w:tab/><w:t>Ort</w:t><w:br/><w:t>Berlin</w:t></w:r></w:p>'),
    )

    expect(parsed.blocks).toEqual([{ kind: 'paragraph', text: 'Firma\tOrt\nBerlin' }])
  })

  it('does not mistake a tab-stop definition for a tab character', () => {
    // `<w:tab/>` inside `w:pPr/w:tabs` is a ruler setting, one element per stop.
    // Read as content it prepends a run of tabs to every indented paragraph.
    const parsed = readDocxXml(
      document(
        '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/><w:tab w:val="left" w:pos="1440"/></w:tabs></w:pPr>' +
          '<w:r><w:t>Café Kranzler</w:t></w:r></w:p>',
      ),
    )

    expect(parsed.blocks).toEqual([{ kind: 'paragraph', text: 'Café Kranzler' }])
  })

  it('decodes entities rather than handing an escaped ampersand downstream', () => {
    const parsed = readDocxXml(document(paragraph('M&#252;ller &amp; Schmidt GbR')))

    expect(parsed.blocks).toEqual([{ kind: 'paragraph', text: 'Müller & Schmidt GbR' }])
  })

  it('ignores field instructions, which are not content', () => {
    // `w:instrText` is where a hyperlink's target lives, and also where
    // INCLUDETEXT and DDEAUTO live. The visible text is in `w:t` and is kept.
    const parsed = readDocxXml(
      document(
        '<w:p><w:r><w:instrText> HYPERLINK "https://evil.example" </w:instrText></w:r>' +
          '<w:r><w:t>Kranzler</w:t></w:r></w:p>',
      ),
    )

    expect(parsed.blocks).toEqual([{ kind: 'paragraph', text: 'Kranzler' }])
    expect(parsed.text).not.toContain('evil.example')
  })

  it('refuses an archive with no document part', () => {
    expect(() => readDocx(buildZip([{ name: 'word/settings.xml', data: '<x/>' }]))).toThrow(
      /word\/document\.xml/,
    )
  })
})
