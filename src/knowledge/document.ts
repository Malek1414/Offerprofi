/**
 * Owner document intake.
 *
 * Only extracted text crosses this boundary. The uploaded binary exists in memory
 * for the duration of one request, is parsed, and is never written to disk or object
 * storage. Keeping that rule here makes the privacy claim inspectable in code.
 */

import { PDFParse } from 'pdf-parse'

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024
export const MAX_EXTRACTED_CHARACTERS = 400_000

export type SupportedDocumentMime = 'application/pdf' | 'text/plain'

export type DocumentProblem =
  | 'empty'
  | 'too_large'
  | 'unsupported_type'
  | 'invalid_text'
  | 'unreadable_pdf'
  | 'no_text'
  | 'too_much_text'

export type DocumentVerdict =
  | { ok: true; mime: SupportedDocumentMime; sourceName: string }
  | { ok: false; problem: DocumentProblem }

export class DocumentParseError extends Error {
  constructor(readonly problem: DocumentProblem) {
    super(problem)
    this.name = 'DocumentParseError'
  }
}

export function validateDocumentUpload(input: {
  filename: string
  declaredMime: string
  bytes: number
  head: Uint8Array
}): DocumentVerdict {
  if (input.bytes <= 0) return { ok: false, problem: 'empty' }
  if (input.bytes > MAX_DOCUMENT_BYTES) return { ok: false, problem: 'too_large' }

  const sourceName = safeSourceName(input.filename)
  const pdf = startsWith(input.head, [0x25, 0x50, 0x44, 0x46, 0x2d])
  if (pdf) return { ok: true, mime: 'application/pdf', sourceName }

  // Plain text has no useful magic bytes. Accept it only when both the declared
  // type or extension says text and its first bytes contain no NUL characters.
  const declaredText = input.declaredMime.toLowerCase().startsWith('text/plain')
  const namedText = sourceName.toLowerCase().endsWith('.txt')
  if ((declaredText || namedText) && !input.head.includes(0)) {
    return { ok: true, mime: 'text/plain', sourceName }
  }

  return { ok: false, problem: 'unsupported_type' }
}

export async function extractDocumentText(
  bytes: Uint8Array,
  mime: SupportedDocumentMime,
): Promise<string> {
  let raw: string

  if (mime === 'text/plain') {
    try {
      raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw new DocumentParseError('invalid_text')
    }
  } else {
    const parser = new PDFParse({ data: bytes })
    try {
      raw = (await parser.getText()).text
    } catch {
      throw new DocumentParseError('unreadable_pdf')
    } finally {
      await parser.destroy()
    }
  }

  const text = normaliseExtractedText(raw)
  if (!text) throw new DocumentParseError('no_text')
  if (text.length > MAX_EXTRACTED_CHARACTERS) {
    throw new DocumentParseError('too_much_text')
  }
  return text
}

export function normaliseExtractedText(text: string): string {
  return text
    .split(String.fromCharCode(0))
    .join('')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n[ ]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function safeSourceName(filename: string): string {
  const leaf = filename.split(/[\\/]/).pop() ?? ''
  const clean = Array.from(leaf)
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && code !== 127
    })
    .join('')
    .trim()
  return (clean || 'Angebot').slice(0, 180)
}

function startsWith(value: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((byte, index) => value[index] === byte)
}
