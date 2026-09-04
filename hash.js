/**
 * lib/hash.js — Lexigraphical Radix Mapping (LRM)
 *
 * Key formula:  key = sha64(payload) XOR sha64(prevKey)
 *
 * Where prevKey is the stored string key of the previous record ("0","1","aB",...).
 * Recovery: sha64(prevKey) = fromB64(key) XOR sha64(payload)
 * This allows verifying the parent key from any child without storing back-pointers.
 *
 * RESERVED: '0' and '1' are positional aliases — #0 = genesis, #1 = projection.
 * The stored key length grows logarithmically with collection size.
 * Records store the shortest non-colliding prefix of the full key.
 *
 * Token composition (vocabulary): id(token) = sha64(token_str) XOR id(left) XOR id(right)
 * B256 primitives: id(char) = sha64(char_str)  (Wu/null = 0n, implicit identity element)
 */

import { createHash } from 'crypto'

// 64-symbol alphabet: 0-9, a-z, A-Z, -, +
export const ALPHA = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-+'
export const RESERVED_1 = new Set(['0', '1'])

/**
 * Stable Lexigraphical JSON Serialization
 */
export function canonical(obj, _seen = new WeakSet()) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj)
  if (_seen.has(obj)) return '"[Circular]"'
  _seen.add(obj)
  if (Array.isArray(obj)) return '[' + obj.map(v => v === undefined ? null : v).map(v => canonical(v, _seen)).join(',') + ']'
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(obj[k], _seen)).join(',') + '}'
}

export function sha64(obj) {
  const data = (obj == null) ? '' : (typeof obj === 'string' ? obj : canonical(obj))
  const hash = createHash('sha256').update(data).digest()
  return hash.readBigUInt64BE(0)
}

/** High-resolution timestamp in nanoseconds (for event metadata, not key formula). */
export function nano() {
  return BigInt(Date.now()) * 1000000n + (process.hrtime.bigint() % 1000000n)
}

export function toB64(v) {
  let n = BigInt(v)
  if (n === 0n) return ALPHA[0]
  if (n < 0n) n = (2n ** 64n) + n
  let res = ''
  while (n > 0n) {
    res = ALPHA[Number(n % 64n)] + res
    n /= 64n
  }
  return res
}

export function fromB64(s) {
  if (!s) return 0n
  let res = 0n
  for (const c of s) {
    const idx = ALPHA.indexOf(c)
    if (idx === -1) continue
    res = res * 64n + BigInt(idx)
  }
  return res
}

export function toBits(str) {
  if (!str || typeof str !== 'string') return ''
  if (str === '0' || str === '1') return str === '0' ? '0' : '1'
  let n = fromB64(str)
  return n.toString(2)
}

/** Encode non-negative integer n in base-64 using ALPHA. Non-padded, big-endian. */
export const encodeSeq = toB64

/** Decode base-64 string back to a Number. */
export const decodeSeq = s => Number(fromB64(s))

/** Key length n → approximate record index (lower bound). */
export const keyLengthToPosition = n => 64 ** (n - 1)

/** Record index → expected key length at that position. */
export const positionToKeyLength = pos =>
  pos <= 0 ? 1 : Math.ceil(Math.log(pos + 1) / Math.log(64))

/**
 * Compute the full LRM key for a record.
 * prevKey: stored string key of the previous record, or null for the first real record.
 */
export function makeFullKey(payload, prevKey = null) {
  return toB64(sha64(payload) ^ sha64(prevKey))
}

/**
 * Recover sha64(prevKey) from a child record.
 * Returns BigInt. Verify: recoverPrevKeyHash(key, payload) === sha64(prevKey)
 */
export function recoverPrevKeyHash(key, payload) {
  return fromB64(key) ^ sha64(payload)
}

/**
 * Compute compositional token ID for vocabulary.
 * id(token) = sha64(token_str) XOR id(left) XOR id(right)
 * B256 primitives: id(char) = sha64(char_str) — no parents (Wu implicit as 0n)
 */
export function tokenId(tokenStr, leftId = 0n, rightId = 0n) {
  return sha64(tokenStr) ^ BigInt(leftId) ^ BigInt(rightId)
}

export function shortestPrefix(fullKey, bitsSet, minBits = 1) {
  const binaryKey = toBits(fullKey)
  for (let n = Math.max(1, minBits); n <= binaryKey.length; n++) {

    const p = binaryKey.slice(0, n)
    if (!bitsSet.has(p)) {
      const v = parseInt(p, 2)
      return { p: toB64(v), n, bits: p }
    }
  }

  return { p: fullKey, n: binaryKey.length, bits: binaryKey }
}

/**
 * Verify chain integrity.
 * Records #0 and #1 are reserved headers — skip crypto check.
 * All other records: stored key must be a binary prefix of the recomputed full key.
 */
export function verify(recs) {
  if (recs.length < 1) return { valid: true, length: 0 }
  let prevKey = null
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i]
    if (!r) continue
    const storedKey = Object.keys(r)[0]
    const payload = r[storedKey]
    if (storedKey === '0') { prevKey = '0'; continue }
    if (storedKey === '1') { prevKey = '1'; continue }
    const expectedFull = makeFullKey(payload, prevKey)
    if (!toBits(expectedFull).startsWith(toBits(storedKey))) {
      return { valid: false, failedAt: i, reason: `Key "${storedKey}" (${toBits(storedKey)}) not prefix of "${expectedFull}"` }
    }
    prevKey = storedKey
  }
  return { valid: true, length: recs.length }
}
