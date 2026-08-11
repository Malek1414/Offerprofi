/**
 * What each surface accepts (D2), and the size bound behind the chunking scheme.
 *
 * The asymmetry between the two surfaces is an owner decision, not an
 * implementation detail, so it is pinned here: if someone later "tidies up" by
 * giving both surfaces the same list, these fail and say which decision was
 * being undone.
 */

import { describe, expect, it } from 'vitest'

import {
  CHUNK_BYTES,
  MAX_UPLOAD_BYTES,
  accepts,
  acceptAttribute,
  chunkCount,
} from '../../src/uploads/limits'

const ONE_MB = 1024 * 1024

describe('D2 — the client surface has parity with what Claude accepts', () => {
  it.each(['menu.pdf', 'preise.xlsx', 'leads.csv', 'vertrag.docx', 'notiz.txt', 'notiz.md'])(
    'accepts %s from the caterer',
    (filename) => {
      expect(accepts('client', filename, ONE_MB).accepted).toBe(true)
    },
  )

  it.each(['karte.png', 'karte.jpg', 'karte.jpeg', 'foto.heic', 'foto.webp'])(
    'accepts %s from the caterer',
    (filename) => {
      expect(accepts('client', filename, ONE_MB).accepted).toBe(true)
    },
  )

  it('accepts a voice note, and marks it as stored rather than read', () => {
    const result = accepts('client', 'sprachnachricht.m4a', ONE_MB)

    expect(result.accepted).toBe(true)
    // D5: captured, stored and flagged — never transcribed. The flag is what stops
    // anything downstream treating an audio file as something it can parse.
    expect(result.accepted && result.type.storedUnread).toBe(true)
  })

  it('marks nothing else as stored-unread, so the flag keeps meaning one thing', () => {
    const result = accepts('client', 'menu.pdf', ONE_MB)
    expect(result.accepted && result.type.storedUnread).toBeFalsy()
  })
})

describe('D2 — the customer surface is documents and screenshots only', () => {
  it('accepts a document from the end customer', () => {
    expect(accepts('customer', 'anfrage.pdf', ONE_MB).accepted).toBe(true)
  })

  it('accepts a screenshot from the end customer', () => {
    expect(accepts('customer', 'screenshot.png', ONE_MB).accepted).toBe(true)
  })

  it('refuses a voice note from the end customer', () => {
    // The explicit owner correction. Voice on the customer side is error-prone —
    // an accent, a noisy venue, a half-second clip — and misreading an event date
    // out of one is a real cost with nothing on the other side of the trade.
    const result = accepts('customer', 'sprachnachricht.m4a', ONE_MB)
    expect(result.accepted).toBe(false)
  })

  it('says "wrong place", not "unsupported", for a type the other surface takes', () => {
    // Two different messages, because telling a customer their voice note is an
    // unsupported file type when we accept it from the caterer is a small lie that
    // makes the product look broken.
    const voice = accepts('customer', 'sprachnachricht.m4a', ONE_MB)
    const nonsense = accepts('customer', 'archiv.zip', ONE_MB)

    expect(voice.accepted === false && voice.reason.kind).toBe('not_on_this_surface')
    expect(nonsense.accepted === false && nonsense.reason.kind).toBe('unsupported_type')
  })

  it('keeps the restriction out of the accept attribute as well', () => {
    expect(acceptAttribute('client')).toContain('.m4a')
    expect(acceptAttribute('customer')).not.toContain('.m4a')
  })
})

describe('size bounds', () => {
  it('refuses an empty file rather than creating a job with nothing in it', () => {
    const result = accepts('client', 'leer.pdf', 0)
    expect(result.accepted === false && result.reason.kind).toBe('empty')
  })

  it('refuses a file over the cap before a single chunk is accepted', () => {
    const result = accepts('client', 'video.pdf', MAX_UPLOAD_BYTES + 1)

    expect(result.accepted).toBe(false)
    // The message needs both numbers: "too large" without a limit gives the user
    // nothing to act on.
    expect(result.accepted === false && result.reason.kind === 'too_large' && result.reason.limitBytes)
      .toBe(MAX_UPLOAD_BYTES)
  })

  it('accepts a file exactly at the cap, because a boundary stated as 25 MB means 25 MB', () => {
    expect(accepts('client', 'gross.pdf', MAX_UPLOAD_BYTES).accepted).toBe(true)
  })
})

describe('chunking', () => {
  it('splits on the chunk size', () => {
    expect(chunkCount(CHUNK_BYTES)).toBe(1)
    expect(chunkCount(CHUNK_BYTES + 1)).toBe(2)
    expect(chunkCount(CHUNK_BYTES * 3)).toBe(3)
  })

  it('never reports zero chunks, so a small file still has one to send', () => {
    expect(chunkCount(1)).toBe(1)
  })

  it('keeps the largest allowed file to a sane number of round trips', () => {
    expect(chunkCount(MAX_UPLOAD_BYTES)).toBe(25)
  })
})
