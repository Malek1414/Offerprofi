/**
 * The reader's job is to read office files. Its *other* job — the one that gets
 * exercised here — is to be handed an archive built to hurt it and refuse.
 *
 * Untrusted files reach this code (CLAUDE.md §7). A ZIP is the one input format
 * that describes its own expanded size, which means a few kilobytes on the wire can
 * ask for terabytes of heap, and a reader that allocates first and validates second
 * takes the process down before it can report anything. The assertions below are
 * ordered the way the defence is: what is caught before any decompression happens,
 * then what is caught during it.
 */

import { describe, expect, it } from 'vitest'

import { openZip, ZipError, DEFAULT_ZIP_LIMITS } from '../../src/parsing/zip'
import { buildZip } from './make-zip'

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

const problemOf = (run: () => unknown): string => {
  try {
    run()
  } catch (error) {
    if (error instanceof ZipError) return error.problem
    return `unexpected: ${String(error)}`
  }
  return 'did not throw'
}

describe('openZip', () => {
  it('reads both compression methods the format actually uses', () => {
    // Office deflates everything, but a tiny part sometimes stores. Both must work
    // or a workbook reads half its parts.
    const archive = openZip(
      buildZip([
        { name: 'stored.txt', data: 'Firma;Ort', store: true },
        { name: 'deflated.xml', data: '<root>' + 'Kranzler'.repeat(500) + '</root>' },
      ]),
    )

    expect(archive.entries.map((entry) => entry.name)).toEqual(['stored.txt', 'deflated.xml'])
    expect(archive.entries[0]?.method).toBe(0)
    expect(archive.entries[1]?.method).toBe(8)
    expect(decode(archive.read('stored.txt'))).toBe('Firma;Ort')
    expect(decode(archive.read('deflated.xml'))).toContain('Kranzler')
  })

  it('decodes text and drops the byte-order mark', () => {
    const archive = openZip(buildZip([{ name: 'a.xml', data: '\uFEFF<x>Köln</x>' }]))
    expect(archive.readText('a.xml')).toBe('<x>Köln</x>')
  })

  it('names a missing entry rather than returning undefined', () => {
    const archive = openZip(buildZip([{ name: 'a.xml', data: '<x/>' }]))
    expect(archive.has('xl/workbook.xml')).toBe(false)
    expect(problemOf(() => archive.read('xl/workbook.xml'))).toBe('entry_not_found')
  })

  it('refuses bytes that are not a zip at all', () => {
    expect(problemOf(() => openZip(new TextEncoder().encode('Firma;Ort\nMüller;Berlin\n')))).toBe(
      'not_a_zip',
    )
    expect(problemOf(() => openZip(new Uint8Array(4)))).toBe('not_a_zip')
  })

  it('is not fooled by the end-of-directory signature appearing inside a stored file', () => {
    // A file whose *contents* contain PK\x05\x06 is legal and is what a naive
    // backwards scan trips over: it finds the wrong record and then reads a
    // directory out of arbitrary bytes.
    const payload = new Uint8Array(64)
    payload.set([0x50, 0x4b, 0x05, 0x06], 20)
    const archive = openZip(buildZip([{ name: 'bait.bin', data: payload, store: true }]))
    expect(archive.entries.map((entry) => entry.name)).toEqual(['bait.bin'])
  })
})

describe('openZip — the zip-bomb guard', () => {
  it('rejects an honestly-declared bomb before decompressing anything', () => {
    // This is the shape of 42.zip: a small archive whose directory says the entry
    // expands enormously. The rejection has to come from `openZip`, which never
    // touches a compressed stream — if it came from `read`, the allocation would
    // already have been attempted.
    // 3 GiB is the largest honest lie a 32-bit ZIP can tell: 4 GiB is the sentinel
    // that means ZIP64, which is refused earlier and for a different reason.
    const bomb = buildZip([
      { name: 'bomb.xml', data: 'x', declaredUncompressedSize: 3 * 1024 * 1024 * 1024 },
    ])

    expect(bomb.length).toBeLessThan(1024)
    expect(problemOf(() => openZip(bomb, { ...DEFAULT_ZIP_LIMITS, maxEntryBytes: 1024 }))).toBe(
      'entry_too_large',
    )
  })

  it('rejects an archive whose entries are each small but together are not', () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      name: `part${index}.xml`,
      data: 'x',
      declaredUncompressedSize: 400,
    }))

    expect(
      problemOf(() => openZip(buildZip(many), { ...DEFAULT_ZIP_LIMITS, maxEntryBytes: 1000, maxTotalBytes: 1000 })),
    ).toBe('archive_too_large')
  })

  it('rejects an archive with more entries than the limit allows', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ name: `p${index}.xml`, data: 'x' }))
    expect(problemOf(() => openZip(buildZip(many), { ...DEFAULT_ZIP_LIMITS, maxEntries: 8 }))).toBe(
      'too_many_entries',
    )
  })

  it('stops a bomb that lies in the central directory, at the inflate', () => {
    // The declaration says 100 bytes, so the pre-check waves it through. Four
    // megabytes of zeros deflate to a couple of kilobytes and would expand past the
    // cap; zlib's own output limit is what catches it, and the point of the
    // assertion is that the failure is a bounded rejection rather than a heap the
    // size of the payload.
    const lying = buildZip([
      { name: 'lie.bin', data: new Uint8Array(4 * 1024 * 1024), declaredUncompressedSize: 100 },
    ])

    expect(lying.length).toBeLessThan(64 * 1024)

    const archive = openZip(lying, { ...DEFAULT_ZIP_LIMITS, maxEntryBytes: 64 * 1024 })
    expect(problemOf(() => archive.read('lie.bin'))).toBe('entry_too_large')
  })

  it('rejects an entry whose inflated size disagrees with its declaration', () => {
    // Same lie, generous limits: nothing overflows, but the two numbers still do not
    // match, and an archive that contradicts itself is not one to read values out of.
    const lying = buildZip([{ name: 'lie.bin', data: new Uint8Array(4096), declaredUncompressedSize: 100 }])
    const archive = openZip(lying)
    expect(problemOf(() => archive.read('lie.bin'))).toBe('size_mismatch')
  })

  it('rejects a stored entry that declares a size its payload does not have', () => {
    const lying = buildZip([
      { name: 'lie.bin', data: new Uint8Array(64), store: true, declaredUncompressedSize: 4096 },
    ])
    const archive = openZip(lying)
    expect(problemOf(() => archive.read('lie.bin'))).toBe('size_mismatch')
  })
})
