# PPTe 2.0

PPTe is an open semantic presentation format and a small reference runtime:
AI or a human creates a stable `document.json`, typed Operations make every
persistent edit reviewable, and a deterministic renderer produces the view.
The Stable Core vertical slice proves the reliable loop: open a Document,
resolve Style Presets and typed overrides, render Text/Image/Shape, edit Text
safely around IME composition, constrain an Agent edit, materialize flat Group
geometry, diff, commit, undo/redo, journal, checkpoint through CAS-backed
assets, and reopen with the same canonical revision.

## Current status

`0.5.0` is the bounded PPTe release. It includes the semantic reference core,
the file://-capable Host editing path, offline Portable editing profiles,
recovery/history, review/patch, and independent GA black-box evidence. It is
not a promise that every future editing or collaboration feature exists; the
remaining boundaries are listed below and in `CHANGELOG.md`.

## Quick start

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm validate
pnpm host:build

# Double-click this self-contained file:// Host in a desktop browser:
# apps/host/dist/index.html

# Generate the small derived CLI reference preview under artifacts/.
pnpm contract-deck

# Independent final acceptance and the complete JSON report.
node scripts/blackbox-gates.mjs --milestone final
node scripts/blackbox-gates.mjs --report

# Six historical implementation E2E profiles and the GA-A performance budget.
pnpm e2e:vertical-slice
pnpm e2e:milestone
pnpm e2e:beta
pnpm e2e:ga-a
pnpm e2e:ga-b
pnpm e2e:ga-c
pnpm perf:ga-a
```

`contract-deck` writes a derived preview under `artifacts/`; it is a CLI
reference fixture, not the Host. `pnpm host:build` produces the self-contained
double-click entry point. The package format is a bounded stored ZIP checkpoint
containing `document.json`, `manifest.json`, style-independent asset metadata,
and a bounded recent History tail. Recovery Journal data stays outside the
package in a host-private directory and is replayed only when its document and
base revision match.

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
- `packages/charts` and `packages/facts` — the GA-B Bar/Line/Pie and GA-C
  Area/Donut contracts, Fact/Source references, consistency diagnostics, and
  explicit sync builders.
- `packages/widgets` — host-owned, deterministic Table/Code/Equation Widget
  definitions with JSON Props validation and static fallback rendering.
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
- `packages/portable-runtime` — offline Viewer, Quick Fix, and Light Edit
  profiles, origin metadata, glyph preflight, presenter controls, and Save as
  New Project.
- `packages/reviewer` and `packages/patch-format` — three-way semantic review
  and data-only `.ppte.patch` transport with safe resource import.
- `packages/exporter-pdf` — deterministic PDF/PNG baseline exporters with
  explicit degradation reports.
- `packages/exporter-pptx` — Image PPTX and semantic PPTX mapping exports with
  embedded Capability Reports.
- `packages/compatibility` — the release-tested Compatibility Profile and
  native/migrate/read-only/reject decisions.
- `packages/importer-legacy` — data-only forward migration for older semantic
  snapshots, with deterministic output, typed style reattachment, flat-group
  materialization, and a reviewable migration report.
- `packages/fault-injection` — the named GA-A Journal/Checkpoint/archive/
  patch/Portable fault matrix and checkpoint injector.
- `packages/performance-budget` — capacity counters, P95 budgets, bundle-size
  checks, and the deterministic GA-A benchmark helpers.
- `apps/contract-deck` — a CLI reference fixture and historical self-check
  harness.
- `apps/host` — the self-contained React/Vite Product Host. Its generated
  `dist/index.html` is usable from `file://` and keeps `document.json` as the
  semantic source of truth.
- `schemas`, `examples`, `scripts/validate.py` — retained public contracts and
  validation fixtures, including the Compatibility Profile, error contract,
  and GA-A budget.
- `docs/PPTe_2.0_完整研发方案_v2.3.md`, `docs/ADR_v2.3_冻结决策.md`, and
  `docs/开发启动清单.md` — the frozen specification inputs.

## Scope

The 0.5.0 release deliberately does not implement:

- Slidev, Markdown as a content source, or DOM reverse parsing;
- Video Widget, native PPTX Chart authoring, or a complete Portable editor;
- nested Groups or Group Rotate;
- Run-level font or font-size styling;
- CRDT, multi-user/real-time collaboration, full legacy markup import, or a
  browser/OS pixel-matrix test lab;
- direct writes that bypass the Operation Engine.

GA-A does include a deliberately narrow legacy boundary: older JSON-compatible
semantic snapshots can be migrated forward through `packages/importer-legacy`.
The source is never executed or overwritten. Unsupported markup/runtime
formats remain rejected and must be retained by the host alongside the
migration report.

The schema retains forward-compatible types for later releases. The GA-C
runtime accepts Text, Image, Shape, Area/Donut and GA-B Chart types, controlled
Widgets, Poster artwork, and flat logical Groups. Portable and Patch resource
operations are transport-layer extensions and are still committed through the
same Session Operation Engine. Unsupported future operations fail with a
diagnostic error; they are not silently ignored or downgraded.

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

## Recorded implementation boundaries

The native package profile is `ppte-2.0-ga-a.1` and is the exact combination
of format `2`, schema `2.0.0`, operation protocol `1.0`, Slide IR `1.0`,
Portable Runtime `2.0.0`, and Layout Recipe `1.0`; Widget ABI and Patch are
unset in this profile. Older supported semantic inputs migrate forward into
a new document. Higher incompatible major versions are read-only; unknown
or inconsistent profiles are rejected.

The six `pnpm e2e:*` commands exercise the historical implementation profiles;
`pnpm e2e:ga-c` additionally runs the independent final black-box suite. The
GA-A performance command builds the 30-slide / 900-element / 120-group /
50 MiB-asset / 20-font corpus and measures the published P95 budgets, including
open, page switch, selection, human and text commit, journal append, undo/redo,
checkpoint, Portable first screen, and bundle size. A failed budget exits
non-zero and prints the measured value and its limit.

The public error surface is `PpteError`/`ErrorSemantics` in
`packages/schema/src/errors.ts`. Boundary diagnostics state the error code,
impact, content safety, whether saving is safe, retryability, and recovery
action. Journal and checkpoint fault points are named and tested; the last
complete checkpoint remains the recovery anchor unless replacement finished.

## GA-B implementation history

GA-B adds deterministic Bar, Line, and Pie Chart data/encoding/options/style
operations, Fact/Source references with cross-slide consistency diagnostics,
numeric Fact Quick Fix, and reviewable Fact synchronization Transactions.
Revised Copy review covers Chart fields and explicit conflict resolutions; the
`.ppte.patch` default profile is `ppte-2.0-ga-b.1`. Image PPTX is a derived
OOXML package containing one self-contained SVG image per page and a Capability
Report. The default `.ppte` checkpoint profile remains `ppte-2.0-ga-a.1` for
backward compatibility; callers opt into the GA-B profile when required.
GA-C checkpoints opt into `ppte-2.0-ga-c.1` when Area/Donut, Poster, or
Widget content is present.

## GA-C implementation history and open gaps

The repository contains a forward-only `ppte-2.0-ga-c.1` profile and related
runtime surfaces for Area/Donut charts, Poster metadata, controlled Widgets,
Light Edit operations, and semantic PPTX mapping. These are bounded release
surfaces.
Video Widget, native PPTX Chart authoring, a complete Portable editor, CRDT,
and multi-user collaboration remain intentionally unimplemented.
