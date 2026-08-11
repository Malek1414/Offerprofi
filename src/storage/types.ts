/**
 * The object-store contract (B0).
 *
 * D29 moved object storage onto us when D15 replaced Supabase with plain Postgres.
 * This is the seam: everything in Phase B writes through this interface, and the
 * driver behind it is a deployment decision rather than a code decision.
 *
 * Four verbs and a list. Deliberately not more — a wider interface would be one the
 * filesystem driver has to fake, and a faked method is a difference between
 * development and production that shows up in production.
 */

export interface StoredObject {
  key: string
  size: number
  contentType: string
}

export interface StoredObjectBody extends StoredObject {
  body: Uint8Array
}

export interface PutOptions {
  contentType: string
}

export interface ObjectStore {
  /** Which implementation this is. Surfaced so an ops screen can say so out loud. */
  readonly driver: 'local' | 's3'

  /**
   * Write. Keys are content-addressed (see `objectKey`), so writing the same key twice
   * is the same object twice — that is what makes a re-upload a no-op rather than a
   * duplicate.
   */
  put(key: string, body: Uint8Array, options: PutOptions): Promise<StoredObject>

  /** `null` when the object is not there. Absence is an answer, not an error. */
  get(key: string): Promise<StoredObjectBody | null>

  /** Metadata without the bytes — how a resumable upload asks "did this already land?". */
  head(key: string): Promise<StoredObject | null>

  /** Idempotent: deleting something already gone is a success. */
  delete(key: string): Promise<void>

  /** Keys under a prefix, sorted. The basis of the B3 deletion path. */
  list(prefix: string): Promise<string[]>
}
