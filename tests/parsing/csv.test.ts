/**
 * The file a German agency actually exports.
 *
 * Every case here came out of the same place: Excel on a German-locale machine.
 * Semicolons because the comma is the decimal separator; a byte-order mark because
 * "CSV UTF-8" is the export that keeps umlauts; CRLF because Windows. A parser that
 * handles RFC 4180 and nothing else reads that file as a single column and reports
 * no error at all, which is the failure this suite exists to prevent.
 */

import { describe, expect, it } from 'vitest'

import { detectDelimiter, parseCsv } from '../../src/parsing/csv'

const encoder = new TextEncoder()

describe('parseCsv — the German export', () => {
  it('detects the semicolon and leaves the decimal commas alone', () => {
    const file = [
      'Firma;Ort;Preis p.P.',
      'Café Kranzler;Berlin;18,50',
      'Weinhaus Müller;Köln;24,90',
      'Fingerfood Nord;Hamburg;9,95',
    ].join('\r\n')

    const parsed = parseCsv(file)

    expect(parsed.delimiter).toBe(';')
    expect(parsed.rows).toEqual([
      ['Firma', 'Ort', 'Preis p.P.'],
      ['Café Kranzler', 'Berlin', '18,50'],
      ['Weinhaus Müller', 'Köln', '24,90'],
      ['Fingerfood Nord', 'Hamburg', '9,95'],
    ])
  })

  it('does not let a decimal comma out-score the real delimiter', () => {
    // The comma appears in every data row, so a naive frequency count picks it.
    // What separates them is shape: the semicolon splits every row into three, the
    // comma splits some rows into two and the header into one.
    const scores = ['Firma;Preis', 'Müller;18,50', 'Schmidt;24,90'].join('\n')
    expect(detectDelimiter(scores).delimiter).toBe(';')
  })

  it('reads a quoted field that contains the delimiter', () => {
    const file = ['Firma;Ort', '"Müller; Schmidt & Co. KG";Berlin'].join('\n')

    expect(parseCsv(file).rows[1]).toEqual(['Müller; Schmidt & Co. KG', 'Berlin'])
  })

  it('unescapes a doubled quote inside a quoted field', () => {
    const file = ['Firma;Ort', '"Restaurant ""Zur Post""";Potsdam'].join('\n')

    expect(parseCsv(file).rows[1]).toEqual(['Restaurant "Zur Post"', 'Potsdam'])
  })

  it('keeps a newline that is inside a quoted field', () => {
    const file = 'Firma;Notiz\r\n"Café Kranzler";"Berlin\r\nMitte"\r\n'

    expect(parseCsv(file).rows).toEqual([
      ['Firma', 'Notiz'],
      ['Café Kranzler', 'Berlin\r\nMitte'],
    ])
  })

  it('strips the byte-order mark instead of welding it to the first header', () => {
    // Left in place, the first header reads as the mark followed by Firma, which
    // matches no label and leaves `business_name` unmapped on a file that has it.
    const bytes = encoder.encode('\uFEFFFirma;Ort\nCafé Kranzler;Berlin\n')
    const parsed = parseCsv(bytes)

    expect(parsed.hadByteOrderMark).toBe(true)
    expect(parsed.rows[0]).toEqual(['Firma', 'Ort'])
    expect(parsed.rows[0]?.[0]).toBe('Firma')
  })
})

describe('parseCsv — line endings and terminators', () => {
  it('accepts CRLF, LF and a lone CR', () => {
    expect(parseCsv('a,b\r\nc,d').rows).toEqual([['a', 'b'], ['c', 'd']])
    expect(parseCsv('a,b\nc,d').rows).toEqual([['a', 'b'], ['c', 'd']])
    expect(parseCsv('a,b\rc,d').rows).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('does not invent a row for the trailing newline every file ends with', () => {
    expect(parseCsv('a,b\nc,d\n').rows).toHaveLength(2)
    expect(parseCsv('a,b\r\nc,d\r\n').rows).toHaveLength(2)
  })

  it('keeps a genuinely empty trailing field', () => {
    expect(parseCsv('a,b\nc,\n').rows[1]).toEqual(['c', ''])
  })
})

describe('detectDelimiter', () => {
  it('finds the comma in a file that is plain RFC 4180', () => {
    const parsed = parseCsv('Company,City\nKranzler,Berlin\nMüller,Köln\n')
    expect(parsed.delimiter).toBe(',')
    expect(parsed.rows[1]).toEqual(['Kranzler', 'Berlin'])
  })

  it('finds a tab', () => {
    expect(detectDelimiter('Firma\tOrt\nKranzler\tBerlin\n').delimiter).toBe('\t')
  })

  it('reports no confidence for a file with one column, rather than picking at random', () => {
    const parsed = parseCsv('Firma\nCafé Kranzler\nWeinhaus Müller\n')

    expect(parsed.delimiterConfidence).toBe(0)
    expect(parsed.rows).toEqual([['Firma'], ['Café Kranzler'], ['Weinhaus Müller']])
  })

  it('does not count a delimiter that only appears inside quotes', () => {
    const file = ['Firma;Ort', '"Müller, Schmidt, Meyer GbR";Berlin', '"Post, Zur";Potsdam'].join('\n')
    expect(detectDelimiter(file).delimiter).toBe(';')
  })

  it('lets a supplied delimiter win outright, at confidence 1', () => {
    // CLAUDE.md §7: owner-supplied values are 1.0 and always win. Detection does not
    // get a vote once a human has said which character it is.
    const parsed = parseCsv('a;b,c\nd;e,f\n', { delimiter: ',' })

    expect(parsed.delimiter).toBe(',')
    expect(parsed.delimiterConfidence).toBe(1)
    expect(parsed.rows[0]).toEqual(['a;b', 'c'])
  })
})

describe('parseCsv — files written by hand', () => {
  it('takes a stray quote inside an unquoted field literally', () => {
    expect(parseCsv('Artikel;Groesse\nTeller;5" rund\n').rows[1]).toEqual(['Teller', '5" rund'])
  })

  it('does not choke on a ragged file', () => {
    const parsed = parseCsv('Firma;Ort;Land\nKranzler;Berlin\nMüller;Köln;DE;extra\n')

    expect(parsed.rows).toEqual([
      ['Firma', 'Ort', 'Land'],
      ['Kranzler', 'Berlin'],
      ['Müller', 'Köln', 'DE', 'extra'],
    ])
  })

  it('returns nothing for an empty file rather than one empty row', () => {
    expect(parseCsv('').rows).toEqual([])
  })
})
