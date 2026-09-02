# PPTe 2.0

PPTe is an open semantic presentation format and a small reference runtime:
AI or a human creates a stable `document.json`, typed Operations make every
persistent edit reviewable, and a deterministic renderer produces the view.
The Stable Core vertical slice proves the reliable loop: open a Document,
resolve Style Presets and typed overrides, render Text/Image/Shape, edit Text
safely around IME composition, constrain an Agent edit, materialize flat Group
geometry, diff, commit, undo/redo, journal, checkpoint through CAS-backed
assets, and reopen with the same canonical revision.

## Quick start

```text
pnpm install
pnpm typecheck
pnpm test
pnpm validate
pnpm e2e:vertical-slice
pnpm e2e:milestone
pnpm e2e:beta
pnpm contract-deck
```

`contract-deck` writes a derived preview under `artifacts/`. The package format
is a bounded stored ZIP checkpoint containing `document.json`, `manifest.json`,
style-independent asset metadata, and a bounded recent History tail. Recovery
Journal data stays outside the package in a host-private directory and is
replayed only when its document and base revision match.

## Repository layout

- `packages/schema` — framework-neutral document, Operation, IR, and file types.
- `packages/canonical-json` — deterministic JSON and SHA-256 revision helpers.
- `packages/core` — immutable Session, revision, bounded history/redo, derived
  indexes, and the single Preview/Commit/Undo/Redo path.
- `packages/operations` — typed Operation application and inverse generation.
- `packages/change-contract` — Scope, permissions, actual mutation budgets,
  invariants, policy, and precondition enforcement.
- `packages/diff` — structural and semantic-ready diff primitives.
- `packages/validation` — runtime subset, text overflow, and glyph preflight.
- `packages/geometry` — fixed Slide-space geometry and hit testing.
- `packages/renderer-react` — a derived reference rendering adapter; it never
  writes the document.
- `packages/editor-react` — selection, transient drag, and IME-safe local edit
  adapters.
- `packages/recovery-journal` and `packages/file-format` — host persistence
  boundaries for checksummed append recovery, SHA-256 CAS, and atomic `.ppte`
  checkpoints.
- `packages/archive` — bounded stored-ZIP primitives for data-only exchange
  packages.
- `packages/capability` — explicit per-target capability and degradation
  reports.
- `packages/portable-runtime` — offline Viewer and Quick Fix profiles,
  origin metadata, glyph preflight, presenter controls, and Save as New
  Project.
- `packages/reviewer` and `packages/patch-format` — three-way semantic review
  and data-only `.ppte.patch` transport with safe resource import.
- `packages/exporter-pdf` — deterministic PDF/PNG baseline exporters with
  explicit degradation reports.
- `apps/contract-deck` — the executable acceptance path.
- `schemas`, `examples`, `scripts/validate.py` — retained public contracts and
  validation fixtures.
- `docs/PPTe_2.0_完整研发方案_v2.3.md`, `docs/ADR_v2.3_冻结决策.md`, and
  `docs/开发启动清单.md` — the frozen specification inputs.

## Scope

This milestone deliberately does not implement:

- Slidev, Markdown as a content source, or DOM reverse parsing;
- Chart, Widget, Poster, or PPTX;
- nested Groups or Group Rotate;
- Run-level font or font-size styling;
- Portable Light Edit, Fact Quick Fix, or a complete Portable editor;
- CRDT, real-time collaboration, legacy migration/import, or a browser/OS
  pixel-matrix test lab;
- direct writes that bypass the Operation Engine.

The schema retains forward-compatible types for later releases, but the
Stable Core runtime accepts only Text, Image, Shape, and flat logical Groups.
Portable and Patch resource operations are transport-layer extensions and are
still committed through the same Session Operation Engine. Unsupported future
operations fail with a diagnostic error; they are not silently ignored or
downgraded.

## Design invariants

`document.json` is the only content source of truth. Slide IR, renderer output,
DOM, selection state, Journal, Diff, and caches are derived. Frame coordinates
are fixed Slide-space `du`; a Group is only a flat relationship. Text changes
never change frame, style, or font size implicitly. Human and Agent writes use
the same typed Transaction and Commit path, and an atomic checkpoint never
replaces a readable prior package until the new package has been written and
validated.

Implementation choices not fixed by the specification are recorded in
[`docs/DECISIONS.md`](docs/DECISIONS.md).
