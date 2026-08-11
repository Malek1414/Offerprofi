/**
 * Text out of a .docx, with tables still shaped like tables.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY TABLE STRUCTURE IS PRESERVED RATHER THAN FLATTENED.
 *
 * EXECUTION_HANDOFF §6 B2 routes `.docx` to "text extraction, then the model reads
 * table structure". Reading the structure out of the file is strictly better than
 * asking a model to recover it from flattened text, and the reason is the one in
 * CLAUDE.md §7: determinism where it is cheap. The `w:tbl` / `w:tr` / `w:tc` nesting
 * *is* the table. Collapsing it into lines and asking a model to find the row
 * boundaries again converts a fact into an inference — one that fails exactly where
 * it matters most, on a cell containing a line break or an empty cell that silently
 * closes the gap and shifts every subsequent column by one.
 *
 * So a table comes back as `string[][]` and a paragraph comes back as a line, and
 * the model's job shrinks to reading the *contents*, which is a job it is good at.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Two limits worth stating rather than discovering:
 *
 *   · **A nested table is flattened into the cell that contains it.** Word allows
 *     arbitrary nesting; a `string[][]` does not express it. The inner table's rows
 *     become tab-separated lines inside the outer cell, so no text is lost and the
 *     outer grid stays rectangular. A prospect list with a table inside a table cell
 *     is not a thing anyone has produced.
 *   · **Only `word/document.xml` is read.** Headers, footers, footnotes, comments
 *     and text boxes live in their own parts and are not visited. A business list
 *     with its data in a header does not exist; a document whose *letterhead* is in
 *     one is normal, and pulling it in would put an agency's own address at the top
 *     of every extraction.
 *
 * Field codes — `w:instrText` — are not read either. That is where a hyperlink's
 * target URL lives, and it is also where `INCLUDETEXT` and `DDEAUTO` live. The
 * hyperlink's *visible* text is in `w:t` and is captured; the instruction stream is
 * not content and is not treated as any.
 */

import { attributesOf, localName, scanTags, unescapeXml } from './xml'
import { DEFAULT_ZIP_LIMITS, openZip, type ZipLimits } from './zip'

export type DocxBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'table'; rows: string[][] }

export interface DocxDocument {
  blocks: DocxBlock[]
  /** Every block as lines; a table row becomes its cells joined by tabs. */
  text: string
}

export class DocxError extends Error {
  constructor(
    readonly problem: 'not_a_document',
    message: string,
  ) {
    super(message)
    this.name = 'DocxError'
  }
}

export interface DocxOptions {
  zipLimits?: ZipLimits
}

const DOCUMENT_PART = 'word/document.xml'

function renderTable(rows: readonly string[][]): string {
  return rows.map((row) => row.join('\t')).join('\n')
}

interface OpenTable {
  rows: string[][]
  row: string[] | null
}

export function readDocxXml(xml: string): DocxDocument {
  const blocks: DocxBlock[] = []
  const tables: OpenTable[] = []
  /** Paragraph buffers for each open `w:tc`, innermost last. */
  const cells: string[][] = []
  let paragraph: string[] | null = null
  let textStart = -1
  /**
   * Run depth exists to keep `w:pPr` out of the output. `<w:tab/>` inside a run is
   * a tab character; the identically-named element inside `w:pPr/w:tabs` is a
   * tab-stop *definition*, one per stop, and honouring those would prepend a row of
   * stray tabs to every indented paragraph in the document.
   */
  let runDepth = 0

  const emitParagraph = (text: string): void => {
    const innermostCell = cells[cells.length - 1]
    if (innermostCell) innermostCell.push(text)
    else blocks.push({ kind: 'paragraph', text })
  }

  for (const tag of scanTags(xml)) {
    const name = localName(tag.name)

    switch (name) {
      case 'tbl': {
        if (tag.kind === 'open') tables.push({ rows: [], row: null })
        else if (tag.kind === 'close') {
          const table = tables.pop()
          if (!table) break
          const innermostCell = cells[cells.length - 1]
          if (innermostCell) innermostCell.push(renderTable(table.rows))
          else blocks.push({ kind: 'table', rows: table.rows })
        }
        break
      }
      case 'tr': {
        const table = tables[tables.length - 1]
        if (!table) break
        if (tag.kind === 'open') table.row = []
        else if (tag.kind === 'close') {
          table.rows.push(table.row ?? [])
          table.row = null
        }
        break
      }
      case 'tc': {
        if (tag.kind === 'open') cells.push([])
        else if (tag.kind === 'close') {
          const finished = cells.pop() ?? []
          const table = tables[tables.length - 1]
          // A cell holds paragraphs; a paragraph break inside one is a line break,
          // not a new cell.
          table?.row?.push(finished.join('\n'))
        }
        break
      }
      case 'p': {
        if (tag.kind === 'open') paragraph = []
        else if (tag.kind === 'close' && paragraph) {
          emitParagraph(paragraph.join(''))
          paragraph = null
        } else if (tag.kind === 'self') {
          emitParagraph('')
        }
        break
      }
      case 'r': {
        if (tag.kind === 'open') runDepth++
        else if (tag.kind === 'close') runDepth = Math.max(0, runDepth - 1)
        break
      }
      case 'tab': {
        if (runDepth > 0 && paragraph) paragraph.push('\t')
        break
      }
      case 'br':
      case 'cr': {
        if (runDepth > 0 && paragraph) paragraph.push('\n')
        break
      }
      case 't': {
        if (runDepth === 0) break
        if (tag.kind === 'open') textStart = tag.end
        else if (tag.kind === 'self') {
          // `<w:t/>` with no content. Nothing to add, but it must not leave a
          // stale start index behind for the next real run to pick up.
          textStart = -1
        } else if (tag.kind === 'close' && textStart >= 0) {
          // `xml:space="preserve"` is Word's marker for significant whitespace and
          // is why nothing here trims: it is set on exactly the runs where a
          // leading space is part of the sentence.
          paragraph?.push(unescapeXml(xml.slice(textStart, tag.start)))
          textStart = -1
        }
        break
      }
      case 'noBreakHyphen': {
        if (runDepth > 0 && paragraph) paragraph.push('-')
        break
      }
      case 'sym': {
        if (runDepth > 0 && paragraph) {
          const code = attributesOf(tag.source)['w:char']
          const point = code ? Number.parseInt(code, 16) : Number.NaN
          // Symbol-font characters land in the private use area, where the glyph
          // depends on a font we do not have. A dingbat rendered as a wrong letter
          // inside a business name is worse than a gap.
          if (Number.isFinite(point) && point >= 0x20 && point < 0xe000) {
            paragraph.push(String.fromCodePoint(point))
          }
        }
        break
      }
      default:
        break
    }
  }

  const text = blocks
    .map((block) => (block.kind === 'paragraph' ? block.text : renderTable(block.rows)))
    .join('\n')

  return { blocks, text }
}

export function readDocx(bytes: Uint8Array, options: DocxOptions = {}): DocxDocument {
  const archive = openZip(bytes, options.zipLimits ?? DEFAULT_ZIP_LIMITS)
  if (!archive.has(DOCUMENT_PART)) {
    throw new DocxError('not_a_document', `archive has no ${DOCUMENT_PART}`)
  }
  return readDocxXml(archive.readText(DOCUMENT_PART))
}
