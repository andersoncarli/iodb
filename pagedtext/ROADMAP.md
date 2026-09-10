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

**The cache ceiling was added in sprint 015.** It used to be a plain `Map` with no
eviction, so any full scan (reachable from `.text`, `.slice`, `.map`, `.indexOf`)
materialized the whole file in memory — the very RAM ceiling paging exists to remove.
Eviction now respects dirty pages, and `cachePages` sets the bound.

## Phase 1.5 — Positional commit

Split out of Phase 3 because that is where the work actually sits: calling it "Phase 3"
hid it behind the Planner, and **O(dirty pages) does not need the full Planner** — it
needs page-local mutation plus a dirty set.

**Done — sprint 015, iodb feature 2.0.** One data page per append, at any file size.
Measured on the case the docs call fundamental (append-only CSV, 900ms time fence):
**1.01 pages/append at 0.3MB, 1.01 at 3MB, 1.02 at 12.3MB** — a 39x larger file costs
1.01x per append.

**The genesis is not rewritten, and since iodb feature 2.1 it does not occupy page 0
either — it travels in the trailer.** It carries only what never changes once the file
exists: magic, version, pageSize, layout, kind. Keeping it in page 0 cost the file its
first line: a CSV parser read the genesis as a record and `head -1` showed metadata
instead of data. In the trailer it occupies nothing the format needs, and **page 0 is a
data page like any other**, so a paged `.csv` starts at its first record. The per-page
statistics — line counts, extents, split keys, logOffset — have one entry per page, so
keeping them in the header made it grow with the file and be rewritten whole on every
commit (55 pages per append at 12MB). They now live in a **trailer** at the end, where
growing only moves forward and displaces no data page.

The trailer has two regimes and neither is a source of truth: **volatile** (default,
rebuilt on every flush) or **checkpoint** (`checkpointEvery: N`, written every N flushes —
between them an append writes one data page and nothing else). That is safe because pages
are self-describing: alignment says where each one starts and filling says where its
content ends, so whatever a checkpoint leaves behind is rebuilt on open by reading the
pages.

- `flush()` walks only the dirty set and writes each page with a positioned `writeSync`.
  There is no header page to rewrite; the trailer follows the regime above.
- The `dirty` flag stopped being decorative: a dirty set now governs what gets written.
- `ftruncateSync` is called when the file shrinks.
- Every mutating array op is page-local: it locates the page and rewrites only it,
  repaging the tail only when a page overflows.

**Durability is fsync on the same fd, not temp+rename.** Rewriting the file into a temp
copy in order to rename it is precisely the cost this phase removes. A torn page is
recovered by rebuilding from the consumer's source of truth — the doctrine already applied
to a corrupt page.

**The prerequisite, also done: the alignment invariant.** Every data page occupies an
exact multiple of `pageSize`, and a line longer than a page occupies k contiguous pages
with k recorded in `extents[]`. Previously `renderPage` returned a short buffer for an
oversized line, which left every later page offset undefined.

Still open, and deliberately so — these are optimization, not correction:

- sparse ChangeSet
- greedy region expansion

## Phase 2 — Planner

Designed in `PLANNER.md` (227 lines, no code). What Phase 1.5 does not need stays here as
optimization, not correction:

- distribute filling uniformly
- semantic-boundary hints
- `maxShiftBytes`
- greedy region expansion

## Phase 3 — Commit

**Done — the incremental half**, in Phase 1.5. "Copy unchanged regions / write planned
regions" is what positional commit means, and it landed there.

**Superseded — the atomicity half.** The store used to commit through temp + fsync +
atomic rename (`atomicReplace`). That is still how the cursor state file is written, but
the store itself no longer uses it: rename requires materializing the whole file, which
defeats O(dirty pages). Durability is now fsync on the same fd after the positioned
writes.

The trade this makes, stated plainly: a crash mid-commit can leave a torn page, where
rename could not. That is the doctrine this project already applies — a corrupt page is
discarded and rebuilt from the consumer's source of truth, never repaired in place. What
is still open is making that detectable rather than silent:

- per-page generation counter, so a reader can tell a page moved under it
- recovery/temporary-file handling

Both are tracked as iodb front 4 (see Phase 6).

## Phase 4 — Kinds

**Started — iodb feature 2.1.** Format-specific strategies, with no change to the storage
API. The point of a kind is no longer only *what a filling line looks like*: **filling is
syntax of the format, not garbage the parser has to tolerate.**

| kind | filling | rationale |
|---|---|---|
| `clike` | ` //---` | a comment; survives a trailing-whitespace trim |
| `text`, `yaml` | ` #---` | idem |
| `csv`, `jsonl` | ` ,` | an extra delimited field: a plain reader sees one more column and ignores it, and the line ends in a comma, so an editor that trims line ends has nothing to trim |

Two consequences that are the reason this phase is worth having:

- **Zero NUL bytes.** `file(1)` says text and `grep` without `-a` finds content.
- **The trailer wears the format's clothes.** In `csv`/`jsonl` it hides as a record whose
  first field is empty; in the comment formats both of its lines start with the comment
  prefix. Without this the stats JSON came back as the file's last record.

Still open: Markdown, and JSON proper (as opposed to `jsonl`).

**A kind declares where its filling stops being neutral, rather than working around it in
silence.** A line of filling is neutral in `csv` and `jsonl`, and legal in `yaml` between
top-level keys; it is **not** neutral inside a YAML block scalar (`|`, `>`), where no
comment is recognized and the filling line becomes part of the string. There is no byte
sequence that is both filling and nothing in there. So `kindRestrictions('yaml')` returns
that restriction at runtime, and breaking a page outside a block scalar is the caller's
responsibility, not the storage's.

**Validation, because removal cannot be prevented.** Nothing stops an external editor from
stripping the filling, but the damage is detectable: `validate(file)` checks alignment (the
size is an exact multiple of `pageSize`), the absence of NUL bytes and that the trailer's
declared page count fits in the file.

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
