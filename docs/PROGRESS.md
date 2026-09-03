# PPTe 2.0 Milestone Progress

## 2026-09-03 — R0 audit intake: reference-core prototype（修复流水线进行中）

独立审计报告 [`REVIEW_v2.3_GA_AUDIT.md`](REVIEW_v2.3_GA_AUDIT.md) 已入库。
当前交付物只能诚实地称为 **reference-core prototype**：底层语义
Document/Operation/Session/Checkpoint 等内核边界有可复用实现，但产品入口、
Portable 编辑、恢复、导出与完整修订回流仍按审计报告缺失。下方早期里程碑条目
记录的是当时的实现变更和自证结果，不再作为 GA-C 产品完成证据；黑盒修复门禁
正在建立并会逐组恢复。

### 本轮已记录

- Published the forward-only `ppte-2.0-ga-c.1` Compatibility Profile from
  GA-B, with public Area and Donut Chart contracts and deterministic SVG
  rendering.
- Added Poster transactions driven by resolved local Artwork Assets. Safe text
  regions, avoidance regions, focal point, and dominant palette are checked
  before the strategy/layer transaction is previewed, confirmed, committed,
  and undone. Existing semantic elements remain in the document.
- Added host-owned Table, Code, and Equation Widgets. Documents contain only
  component type/version, JSON Props, requirements, and an asset-or-placeholder
  fallback; unknown definitions and invalid Props never execute document code.
- Added Portable Light Edit for Image Crop, Chart Data, and simple Move/Resize.
  Each edit uses the existing Session Operation Engine and exact inverse path;
  GA-C checkpoint save embeds required bytes and passes offline audit.
- Added semantic PPTX mapping export: editable Text Boxes, Pictures, native
  Shapes, static Chart SVG, Widget fallbacks, and Poster Artwork Pictures.
  Missing or mismatched payloads remain visible as placeholders and produce
  explicit Capability Report errors; no slide-image shortcut or silent drop is
  used.
- Added GA-C legacy migration, Poster downgrade warnings for older targets,
  public schema/example coverage, renderer markers, release documentation, and
  a dedicated `e2e:ga-c` acceptance command.

### Historical self-check（非独立产品验收）

- `pnpm install` — passed; all 34 workspace projects were already up to date.
- `pnpm typecheck` — passed.
- `pnpm test` — 61 tests passed, 0 failed, 0 skipped.
- `pnpm validate` — 15 schemas/examples, semantic checks, operation parity,
  markdown structure, and source guards passed.
- `pnpm e2e:vertical-slice` — passed; existing Stable Core, Journal,
  Checkpoint, renderer, scope, and out-of-scope boundary remained green.
- `pnpm e2e:milestone` — passed; existing IR, Recipe, Agent, artwork,
  comparison, confirmation, and undo flow remained green.
- `pnpm e2e:beta` — passed; existing Portable Viewer/Quick Fix, Glyph, Patch,
  PDF, and PNG flow remained green.
- `pnpm e2e:ga-a` — passed at the published 30-slide / 900-element /
  120-group / 50 MiB / 20-font boundary; every published P95 and bundle
  budget passed.
- `pnpm e2e:ga-b` — passed; existing Chart/Fact, Review/Patch, and Image PPTX
  acceptance remained green.
- `pnpm e2e:ga-c` — passed; Area/Donut boundary, Table/Code/Equation Widget
  registry/fallback, Poster safety and undo, Light Edit edits/save/audit, and
  semantic PPTX mapping all passed.
- Semantic PPTX independent package check — passed; a 19,130-byte, two-slide
  package passed `unzip -t`, every XML part passed `xmllint`, and LibreOffice
  converted it to a valid two-page PDF.
- `git diff --check` — passed.

### Explicitly not done

This release does not generate Artwork pixels; Poster consumes a resolved local
Asset and its declared safety metadata. Video Widget, private Widget
registries, native PPTX Chart authoring, PPTX semantic import, a complete
Portable editor, nested Groups, Group Rotate, Run-level font or font-size
styling, CRDT, real-time collaboration, full legacy markup/runtime import, and
browser/OS pixel-matrix validation remain outside the release-tested surface.
Semantic PPTX Charts are static SVG Pictures and Widgets use explicit static
fallbacks. No remote was created and no changes were pushed.

## 2026-09-03 — R5 recovery / history closure（findings 23–25）

### Completed this round

- Added Host-level checkpoint open/recovery APIs with automatic adjacent
  Journal discovery by `documentId + baseCheckpointRevision`, isolated draft
  replay/validation, and explicit recover/discard/save-as outcomes.
- Persisted checked inverse metadata with committed Journal/checkpoint history
  tails. `PpteSession` now restores and bounds recent history, so normal reopen
  and Journal recovery expose a usable Undo stack only after validating both
  directions of the history chain.
- Added hash-verified CAS/blob resolution during Journal replay. The replay
  path now carries the checkpoint compatibility profile and runtime profile,
  including GA-C Widget semantics; successful save-as/checkpoint paths clear
  the Journal only after the new package is durable.
- Kept `document.json` canonical and all changes on the existing typed
  Operation/Session path; no new persistence source or red-line capability was
  introduced.

### Exit-condition evidence

- `node scripts/blackbox-gates.mjs --milestone r5` — passed, 33/33 cases,
  0 red; includes the real SIGKILL child, automatic discovery, checkpoint
  history Undo, new-asset replay, and GA-C Widget replay.
- `pnpm test` — passed, 78/78 tests, 0 failed, 0 skipped.
- `pnpm typecheck` — passed.
- `pnpm e2e:vertical-slice` — passed, including checkpoint round-trip and
  journal recovery.
- `git diff --check` — passed.
- `node scripts/blackbox-gates.mjs --report` — 40 green / 12 red overall;
  the 12 red cases are outside R5 (`review-patch`: 9, `section-41`: 3) and
  are not claimed as part of this milestone. Every selected R5 group is green.

### Boundary recorded honestly

Recovering in memory keeps the matching Journal until a normal Session
checkpoint finishes; `discard` and `save-as` are the explicit Host actions that
complete and clear it immediately. A standalone replay without a blob resolver
can use the new asset metadata to reconstruct the semantic snapshot, but
checkpoint serialization still requires verified payload bytes. No remote was
created and no changes were pushed.

## 2026-09-03 — GA-B Chart / Fact / Review / Patch / Image PPTX

### Completed this round

- Added the GA-B Compatibility Profile `ppte-2.0-ga-b.1` as an explicit
  interchange profile while keeping the default `.ppte` checkpoint profile at
  GA-A for backward compatibility.
- Added public Bar, Line, and Pie Chart contracts with validated columns,
  rows, encodings, options, typed style overrides, deterministic SVG output,
  and reversible `chart.*` Operations. Area and Donut remain forward-
  compatible schema values for GA-C and are rejected by the GA-B runtime.
- Added Fact/Source references, derived indexes/diagnostics for cross-slide
  consistency, displayable-source checks, and explicit Fact update
  Transactions. Numeric Portable Quick Fix and Agent Fact sync use the same
  Session preview/confirmation/commit/undo path.
- Completed Chart-aware Revised Copy review and `.ppte.patch` generation:
  Chart fields, Fact/Source records, two-way manual fallback, explicit
  conflict resolutions, and normal undoable Transactions are covered.
- Added deterministic Image PPTX export as a standard OOXML ZIP with one
  self-contained SVG image per slide and an embedded Capability Report.
  Missing or hash-mismatched referenced assets retain a visible placeholder
  and return an explicit failure; no page or asset is silently dropped.
- Added positive, inverse, conflict, migration, Portable, Agent, export, and
  capability tests, a public `examples/ga-b-chart-document.json` fixture, and
  the executable `e2e:ga-b` acceptance path.

### Exit-condition evidence

- `pnpm install` — passed; all 33 workspace projects were up to date and the
  lockfile passed supply-chain policy checks.
- `pnpm typecheck` — passed.
- `pnpm test` — 55 tests passed, 0 failed, 0 skipped.
- `pnpm validate` — 14 schemas/examples, semantic checks, operation parity,
  markdown structure, and source guards passed.
- `pnpm e2e:vertical-slice` — passed; existing checkpoint, Journal, scope,
  renderer, and Stable Core flow remained green.
- `pnpm e2e:milestone` — passed; existing IR, Recipe, Agent, artwork,
  comparison, confirmation, and undo flow remained green.
- `pnpm e2e:beta` — passed; existing Portable Viewer/Quick Fix, Glyph,
  Patch, PDF, and PNG flow remained green.
- `pnpm e2e:ga-a` — passed at the published 30-slide / 900-element /
  120-group / 50 MiB / 20-font boundary. All P95 and bundle budgets passed;
  observed P95 values included human commit 90.19 ms, checkpoint 571.78 ms,
  Viewer first screen 509.90 ms, and Quick Fix first screen 492.26 ms.
- `pnpm e2e:ga-b` — passed; Chart/Fact cross-slide consistency and explicit
  synchronization, Chart review/Patch, two-slide Image PPTX packaging,
  Capability Report, and explicit missing-asset failure all passed.
- `git diff --check` — passed.

### Explicitly not done

This round does not implement Area/Donut runtime support, Poster, Widget,
Portable Light Edit, Semantic PPTX, nested Groups, Group Rotate, Run-level
font or font-size styling, CRDT, real-time collaboration, a complete Portable
editor, or full legacy markup/runtime import. Image PPTX is intentionally an
image export rather than a semantic PPTX writer. No remote was created and no
changes were pushed.

## 2026-09-03 — GA-A Stabilization / v0.2.0-rc.1 candidate

### Completed this round

- Froze the release-tested `ppte-2.0-ga-a.1` Compatibility Profile and added
  native, forward-migrate, read-only, and reject decisions for independent
  format, schema, operation, Slide IR, Portable Runtime, and Recipe versions.
- Added a data-only forward migration API for JSON-compatible legacy semantic
  snapshots. It preserves source identity by digest, never executes or
  overwrites the source, materializes nested Groups into Flat Groups, promotes
  safe style values to typed overrides, retains unsafe Run-style differences
  in a non-required migration Extension, and emits deterministic review data.
- Added the public error semantics/catalog: impact, content safety, save
  safety, recoverability, retryability, and recovery guidance are attached to
  validation and boundary diagnostics without removing the original error
  code/message/severity contract.
- Added the independent GA-A fault-point list and matrix. Journal corruption,
  base/CAS mismatch, all Checkpoint replacement stages, archive safety,
  Patch replay/conflict, and Portable network/payload failures have explicit
  expected outcomes and recovery policy. Checkpoint injectors verify that the
  prior file remains readable until replacement completes.
- Added a real 30-slide / 900-element / 120-group / 50 MiB-asset / 20-font
  acceptance corpus, capacity validation, P95 performance budgets, and
  compressed bundle limits to the executable GA-A E2E and CI workflow.
- Updated the README, CONTRIBUTING guide, CHANGELOG, decisions log, public
  Compatibility Profile schema/example, and release scripts. The root
  candidate version is `0.2.0-rc.1`; publication is intentionally local-only.

### Exit-condition evidence

- `pnpm install --frozen-lockfile` — passed; lockfile policy check passed.
- `pnpm typecheck` — passed.
- `pnpm -r typecheck` — passed for 29 workspace projects (the root importer
  has no recursive script).
- `pnpm test` — 49 tests passed, 0 failed, 0 skipped.
- `pnpm validate` — 13 schemas/examples, semantic checks, operation parity,
  markdown structure, and source guards passed.
- `pnpm e2e:vertical-slice` — passed; checkpoint round trip, journal recovery,
  and out-of-scope blocking remained green.
- `pnpm e2e:milestone` — passed; IR, Recipe, Agent, artwork, comparison,
  confirmation, and undo evidence remained green.
- `pnpm e2e:beta` — passed; Portable Viewer/Quick Fix, glyph coverage,
  three-way Patch, replay protection, PDF, PNG, and explicit degradation
  remained green.
- `pnpm e2e:ga-a` — passed at the exact capacity boundary. The slowest
  measured P95 was human commit at 91.9 ms against 100 ms; checkpoint was
  572.6 ms against 3,000 ms; Portable Viewer was 515.6 ms against 2,000 ms;
  Portable Quick Fix was 487.5 ms against 2,500 ms. Viewer and Quick Fix gzip
  bundles were 186,101 and 185,250 bytes against 1,200,000 and 2,000,000
  byte limits.
- `git diff --check` — passed.

### Explicitly not done

This candidate supports only data-only legacy semantic snapshot migration. It
does not execute or import legacy markup/runtime sources. Chart, Widget,
Poster, PPTX, nested Groups, Group Rotate, Run-level font or font-size
styling, Portable Light Edit, Fact Quick Fix, a complete Portable editor,
CRDT, real-time collaboration, and browser/OS pixel-matrix validation remain
out of scope. No remote was created and no changes were pushed.

## 2026-09-03 — Week 11–16 Portable Runtime / Review / Export Beta

### Completed this round

- Added a self-contained Portable Viewer and Quick Fix runtime derived from
  the semantic Document, with offline playback, fullscreen, slide navigation,
  Click Steps, notes, origin metadata, explicit no-sync messaging, and
  capability reporting. Viewer has no edit path; Quick Fix supports Text,
  Image replacement, Undo, and Save as New Project through the Operation
  Engine.
- Added strict Glyph Coverage inspection for portable text edits. Undeclared,
  incomplete, unsafe, or fallback-only font coverage becomes an explicit
  error; Viewer degradation is reported as `font-replacement` instead of
  being hidden.
- Added three-way semantic Revised Copy comparison over Base, Local, and
  Revised snapshots. Matching uses element identity, semantic keys, lineage,
  Fact/Source IDs, and manual-only heuristic/ambiguous suggestions. Review
  units cover fields, elements, slides, records, and resources; accepted
  changes become normal review Transactions and can be undone.
- Added data-only `.ppte.patch` stored ZIP transport with manifest,
  `operations.jsonl`, content-addressed asset/font payload paths, binary hash
  checks, safe-path checks, executable-payload rejection, base-revision
  preconditions, atomic resource import, partial acceptance, and replay/base
  mismatch protection. CRDT and real-time collaboration remain out of scope.
- Added deterministic PDF 1.4 and PNG baseline exporters. Unsupported,
  missing-source, font, layout, and rasterization limitations are returned in
  the Capability Report and export issues; pages/content are not silently
  skipped.
- Added public schemas/examples for Portable Origin, Capability Report,
  Review, and patch resource maps, plus the `e2e:beta` gate and positive,
  inverse, conflict, security, and degradation tests.

### Exit-condition evidence

- `pnpm install` — passed.
- `pnpm -r typecheck` — passed for all 25 selected workspace projects.
- `pnpm typecheck` — passed.
- `pnpm test` — 44 tests passed, 0 failed, 0 skipped.
- `pnpm validate` — 10 schemas/examples, semantic checks, operation parity,
  markdown structure, and source guards passed.
- `pnpm e2e:vertical-slice` — passed; existing checkpoint, journal, scope,
  renderer, and Operation Engine flow remained green.
- `pnpm e2e:milestone` — passed; existing IR, Recipe, Agent, artwork,
  comparison, confirmation, and undo flow remained green.
- `pnpm e2e:beta` — passed; Viewer audit, Quick Fix Text/Image/Undo/Save,
  Glyph Coverage, three-way Patch, replay protection, PDF, PNG, and explicit
  degradation all passed.
- `git diff --check` — passed.

### Explicitly not done

The first GA portable promise is limited to Viewer and Quick Fix. Light Edit,
Fact Quick Fix, Chart/Widget/Poster/PPTX, a complete Portable editor, crop,
free geometry, full Agent/Generation Engine, CRDT, real-time collaboration,
legacy migration/import, and browser/OS pixel-matrix validation are not part
of this round. PDF/PNG are deterministic baselines with explicit fidelity and
font limitations, not a claim of complete production export parity. No remote
is created and no changes are pushed.

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

## 2026-09-03 — Week 7–13 Slide IR / Recipe / Agent milestone

### Completed this round

- Added bounded Presentation IR, Slide IR, Recipe Spec, Layout Constraint,
  Element Draft, and compiled-draft validation with public JSON examples and
  schema validation. Unknown fields and non-JSON executable payloads are
  rejected.
- Added a deterministic Design Compiler that selects versioned declarative
  Recipes, resolves normalized Zones and constraints, creates semantic Element
  Drafts, preserves Reading Order and semantic keys, records provenance, and
  returns typed initialization/reflow/regeneration Transactions without
  committing.
- Added 12 built-in declarative Recipes and a controlled-code registration
  boundary, keeping the built-in declarative ratio at 100%. Added seven
  bounded Macros with input validation; expansion ends at Element Drafts.
- Added the complete Agent query surface from the frozen plan plus aliases for
  facts, sources, assets, theme, history, text search, semantic keys, preview,
  commit, undo, selection/slide regeneration, Recipe application, Macro
  expansion, artwork replacement, Fact synchronization, revised-copy compare,
  editability, and deterministic slide rendering.
- Enforced granted Scope on Agent reads and writes, explicit confirmation for
  destructive generated changes, actual nine-dimension Mutation Budgets,
  protected regeneration anchors, and one Session preview/commit route.
- Added Hybrid artwork role/metadata, deterministic renderer markers, safe and
  avoid-region checks, L3 targeted visual hashes with target-leak reporting,
  contract tests, and a milestone E2E flow. Existing Stable Core renderer
  output remains deterministic.

### Exit-condition evidence

- `pnpm install --frozen-lockfile` — passed after adding the three workspace
  packages.
- `pnpm -r typecheck` — passed for all selected workspace projects.
- `pnpm typecheck` — passed.
- `pnpm test` — 38 tests passed, 0 failed, 0 skipped.
- `pnpm validate` — 7 schemas/examples, semantic checks, operation parity,
  and source guards passed.
- `pnpm e2e:vertical-slice` — passed; checkpoint round trip, journal recovery,
  and the existing out-of-scope block remained green.
- `pnpm e2e:milestone` — passed; Agent queries, draft-only generation,
  confirmation, same-path commit/undo, Recipe, Macro, Fact, artwork, and
  revised-copy checks completed.
- `git diff --check` — passed.

### Explicitly not done

This round provides Hybrid Visual foundations and artwork metadata validation,
not an image-generation service or a visual review model. Chart and Component
runtime rendering, Recipe Studio UI, full Poster behavior, Portable viewer,
PPTX/PDF/PNG export, Patch/Merge, migration/import pipelines, and a complete
browser/OS visual matrix remain follow-on work or the explicit Stable Core
boundary. No remote is created and no changes are pushed.

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
