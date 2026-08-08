/**
 * F1.10 — uploads.
 *
 * Acceptance: "An unscanned file never reaches a parser."
 */

import { describe, expect, it } from 'vitest'

import {
  MAX_FILES_PER_INQUIRY,
  MAX_FILE_BYTES,
  assertScanned,
  evaluateUpload,
  mayParse,
  parsableAttachments,
  sniffMime,
} from '../../src/chat/uploads'

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])
const NONSENSE = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07])

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

describe('F1.10 — content sniffing', () => {
  it('identifies real files by their leading bytes', () => {
    expect(sniffMime(PDF).mime).toBe('application/pdf')
    expect(sniffMime(PNG).mime).toBe('image/png')
    expect(sniffMime(JPEG).mime).toBe('image/jpeg')
  })

  it('believes the bytes, not the declared type', () => {
    // The classic upload attack: a PDF parser handed something that is not a PDF,
    // because Content-Type said so. Content-Type is attacker-controlled.
    const result = sniffMime(PNG, 'application/pdf')
    expect(result.mime).toBe('image/png')
    expect(result.mismatch).toBe(true)
  })

  it('believes the bytes, not the file extension', () => {
    // "Angebot.pdf" containing PNG bytes is a PNG.
    expect(sniffMime(PNG, 'application/pdf').kind).toBe('image')
  })

  it('uses the declared type only to tell a docx from a plain zip', () => {
    // They are byte-identical at the front, so the declaration is the only signal
    // — and it is used only here, never to override a positive sniff.
    expect(sniffMime(ZIP, DOCX).mime).toBe(DOCX)
    expect(sniffMime(ZIP, null).mime).toBe('application/zip')
  })

  it('does not trust the declaration for an unrecognised file', () => {
    const result = sniffMime(NONSENSE, 'application/pdf')
    expect(result.mime).toBe('application/octet-stream')
    expect(result.kind).toBe('other')
  })

  it('does not read past the end of a very short file', () => {
    expect(() => sniffMime(new Uint8Array([0x25]))).not.toThrow()
    expect(() => sniffMime(new Uint8Array([]))).not.toThrow()
  })
})

describe('F1.10 — limits', () => {
  const base = { filename: 'Briefing.pdf', declaredMime: 'application/pdf', head: PDF }

  it('accepts an ordinary venue PDF', () => {
    const verdict = evaluateUpload({ ...base, bytes: 1_400_000, existingCount: 0 })
    expect(verdict.accepted).toBe(true)
    expect(verdict.reasonCode).toBe('ok')
  })

  it('rejects a file over 25 MB', () => {
    const verdict = evaluateUpload({ ...base, bytes: MAX_FILE_BYTES + 1, existingCount: 0 })
    expect(verdict.accepted).toBe(false)
    expect(verdict.reasonCode).toBe('too_large')
  })

  it('accepts a file exactly at the limit', () => {
    expect(evaluateUpload({ ...base, bytes: MAX_FILE_BYTES, existingCount: 0 }).accepted).toBe(true)
  })

  it('rejects the eleventh file on an inquiry', () => {
    const verdict = evaluateUpload({
      ...base,
      bytes: 1000,
      existingCount: MAX_FILES_PER_INQUIRY,
    })
    expect(verdict.reasonCode).toBe('too_many')
  })

  it('rejects an empty file', () => {
    expect(evaluateUpload({ ...base, bytes: 0, existingCount: 0 }).reasonCode).toBe('empty')
  })

  it('rejects a file whose type we cannot identify', () => {
    const verdict = evaluateUpload({
      filename: 'thing.pdf',
      declaredMime: 'application/pdf',
      head: NONSENSE,
      bytes: 500,
      existingCount: 0,
    })
    expect(verdict.accepted).toBe(false)
    expect(verdict.reasonCode).toBe('unsupported_type')
  })

  it('returns a reason code, never prose — the UI localises it', () => {
    const verdict = evaluateUpload({ ...base, bytes: MAX_FILE_BYTES + 1, existingCount: 0 })
    // A German customer must not be shown an English sentence from the engine.
    expect(verdict.reasonCode).toMatch(/^[a-z_]+$/)
  })

  it('records a declared/sniffed mismatch for the audit trail', () => {
    const verdict = evaluateUpload({
      filename: 'Angebot.pdf',
      declaredMime: 'application/pdf',
      head: PNG,
      bytes: 2000,
      existingCount: 0,
    })
    expect(verdict.mismatch).toBe(true)
    // Still accepted — it is a perfectly good PNG, just not what it claimed.
    expect(verdict.accepted).toBe(true)
    expect(verdict.kind).toBe('image')
  })
})

describe('F1.10 — an unscanned file never reaches a parser', () => {
  const att = (scanStatus: 'pending' | 'clean' | 'blocked') => ({
    attachmentId: `att_${scanStatus}`,
    mime: 'application/pdf',
    kind: 'document' as const,
    scanStatus,
  })

  it('permits only a clean file', () => {
    expect(mayParse(att('clean'))).toBe(true)
    expect(mayParse(att('pending'))).toBe(false)
    expect(mayParse(att('blocked'))).toBe(false)
  })

  it('fails closed for a status the gate has never seen', () => {
    // A positive check ('is clean') survives a new enum value; a negative one
    // ('is not blocked') would let it straight through.
    expect(mayParse({ ...att('pending'), scanStatus: 'quarantined' as never })).toBe(false)
  })

  it('filters a batch down to scanned files only', () => {
    const parsable = parsableAttachments([att('clean'), att('pending'), att('blocked')])
    expect(parsable.map((a) => a.attachmentId)).toEqual(['att_clean'])
  })

  it('throws at the parser entry point rather than failing silently', () => {
    expect(() => assertScanned(att('pending'))).toThrow(/scan_status/)
    expect(() => assertScanned(att('clean'))).not.toThrow()
  })
})
