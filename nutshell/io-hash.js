import { createHash } from 'crypto'

// ── Hashing ──────────────────────────────────────────────────────
const B64 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-+'

export function canonical(obj, _seen = new WeakSet()) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj)
  if (_seen.has(obj)) return '\"[Circular]\"'
  _seen.add(obj)
  if (Array.isArray(obj)) return '[' + obj.map(v => canonical(v ?? null, _seen)).join(',') + ']'
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(obj[k], _seen)).join(',') + '}'
}

export function sha64(obj) {
  const data = obj == null ? '' : typeof obj === 'string' ? obj : canonical(obj)
  return createHash('sha256').update(data).digest().readBigUInt64BE(0)
}

export function toB64(n) {
  n = BigInt(n); if (n < 0n) n += 2n ** 64n
  if (n === 0n) return B64[0]
  let r = ''; while (n > 0n) { r = B64[Number(n % 64n)] + r; n /= 64n }
  return r
}

export function fromB64(s) {
  let r = 0n
  for (const c of s) { const i = B64.indexOf(c); if (i >= 0) r = r * 64n + BigInt(i) }
  return r
}

export function toBits(s) {
  if (s === '0') return '0'; if (s === '1') return '1'
  return fromB64(s).toString(2)
}

/**
 * key = sha64(payload) XOR sha64(prevKey)
 * prevKey: stored string key of the previous record, or null for first record.
 * Recovery: sha64(prevKey) = fromB64(key) XOR sha64(payload)
 */
export function makeFullKey(payload, prevKey) {
  return toB64(sha64(payload) ^ sha64(prevKey))
}

export function recoverPrevKeyHash(key, payload) {
  return fromB64(key) ^ sha64(payload)
}

/** Token composition: id(token) = sha64(str) XOR id(left) XOR id(right) */
export function tokenId(str, leftId = 0n, rightId = 0n) {
  return sha64(str) ^ BigInt(leftId) ^ BigInt(rightId)
}

export function shortestPrefix(fullKey, bitsSet) {
  const bin = toBits(fullKey)
  for (let n = 1; n <= bin.length; n++) {
    const p = bin.slice(0, n)
    if (!bitsSet.has(p)) return { key: toB64(parseInt(p, 2)), bits: p }
  }
  return { key: fullKey, bits: bin }
}

export function verify(records) {
  let prevKey = null
  for (let i = 0; i < records.length; i++) {
    const { key, payload } = records[i]
    if (key === '0') { prevKey = '0'; continue }
    if (key === '1') { prevKey = '1'; continue }
    const expected = toBits(makeFullKey(payload, prevKey))
    if (!expected.startsWith(toBits(key)))
      return { valid: false, failedAt: i, key, expected }
    prevKey = key
  }
  return { valid: true, length: records.length }
}
