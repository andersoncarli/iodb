# IO Nutshell

**A reactive append-only store in ~190 lines.**

Two files. One interface. Every write is permanent, every read is instant, every mutation is observable.

---

## The Pair

```
state.jsonl   ← append-only log (the truth)
state.json    ← projection snapshot (the view)
```

The `.jsonl` is the source of truth — an immutable, append-only sequence of patches. The `.json` is a derived cache — the reduced state, recomputable at any time by replaying the log. If the `.json` disappears, nothing is lost.

This is event sourcing reduced to its atomic form.

---

## The Interface

```js
const users = IO('users', { path: './data', autoFlush:false })

users.in({ name: 'alice' })          // write → '#k'
users.in({ age: 30 })                // write → '#m'
users.flush()

users.get()                          // → { name: 'alice', age: 30 }
users.get('name')                    // → 'alice'
users.get('#k')                      // → { name: 'alice' }

const off = users.out(({ key, payload }) => {
  console.log(`${key}: ${JSON.stringify(payload)}`)
})
off()                             // unsubscribe
```

Five verbs. That's it.

| Verb | Does |
|------|------|
| `in(record)` | Write a patch, reduce into state, flush to disk, return `#key` |
| `out(fn)` | Subscribe to future writes. Returns `off()` |
| `get()` | Read the current projection |
| `get('#key')` | Read a specific record by hash |
| `flush()` | Flush buffered writes to disk |

### Interop with io-engine

The sibling engine `src/io-engine.js` shares this shape. Code written for it —
`io.open(payload)` before the first write, `io.close()` at the end — runs on the
nutshell unchanged:

| Verb | On the nutshell |
|------|-----------------|
| `open(payload)` | Optional. Seeds record `#0` if given; otherwise a no-op — genesis is elected lazily on first write. Returns `this`. |
| `close()` | Optional no-op, returns `this`. io-engine needs it to flush its YAML projection (published only every 100th write); the nutshell re-publishes its JSON projection on **every** flush, so there is nothing to close. |
| `header()` / `state()` | Genesis records `#0` / `#1`, read straight from the log. |
| `find(pred)` | `records()` minus genesis, payloads filtered by `pred`. |

The one asymmetry that remains is deliberate: io-engine defers its `stringify`-heavy
YAML projection and needs `close()` to flush it; the nutshell's projection is small
JSON and always current. Everything else — `in` / `out` / `get` / `flush` / `verify`
/ `size` — means the same on both.

Every `in()` returns a hash key. Every hash key is a permanent address. Every `out()` fires synchronously after the write hits disk.

---

## The Hash

Each record gets a key derived from three things:

```
key = sha256(payload) ⊕ sha256(previous) ⊕ sequence
```

This is a **hash chain** — every record's identity depends on every record before it. Mutate a single byte anywhere in the log, and the chain breaks from that point forward.

The stored key is the **shortest unique binary prefix** of the full hash. Early records get single-character keys (`2`, `k`, `F`). As the collection grows, keys get longer — but logarithmically:

```
rec   0  key: 3       len: 1
rec   7  key: M       len: 1
rec  31  key: j       len: 1
rec  63  key: 1g      len: 2
rec 500  key: 4r      len: 2
```

At 1,000 records, most keys are still 1-2 characters. At 10,000, they're 2-3. The bit-depth follows a clean bell curve:

```
depth  count      histogram
──────────────────────────────────────
  6      32       ███░░░░░░░░░░░░░░░░
  7      64       █████░░░░░░░░░░░░░░
  8     128       ██████████░░░░░░░░░
  9     231       ███████████████████
 10     298       ████████████████████████   ← peak
 11     169       ██████████████░░░░░░░░░
 12      43       ███░░░░░░░░░░░░░░░░░░░
```

This isn't an optimization — it's an emergent property of binary prefix uniqueness over a growing hash space.

---

## The Reactivity

`.out()` is a synchronous publish-subscribe with exactly one guarantee: **the handler fires after the write is on disk.**

```js
const ping = IO('ping', { path: dir }) // default autoFlush:true
const pong = IO('pong', { path: dir })

pong.out(({ n }) => {
  if(n>0) ping.in({ type: 'ping', n: n - 1 })
})

ping.out(({ n }) => {
  if(n>0) pong.in({ type: 'pong', n: n-1 })
})

ping.in({ type: 'ping', n: 1000 })   // starts the rally
```

Two streams. Each `.out()` writes to the other. The rally runs synchronously — 1,000 round-trips, each hitting disk four times (2× append + 2× projection), converging at ~1ms per rally.

```
1000 round-trips in 926ms
avg: 0.923ms   p50: 0.770ms   p95: 1.955ms   p99: 2.685ms
```

The unsubscribe is just as clean:

```js
const off = state.out(fn)
off()   // done — fn will never fire again
```

No event names. No channels. No routing. Just functions in, functions out.

---

## The Reduce

The default reduce is `Object.assign` — each patch merges into state. But the reducer is pluggable:

```js
// Merge mode (default) — state is the latest merged view
IO('config', { path: dir })

// Append mode — state is the full history
IO('log', {
  path: dir,
  reduce: (acc, rec) => [...acc, rec],
  initial: [],
})
```

Same file pair, same interface, different semantics. A key-value store and an event stream are the same thing with different reducers.

---

## The Verification

```js
state.verify()   // → { valid: true, length: 1002 }
```

Replays the full log, re-derives every key from its payload and predecessor, and confirms each stored key is a valid prefix. Any single-byte mutation to any record breaks the chain at that point.

This isn't an external audit — it's intrinsic. The key **is** the proof.

---

## The Format

Each line in `.jsonl`:

```
{"name":"alice"}#k
{"age":30}#m
```

Payload, then `#`, then key. Human-readable in `tail -f`. Parseable in one `lastIndexOf('#')`. No envelopes, no metadata bloat.

Genesis records use reserved keys `0` and `1`:

```
{"_entity":"state","_type":"io"}#0
{"_projection":"state"}#1
{"name":"alice"}#k
```

`#0` is the entity header. `#1` marks the projection boundary. Data starts at sequence 2 — disjoint hash space from genesis.

---

## The Adapters

Serialization is pluggable at both ends:

```js
IO('state', {
  log:        { to: JSON.stringify, from: JSON.parse },
  projection: { to: v => YAML.stringify(v), from: YAML.parse },
})
```

The log format and the projection format are independent. You could write JSONL logs with YAML projections, or MessagePack logs with pretty-printed JSON snapshots. The engine doesn't care — it calls `to()` on write and `from()` on read.

---

## The Numbers

All on a single-process, local SSD, Bun runtime:

| Metric | Value |
|--------|-------|
| Sequential write throughput | ~9,000 rec/s |
| Hash lookup (`io.get('#key')`) | ~1,600,000 ops/s |
| Reactive round-trip (ping-pong) | ~1,080 rallies/s |
| Reactive latency p50 | 0.77ms |
| Chain verification (1000 records) | <10ms |

---

## What's Not Here

No locks. No WAL. No fsync. No binary protocol. No schema. No indexes beyond the hash map. No event bus. No dependency on anything but `node:crypto` and `node:fs`.

The price of "no locks" is measured, not assumed: 8 processes writing one base lose **no records** (POSIX appends are atomic) but break the chain — 170 distinct keys out of 240, because each process computes prefixes against its own `prefixSet`. `verify()` reports it. See `io-nutshell.concurrency.test.js`.

There is one **opt-in** escape hatch: `IO('state', { lock: true })` routes writes through the same presence-based critical section `io-engine.js` uses (`../src/adapters/io-append.js`) — absence means free, PID in the lock filename, `wx` to acquire, `unlink` to release, dead-holder sweep via `kill(pid,0)`. It is off by default and the sentence above stays true for every caller who does not ask. With it on, the same 8×30 load lands all 240 records with 0 crashes and 0 lock timeouts. `bench/compare-3.3.js` runs that load against both engines; `bench/resultado-3.3.txt` records where the numbers diverge and why.

The entire system is **one file, one export, zero configuration**.

```
io/
  io-nutshell.js     ← the engine (190 lines)
  io-nutshell.t.js   ← unit tests
  io-smoke.js        ← write stress + chain verification
  io-demo.js         ← reactive ping-pong benchmark
```

---

*Two files. Five verbs. Hash-chained truth with reactive projections.*

*That's IO in a nutshell.*
