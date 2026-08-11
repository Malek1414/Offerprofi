/**
 * Enough XML to read Office files, and deliberately not one line more.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS A SCANNER, NOT A PARSER, AND THAT IS THE POINT.
 *
 * A conforming XML parser resolves entities, and entity resolution is where XML
 * parsers get people hurt: a document that declares `<!ENTITY xxe SYSTEM
 * "file:///etc/passwd">` or the billion-laughs expansion turns a file upload into a
 * file read or an out-of-memory. Every one of those attacks lives in the DOCTYPE.
 * This scanner walks tags and text and skips `<!…>` wholesale, so there is no
 * declaration handling to get wrong — the class of bug is absent rather than
 * defended against.
 *
 * The five predefined entities plus numeric references are decoded by
 * `unescapeXml`, because those are what Office actually writes and they expand to
 * exactly one character each. Anything else stays as literal text: an undecoded
 * `&foo;` in a business name is a cosmetic defect, and resolving it is a class of
 * vulnerability.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Both consumers — `xlsx.ts` and `docx.ts` — need the same three things and
 * nothing else: where the tags are, what their attributes say, and the text
 * between them. They keep their own stacks because their nesting rules differ.
 */

export interface XmlTag {
  /** As written, prefix included: `w:t`, `c`, `Relationship`. */
  name: string
  kind: 'open' | 'close' | 'self'
  /** The whole tag including the angle brackets, for `attributesOf`. */
  source: string
  /** Index of the `<`. Text of the preceding element ends here. */
  start: number
  /** Index just past the `>`. Text of this element starts here. */
  end: number
}

/**
 * The part of a tag name after the namespace prefix.
 *
 * Office writes `w:t` in a .docx and bare `t` in a .xlsx worksheet, and a third
 * writer is free to bind the same namespace to a different prefix. Matching on the
 * local name means a file written by LibreOffice or by a Python library parses the
 * same as one written by Word. Proper namespace resolution would be more correct
 * and would buy nothing: within one Office part, local names do not collide.
 */
export function localName(name: string): string {
  const colon = name.indexOf(':')
  return colon < 0 ? name : name.slice(colon + 1)
}

/**
 * A `>` inside an attribute value does not close a tag. Office rarely writes one,
 * but a business name can contain anything, and a scanner that ends the tag early
 * would silently swallow the rest of the row.
 */
function findTagEnd(xml: string, from: number): number {
  let quote = ''
  for (let index = from + 1; index < xml.length; index++) {
    const character = xml.charAt(index)
    if (quote) {
      if (character === quote) quote = ''
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '>') {
      return index
    }
  }
  return -1
}

export function* scanTags(xml: string): Generator<XmlTag> {
  let index = 0
  while (index < xml.length) {
    const open = xml.indexOf('<', index)
    if (open < 0) return

    // Comments, CDATA, the XML declaration, and every `<!…>` construct including
    // DOCTYPE are stepped over as opaque spans. See the header comment: not
    // interpreting a DOCTYPE is the security property, not an omission.
    if (xml.startsWith('<!--', open)) {
      const close = xml.indexOf('-->', open)
      index = close < 0 ? xml.length : close + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', open)) {
      const close = xml.indexOf(']]>', open)
      index = close < 0 ? xml.length : close + 3
      continue
    }
    if (xml.startsWith('<?', open) || xml.startsWith('<!', open)) {
      const close = xml.indexOf('>', open)
      index = close < 0 ? xml.length : close + 1
      continue
    }

    const close = findTagEnd(xml, open)
    if (close < 0) return

    const source = xml.slice(open, close + 1)
    const closing = source.charAt(1) === '/'
    const selfClosing = source.charAt(source.length - 2) === '/'
    const nameMatch = /^<\/?\s*([^\s/>]+)/.exec(source)
    const name = nameMatch?.[1]

    if (name) {
      yield {
        name,
        kind: closing ? 'close' : selfClosing ? 'self' : 'open',
        source,
        start: open,
        end: close + 1,
      }
    }
    index = close + 1
  }
}

const ATTRIBUTE = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g

export function attributesOf(tagSource: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  ATTRIBUTE.lastIndex = 0
  let match = ATTRIBUTE.exec(tagSource)
  while (match) {
    const name = match[1]
    const value = match[3] ?? match[4] ?? ''
    if (name) attributes[name] = unescapeXml(value)
    match = ATTRIBUTE.exec(tagSource)
  }
  return attributes
}

/** An attribute by local name, so `r:id` and `id` are both found by `id`. */
export function attribute(attributes: Record<string, string>, name: string): string | undefined {
  const direct = attributes[name]
  if (direct !== undefined) return direct
  for (const [key, value] of Object.entries(attributes)) {
    if (localName(key) === name) return value
  }
  return undefined
}

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

export function unescapeXml(value: string): string {
  if (!value.includes('&')) return value
  return value.replace(/&(#x?[0-9A-Fa-f]+|[A-Za-z]+);/g, (whole, body: string) => {
    if (body.charAt(0) === '#') {
      const hex = body.charAt(1) === 'x' || body.charAt(1) === 'X'
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10)
      // Lone surrogates and out-of-range code points would throw. An unresolvable
      // reference is left as written rather than crashing a whole import.
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole
      if (code >= 0xd800 && code <= 0xdfff) return whole
      return String.fromCodePoint(code)
    }
    return NAMED[body] ?? whole
  })
}
