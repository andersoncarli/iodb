/**
 * io-append.js — the indivisible part of a write, on its own.
 *
 * Feature 2.2 asked what is genuinely atomic in `flush()`. The answer is small:
 * *check whether the log grew, append, release*. Everything else the engine used
 * to do under the lock — saveIndex(), flushYaml() — publishes DERIVED state that
 * is reconstructible from the log, so it does not belong in the critical section.
 *
 * What is left is this file. It knows about locks, offsets and bytes. It does not
 * know what a key is, what a projection is, or what format the log is in — the
 * caller injects that through `compute`. That is what lets two very different
 * engines share it: io-engine.js (indexed, YAML projection, dash/jsonl) and
 * nutshell/io-nutshell.js (no index, JSON projection, jsonl only).
 *
 * Lock protocol (rename-based, unchanged from io-engine.js:52-77):
 *   free    → lockFile exists
 *   locked  → lockFile renamed to lockFile.<PID>
 *   acquire → renameSync(lockFile, lockFile.<PID>)  — atomic on POSIX, ENOENT if taken
 *   stale   → scan for lockFile.<pid>, kill(pid,0) for liveness, steal if dead
 *
 * The stale-holder sweep is why this is a file lock and not a shared-memory
 * mutex: a mutex bit does not survive `kill -9`, and a dead holder would pin it
 * forever. Crash recovery is non-negotiable here.
 */
import { statSync, renameSync, appendFileSync, readdirSync, writeFileSync } from 'fs'
import { dirname, basename, join } from 'path'

/**
 * Lock timeout scales with the file, because the work under the lock used to
 * scale with it too. A fixed 1000ms meant a store that worked today timed out at
 * ten times the size for no reason the caller could see.
 *
 * Feature 2.3 is expected to turn this back into a small constant — once 2.2 has
 * made the critical section O(1) in store size, a growing timeout has nothing
 * left to compensate for. It stays adaptive until that is measured, not assumed.
 */
export function lockTimeout(lockFile) {
  try { return Math.max(1000, Math.ceil(statSync(lockFile).size / 64)) } catch { return 1000 }
}

/**
 * Acquire the rename lock, returning the private lock path held by this process.
 *
 * The spin is a bare `while` on purpose. Yielding between attempts (Atomics.wait
 * on a throwaway buffer, the portable way to block synchronously) is the obvious
 * companion fix and was tried: it made things worse. The wait is synchronous, so
 * it blocks the whole thread — and when contention is between writers inside ONE
 * process, the sleeping waiter is blocking the very work it waits on. A bare spin
 * at least lets an async holder make progress.
 */
/**
 * Create the mutex once, and only once, for a given base.
 *
 * This is the subtle part, and getting it wrong silently destroys mutual
 * exclusion: while a process HOLDS the lock, the lock file does not exist —
 * acquire renamed it to `<lockFile>.<pid>`. So "create it if missing" is not a
 * safe idempotent init. A second process running that check mid-hold recreates
 * the mutex, and now there are two: the fresh `<lockFile>` and the held
 * `<lockFile>.<pid>`. Both processes proceed, inside the critical section, at
 * the same time.
 *
 * Measured: with each worker running create-if-missing, 8 of 120 critical
 * sections overlapped. With creation done exactly once, zero.
 *
 * `wx` is exclusive-create and atomic, so the race is decided by the kernel.
 * EEXIST means someone else won, which is success — and crucially, EEXIST also
 * covers "the lock exists because someone is holding it", which is why this
 * must never be paired with an existsSync guard.
 */
export function ensureLock(lockFile) {
  try { writeFileSync(lockFile, '', { flag: 'wx' }); return true }
  catch (e) { if (e.code === 'EEXIST') return false; throw e }
}

export function acquireLock(lockFile, timeout = lockTimeout(lockFile)) {
  const deadline = Date.now() + timeout
  const myLock = `${lockFile}.${process.pid}`
  while (Date.now() < deadline) {
    try {
      renameSync(lockFile, myLock)
      return myLock
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }
    // lockFile is gone — someone holds it. Check whether that someone is dead.
    const dir = dirname(lockFile), base = basename(lockFile) + '.'
    try {
      for (const file of readdirSync(dir)) {
        if (!file.startsWith(base)) continue
        const pid = parseInt(file.slice(base.length))
        if (!pid) continue
        try { process.kill(pid, 0) } catch {
          try { renameSync(join(dir, file), myLock); return myLock } catch { }
        }
      }
    } catch { }
  }
  throw new Error(`[IO] Lock timeout (${timeout}ms): ${lockFile}`)
}

/** Release by putting the lock file back where it was. */
export function releaseLock(myLock, lockFile) {
  renameSync(myLock, lockFile)
}

/**
 * Run one guarded append.
 *
 *   lockFile    path whose existence is the mutex
 *   logFile     append-only log
 *   lastOffset  the log size this caller last saw
 *   compute()   → { bytes, commit? }  produces what to append. Called once
 *               before the lock; called AGAIN inside the lock if the log grew
 *               meanwhile, so the caller can re-chain against what landed.
 *               `resynced` tells it which of the two it is.
 *   onResync(size)  optional: caller reloads its own state from the log first.
 *
 * Returns { bytes, offset, resynced, result } where `result` is whatever
 * `commit` returned — the caller's own bookkeeping, run while still holding the
 * lock but after the append has landed.
 *
 * Everything derived (indexes, projections, snapshots) belongs AFTER this call.
 * That is the whole point of the feature.
 */
export function appendGuarded({ lockFile, logFile, lastOffset = 0, compute, onResync, timeout }) {
  const size = () => { try { return statSync(logFile).size } catch { return 0 } }

  const myLock = acquireLock(lockFile, timeout ?? lockTimeout(lockFile))

  try {
    // Did anyone else append while we were getting here? A size comparison is
    // enough — the log is append-only, so a changed size means new records.
    const observed = size()
    const resynced = observed !== lastOffset
    if (resynced && onResync) onResync(observed)

    // `compute` runs INSIDE the lock, exactly once. Pre-computing outside it
    // and recomputing on conflict is the obvious optimisation and was tried:
    // it is only sound if `compute` is pure, and a chaining engine's is not —
    // it advances prevKey and claims prefixes. The speculative pass corrupted
    // the state the second pass then chained onto, and the corruption only
    // showed up across processes, where the resync actually fires.
    //
    // io-engine keeps its own pre-compute outside the lock, where it belongs:
    // there it is the reduce over the projection, which is genuinely pure.
    const plan = compute({ resynced, offset: resynced ? observed : lastOffset })

    const bytes = plan.bytes
    if (bytes && bytes.length) appendFileSync(logFile, bytes)
    const offset = (resynced ? observed : lastOffset) + (bytes ? bytes.length : 0)

    const result = plan.commit ? plan.commit({ offset, resynced }) : undefined
    return { bytes, offset, resynced, result }
  } finally {
    // Release even if compute/commit threw: a held lock outlives the error and
    // would strand every other writer until the timeout sweep reclaims it.
    try { releaseLock(myLock, lockFile) } catch { }
  }
}

/**
 * Publish a derived file safely from OUTSIDE the lock.
 *
 * With publication moved out of the critical section, two writers can race to
 * write the same derived file, and a slow one can land after a fast one — an
 * older index overwriting a newer. The arbiter: only publish if our offset is at
 * least the one already recorded on disk. `readOffset` extracts it from the
 * existing file (the caller knows its own header format); returning null means
 * "no readable file, go ahead".
 *
 * The temp file carries the PID. A fixed `.tmp` name was shared by every process
 * writing the same base, and they clobbered each other mid write→rename — that
 * was the bug feature 1.2 fixed, and it must not come back through this door.
 */
export function publishDerived({ file, content, offset, readOffset }) {
  if (readOffset && offset != null) {
    let existing = null
    try { existing = readOffset(file) } catch { existing = null }
    if (existing != null && existing > offset) return false
  }
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, content)
  renameSync(tmp, file)
  return true
}
