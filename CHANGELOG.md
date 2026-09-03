# Changelog

All notable changes to the PPTe reference runtime are recorded here.

## Audit status — 2026-09-03

The independent GA audit reclassifies this checkout as a **reference-core
prototype**. The entries below record implementation history and repository
self-checks; they do not mean that the corresponding product journey is
complete or GA-accepted. Product-surface gaps from the audit are being tracked
by the R0 black-box gate repair pipeline. No GA-C-complete or all-milestones-
complete claim is currently made.

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
