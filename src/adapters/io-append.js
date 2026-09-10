/**
 * io-append.js — the indivisible part of a write, on its own.
 *
 * Feature 4.2 asked what is genuinely atomic in `flush()`. The answer is small:
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
 * Lock protocol (presence-based, feature 4.3; per-file since 1.5):
 *   free    → no <base>.<pid>.lock.<file> exists at all
 *   locked  → <base>.<pid>.lock.<file> exists
 *   acquire → scan for live holders, create ours, RECHECK, lowest pid wins
 *   release → unlinkSync(our own path)
 *   stale   → kill(pid,0) on each holder found by the scan, unlink if dead
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
import { statSync, renameSync, appendFileSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'fs'
import { dirname, basename, join } from 'path'

/**
 * The lock timeout is a flat constant, and feature 4.3 is what earned it back.
 *
 * It used to scale with the size of the projection file, because the work under
 * the lock scaled with it too: the whole projection was rewritten inside the
 * critical section, so a bigger store really did need longer before a wait could
 * honestly be called a deadlock. That is a compensation, not a policy.
 *
 * 4.2 took the O(n) work out of the critical section and 4.1 measured what was
 * left — *stat, append, release*, flat in store size. A timeout that grows now
 * compensates for nothing, and a growing timeout is worse than a fixed one: it
 * turns a real deadlock into a long hang that scales with your data.
 *
 * The value still does NOT scale with data — that part of the 4.3 argument
 * stands. What feature 1.5 changed is that the mutex now actually excludes
 * (acquireLock had built a per-PID path, so every writer used to "win"
 * instantly). With real mutual exclusion, N contending writers genuinely queue,
 * and the wait a non-holder sees is N × (someone else's critical section), not
 * scheduler noise on top of an uncontended take. 1000ms was tripping `Lock
 * timeout` on loaded machines under the concurrency suites for a lock that WAS
 * being served, just slowly. 3000ms covers the realistic queue depth (the
 * matrix test now caps its own load at 3 processes per cell) while staying
 * flat and ~three orders of magnitude above the microsecond-scale section in
 * the uncontended case. The stale-PID sweep, not the timeout, still handles a
 * genuinely dead holder.
 */
export const LOCK_TIMEOUT = 3000

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

/**
 * One lock PER MUTABLE FILE (feature 1.5).
 *
 * `acquireLock(base)` reserves the whole family, as before. `acquireLock(base,
 * 'index')` reserves ONLY the `.index`. The held path names what is reserved:
 *
 *   <base>.<pid>.lock          the family (legacy single-mutex callers)
 *   <base>.<pid>.lock.dash     this process is mutating the .dash
 *   <base>.<pid>.lock.index    ... the .index
 *   <base>.<pid>.lock.yaml     ... the .yaml
 *
 * Why per file: the triad `.dash`/`.index`/`.yaml` is published in three short
 * windows, not one long one. Under a single mutex, publishing a derived file
 * would hold the append path hostage for the duration of a whole rewrite. With
 * separate locks, two processes mutating DIFFERENT files of the same entity do
 * not block each other at all, and the fixed order `.dash` → `.index` → `.yaml`
 * is what keeps a cycle from forming.
 *
 * The PID moves back into the NAME, and the mutex is no longer the `wx` alone.
 * `wx` on a per-PID path can never collide, so it excludes nothing by itself —
 * that was the false mutex this feature already fixed once. Here exclusion comes
 * from **scan + recheck with a deterministic tie-break**: look for other live
 * holders of this file, create our own path only when there are none, then look
 * AGAIN; if someone with a LOWER pid appeared in the window, we yield to them.
 * A total order on pid means the two racers never both yield and never both
 * proceed.
 *
 * The gain over PID-in-contents is that `readdir` alone answers *who holds it*,
 * with no file to open and no window between create and write where a sweep
 * finds an empty file it cannot classify.
 */
function lockPathsFor(base, file) {
  const dir = dirname(base) || '.'
  // Callers written against the single-mutex protocol pass `f.lock`, which is
  // already `.lock`-suffixed; the per-file callers pass the bare base. Strip it
  // so both land on the SAME stem — otherwise the family lock and the per-file
  // locks would be two unrelated namespaces that never see each other's holders.
  const stem = basename(base).replace(/\.lock$/, '')
  const suffix = file ? `.lock.${file}` : '.lock'
  // `<stem>.<pid><suffix>` — anchored both ends so `.lock.index` never matches a
  // scan for `.lock` (the family lock) and vice versa.
  const re = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(\\d+)${suffix.replace(/\./g, '\\.')}$`)
  return { dir, mine: join(dir, `${stem}.${process.pid}${suffix}`), re }
}

/** Live holders of this file other than us; sweeps dead ones as it goes. */
function liveHolders(dir, re) {
  let names = []
  try { names = readdirSync(dir) } catch { return [] }
  const live = []
  for (const n of names) {
    const m = re.exec(n)
    if (!m) continue
    const pid = parseInt(m[1])
    if (!pid || pid === process.pid) continue
    try { process.kill(pid, 0); live.push(pid) } catch {
      // Dead holder: `kill -9` leaves the file with nobody to remove it, so
      // without this sweep one corpse wedges every future writer forever.
      try { unlinkSync(join(dir, n)) } catch { }
    }
  }
  return live
}

export function acquireLock(base, fileOrTimeout, maybeTimeout) {
  // Back-compat: acquireLock(path) and acquireLock(path, timeout) still work.
  const file = typeof fileOrTimeout === 'string' ? fileOrTimeout : null
  const timeout = (typeof fileOrTimeout === 'number' ? fileOrTimeout : maybeTimeout) ?? LOCK_TIMEOUT
  const deadline = Date.now() + timeout
  const { dir, mine, re } = lockPathsFor(base, file)

  while (Date.now() < deadline) {
    if (liveHolders(dir, re).length === 0) {
      try {
        // `wx` on OUR path. It does not provide the exclusion — the scan does —
        // but it does guarantee we never silently adopt a stale file of our own
        // pid left behind by an earlier crash in this same process id.
        writeFileSync(mine, '', { flag: 'wx' })
      } catch (e) {
        if (e.code !== 'EEXIST') throw e
        // Our own path already exists: a previous holder with our pid number.
        // Take it over — `liveHolders` skips our pid, so nobody else will.
        try { unlinkSync(mine) } catch { }
        continue
      }
      // Recheck. Between the scan and the create, another process may have done
      // exactly the same thing, and now two files exist.
      //
      // Yielding only to a LOWER pid is not enough, and measuring it is how that
      // showed: 9 overlaps in 240 sections, every one of them a lower pid
      // walking in on a higher pid that already held. The asymmetry is the bug —
      // the higher pid yields, but the lower one sees a rival it outranks and
      // proceeds anyway, straight into the section the higher pid is running.
      //
      // So ANY rival in the window makes us back off. That alone would livelock
      // (both drop, both retry, both collide again), which is what the pid order
      // is actually for: the lower pid retries immediately, the higher one waits
      // out the other's section first. Rank breaks the tie; it does not grant
      // entry.
      const rivals = liveHolders(dir, re)
      if (rivals.length) {
        try { unlinkSync(mine) } catch { }
        if (rivals.every(p => p > process.pid)) continue
        // Outranked: let the winner actually run before we scan again, instead
        // of spinning on a directory we already know is occupied.
        while (Date.now() < deadline && liveHolders(dir, re).length) { /* spin */ }
        continue
      }
      return mine
    }
  }
  throw new Error(`[IO] Lock timeout (${timeout}ms): ${mine}`)
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
 *   onPhase(name, ns)  optional timing hook, zero cost when absent. Fires with
 *               `'lockWait'` (nanoseconds spent spinning in acquireLock) and
 *               `'critical'` (nanoseconds the lock was actually held: resync +
 *               compute + append + commit). Both engines route through here, so
 *               the two numbers are apples to apples across io-engine and the
 *               nutshell — everything else each engine does (its projection, its
 *               index) is OUTSIDE this call by design and is not counted.
 *
 * Returns { bytes, offset, resynced, result } where `result` is whatever
 * `commit` returned — the caller's own bookkeeping, run while still holding the
 * lock but after the append has landed.
 *
 * Everything derived (indexes, projections, snapshots) belongs AFTER this call.
 * That is the whole point of the feature.
 */
export function appendGuarded({ lockFile, logFile, lastOffset = 0, compute, onResync, onPhase, timeout }) {
  const size = () => { try { return statSync(logFile).size } catch { return 0 } }

  const _w0 = onPhase ? process.hrtime.bigint() : 0n
  const myLock = acquireLock(lockFile, timeout ?? LOCK_TIMEOUT)
  if (onPhase) onPhase('lockWait', Number(process.hrtime.bigint() - _w0))
  const _c0 = onPhase ? process.hrtime.bigint() : 0n

  try {
    // Did anyone else append while we were getting here? A size comparison is
    // enough — the log is append-only, so a changed size means new records.
    // `observed` is the REAL file size under the lock; use it, not the caller's
    // possibly-drifted lastOffset, for the returned offset. lastOffset drifts
    // because a caller that adds only its own bytes each guarded write falls
    // below the true size once other writers have landed between its writes —
    // and then a later `resynced` check reads false when records are in fact
    // unseen. That was half of feature 1.5's key-collision.
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
    // `observed` + our bytes: we hold the lock, so nothing landed between the
    // stat above and this append. Always the true post-append size, no drift.
    const offset = observed + (bytes ? bytes.length : 0)

    const result = plan.commit ? plan.commit({ offset, resynced }) : undefined
    return { bytes, offset, resynced, result }
  } finally {
    // Release even if compute/commit threw: a held lock outlives the error and
    // would strand every other writer until the timeout sweep reclaims it.
    try { releaseLock(myLock, lockFile) } catch { }
    if (onPhase) onPhase('critical', Number(process.hrtime.bigint() - _c0))
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
export function publishDerived({ file, content, offset, readOffset, lockBase, lockName }) {
  // Without a lock this whole function is a read-compare-write, and that is not
  // atomic no matter how atomic the rename is. Two writers both read `existing`,
  // both decide to publish, and the one holding the OLDER content can win the
  // rename by arriving second — an older file overwriting a newer one, with the
  // arbiter having approved both. The rename cannot fix it because the decision
  // was already made on stale information.
  //
  // Taking the file's own lock closes exactly that window, and only that one.
  // It is a different lock from the .dash's, so publishing a derived file never
  // blocks an append (feature 1.5).
  const held = lockBase ? acquireLock(lockBase, lockName) : null
  try {
    if (readOffset && offset != null) {
      let existing = null
      try { existing = readOffset(file) } catch { existing = null }
      if (existing != null && existing > offset) return false
    }
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, content)
    renameSync(tmp, file)
    return true
  } finally {
    if (held) { try { releaseLock(held) } catch { } }
  }
}
