# PPTe 2.0 Milestone Progress

## 2026-09-02 — Week 1–2 gate recovery

### Completed this round

- Added a `typecheck` script to all 16 workspace packages and apps so the
  recursive typecheck gate covers the complete workspace.
- Kept the existing semantic model, Operation Engine, tests, and explicit
  Week 1–2 scope unchanged.
- Recorded the conservative workspace compiler choice in
  [`docs/DECISIONS.md`](DECISIONS.md).

### Exit-condition evidence

- `pnpm install --frozen-lockfile` — passed.
- `pnpm -r typecheck` — passed for all 16 selected workspace projects.
- `pnpm typecheck` — passed.
- `pnpm test` — 15 tests passed, 0 failed, 0 skipped.
- `pnpm validate` — schemas, semantic checks, operation parity, markdown
  structure, and source guards passed.
- `pnpm e2e:vertical-slice` — passed; checkpoint round trip was true, journal
  recovery completed, and the out-of-scope transaction was blocked.
- Existing tests remain green with no test-meaning or gate-scope reduction.

### Explicitly not done

This round does not add Chart, Widget, Poster, PPTX, Patch, a complete
Portable editor, nested Groups, Group Rotate, Run-level font or font-size
styling, Slidev, DOM reverse parsing, or direct writes outside the Operation
Engine. No remote is created and no changes are pushed.

## 2026-09-03 — Week 3–6 Stable Core

### Completed this round

- Completed the Document, Manifest, and Transaction runtime/schema boundaries,
  canonical revisions, semanticKey resolution, and explicit replacement
  Lineage inheritance.
- Added Style Preset → Token → Typed Override resolution and derived Override
  Debt diagnostics.
- Completed Text v1 boundaries: fixed text frames, explicit Fit, overflow
  diagnostics, IME-safe RichText editing, single-level lists/marks, and glyph
  checks.
- Completed Image and Shape operations/rendering, including image crop/focal
  point and self-contained asset handling.
- Added flat logical Groups with materialized member frames; Groups do not
  render, nest, or create a persistent coordinate system.
- Added bounded Revision/History/Redo, durable checksummed Journal with result
  revisions and CAS references, SHA-256 CAS, atomic self-contained ZIP
  Checkpoints, recent history tails, and reopen validation.
- Expanded the Contract Deck/E2E and added positive, inverse, conflict,
  persistence-fault, deterministic property, and renderer Golden tests.

### Exit-condition evidence

- `pnpm install --frozen-lockfile` — passed.
- `pnpm -r typecheck` — passed.
- `pnpm typecheck` — passed.
- `pnpm test` — 35 tests passed, 0 failed, 0 skipped.
- `pnpm validate` — passed.
- `pnpm e2e:vertical-slice` — passed; checkpoint round trip was true, journal
  recovery completed, and the out-of-scope transaction was blocked with
  `SCOPE_VIOLATION`.
- `git diff --check` — passed.
- Existing tests remain green with no skip/only or test-scope reduction.

### Explicitly not done

Chart, Widget, Poster, PPTX, Patch, nested Groups, Group Rotate, Run-level
font or font-size styling, a complete Portable editor, Slidev, Markdown as a
content source, and DOM reverse parsing remain outside this milestone and are
rejected or diagnosed at the runtime boundary. Full browser/OS matrix testing,
screenshot artifact comparison, and migration/import pipelines remain
follow-on work. No remote is created and no changes are pushed.
