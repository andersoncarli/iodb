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
 * Lock protocol (presence-based, feature 2.3):
 *   free    → no lockFile.* exists at all
 *   locked  → lockFile.<PID> exists
 *   acquire → writeFileSync(lockFile.<PID>, '', {flag:'wx'})  — atomic on POSIX
 *   release → unlinkSync(lockFile.<PID>)
 *   stale   → scan for lockFile.<pid>, kill(pid,0) for liveness, unlink if dead
 *
 * ABSENCE MEANS FREE, and that is the whole design. The earlier protocol was
 * the other way round: a lock file that had to EXIST to mean free, and was
 * renamed away to mean held. That inversion is what made the mutex need a
 * birth — someone had to create the file once, and exactly once, before anyone
 * could take it. Getting that wrong destroyed mutual exclusion silently: while
 * a writer held the lock the file was absent, so a "create it if missing" init
 * running at that moment forged a SECOND mutex and let two writers in. (007
 * measured it: 8 of 120 critical sections overlapped.)
 *
 * With absence as the free state, that whole class of bug cannot be written. A
 * fresh directory is already in the correct state, so there is no init to race,
 * no once-only ceremony to get wrong, and nothing to clean up after a crash
 * except the dead holder's own file.
 *
 * The PID goes in the NAME, never the contents. This matters for crash
 * recovery: the sweep must identify the holder, and a name is set by the same
 * single atomic syscall that creates the file. Had the PID lived INSIDE the
 * file, there would be a window between create and write where the sweep finds
 * an empty file and cannot tell a just-born lock from a corrupt one — it would
 * either steal a live lock or hang forever. Putting it in the name closes that
 * window by construction.
 *
 * That stale-holder sweep is also why this is a file lock and not a
 * shared-memory mutex: a mutex bit does not survive `kill -9`, and a dead
 * holder would pin it forever. Crash recovery is non-negotiable here.
 */
import { statSync, renameSync, appendFileSync, readdirSync, writeFileSync, unlinkSync } from 'fs'
import { dirname, basename, join } from 'path'

/**
 * The lock timeout is a flat constant, and feature 2.3 is what earned it back.
 *
 * It used to scale with the size of the projection file, because the work under
 * the lock scaled with it too: the whole projection was rewritten inside the
 * critical section, so a bigger store really did need longer before a wait could
 * honestly be called a deadlock. That is a compensation, not a policy.
 *
 * 2.2 took the O(n) work out of the critical section and 2.1 measured what was
 * left — *stat, append, release*, flat in store size. A timeout that grows now
 * compensates for nothing, and a growing timeout is worse than a fixed one: it
 * turns a real deadlock into a long hang that scales with your data.
 *
 * 1000ms against a sub-millisecond critical section is ~three orders of
 * magnitude of headroom, which covers scheduler noise and a slow disk without
 * hiding a genuinely stuck holder. The stale-PID sweep in acquireLock, not the
 * timeout, is what handles a dead holder.
 */
export const LOCK_TIMEOUT = 1000

/** Back-compat shim: callers that still ask for a per-file timeout get the constant. */
export function lockTimeout(_lockFile) { return LOCK_TIMEOUT }

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
 * Kept as a no-op for callers written against the old protocol.
 *
 * There is nothing left to ensure. Under presence-semantics the free state is
 * "no file", which every directory already satisfies, so the mutex has no birth
 * to arrange and no once-only invariant to protect. Returning true preserves
 * the old contract ("the lock is ready to be taken") for existing call sites.
 */
export function ensureLock(_lockFile) { return true }

export function acquireLock(lockFile, timeout = LOCK_TIMEOUT) {
  const deadline = Date.now() + timeout
  const myLock = `${lockFile}.${process.pid}`
  const dir = dirname(lockFile), base = basename(lockFile) + '.'
  while (Date.now() < deadline) {
    // `wx` is exclusive-create: the kernel decides the race, and exactly one
    // caller can win. EEXIST means someone else holds it.
    try {
      writeFileSync(myLock, '', { flag: 'wx' })
      return myLock
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
    }
    // Held — but is the holder still alive? A `kill -9` leaves the file behind
    // with nobody to remove it, so without this sweep one dead process would
    // wedge every future writer.
    try {
      for (const file of readdirSync(dir)) {
        if (!file.startsWith(base)) continue
        const pid = parseInt(file.slice(base.length))
        if (!pid || pid === process.pid) continue
        try { process.kill(pid, 0) } catch {
          // Dead. Remove its lock and let the next spin take it normally,
          // rather than claiming it here: unlink-then-create keeps acquisition
          // in ONE place, so two processes reaping the same corpse still have
          // to fight over the `wx` above, where the kernel picks one winner.
          try { unlinkSync(join(dir, file)) } catch { }
        }
      }
    } catch { }
  }
  throw new Error(`[IO] Lock timeout (${timeout}ms): ${lockFile}`)
}

/**
 * Release by removing our own lock file. `lockFile` is unused now — releasing
 * no longer has to reconstruct the free state, because the free state is
 * nothing at all. The parameter stays for call-site compatibility.
 */
export function releaseLock(myLock, _lockFile) {
  unlinkSync(myLock)
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

  const myLock = acquireLock(lockFile, timeout ?? LOCK_TIMEOUT)

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
