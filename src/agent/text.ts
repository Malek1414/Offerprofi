/**
 * Model-text boundary cleanup.
 *
 * Structured output guarantees JSON shape, not that a string inside it was encoded
 * once. Live Anthropic QA produced both literal unicode escapes and UTF-8 bytes
 * decoded as Latin-1. This repairs only those two identifiable cases and otherwise
 * leaves multilingual prose untouched.
 */

import { Buffer } from 'node:buffer'

export function normaliseModelText(text: string): string {
  let value = text

  // Two passes cover a doubly escaped sequence while keeping the operation bounded.
  for (let pass = 0; pass < 2 && /\\u[0-9a-f]{4}/i.test(value); pass += 1) {
    value = value.replace(/\\u([0-9a-f]{4})/gi, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
  }

  const scoreBefore = mojibakeScore(value)
  const isLatin1 = [...value].every((character) => character.codePointAt(0)! <= 0xff)
  if (scoreBefore > 0 && isLatin1) {
    const repaired = Buffer.from(value, 'latin1').toString('utf8')
    if (!repaired.includes('\uFFFD') && mojibakeScore(repaired) < scoreBefore) {
      value = repaired
    }
  }

  return value.trim()
}

function mojibakeScore(text: string): number {
  return text.match(/[\u0080-\u009f\u00c2\u00c3\u00e2]/g)?.length ?? 0
}
