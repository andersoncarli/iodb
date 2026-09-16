# Typed Tree

Minimal prototype of the Typed CSV / lazy filesystem tree architecture.

- `typed.js` — named, autoreferential type definitions and schema resolution.
- `typedtree.js` — topology-only tree over plain records.
- `lazytree.js` — filesystem topology; children, stat and hash are lazy/memoized.
- `tree.js` — CLI that materializes topology as `tree.csv` without calling `stat()`.

The semantic core is intentionally small. YAML Flow parsing, richer constructors, serializers and computed fields remain independent extensions.
