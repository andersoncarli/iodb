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

- page reader
- page cache
- logical line access without loading the whole file
- local page parsing
- random page access by scan
- page metadata

No global index is required initially.

## Phase 2 — Planner

- sparse ChangeSet
- region selection
- remove old filling
- apply changes
- repage region
- distribute filling uniformly
- semantic-boundary hints
- `maxShiftBytes`
- greedy region expansion

## Phase 3 — Commit

- sequential physical output
- copy unchanged regions
- write planned regions
- fsync
- atomic rename
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
- reverse line iteration
- block/delimited views
- persistent page index

## Non-goals

PagedText is not intended to become:

- a database
- a general parser framework
- an AST store
- a proprietary file format
- a globally indexed text database by default

Higher-level systems such as IODB may build on top of it.
