# Changelog

All notable changes to the PPTe reference runtime are recorded here.

## [0.6.0] — 2026-09-04 (bounded completion release)

### Added and verified

- Added the controlled Video Widget `core/video@1.0.0`. It accepts local
  source metadata, keeps a local poster/fallback path in the semantic
  document, survives checkpoint round-trips, and reports an actionable static
  downgrade in offline Light Edit. PDF/PNG retain a non-empty fallback path
  but return explicit element-scoped degradation; this is not native video
  playback or network media support.
- Added native semantic PPTX chart parts for Bar, Line, and Pie Charts. The
  exporter preserves chart categories and numeric values and marks each
  eligible Chart capability item with `nativeChart: true`. Area and Donut
  remain static/degraded in PPTX.
- Added the bounded `full-portable` self-contained `file://` profile. Its
  public surface covers text/image editing, multi-selection, single-element
  Move/Resize/Scale/Rotate, Image Crop, Chart Data, Undo/Redo, and Save as New
  Project; all persistent edits use the existing Session Operation Engine.
- Added the stdio MCP server and shared PPTe skill for Claude Code, Codex CLI, pi agent, and Cherry Studio, including readonly tool filtering and atomic `.ppte` checkpoint persistence.
- Added Group Rotate for flat Groups. Rotation is materialized as explicit
  member Frame and `rotationDeg` changes with an exact inverse; Groups do not
  gain a frame, transform, or coordinate system.
- Extended the legacy importer with a bounded Slidev/Markdown text parser and
  JSON-compatible semantic snapshot migration. Supported text is reduced to
  semantic heading/body Text elements (with a small deterministic markup
  cleanup); GA-B/GA-C profile rules, migration evidence, and source-preserving
  rejection/degradation remain explicit. Raw markup is never executed or
  retained as a runtime document source.
- Independent black-box acceptance now reports `16 groups, 62 green / 0 red`,
  including §41 A–J and the five new capability groups.

### Still not implemented

- CRDT.
- Multi-user / real-time collaboration.
- Nested Groups or a Group coordinate system.
- Run-level font or font-size styling.
- Full legacy markup/runtime import, general Slidev/Markdown content-source
  support, or DOM reverse parsing; the bounded importer above is the only
  supported text-source path.
- Network video playback, arbitrary/private Widget execution, and semantic
  PPTX import.
- Browser/OS pixel-matrix validation and direct writes that bypass the
  Operation Engine.

These are intentional 0.6.0 boundaries, not hidden capabilities. Capability
Reports and migration/export diagnostics remain the source of truth when a
target is static, degraded, unsupported, or requires a newer profile.

## [0.5.0] — 2026-09-03 (final bounded release)

### Added and verified

- Added the self-contained React/Vite Host. A real Playwright `file://`
  journey covers New, Agent generation of 10 pages, double-click text editing,
  pointer image drag, Add page, Present, `.ppte` download/reopen, and restored
  Undo history.
- Made Host text/image/page edits use typed semantic Operations with inverse
  history; standard browser checkpoints retain the recent History tail so Undo
  remains available after reopening.
- Converted §41 scenarios A–J into independent black-box cases. Final evidence
  is `52 green / 0 red` from `node scripts/blackbox-gates.mjs --milestone final`.
- Updated Quick Start, final gate scripts, and the local release/tag workflow.

### Still not implemented

- Video Widget.
- Native PPTX Chart authoring.
- Complete Portable editor.
- CRDT.
- Multi-user / real-time collaboration.

These are intentional 0.5.0 boundaries, not hidden capabilities. Slidev,
Markdown-as-content, nested Groups, Group Rotate, Run-level font styling, and
other frozen “明确不做” items remain out of scope as documented in the ADR and
development checklist.

## Historical audit status — 2026-09-03 (pre-0.5.0 baseline)

The independent GA audit reclassified the pre-0.5.0 checkout as a
**reference-core prototype**. The historical entries below record the baseline
and its implementation history; final 0.5.0 acceptance is recorded above.

## [0.4.0-rc.1] — 2026-09-03 (reference-core prototype; audit reclassification)

### Added

- GA-C Compatibility Profile `ppte-2.0-ga-c.1`, forward-only from GA-B.
- Deterministic Area and Donut Chart runtime support.
- Poster artwork transactions with safe-region, focal-point, and palette
  metadata checks.
- Host-owned Table, Code, and Equation Widgets with JSON Props and static
  fallbacks.
- Portable Light Edit for Image Crop, Chart Data, and simple Move/Resize,
  including exact Undo and GA-C checkpoint save.
- Semantic PPTX mapping export for editable Text Boxes, Pictures, native
  Shapes, static Chart SVG, Widget fallback, Poster artwork, and Capability
  Reports.
- GA-C legacy migration, public example/schema coverage, and a dedicated E2E
  acceptance command.

### Scope and audit boundary

- The code contains GA-C-oriented runtime primitives, but the independent
  audit found the product Host, full Portable editing, recovery, faithful
  PDF/PNG/PPTX export, and complete review/patch workflow incomplete.
- Video Widget, native PPTX Chart authoring, private Widget registries, CRDT,
  real-time collaboration, and full legacy markup/runtime import remain out
  of scope.
- Capability/degradation behavior must be re-verified by the new black-box
  gates before any release claim is restored.

## [0.3.0-rc.1] — 2026-09-03

### Added

- GA-B Compatibility Profile `ppte-2.0-ga-b.1` for reviewable patch output;
  the default `.ppte` checkpoint profile remains GA-A for compatibility.
- Bar, Line, and Pie Chart contracts with deterministic SVG rendering, typed
  data/encoding/options/style Operations, inverse handling, and runtime
  validation. Area and Donut remain forward-compatible but are not GA-B
  runtime features.
- Fact/Source references, cross-slide consistency diagnostics, explicit Fact
  synchronization Transactions, Portable numeric Fact Quick Fix, and Agent
  scope/confirmation coverage.
- Chart-aware three-way Review/Patch handling, explicit conflict resolution,
  and a deterministic Image PPTX exporter with an embedded Capability Report.

### Scope

- Poster, Widget, Portable Light Edit, Semantic PPTX, CRDT, real-time
  collaboration, and full legacy markup/runtime import remain out of scope.
- Missing or mismatched image payloads produce explicit export failures and a
  visible placeholder in the derived package; content is never silently
  discarded.

## [0.2.0-rc.1] — 2026-09-03

### Added

- GA-A Compatibility Profile `ppte-2.0-ga-a.1` with independent version
  checks and explicit native, forward-migrate, read-only, and reject paths.
- Data-only legacy semantic snapshot migration with deterministic IDs,
  materialized flat Groups, typed Style Preset reattachment, retained
  non-required Run-style notes, source digest, and a reviewable report.
- Public error semantics for impact, content safety, save safety,
  recoverability, retryability, and recovery guidance.
- Named Journal/Checkpoint/archive/patch/Portable fault matrix and checkpoint
  fault injection coverage.
- GA-A capacity and P95 performance budget helpers plus the CI acceptance
  corpus and bundle-size checks.
- Public Compatibility Profile schema/example and updated open-source
  contributor and release documentation.

### Reliability

- Kept the prior checkpoint readable across build, fsync, pre-replacement,
  replacement, and post-replacement fault points unless replacement had
  completed.
- Optimized binary asset hashing and stored-archive CRC verification while
  preserving canonical document hashing and byte verification.

### Scope

- The candidate does not add Chart, Widget, Poster, PPTX, nested Groups,
  Group Rotate, Portable Light Edit, CRDT, real-time collaboration, or full
  legacy markup import.
