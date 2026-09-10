# iodb

**A reactive append-only database over a triple of plain-text files.**

The log is the truth. The projection and the index are derived — deletable, rebuildable, never authoritative. Every write is permanent, every key is a proof, every mutation is observable. `cat` still works on all three files.

If you know [`io-nutshell`](nutshell/io-nutshell.md), you know the shape. `iodb` is the production sibling: same five verbs, plus a real name index, a dedicated lockfile for safe multi-process writes, and an opt-in paged projection for stores larger than RAM.

---

## The Triple

```
state.dash    ← append-only log (the truth)
state.yaml    ← projection snapshot (the human view)
state.index   ← key→allocation index (fast open, no rescan)
```

The `.dash` is an immutable sequence of patches — the write-ahead log, except nothing is ahead of it. The `.yaml` is the reduced state, readable in an editor, republished periodically. The `.index` records which short keys are taken, so opening a large store does not mean replaying the whole log.

Lose the `.yaml` or the `.index` and nothing is lost — both rebuild from the `.dash`. Corrupt one page of either and the engine discards it and rebuilds rather than trusting it.

---

## The Interface

```js
import IO, { merge } from './src/io-engine.js'

const users = IO('./data/users', { reduce: merge, initial: {} })
users.open()                          // seed genesis, load the index

const k = users.in({ name: 'alice' }) // write → '#5' (the returned key)
users.in({ age: 30 })                 // write → '#4'

users.get('name')                    // → 'alice'
users.get(k)                         // → { name: 'alice' }   (by its hash key)
users.state()                        // → the projection, genesis fields and all

const off = users.out(({ key, payload }) => { /* fires after the append */ })
off()

users.verify()                       // → { valid: true, length: 4 }
users.close()                        // flush the deferred YAML projection
```

`get()` and `state()` return the *reduced* projection — under `merge` the genesis records fold in, so it carries `_entity` / `_projection` alongside your data. `header()` reads `#0`; `find(pred)` filters payloads with genesis excluded.

Same five verbs as the nutshell — `in` / `out` / `get` / `flush` / `verify` — plus `open()` / `close()` bracketing the session. `open()` seeds genesis and loads the index; `close()` flushes the YAML projection, which is republished only every 100th write during the session.

| Verb | Does |
|------|------|
| `open(payload)` | Seed record `#0`, load the `.index`, delta-sync the projection. |
| `in(record, {flush})` | Write a patch, reduce into state, append to the log, return `#key`. `flush:0` buffers. |
| `out(fn)` | Subscribe to future writes. Fires synchronously after the append lands. Returns `off()`. |
| `get()` / `get('#key')` | Read the projection, or one record by its hash key. |
| `flush()` | Pre-compute keys, take the lock, verify the chain, append the batch, release. |
| `verify()` | Replay the log, re-derive every key, confirm the chain. |
| `close()` | Flush the deferred YAML projection. |

---

## The Hash

Each record's key is derived from its payload and its predecessor:

```
key = sha64(payload) XOR sha64(prevKey)
```

A **hash chain**: every key depends on every key before it. Flip one byte anywhere in the log and the chain breaks from that point on. `verify()` finds it — the key *is* the proof, there is no separate checksum.

The stored key is the **shortest binary prefix** that is still unique. Early records get one-character keys; as the collection grows keys lengthen logarithmically. The scheme is a radix map (`src/hash.js`, "Lexigraphical Radix Mapping") — keys sort in the same order as the values they address, which is what makes range reads possible once the index exposes them.

Recovery works backward too: `sha64(prevKey) = fromB64(key) XOR sha64(payload)`, so any child verifies its parent without stored back-pointers.

---

## The Reduce

The reducer decides what the projection *means*. Same file triple, same interface, different semantics:

```js
IO('./config', { reduce: merge,  initial: {} })   // map: last write per key wins, null deletes
IO('./log',    { reduce: append, initial: [] })   // stream: the full ordered history
IO('./kv',     { reduce: assign, initial: {} })   // shallow object assign
```

`merge` carries tombstones — `{ a: null }` deletes key `a`. `append` preserves application order: a store built with `append` is an ordered list, not a map, read back through `records()`. A key-value store and an event stream are the same engine with different reducers.

`src/db-factory.js` names the common pairings: `store` (merge), `stream` (append), `kv` / `map` (assign), `table` (upsert by `id`).

---

## The Format

`.dash` lines — payload, then `#`, then key:

```
{"name":"alice"}#5
{"age":30}#4
```

Human-readable in `tail -f`, parseable in one `lastIndexOf('#')`. Pass `format: 'jsonl'` for `{"5":{"name":"alice"}}` instead — the log format and the projection format are independent.

Genesis uses reserved keys `0` and `1`:

```
{"_entity":"users","_type":"kv"}#0
{"_projection":"users"}#1
{"name":"alice"}#5
{"age":30}#4
```

`#0` is the entity header, `#1` the projection boundary. Data starts at sequence 2, in a hash space disjoint from genesis.

---

## The Lock

Writes go through a **dedicated presence-based lockfile** — `state.lock`, distinct from every data file:

```
free     → no state.lock.<pid> on disk
locked   → state.lock.<pid> exists (created with 'wx', atomic)
release  → unlink it
```

Absence is the free state, so the mutex has no birth ceremony to race. The PID lives in the filename, not the contents, so one `open('wx')` both creates and claims. A dead holder is swept via `kill(pid, 0)`. The critical section is just *stat, append, release* — the O(n) projection and index writes happen outside it, after the lock is dropped.

The result under 8 processes writing one base: all records land, the chain stays valid, zero lock timeouts. The protocol is shared with the nutshell (`src/adapters/io-append.js`), so the two engines behave the same under contention.

---

## The Paged Projection

By default the projection is one object held in RAM and rebuilt from the log at `open()` — fine until the store outgrows the process. Pass a page size to move it to disk:

```js
IO('./big', { reduce: merge, initial: {}, pageSize: 4096 })
```

One axis, like `format`. `pageSize > 0` writes the projection as `pageSize`-aligned text pages in `state.proj`, read one page at a time — `get('key')` pays a single ~4K read instead of needing the whole map resident. `pageSize: 0` or absent is the monolithic path, byte-identical to every build before it.

Two page layouts, because the reducers are not commutative: `merge` / `assign` get pages sorted by key; `append` gets pages in application order. `cat state.proj` still shows readable text; `sed -n` shows one page.

The primitive underneath is [`pagedtext`](pagedtext/) — a standalone paged-text layer with its own cursor, filling modes, and atomic flush. You never have to reach for it directly; `pageSize` is the whole interface. See [`pagedtext/hello-paged.js`](pagedtext/hello-paged.js) for a runnable tour with tiny pages.

---

## What's Not Here Yet

`open()` on a paged store is **not** flat — it still reads the whole `.dash` to rebuild the allocator bitmaps. A flat open needs a real key→offset index (feature 2.4). Paged writes are still O(store) per flush, not O(dirty pages) — region-level commit is later work. The benchmark `bun src/io-engine.bench.js --paged` is the evidence for both, not a claim to the contrary.

---

## Layout

```
src/
  io-engine.js         ← the engine
  hash.js              ← the radix key scheme
  paged-projection.js  ← the on-disk projection (opt-in via pageSize)
  db.js, db-factory.js ← the polymorphic DB facade over IO()
  adapters/            ← file / yaml / json / sqlite / dash / io-append (the lock)
pagedtext/
  pagedtext.js         ← standalone paged-text primitive
  hello-paged.js       ← runnable tour
  docs/                ← the design conversation behind it
nutshell/
  io-nutshell.md       ← the ~190-line reference sibling
```

---

## Dependencies (workspace peers, not submodules)

This repo expects `../utils` and `../utest` as sibling directories — it does not vendor them or bring them as git submodules:

```
any/folder/
  utils/   ← git clone git@github.com:andersoncarli/utils.git
  utest/   ← git clone git@github.com:andersoncarli/utest.git
  iodb/    ← this repo
```

`iodb/src/*.js` imports from `../utils/src/...` (the event bus); tests run via `bun ../utest/utest.js .`. Cloning `iodb` alone is not enough — clone all three side by side. When `iodb` is a submodule of a host project (e.g. `bot/`), that host must carry `utils` and `utest` as siblings at the same level.

---

## The Work

Managed by **ZSS (Zero Scan Sprints)** via the `sprint` tool — the state of the work lives in the tool, not in hand-written docs. Start with `sprint boot`. Method: [AGENTS.md](AGENTS.md) and [.sprint/BOOT.md](.sprint/BOOT.md). Current state: [STATUS.md](STATUS.md) or `sprint fronts`. History: [sprints/_TOC.md](sprints/_TOC.md).

---

*Three files. Five verbs. Hash-chained truth, a readable projection, a real index.*
