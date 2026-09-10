/**
 * index-bitmap.js — the name allocator, and nothing else (feature 1.5).
 *
 * The `.index` used to be write-only. `saveIndex()` wrote `prefixes=` (the whole
 * prefix set, one comma-joined bit-string per record) and `levels`, and nobody
 * ever read either back: the only reader extracted `lastOffset` and threw the
 * rest away. So every writer rebuilt the prefix set by re-reading the log,
 * record by record, to answer a question the file beside it already knew.
 *
 * That is what this module ends. It owns ONE question — *which binary prefixes
 * are already taken, by level?* — and answers it from memory, with no lock and
 * no disk. From that single fact everything else derives: `allocKey` for the
 * write path, `lookup` for the read path, `levels()` for the shape of the
 * collection, and a file small enough to load at open() instead of a log scan.
 *
 * It is deliberately NOT a catalogue of objects, NOT a history, NOT a
 * projection. Those are the `.dash` and the `.yaml`.
 *
 * ## Why bitmaps and not the prefix set
 *
 * A level `L` has exactly `2^L` possible prefixes, so occupancy at that level is
 * `2^L` bits — a dense array, not a sparse set. Level 6 is 64 bits, one BigInt.
 * The old `prefixes=` line stored every prefix as text and grew linearly with
 * the record count; the bitmap for a level is fixed-size no matter how full it
 * gets, and "is this prefix taken" becomes a bit test instead of a string hash.
 *
 * `count` per level is what the old `levels` was reaching for but never used:
 * with it, `count === 2^L` means the level is CLOSED and the allocator can skip
 * it outright instead of discovering the fact one failed probe at a time.
 *
 * The RAM ceiling is real and known: level 24 (~16M records) is about 4 MB
 * across all levels, level 30 would be 256 MB. Feature 1.5 assumes collections
 * in the millions; 4K paging is 2.4/2.5's problem, and the per-level split here
 * is what makes that paging possible later without touching callers.
 */

/** Levels above this are stored sparsely — a dense 2^L bitmap stops being sane. */
const DENSE_MAX = 20

export function makeBitmaps() {
  // level → { count, bits: BigInt } for L <= DENSE_MAX, { count, set: Set } above.
  return { levels: new Map() }
}

function levelOf(bm, L) {
  let lv = bm.levels.get(L)
  if (!lv) {
    lv = L <= DENSE_MAX ? { count: 0, bits: 0n } : { count: 0, set: new Set() }
    bm.levels.set(L, lv)
  }
  return lv
}

/** Capacity of level L, as a BigInt (2^L distinct prefixes of length L). */
export const capacityOf = L => 1n << BigInt(L)

/** Is the binary prefix `bits` already taken? */
export function has(bm, bits) {
  const lv = bm.levels.get(bits.length)
  if (!lv) return false
  if (lv.set) return lv.set.has(bits)
  return (lv.bits & (1n << BigInt(parseInt(bits, 2)))) !== 0n
}

/** Mark `bits` taken. Returns false if it already was — the caller's collision signal. */
export function add(bm, bits) {
  if (!bits) return false
  const lv = levelOf(bm, bits.length)
  if (lv.set) {
    if (lv.set.has(bits)) return false
    lv.set.add(bits); lv.count++
    return true
  }
  const mask = 1n << BigInt(parseInt(bits, 2))
  if ((lv.bits & mask) !== 0n) return false
  lv.bits |= mask; lv.count++
  return true
}

/** A level is closed when every prefix of that length is spoken for. */
export function isClosed(bm, L) {
  const lv = bm.levels.get(L)
  if (!lv) return false
  return BigInt(lv.count) >= capacityOf(L)
}

/**
 * `lookup` has TWO modes, because two different callers ask two different
 * questions and conflating them is how an index starts lying.
 *
 *   an ID (a stored short key)  → EXACT match. "Does this name exist, and at
 *                                 what level?" Used by get/dedup/target
 *                                 resolution, where a prefix match would be a
 *                                 false positive.
 *   a HASH (a long bit-string)  → SHORTEST-PREFIX match, capped by `upto`.
 *                                 "Does any level already claim a prefix of
 *                                 this?" This is a membership question for
 *                                 callers that hold a hash and want to know
 *                                 whether the collection knows anything on that
 *                                 path — NOT the allocator's collision test.
 *                                 `allocKey` compares names whole; see there.
 *
 * Cost is O(L) bit tests in memory — L is log₆₄ n, so tens of nanoseconds and
 * sub-microsecond well past 10⁹ records. No disk, no lock.
 */
export function lookup(bm, bits, { exact = false, upto = null } = {}) {
  if (exact) {
    return has(bm, bits) ? { exists: true, level: bits.length } : { exists: false, level: null }
  }
  const L = Math.min(upto ?? bits.length, bits.length)
  for (let l = 1; l <= L; l++) {
    if (has(bm, bits.slice(0, l))) return { exists: true, level: l }
  }
  return { exists: false, level: null }
}

/**
 * Choose the shortest free prefix of `bits`, and CLAIM it.
 *
 * This is `shortestPrefix(fullKey, prefixSet)` with the set replaced by the
 * bitmaps — same contract, but it can skip a closed level in O(1) instead of
 * probing it, and it never needs the set rebuilt from the log first.
 *
 * The level-up is also what makes a salt unnecessary. Two records with the same
 * payload and the same target produce the SAME full key; the first takes
 * `bits[0..L]`, the second finds it occupied and moves to `bits[0..L+1]` — a
 * different name, still a valid prefix of the same full key, so both verify.
 * Identical content, distinct keys, no seq counter anywhere.
 *
 * `startAt` is a hint only (positionToKeyLength of the record count). Too low
 * costs extra iterations; it can never produce a wrong answer, because every
 * level below is still checked for a colliding claim.
 */
export function allocKey(bm, bits, startAt = 1) {
  for (let L = Math.max(1, startAt); L <= bits.length; L++) {
    if (isClosed(bm, L)) continue
    const p = bits.slice(0, L)
    // The collision test is EXACT occupancy of this bit-string, not a prefix
    // relation — the same rule `shortestPrefix(fullKey, prefixSet)` has always
    // applied, with the set swapped for a bitmap.
    //
    // Rejecting a level because some SHORTER prefix is taken looks stricter and
    // safer, and it is neither: it is unsatisfiable. If '1' is claimed, then '1'
    // prefixes every longer prefix of that same path, so every level would be
    // rejected down to the fallback, and two identical payloads would both land
    // on the raw full key instead of on '1' and '10'. Measured before this
    // comment existed.
    //
    // Nothing is lost by allowing it, because a key is never resolved as a
    // prefix of another key. Names are compared whole, and `verify()` asks only
    // that a stored key be A prefix of the full key it recomputes — so '1' and
    // '10' are two distinct names that each verify against their own record.
    if (has(bm, p)) continue
    add(bm, p)
    return { bits: p, level: L }
  }
  // Exhausted: fall back to the full key. Only reachable if every prefix of a
  // 64-bit hash is claimed, which needs the collection to be astronomically
  // larger than the RAM ceiling above.
  add(bm, bits)
  return { bits, level: bits.length }
}

/** Occupancy per level — the "shape" of the collection, for 2.4. */
export function levels(bm) {
  const out = {}
  for (const [L, lv] of [...bm.levels.entries()].sort((a, b) => a[0] - b[0]))
    out[L] = { count: lv.count, closed: isClosed(bm, L) }
  return out
}

export function totalCount(bm) {
  let n = 0
  for (const lv of bm.levels.values()) n += lv.count
  return n
}

/**
 * Serialize to the `.index` body — one line per level, base64 for dense levels.
 *
 * Dense levels ship the raw bitmap because it is fixed-size and self-describing;
 * sparse ones ship their prefixes as text, since above DENSE_MAX the occupied
 * set is vastly smaller than 2^L and a dense encoding would be mostly zeros.
 */
export function serialize(bm) {
  let out = ''
  for (const [L, lv] of [...bm.levels.entries()].sort((a, b) => a[0] - b[0])) {
    if (lv.set) {
      out += `${L}${JSON.stringify({ count: lv.count, keys: [...lv.set] })}\n`
    } else {
      const bytes = Math.ceil(Number(capacityOf(L)) / 8) || 1
      const buf = Buffer.alloc(bytes)
      let n = lv.bits
      for (let i = 0; i < bytes && n > 0n; i++) { buf[i] = Number(n & 0xffn); n >>= 8n }
      out += `${L}${JSON.stringify({ count: lv.count, bits: buf.toString('base64') })}\n`
    }
  }
  return out
}

/** Inverse of serialize. Unknown/garbled lines are skipped, not fatal — the
 *  caller can always rebuild from the .dash, so a bad index costs a rescan, not
 *  the data. */
export function deserialize(body) {
  const bm = makeBitmaps()
  for (const line of String(body).split('\n')) {
    if (!line) continue
    const m = /^(\d+)(\{.*\})$/.exec(line)
    if (!m) continue
    let d
    try { d = JSON.parse(m[2]) } catch { continue }
    const L = Number(m[1])
    const lv = levelOf(bm, L)
    lv.count = d.count ?? 0
    if (d.keys) { lv.set = new Set(d.keys) }
    else if (d.bits) {
      const buf = Buffer.from(d.bits, 'base64')
      let n = 0n
      for (let i = buf.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(buf[i])
      lv.bits = n
    }
  }
  return bm
}
