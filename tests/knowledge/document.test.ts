import { describe, expect, it } from 'vitest'

import {
  DocumentParseError,
  extractDocumentText,
  normaliseExtractedText,
  safeSourceName,
  validateDocumentUpload,
} from '../../src/knowledge/document'

describe('owner document intake', () => {
  it('trusts PDF magic bytes rather than a browser-supplied MIME type', () => {
    expect(
      validateDocumentUpload({
        filename: 'angebot.bin',
        declaredMime: 'application/octet-stream',
        bytes: 20,
        head: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]),
      }),
    ).toEqual({ ok: true, mime: 'application/pdf', sourceName: 'angebot.bin' })
  })

  it('accepts UTF-8 text candidates and rejects binary data renamed to txt', () => {
    expect(
      validateDocumentUpload({
        filename: 'angebot.txt',
        declaredMime: 'text/plain',
        bytes: 10,
        head: new TextEncoder().encode('Menü 2026'),
      }).ok,
    ).toBe(true)

    expect(
      validateDocumentUpload({
        filename: 'angebot.txt',
        declaredMime: 'text/plain',
        bytes: 4,
        head: new Uint8Array([1, 0, 2, 3]),
      }),
    ).toEqual({ ok: false, problem: 'unsupported_type' })
  })

  it('normalises extracted text without changing its words or figures', async () => {
    const bytes = new TextEncoder().encode('  Menü\r\n\r\n\r\n  80 Gäste\t  72 €  ')
    await expect(extractDocumentText(bytes, 'text/plain')).resolves.toBe('Menü\n\n80 Gäste 72 €')
    expect(normaliseExtractedText('A\u0000\n\n\nB')).toBe('A\n\nB')
  })

  it('extracts selectable text from a real PDF byte stream', async () => {
    await expect(extractDocumentText(minimalPdf('Menue 2026'), 'application/pdf')).resolves.toContain(
      'Menue 2026',
    )
  })

  it('rejects invalid UTF-8 instead of silently replacing bytes', async () => {
    await expect(extractDocumentText(new Uint8Array([0xff]), 'text/plain')).rejects.toMatchObject({
      problem: 'invalid_text',
    } satisfies Partial<DocumentParseError>)
  })

  it('keeps only a safe, bounded source filename', () => {
    expect(safeSourceName('../../Kunde\u0000 Angebot.pdf')).toBe('Kunde Angebot.pdf')
    expect(safeSourceName('')).toBe('Angebot')
  })
})

function minimalPdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 72 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(new TextEncoder().encode(pdf).length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xrefOffset = new TextEncoder().encode(pdf).length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return new TextEncoder().encode(pdf)
}
