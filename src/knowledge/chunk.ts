/**
 * Cutting a document into chunks (Phase C).
 *
 * Pure, so the boundaries are a unit test rather than something inspected once
 * by eye. Splitting is where retrieval quality is won or lost long before any
 * ranker runs: a price separated from the dish it belongs to is two useless
 * chunks where there was one useful one.
 *
 * Paragraph-first, because a caterer's offer is written in paragraphs and menu
 * blocks, and a blank line is an author telling you where a thought ends. Only
 * when a paragraph is too long for the budget is it split on sentences, and only
 * then on hard character count — each fallback is worse than the one before, so
 * each is reached only when the better one cannot apply.
 */

/** Roughly 250 words. Big enough to hold a menu block with its price. */
export const TARGET_CHARS = 1_400
/** Below this a chunk is joined to its neighbour rather than filed alone. */
export const MIN_CHARS = 200

export interface Chunk {
  ordinal: number
  text: string
}

export function chunkDocument(text: string, targetChars: number = TARGET_CHARS): Chunk[] {
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)

  const pieces: string[] = []
  for (const paragraph of paragraphs) {
    if (paragraph.length <= targetChars) {
      pieces.push(paragraph)
      continue
    }
    pieces.push(...splitLongParagraph(paragraph, targetChars))
  }

  // Merge forward while there is room. A two-line paragraph is a heading or a
  // price on its own; filed alone it retrieves as a fragment with no subject.
  const merged: string[] = []
  for (const piece of pieces) {
    const last = merged[merged.length - 1]
    if (last !== undefined && (last.length < MIN_CHARS || piece.length < MIN_CHARS)) {
      if (last.length + piece.length + 1 <= targetChars) {
        merged[merged.length - 1] = `${last}\n${piece}`
        continue
      }
    }
    merged.push(piece)
  }

  return merged.map((chunkText, index) => ({ ordinal: index, text: chunkText }))
}

/**
 * Sentences first, characters only as a last resort.
 *
 * The hard split exists because a document can contain a 4,000-character table
 * with no sentence punctuation at all, and refusing to index it would be worse
 * than indexing it badly.
 */
function splitLongParagraph(paragraph: string, targetChars: number): string[] {
  const sentences = paragraph.match(/[^.!?\n]+[.!?]*\s*/g) ?? [paragraph]
  const out: string[] = []
  let current = ''

  for (const sentence of sentences) {
    if (current.length + sentence.length > targetChars && current) {
      out.push(current.trim())
      current = ''
    }
    if (sentence.length > targetChars) {
      if (current) {
        out.push(current.trim())
        current = ''
      }
      for (let i = 0; i < sentence.length; i += targetChars) {
        out.push(sentence.slice(i, i + targetChars).trim())
      }
      continue
    }
    current += sentence
  }

  if (current.trim()) out.push(current.trim())
  return out.filter(Boolean)
}
