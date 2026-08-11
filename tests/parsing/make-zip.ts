/**
 * ZIP fixtures built in memory, so no binary blob is ever checked in.
 *
 * A committed .xlsx is a file nobody in the repository can read in a diff, cannot be
 * varied without a spreadsheet application, and — the part that matters here —
 * cannot express the cases this suite actually needs: a central directory that lies
 * about an entry's size, a deflate stream that expands past its declaration. Those
 * are not files you can produce by saving from Excel. They are files you write.
 *
 * The writer is the format's other half, which means the ZIP tests exercise the
 * reader against bytes laid out from the specification rather than against whatever
 * one particular Excel version happened to emit.
 */

import { deflateRawSync } from 'node:zlib'

export interface ZipFileSpec {
  name: string
  data: Uint8Array | string
  /** Stored (method 0) instead of deflated. */
  store?: boolean
  /**
   * Overrides the uncompressed size written to both headers, without touching the
   * data. This is how a zip bomb is expressed: a declaration the payload does not
   * honour, in whichever direction the test needs.
   */
  declaredUncompressedSize?: number
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const encoder = new TextEncoder()

const toBytes = (data: Uint8Array | string): Uint8Array =>
  typeof data === 'string' ? encoder.encode(data) : data

export function buildZip(files: readonly ZipFileSpec[]): Uint8Array {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const file of files) {
    const raw = toBytes(file.data)
    const name = encoder.encode(file.name)
    const method = file.store ? 0 : 8
    const payload = file.store ? Buffer.from(raw) : deflateRawSync(raw)
    const uncompressedSize = file.declaredUncompressedSize ?? raw.length

    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4) // version needed
    header.writeUInt16LE(0, 6) // flags
    header.writeUInt16LE(method, 8)
    header.writeUInt16LE(0, 10) // time
    header.writeUInt16LE(0, 12) // date
    header.writeUInt32LE(crc32(raw), 14)
    header.writeUInt32LE(payload.length, 18)
    header.writeUInt32LE(uncompressedSize, 22)
    header.writeUInt16LE(name.length, 26)
    header.writeUInt16LE(0, 28) // extra

    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02014b50, 0)
    record.writeUInt16LE(20, 4) // version made by
    record.writeUInt16LE(20, 6) // version needed
    record.writeUInt16LE(0, 8) // flags
    record.writeUInt16LE(method, 10)
    record.writeUInt16LE(0, 12)
    record.writeUInt16LE(0, 14)
    record.writeUInt32LE(crc32(raw), 16)
    record.writeUInt32LE(payload.length, 20)
    record.writeUInt32LE(uncompressedSize, 24)
    record.writeUInt16LE(name.length, 28)
    record.writeUInt16LE(0, 30) // extra
    record.writeUInt16LE(0, 32) // comment
    record.writeUInt16LE(0, 34) // disk
    record.writeUInt16LE(0, 36) // internal attributes
    record.writeUInt32LE(0, 38) // external attributes
    record.writeUInt32LE(offset, 42)

    local.push(header, Buffer.from(name), payload)
    central.push(record, Buffer.from(name))
    offset += header.length + name.length + payload.length
  }

  const localPart = Buffer.concat(local)
  const centralPart = Buffer.concat(central)

  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralPart.length, 12)
  end.writeUInt32LE(localPart.length, 16)
  end.writeUInt16LE(0, 20)

  return new Uint8Array(Buffer.concat([localPart, centralPart, end]))
}
