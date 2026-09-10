# PagedText

`PagedText` is a generic primitive for treating an arbitrarily large text file as a logical sequence while physically storing it in pages.

It is **not a database**. It is a text-storage layer that can sit underneath editors, parsers, logs, CSV/JSON tools, IODB, and other higher-level systems.

## Core idea

> Align any text file into physical pages with the minimum possible semantic impact.

The logical file remains continuous. Pages, physical offsets, and fillings are implementation details.

```text
logical text
     │
     ▼
  PagedText
     │
     ▼
logical content ────────────────┐
                               │
physical representation         │
  page 0  content + filling    │
  page 1  content + filling    │
  page 2  content + filling    │
                               │
     └─────────────────────────┘
```

## Filling

A filling is **physical capacity**, not logical content. Its only purpose is to make page boundaries useful for future changes.

The default is `ws`: whitespace. It is intentionally discrete and should be semantically invisible to ordinary readers, compilers, parsers, and Unix tools.

An explicit `comment` mode is available when visible instrumentation is useful:

```js
const text = await PagedText({
  path: './app.js',
  kind: 'clike',
  filling: 'comment'
})
```

For C-like formats this can produce `//- pagedtext filling`. The same idea can be adapted by other `kind`s.

`kind` owns format-specific filling rules. For example, CSV can place whitespace before or around delimiters, and JSON can use syntactically neutral whitespace. The storage core does not need to understand those grammars.

## Logical API

```js
const text = await PagedText({
  path: './huge.log',
  kind: 'clike',
  pageSize: 64 * 1024
})

text[1000]
text.length
text.at(-1)
text.slice(100, 200)
text.push('new line')
text.splice(10, 2, 'a', 'b')

for (const line of text) console.log(line)
```

The API behaves like an array of logical lines. Physical fillings never appear in the result.

## Cursor

A cursor is an independent change buffer over the logical text.

```js
const c = text.cursor(1000)

c.insert('hello')
c.write('replacement')
c.delete(3)
c.seek(500)
```

The cursor does not immediately rewrite the source file.

```js
await c.save()    // persist working state; source remains untouched
await c.flush()   // publish changes to the source
c.rollback()      // discard pending changes
```

`flush()` is the physical write boundary.

The current v0 cursor stores its complete logical line array as a sidecar state file. This is deliberately simple; future versions should persist a sparse change set/rope instead.

## Planner

The Planner is the physical optimization layer between logical edits and the file.

```text
Cursor
  │
  ▼
ChangeSet
  │
  ▼
Planner
  │
  ├── select affected regions
  ├── apply changes
  ├── repage
  └── distribute filling
  │
  ▼
new pages
  │
  ▼
atomic sequential commit
```

The Planner does **not** need page movement as a primitive. It can reconstruct a contiguous or independently selected set of pages, producing a new set of pages that may be larger, smaller, or differently distributed than the original.

A typical local edit therefore becomes:

```text
old pages
   │
   ├── remove old fillings
   ├── apply logical changes
   └── repage region
          │
          ▼
     new pages + optimal filling
```

If the new region fits in the old physical space, only that region needs to be rewritten. If it grows, the Planner may consume neighboring capacity. If the affected region becomes too expensive, a larger rebuild is chosen.

See [`PLANNER.md`](./PLANNER.md) for the design.

## Filling distribution

After rebuilding a region, filling should be distributed approximately uniformly among the resulting pages rather than left as accidental trailing slack.

This creates deliberate future capacity:

```text
P0  content + fill
P1  content + fill
P2  content + fill
```

The exact policy belongs to the Planner and eventually to `kind` where syntax matters.

A useful invariant is:

> More filling trades physical compactness for lower future write amplification.

## Semantic affinity

A `kind` may also provide lightweight hints about useful boundaries:

- a line
- a CSV record
- a JSON object/value
- a C-like function/block
- a Markdown section

These are preferences, not hard constraints.

If a function or Markdown section can remain whole by consuming a small amount of filling, that is preferable. If avoiding a split would require a large rewrite, the Planner should allow the split.

```text
semantic integrity
       ↓
prefer when cheap
       ↓
physical cost budget
```

## Atomic commit

Once all affected regions have been planned, the physical result is committed sequentially.

Conceptually:

```text
old file
   │
   ├── unchanged region → copy
   ├── planned region   → write new pages
   ├── unchanged region → copy
   └── ...
          │
          ▼
       fsync
          │
          ▼
   atomic rename/publish
```

The current v0 already uses temporary-file + `fsync` + rename for atomic publication, although it still rebuilds the whole logical file in memory. Region-level commit is a future storage optimization.

## Current v0

Implemented:

- logical array-of-lines API
- Proxy numeric access
- `clike` and `text` kinds
- `ws` filling as the default
- explicit `comment` filling mode
- hidden physical fillings
- cursor read/write/insert/delete/replace
- cursor save/load sidecar
- rollback
- atomic flush
- page inspection
- no global line index

Still intentionally prototype-level:

- the entire logical file is currently loaded in memory
- flush rebuilds the complete file
- Planner is documented but not yet implemented as a physical region optimizer
- filling redistribution is not yet implemented
- region-level sequential commit is not yet implemented
- cursor persistence is still a full line-array snapshot
- byte/binary cursor is not implemented
- CSV/JSON/Markdown/C-like structural hints are future `kind` work

The next implementation step is therefore **not a new public API**. It is replacing the v0 whole-file internals with page cache + logical ChangeSet + Planner while preserving the interface above.
