/**
 * The parsing surface Phase B imports, and the shape of the pipeline it implies.
 *
 * Everything here is a pure function of bytes. Nothing reads the environment, opens
 * a connection, or writes a row — which is what lets the whole of B2 be tested with
 * fixtures built in memory, and what keeps a malformed spreadsheet from being able
 * to reach anything but its own parse.
 *
 * The order is the pipeline in EXECUTION_HANDOFF §6:
 *
 *     bytes ──▶ readXlsx / parseCsv / readDocx ──▶ string[][] ──▶ proposeMapping
 *                                                                      │
 *                                                       a proposal, never a decision
 *                                                                      ▼
 *                                                            the owner confirms
 *
 * `proposeMapping` is the last step deliberately, and it is the one that cannot
 * complete on its own. See `headers.ts`.
 */

export { openZip, ZipError, DEFAULT_ZIP_LIMITS } from './zip'
export type { ZipArchive, ZipEntry, ZipLimits, ZipProblem } from './zip'

export { readXlsx, xlsxSheetNames, serialToDateText, XlsxError } from './xlsx'
export type { XlsxOptions, XlsxSheet, XlsxWorkbook } from './xlsx'

export { parseCsv, detectDelimiter, decodeCsvText, CSV_DELIMITERS } from './csv'
export type { CsvDelimiter, CsvDocument, CsvOptions } from './csv'

export { readDocx, readDocxXml, DocxError } from './docx'
export type { DocxBlock, DocxDocument, DocxOptions } from './docx'

export {
  proposeMapping,
  detectHeaderRow,
  PROSPECT_FIELDS,
  MAX_DETECTED_CONFIDENCE,
} from './headers'
export type {
  ColumnReading,
  FieldCandidate,
  FieldProposal,
  MappingEvidence,
  MappingProposal,
  ProspectField,
} from './headers'
