# FSWatch

Minimal filesystem observation for Bun/Linux.

FSWatch observes a filesystem tree, keeps a persistent metadata baseline in `bun.sqlite`, turns filesystem changes into semantic events, and routes those events to named clusters.

## Philosophy

**Backend observes. Observer reconciles. SQLite remembers. Clusters filter. Consumers react.**

The filesystem is truth. Kernel notifications are hints. SQLite is the last known state, not the source of truth.

Clusters are views, not partitions. The same physical event may be delivered to multiple clusters.

Business rules do not belong in FSWatch.

## Configuration

Configuration may be a POJO:

```js
const fs = await FSWatch({
  SOURCE: {
    targets: ['~/project'],
    include: ['**/*.ts'],
    exclude: ['**/node_modules/**']
  },
  TESTS: {
    targets: ['~/project'],
    include: ['**/*.test.ts']
  },
  DOCS: {
    targets: ['~/project'],
    include: ['**/*.md']
  },
  IGNORE: {
    targets: ['~/project'],
    include: ['**/node_modules/**', '**/.git/**']
  }
})
```

or a YAML file:

```js
const fs = await FSWatch('./fswatch.yaml')
```

Root `include`/`exclude` define an implicit `DEFAULT` view. Every other top-level object is a named cluster.

## Metadata

The default database is `bun.sqlite` next to a YAML configuration file, or in the current working directory for a POJO configuration.

Two tables represent the tree:

- `nodes`: directories
- `leaves`: terminal filesystem objects

Identity is `(dev, ino)`. Paths are mutable names/locations, not identity.

## Events

```js
{ type: 'create', id, path, kind }
{ type: 'delete', id, path, kind }
{ type: 'move', id, from, path, kind }
{ type: 'metadata_changed', id, path, metadata }
{ type: 'content_changed', id, path, size, mtime, hash }
{ type: 'reconcile', path, reason }
```

Raw Linux event names are deliberately not part of the consumer API.

## Usage

```js
const fs = await FSWatch('./fswatch.yaml')

await fs.watch()

fs.SOURCE.on(event => console.log(event))

// ...
fs.close()
```

`watch()` performs an initial scan before subscribing to changes, establishing the baseline.

For an explicit baseline:

```js
await fs.scan()
await fs.watch({ baseline: false })
```

## Architecture

```text
                    fswatch.yaml / POJO
                            │
                            ▼
                        FSWatch
                            │
             ┌──────────────┴──────────────┐
             │                             │
          Observer                    MetadataStore
             │                             │
      Linux watcher                     SQLite
             │                       nodes + leaves
             │                             │
             └────── semantic event ──────┘
                            │
                  ┌─────────┼─────────┐
                  ▼         ▼         ▼
               SOURCE    TESTS      DOCS ...
```

The physical observer is shared across overlapping clusters. A directory is watched once regardless of how many clusters target it.

## Recovery

The intended recovery model is:

```text
kernel event loss / uncertainty
            ↓
        reconcile
            ↓
       filesystem scan
            ↓
   compare with SQLite baseline
            ↓
     semantic differences
```

The Linux backend is intentionally isolated so the first backend can be replaced or supplemented without changing the cluster/configuration model.

## Scope of 0.1

The first version provides:

- Bun API
- YAML/POJO configuration
- glob and RegExp filters
- recursive baseline scan
- persistent SQLite metadata
- `(dev, ino)` identity
- shared directory watchers
- dynamic watches for newly-created directories
- semantic create/delete/metadata events
- explicit reconciliation API
- cluster routing
- tests

The next backend hardening step is direct Linux `inotify` integration with native `MOVED_FROM`/`MOVED_TO` cookies, queue-overflow detection, write coalescing, and automatic reconciliation. The public model does not need to change for that backend.
