/**
 * Password hashing for agency staff (D29a).
 *
 * Ours now, because D15 moved off a platform that supplied it. Only agency staff
 * have accounts — customers never do (D11), so this is a small surface, used by a
 * handful of people per tenant. That is not a reason to be casual about it: a solo
 * wedding planner reuses passwords, and a leak here is a leak of her business.
 *
 * **scrypt, from `node:crypto`.** Argon2id would be the modern first choice, but it
 * means a native dependency that has to compile on every developer machine and in
 * every deploy image. scrypt is memory-hard, in the standard library, has no build
 * step, and is explicitly permitted by OWASP for password storage. The trade is
 * deliberate: a marginally weaker KDF that is definitely present beats a stronger
 * one that someone disables when the build breaks on a Friday.
 *
 * The stored format carries its own parameters, so the cost can be raised later
 * without invalidating existing hashes — old passwords keep verifying against their
 * original settings and are silently upgraded on next login (`needsRehash`).
 */

import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto'

/**
 * `promisify` collapses scrypt's overloads onto the three-argument one and drops the
 * options parameter, which is exactly the parameter that carries the cost. Wrapped by
 * hand so the tuning stays type-checked.
 */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (err, derived) => {
      if (err) reject(err)
      else resolve(derived)
    })
  })
}

/**
 * Cost parameters. N=2^16 costs roughly 100ms and 64 MB per hash on a modern
 * server, which is a sane ceiling for a login endpoint: slow enough to make offline
 * cracking expensive, fast enough that a legitimate owner does not notice.
 */
const PARAMS = { N: 65536, r: 8, p: 1, keylen: 64 } as const

/** Node's default maxmem (32 MB) is below what N=65536 needs; it throws otherwise. */
const MAXMEM = 256 * 1024 * 1024

const SALT_BYTES = 16

/**
 * Hash a password into a self-describing string:
 *
 *   scrypt$N$r$p$<salt-base64url>$<hash-base64url>
 *
 * Everything needed to verify — and to notice that the parameters have moved on —
 * travels with the hash. Nothing depends on a constant in this file staying the
 * value it had when the row was written.
 */
export async function hashPassword(password: string): Promise<string> {
  assertUsable(password)
  const salt = randomBytes(SALT_BYTES)
  const derived = await scrypt(password.normalize('NFKC'), salt, PARAMS.keylen, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    maxmem: MAXMEM,
  })

  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$')
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false for a malformed or unrecognised hash rather than throwing. A
 * corrupted row must fail the login, not 500 the endpoint — an exception here would
 * be an availability bug triggerable by whatever wrote the bad row.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored)
  if (!parsed) return false

  let derived: Buffer
  try {
    derived = await scrypt(password.normalize('NFKC'), parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: MAXMEM,
    })
  } catch {
    // Absurd parameters in a stored hash would otherwise take the process down.
    return false
  }

  if (derived.length !== parsed.hash.length) return false
  // Constant-time: a byte-by-byte comparison leaks how much of the hash matched.
  return timingSafeEqual(derived, parsed.hash)
}

/**
 * Should this hash be rewritten with current parameters?
 *
 * Called after a successful login. Raising the cost is worthless if existing
 * accounts keep their old one forever, and this is the only moment the plaintext is
 * available to rehash with.
 */
export function needsRehash(stored: string): boolean {
  const parsed = parse(stored)
  if (!parsed) return true
  return parsed.N < PARAMS.N || parsed.r < PARAMS.r || parsed.p < PARAMS.p
}

interface ParsedHash {
  N: number
  r: number
  p: number
  salt: Buffer
  hash: Buffer
}

function parse(stored: string): ParsedHash | null {
  const parts = stored.split('$')
  if (parts.length !== 6) return null
  const [scheme, n, r, p, salt, hash] = parts
  if (scheme !== 'scrypt') return null

  const N = Number(n)
  const rr = Number(r)
  const pp = Number(p)
  if (!Number.isInteger(N) || !Number.isInteger(rr) || !Number.isInteger(pp)) return null
  if (N <= 1 || rr <= 0 || pp <= 0) return null
  // Refuse parameters that would exhaust memory before scrypt even runs.
  if (N > 1 << 22 || rr > 64 || pp > 16) return null
  if (!salt || !hash) return null

  return {
    N,
    r: rr,
    p: pp,
    salt: Buffer.from(salt, 'base64url'),
    hash: Buffer.from(hash, 'base64url'),
  }
}

/** The shortest password we accept, in characters. */
export const MIN_PASSWORD_LENGTH = 10

/**
 * A length floor and a ceiling, and nothing else.
 *
 * No character-class rules: they push people toward `Passwort1!` and are no longer
 * recommended by NIST or the BSI. The ceiling exists because scrypt hashes whatever
 * it is handed, and an unbounded password is an unbounded amount of work for an
 * unauthenticated caller — a denial-of-service dressed as a login.
 */
export const MAX_PASSWORD_LENGTH = 256

function assertUsable(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`password must be at most ${MAX_PASSWORD_LENGTH} characters`)
  }
}
