# Dashed DSL — Structural Roadmap Format

The Dashed DSL is a high-density, human-readable, and cryptographically anchored format used for managing project roadmaps. It prioritizes implicit hierarchy via numeric IDs while maintaining flexible attribute nesting using dashed prefixes.

## Node Anatomy

Every line in a `.yaml` roadmap corresponds to a **Node**. A node follows this anatomical structure:

`[Prefix][Key]: [Value] [Metadata] [{JsonExtra}] [#Hash]`

| Component | Example | Description |
| :--- | :--- | :--- |
| **Prefix** | `11.1.2` or `--` | Numeric IDs represent implicit depth. Dashes represent incremental depth. |
| **Key** | `strip-ids` or `files` | The unique identifier or attribute name at the current depth. |
| **Value** | `Strip @ids...` | The primary content or "title" of the node. |
| **Metadata** | `[critical, 1h]` | Inferred task properties: priority, estimate, status. |
| **JsonExtra** | `{version: 0.3}` | Inline JSON metadata merged into the task or root property. |
| **Hash** | `#aB3` | The cryptographic prefix from the `.flow` event log. |

## Hierarchical Rules

### 1. Implicit Hierarchy (Numeric IDs)
Numeric prefixes automatically derive their depth from the dot-count:
*   `11:` → Level 1 (Pillar/Sprint)
*   `11.1:` → Level 2 (Objective)
*   `11.1.1:` → Level 3 (Task)

### 2. Explicit Nesting (Dashed)
Dashes can be used to define structural sections or attributes:
*   `-INVARIANTS:` → Level 1 (Section)
*   `--logic:` → Level 2 (Sub-section)

### 3. Task Attributes (Anchoring)
A single dash prefix following a Level 3 Task is automatically upscaled to **Level 4** (Attribute) and anchored to the preceding task:
*   `11.1.1: Title`
*   `-files: [...]` → Anchored to `11.1.1` as `11>11.1>11.1.1>files`.

## Format Examples

### Root Property
```yaml
PROJECT: FRM - Fractal Reasoning Machine {version:0.3}
```

### Hierarchical Task with Inline Metadata
```yaml
11.1.2: Record key output [critical, 0.5h] 
-: {spec: plans/11.md#T-002} #aB3
-files: ["io/bot.js"] #f2
-notes: |
  Append the dimension record key. #a7
```

### Structural Section
```yaml
-INVARIANTS: System Rules
--append-only: No logical writes are buffered. #8E
```

## Parsing & Parity

Every node is a discrete entry in the `.flow` event log. The `parseLine` logic ensures that formatting is preserved during rehydration, while `stringify` maintains a stable, numeric-aware sorted projection in the `.yaml` manifest.
