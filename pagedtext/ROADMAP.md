# PagedText Roadmap

## Phase 0 — DX prototype

Done:

- array-like logical text
- Proxy numeric access
- cursor
- save/load/rollback
- atomic flush
- basic pages()
- `kind`
- `ws` default filling
- explicit `comment` filling

## Phase 1 — Real paged storage

**Done** (implemented but previously unmarked here):

- page reader — `pagedtext.js:218-230`
- page cache — `:160`
- logical line access without loading the whole file — `lineAt` `:261-266` via `locate` `:251`
- local page parsing — `:225-227`
- random page access by scan — `locate`
- page metadata — `pagesInfo` `:304-317`

No global index is required initially.

**Not done — the cache has no ceiling.** `:160` is a plain `Map` with no eviction, so any
full scan (`allLines`, `:244-248`, reachable from `.text`, `.slice`, `.map`, `.indexOf`)
materializes the whole file in memory. That is the very RAM ceiling paging exists to
remove.

## Phase 1.5 — Positional commit

Split out of Phase 3 because that is where the work actually sits: calling it "Phase 3"
hid it behind the Planner, and **O(dirty pages) does not need the full Planner** — it
needs page-local mutation plus a dirty set.

**Not done. This is the gap.**

- `flush()` (`:281-298`) reads and re-renders **every** page and calls `atomicReplace()`
  — a full rewrite. The header comment at `:18` claims "written with a positioned
  writeSync, so only the dirty page pays". It does not.
- The `dirty` flag is written at `:205`, `:228`, `:275` and cleared at `:297`, and
  **never read in a decision position**.
- `ftruncateSync` is imported at `:2` and never called.
- Every mutating array op (`push`/`pop`/`splice`/index set) calls `allLines()` +
  `replaceAll()` (`:452-481`, `:515-523`) — each single mutation rewrites the whole file.

Prerequisite: **every data page must occupy exactly `pageSize`**. Today `renderPage`
(`:93-110`) returns a short buffer for an oversized line, so a page offset is not
computable and positional writing is incorrect. An oversized line must occupy k
contiguous pages, declared in the header.

- sparse ChangeSet
- region selection
- local repagination
- write only planned regions

## Phase 2 — Planner

Designed in `PLANNER.md` (227 lines, no code). What Phase 1.5 does not need stays here as
optimization, not correction:

- distribute filling uniformly
- semantic-boundary hints
- `maxShiftBytes`
- greedy region expansion

## Phase 3 — Commit

**Done — the atomicity half:**

- fsync — `atomicReplace` `:136-150`
- atomic rename — `:148`
- temp-file naming with PID + random — `:137`

**Not done — the incremental half.** "Copy unchanged regions / write planned regions"
moved to Phase 1.5, which is where the work belongs.

- recovery/temporary-file handling

## Phase 4 — Kinds

Add format-specific strategies without changing the storage API:

- CSV
- JSON
- Markdown
- C-like refinement
- YAML

Each kind should minimize semantic impact rather than impose a proprietary storage format.

## Phase 5 — Advanced access

- byte cursor
- forward/reverse streams
- reverse line iteration (`reverse()` at `:482` is a materializing copy, not an iterator)
- block/delimited views
- persistent page index

## Phase 6 — Concurrency

Not in the original framing, and now unavoidable: **multiple OS processes open the same
PagedText file.** Tracked in the iodb project as front 4.

- per-page generation counters in the header (`gen[]`)
- header-page arbitration: the header read-modify-write takes a lock, data pages are
  written positionally outside it
- multi-page header extent (`headerPages: k`) — `gen[]`, `pages[]` and `keys[]` all grow
  with the page count and today must fit in one 4096-byte header, capping a file at
  ~300 data pages
- conflict resolution: re-read-and-reapply for keyed layouts, rebuild-from-source for
  sequential ones, where order is the identity

## Consumers

`iodb` builds on PagedText through `src/paged-projection.js`, which is a codec (key/value
line encoding) and a key index (split keys) over a PagedText store — **not** a second
storage engine. PagedText owns the header, page offsets, the cache, the dirty set and the
commit; it does not know what a key, a projection or a `.dash` is.

That contract is the **target**, not yet the state: today `paged-projection.js` is an
independent reimplementation with its own magic (`PAGEDPROJ` v1 against `PAGEDTEXT` v2),
and nothing in iodb's `src/` imports PagedText at all. Convergence is iodb feature 2.0.

Two consequences for this roadmap:

- **Synchronous is a hard requirement, not a preference.** iodb writes inside a lock
  critical section; an `await` there reopens the section. No `node:fs/promises` in
  PagedText.
- **Concurrency is in scope.** See Phase 6.

## Non-goals

PagedText is not intended to become:

- a database
- a general parser framework
- an AST store
- a proprietary file format
- a globally indexed text database by default
