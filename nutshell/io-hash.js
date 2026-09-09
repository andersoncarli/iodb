/**
 * io-hash.js — the nutshell's view of the hash primitive.
 *
 * This file used to carry its own copy of the maths. Feature 2.2 proved the two
 * copies were identical — canonical, sha64, toB64, fromB64, toBits and
 * makeFullKey agreed on every payload tested and across the full 64-bit range —
 * so the copy is gone and this is now a re-export of the root module.
 *
 * The two interface differences were reconciled upstream rather than here:
 *   shortestPrefix returns { p, key, n, bits } — `p` and `key` are aliases.
 *   verify accepts both { [key]: payload } and { key, payload } records.
 *
 * Keeping this file (instead of pointing the engine at ../hash.js) preserves the
 * nutshell's import surface: io-nutshell.js still reads './io-hash'.
 */
export {
  ALPHA,
  RESERVED_1,
  canonical,
  sha64,
  nano,
  toB64,
  fromB64,
  toBits,
  encodeSeq,
  decodeSeq,
  keyLengthToPosition,
  positionToKeyLength,
  makeFullKey,
  recoverPrevKeyHash,
  tokenId,
  shortestPrefix,
  verify,
} from '../hash.js'
