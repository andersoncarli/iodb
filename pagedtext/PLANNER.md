# PagedText Planner

The Planner converts logical cursor changes into a new physical representation of the affected text.

Its job is not to edit individual pages in place. Its job is to choose a useful physical region, rebuild it, repage it, and hand the result to the committer.

## Principle

> A modified region is reconstructed as logical text and then repaged with optimal filling.

Pages are a physical storage unit, not the fundamental editing unit.

## Pipeline

```text
Cursor
  │
  ▼
ChangeSet
  │
  ▼
normalize / merge changes
  │
  ▼
select affected regions
  │
  ▼
read logical content
  │
  ▼
apply ChangeSet
  │
  ▼
repage + distribute filling
  │
  ▼
PhysicalPlan
  │
  ▼
sequential atomic commit
```

## Regions

A ChangeSet can affect one or many regions.

```text
P10 P11 P12          P80 P81              P400
 └──── region A ───┘   └─ region B ─┘       └ region C ┘
```

Nearby or overlapping changes should be merged before planning. Independent regions can be planned independently.

The region may expand beyond the immediately affected page when that gives a cheaper result.

## Rebuilding a region

For each region:

1. load the selected pages;
2. remove their physical fillings from the logical view;
3. apply the normalized ChangeSet;
4. identify useful semantic boundaries supplied by `kind`;
5. repage the resulting logical text;
6. distribute filling among the resulting pages;
7. compare the physical cost with the allowed budget.

The old filling is never treated as user content.

## Filling

Filling represents physical capacity reserved for future mutations.

Default:

```text
ws
```

Optional:

```text
comment
```

The Planner asks for capacity; `kind` decides how that capacity can be represented without damaging the syntax.

Examples:

```text
C-like      whitespace or comment
CSV         whitespace around syntactically safe delimiters/records
JSON        whitespace in grammar-neutral positions
Markdown    whitespace/newlines in low-impact positions
```

The core Planner does not parse these formats itself.

## Uniform distribution

After a region is rebuilt, filling should be distributed approximately uniformly over its resulting pages.

Conceptually:

```text
content bytes = C
filling bytes = F
pages         = N

reserve roughly F / N per page
```

The exact algorithm can account for page size, record boundaries, and semantic affinity.

The reason is future mutation locality. A page with no capacity forces the next edit to expand the region; deliberate distributed filling absorbs small changes locally.

## Semantic affinity

`kind` may identify preferred boundaries. They are soft constraints.

For example:

```text
function foo() { ... }     strong
CSV record                 medium
line                       weak
```

If a small amount of filling keeps a function, JSON object, CSV record, or Markdown section within one page, prefer that layout.

If the required movement is expensive, permit the boundary to cross a page.

The objective is not perfect semantic packing. It is minimum semantic and physical disruption.

## Cost budget

The Planner should have a physical budget, preferably expressed in bytes:

```js
maxShiftBytes
```

It starts with a small region and expands it while the estimated cost remains acceptable.

```text
P10
 ↓
P10..P11
 ↓
P10..P12
 ↓
P10..P13
```

Once the budget is exceeded, stop expanding the local plan and choose a larger rebuild strategy.

The Planner does not need an elaborate optimizer. A greedy expansion strategy is sufficient for the first real implementation.

## Physical plan

The Planner should produce a description, not write the file:

```js
{
  regions: [
    {
      old: { first: 10, last: 12 },
      pages: [/* new physical pages */],
      bytes: 12345
    }
  ],
  strategy: 'regions'
}
```

Possible high-level strategies are:

```text
local regions
expanded regions
whole-file rebuild
```

`shift` is an implementation consequence of replacing an old region with a larger or smaller new region; it does not need to be a first-class Planner operation.

## Commit

The Committer consumes the PhysicalPlan and writes the resulting file sequentially.

```text
COPY unchanged
WRITE new region
COPY unchanged
WRITE new region
...

fsync
rename
```

The final publication must be atomic. A failed commit must not expose a partially written source file.

## Important invariant

```text
logical content
      ≠
physical representation
```

Physical page boundaries and fillings must never leak into the logical API.

A normal reader should see the same semantic text regardless of how PagedText chose to paginate it.

## Future implementation order

1. page reader/cache
2. sparse logical ChangeSet
3. region reconstruction
4. uniform filling distribution
5. greedy region expansion with `maxShiftBytes`
6. sequential region commit
7. atomic publication
8. persistent page index
9. format-specific semantic affinity

The public API should remain stable while these internals evolve.
