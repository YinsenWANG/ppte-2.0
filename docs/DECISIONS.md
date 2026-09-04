# Implementation decisions

This file records conservative choices made while implementing the frozen
milestones.

## 2026-09-04 — r0 completion evidence and frozen boundaries

- The final independent black-box report and cumulative `final3` milestone are
  both green: 16 groups, 62 green / 0 red. The five new groups were kept as
  behavior-first probes from their initial red run; no assertion was removed
  or relaxed.
- Video uses the controlled built-in `core/video@1.0.0` registry definition.
  It accepts local source metadata and a poster reference, renders a bounded
  video/fallback surface, and reports static downgrade/recovery evidence in
  offline Light Edit. It does not add network playback or arbitrary document
  code.
- Native PPTX Chart authoring is limited to semantic Bar, Line, and Pie. The
  exporter writes OOXML chart parts and a capability `nativeChart` flag while
  retaining the deterministic static sidecar for compatibility checks. Area
  and Donut remain the forward GA-C static/degraded boundary.
- `full-portable` is a named profile, not a second document model. Its
  selection, geometry, crop, Chart Data, undo/redo, and save-as-new-project
  methods all route through the existing Session and typed Operations.
- Group Rotate follows ADR-006/§20.5: it computes each member's new axis-aligned
  Frame and `rotationDeg` explicitly and stores an inverse for each member.
  The Group object remains flat and has no frame, transform, or group
  coordinate system.
- Legacy text support is deliberately bounded to the importer boundary. A
  Slidev/Markdown string is parsed into semantic Text slides and reports
  `MIGRATION_TEXT_SOURCE_PARSED`; raw markup is never retained as the
  document source and is never reverse-parsed from the DOM. Semantic legacy
  snapshots retain the existing GA-C Area/Donut, Poster, and Widget fallback
  decisions, with GA-B downgrade issues.
- The final npm verification was `npm run typecheck`, `npm test` (85/85), and
  `npm run validate`; all passed. CRDT, multiplayer/realtime collaboration,
  nested Groups, Run-level font/size, arbitrary/private Widget execution,
  full legacy runtime/markup execution, and direct writes remain outside the
  frozen scope.

## 2026-09-04 — Agent MCP transport boundary

- PPTe exposes the existing `AgentToolServer` through a minimal MCP over stdio
  entry point. Each process owns one opened `.ppte` document and its recovery
  Journal; there is no multiplexing, HTTP/SSE transport, or authentication.
- `commit_transaction` and `undo_transaction` continue to use the Session
  Operation Engine, then atomically checkpoint the same `.ppte` path through
  `writeCheckpoint`; readonly sessions omit those mutation tools from
  `tools/list`. These transport and lifecycle limits are deliberate boundaries,
  not deferred infrastructure.

## 2026-09-04 — r0 section-41 A 基线漂移判定与修复

- 初始 `node scripts/blackbox-gates.mjs --report` 两次复跑一绿一红；红结果为 51 个绿断言、section-41 A 的 1 个红断言，失败证据为 `Pointer drag did not commit image geometry`，`imageDragged:false`。
- 随后以独立子进程复跑完整 `final` 6 次、section-41 10 次，均为全绿；浏览器事件探针也确认图片节点收到了 pointer down/move/up，事务 history 从 3 增至 4，位置从 `left:1120px;top:260px` 变为 `left:1179.178px;top:299.452px`。因此判定为冷启动下的浏览器测量/原生图片手势竞争造成的 flaky，而非稳定实现回归。
- 修复边界保持在 Host 与第三方门禁的同步：图片拖拽开始/移动/结束时阻止原生默认手势，画布声明 `touch-action:none`；门禁在取样前等待导入事务深度为 3、有效渲染矩形，在释放后等待精确提交深度为 4。未删除或放宽任何既有断言。

## 2026-09-04 — r0 section-41 A 第二次取样竞态

- 当前基线聚焦复跑 8 次出现 2 次红；失败时后续 `history-depth` 仍为 5，且浏览器探针看到完整 pointer down/move/up 与 pointer capture，说明拖拽事务已提交。
- 失败取样的证据是：同一轮先读到 `image.style.left/top = 1179.18px/299.452px`，紧接着独立的 `Locator.boundingBox()` 返回 `null`，再次 `Locator.evaluate()` 又读到移动后的新节点；这是上传 Asset URL settle 引起 React `innerHTML` 替换时读到了已卸载旧节点，不是实现回归。
- 门禁改为在同一次页面评估中同时验证 frame 已改变且 `getBoundingClientRect()` 非零，再读取结果句柄；没有删除 History、frame 或可见矩形断言，也没有把 History 增长单独当作拖拽成功。

## 2026-09-04 — r0 新能力断言的保守边界

- 本轮只建立新能力的第三方黑盒红断言，不把尚未实现的能力伪装成绿；原有 11 个组（含 section-41）的断言继续完整执行。
- Group Rotate 的探针使用与单元素 `element.rotate` 一致的 `rotationDeg` 请求字段，但验收只约束行为：90° 后每个成员都有显式 Frame/rotation 变化、Undo 精确恢复，Group 不出现 `frame`、`rotationDeg`、`transform` 或坐标系字段。这样不为扁平 Group 引入持久坐标系。
- `full-portable` 作为明确的 Portable profile 名称进入累计 milestone；其 file:// 断言覆盖多选、Move/Scale/Rotate、Crop、Chart Data、Undo/Redo、Save as New Project 的公开方法面。Video 与 PPTX Chart 的断言分别以 Host registry/static fallback 与 python-pptx 原生 chart part/category/value 为事实边界。
- Slidev/Markdown 文本导入探针通过现有 legacy importer 的公开入口执行；当前 JSON-only 入口返回 `MIGRATION_INPUT_INVALID` 的红结果被原样保留，直到后续轮次实现受控解析与语义化迁移。

## 2026-09-03 — R7 Host browser boundary and final acceptance

The browser Host uses a small browser-safe Session boundary around the same
typed `Operation`/inverse/revision protocol. The full Core entry point is not
bundled into the `file://` Host because its Patch transport includes Node file
system adapters; keeping that adapter out preserves the offline boundary. Host
checkpoints persist the validated recent forward transactions and their
inverse metadata, so reopening a downloaded `.ppte` restores an actionable
Undo stack without making the DOM a content source.

The Host Agent action is intentionally a deterministic local orchestrator: it
requires a selected source file, objective, and audience, then creates ten
pages through the canonical `slide.duplicate` Operation. No remote model,
network asset, CRDT, or alternate document source is introduced. The final
§41 A–J evidence is the independent black-box suite; presence-only DOM checks
are not release evidence for the Host journey.

## 2026-09-03 — GA-C Poster, Widget, Light Edit, and Semantic PPTX boundary

GA-C publishes the explicit `ppte-2.0-ga-c.1` Compatibility Profile. It is
forward-only from GA-B; the GA-A default checkpoint and GA-B runtime boundary
remain unchanged. Area and Donut use the same deterministic SVG chart
renderer as the reference surface. Older runtime profiles reject them with a
diagnostic instead of treating them as another chart type.

Poster is represented by a `visualStrategy: poster` slide plus a semantic
Image whose role is `artwork`. The artwork Asset must declare safe text
regions, a focal point, and a dominant palette before the compiler creates a
Poster transaction. Existing title, metric, CTA, logo, and source objects are
kept as independent semantic elements; the transaction sets the strategy and
adds one artwork layer, requires confirmation by default, and remains fully
undoable. This round does not generate artwork pixels; it consumes a resolved
local Asset and records its safety metadata.

Controlled Widgets are host-owned `WidgetRegistry` definitions. The document
stores only component type/version, JSON Props, and an asset-or-placeholder
fallback. GA-C includes deterministic `core/table`, `core/code`, and
`core/equation` definitions. Unknown or invalid definitions render the
declared fallback; no Widget implementation, network capability, or arbitrary
code is stored in a document. `component.updateProps` is a GA-C-only typed
Operation with an exact inverse and the usual Scope/Change Contract path.

Portable Light Edit is limited to Image Crop, Chart Data replacement, and
simple Move/Resize. Each action creates one typed Transaction in the existing
Session, has a field-specific contract, validates the GA-C runtime, and can be
undone. Light Edit output defaults to the GA-C checkpoint profile, embeds
required bytes, keeps origin/capability metadata, and remains offline. Group
editing, free transforms, and a full Portable editor remain out of scope.

Semantic PPTX is a mapping compiler, not a screenshot export: Text becomes an
editable Text Box, Image/Artwork becomes a Picture, Shape becomes a native
Shape, and Flat Group coordinates are materialized. Charts are deterministic
SVG Pictures, Components use their static fallback, Posters map to the
Artwork Picture, and animation is represented by the final static state.
Missing or mismatched payloads emit a visible placeholder and an explicit
error. The exporter never parses rendered DOM back into a document and never
silently drops an unsupported object.

Legacy migration accepts GA-C Area/Donut, controlled Widgets, Poster strategy,
and artwork metadata only when the explicit GA-C target is requested. Older
targets omit unsupported Area/Donut and Widget objects or downgrade Poster to
structured while retaining safe semantic elements; each decision is reported
as a migration warning and preserves the source boundary. Video Widgets,
native PPTX Chart authoring, private Widget registries, real-time
collaboration, and CRDT remain unimplemented.

## 2026-09-03 — GA-B Chart, Fact/Source, Review, Patch, and Image PPTX boundary

GA-B accepts only Bar, Line, and Pie Charts in the runtime. Area and Donut
remain schema-level forward-compatible values for the later GA-C profile and
are rejected by the GA-B runtime and chart renderer.

Fact changes are generated as one reviewable Transaction containing the Fact
upsert and explicit reference-sync Operations. The builder updates only text
references whose prior display is identifiable and only chart cells whose row,
field, or single-cell identity is safe; an unsafe reference is never silently
overwritten. Agent Fact sync requires both `facts` and `content` permission and
retains the normal preview/confirmation/commit path.

Revised Copy comparison adds Chart data, encoding, options, style, and
Fact/Source record units. A missing Base uses a manual two-way fallback and is
never auto-accepted; same-field conflicts require an explicit revised-side
resolution. Accepted units become ordinary Session Transactions and remain
undoable.

Image PPTX is a deterministic OOXML package with one self-contained SVG image
per page and a bundled Capability Report. It is intentionally an image export,
not a semantic PPTX writer. Missing or hash-mismatched image payloads produce
a visible placeholder plus an explicit failure result. The default checkpoint
profile stays GA-A for compatibility; GA-B is selected explicitly for
GA-B-specific patch/checkpoint interchange.

This round does not implement Poster, Widget, Portable Light Edit, Semantic
PPTX, CRDT, real-time collaboration, or full legacy markup/runtime import.

## 2026-09-02 — zero runtime dependencies

The slice uses TypeScript and platform APIs only. This keeps Core usable in
Node, a browser main thread, and a worker without leaking a library-private
document model into the file format.

## 2026-09-02 — stored ZIP checkpoint

The `.ppte` writer emits a deterministic ZIP with stored (uncompressed) entries
and implements the small reader/writer in the Node persistence boundary. The
format remains a ZIP checkpoint while avoiding a dependency whose metadata or
private state could affect canonical content.

## 2026-09-02 — synchronous pure Core API

Preview, commit, diff, validation, and undo are synchronous pure operations in
the vertical slice. Host persistence is the only synchronous I/O boundary;
callers may schedule it as a job without making Core depend on a runtime.

## 2026-09-02 — unsupported future elements are not implemented

The retained public schemas document the forward contract, but the Week 1–2
runtime intentionally accepts and renders only Text, Image, and Shape. Chart,
Widget, Poster, PPTX, Patch, nested Group, and complete Portable editing are
explicitly outside this slice and produce a diagnosable unsupported error when
passed to runtime code.

## 2026-09-02 — journal tail recovery

Journal records are newline-delimited and checksummed. Recovery accepts the
last complete valid record and reports a partial or corrupt tail instead of
silently applying it. Checkpoint replacement is temp-file + fsync + rename;
an interrupted build therefore leaves the prior checkpoint readable.

## 2026-09-02 — workspace typecheck entrypoints

The recursive typecheck gate is exposed by every workspace package and app.
Each entrypoint invokes the repository TypeScript configuration because this
prototype intentionally has one compilation graph covering source and tests.
This keeps the gate complete without inventing package-local compiler
boundaries or changing runtime behavior.

## 2026-09-03 — Stable Core package and compatibility profile

The Stable Core checkpoint uses the frozen `ppte-2.0-ga-a.1` compatibility
profile, independent format/schema/operation versions, and a canonical
`sha256-` content revision. Manifest file hashes remain plain SHA-256 hex
digests, while Document Asset and Font metadata use the prefixed revision form
so the two hash domains cannot be confused.

## 2026-09-03 — self-contained assets with host CAS optimization

Checkpoint output always contains the bytes required by the Document. A
content-addressed store may supply those bytes to the writer, but it is not a
second source of truth. Journal records can carry the required Asset hashes so
recovery can verify that the current checkpoint contains the referenced
content before replay.

## 2026-09-03 — durable commit ordering and bounded History

A commit is considered durable only after the Journal append has been flushed;
the in-memory snapshot, revision, and History are not advanced when that
append fails. Standard sessions retain at most 200 History entries by default,
with an optional byte budget, and checkpoints carry the recent transaction
tail. Clean checkpoints carry no recent History.

## 2026-09-03 — explicit identity, style, fact, and group policies

Direct edits retain the current element identity. Explicit replacement helpers
inherit a prior `semanticKey`, record `replacesElementId`, and reject a
conflicting key or active replacement target. Style resolution is
Preset → Token → Typed Override; Override Debt is derived diagnostics rather
than persisted state. Text Fit, Fact display synchronization, and text-style
scaling during Group Resize are explicit Operations. Flat Groups materialize
member Frame changes and never create a nested coordinate system.

## 2026-09-03 — Stable Core boundary

This milestone does not implement Chart, Widget, Poster, PPTX, Patch, nested
Groups, Group Rotate, Run-level font or font-size styling, a complete Portable
editor, Slidev, Markdown as a content source, or DOM reverse parsing. These
remain explicit follow-on scope and are rejected or diagnosed at the runtime
boundary instead of being silently downgraded.

## 2026-09-03 — exact optional-state undo

When an Operation changes an optional field, its inverse records whether the
field was absent and uses an explicit `unset` branch when necessary. Undo
therefore restores the exact prior Document state instead of introducing a
default value that was not present before the edit.

## 2026-09-03 — deterministic contract evidence

The Stable Core contract evidence uses a fixed-seed reversible operation
sequence and a renderer Golden hash over canonical output. These checks are
kept dependency-free and complement the positive, inverse, conflict,
persistence-fault, and reopen tests.

## 2026-09-03 — normalized declarative Recipe geometry

Recipe Zone coordinates and constraint dimensions use normalized 0..1 values.
The Design Compiler resolves constraints first and materializes the result to
the Document Canvas. Only the resulting Frames are eligible for persistence;
the Recipe and Slide IR remain compilation inputs.

## 2026-09-03 — controlled Recipe and Macro trust boundary

The normal Recipe path is data-only. A controlled Recipe may be registered only
with an explicit trusted host handler; the handler is not serialized into an
IR, Draft, Transaction, or `.ppte` package. Macro inputs are bounded JSON and
Macro output is validated Element Draft data. Macro expansion never commits or
creates a persistent runtime object.

## 2026-09-03 — Agent preview and confirmation boundary

Agent query tools filter returned semantic data by the granted Scope. Generate,
reflow, artwork, fact-sync, and comparison tools are draft/preview operations.
Only `commit_transaction` may call the Session commit path, and a transaction
marked `requireConfirmation` needs an explicit confirmation value. Actual
structural Diff values, including Facts, Sources, Theme Tokens, and Style
Presets, are checked against the Change Contract budgets.

## 2026-09-03 — Hybrid artwork safety metadata

Hybrid artwork remains an Image with `role: artwork`; title, content, source,
and other key objects stay semantic. Safe regions, avoidance regions, focal
point, and dominant palette are asset metadata. The reference renderer exposes
only deterministic data attributes, while the compiler validator rejects
missing metadata or an artwork region that obscures semantic content.

## 2026-09-03 — targeted visual diff reference surface

L3 targeted visual comparison uses per-slide and per-semantic-element hashes of
the deterministic reference-render HTML. It reports changed target and
non-target element IDs without making a browser screenshot or pixel buffer a
Document source. A browser/OS pixel matrix remains a later release concern.

## 2026-09-03 — Week 11–16 Portable and review boundary

The first GA portable profile is limited to offline Viewer and Quick Fix.
Viewer is read-only; Quick Fix only creates Text/Image Operations, checks
Glyph Coverage before Text commit, and saves a new project or derived copy.
Portable output carries source origin and Capability Report data and states
that it has no sync or overwrite relationship with the source project.

The Revised Copy flow is file-based three-way review, not real-time
collaboration. `.ppte.patch` is a data-only stored ZIP whose operations carry
the Base revision precondition. Asset and embedded-font imports require
declared metadata, safe package paths, and verified bytes. Resource import
operations are transport operations outside the Stable Core operation matrix;
they are applied through the same Session Operation Engine and produce normal
inverse operations. A Base mismatch is reported and never auto-committed.

PDF and PNG are baseline exporters. Unsupported elements, missing sources,
font replacement, layout risk, and rasterized output remain visible through
Capability Reports and export issues. The baseline never silently drops a
page or unsupported element.

## 2026-09-03 — GA-A Compatibility Profile and migration boundary

GA-A publishes only the frozen `ppte-2.0-ga-a.1` combination. The reference
runtime treats a matching combination as native, older declared combinations
as forward-migration candidates, higher incompatible major versions as
read-only, and missing/inconsistent declarations as rejection. No profile is
implicitly treated as equivalent to another profile.

The migration API accepts JSON-compatible semantic snapshots and produces a
new `PpteDocument` plus a deterministic report. It never executes source
payloads and never overwrites the source. Source identity is retained as a
digest and identifiers in the report. Nested Groups are flattened by
materializing child Frames and creating a `LogicalGroup`; Run-level font
differences are retained in a non-required migration Extension when splitting
would be unsafe; unavailable Style Presets become typed element overrides or
an explicit target fallback. Ambiguous semantic keys are left unset and
reported. Unsupported markup and runtime-specific inputs remain outside the
data-only migration boundary.

## 2026-09-03 — explicit GA-A error semantics

The frozen error code and recovery fields remain available on
`ValidationIssue`; GA-A adds impact, content safety, save safety,
recoverability, and retryability with a public error catalog. Existing callers
may still consume the original code/message/severity fields. New boundary
diagnostics are enriched at return boundaries, while thrown persistence
errors retain their stable code prefixes for compatibility with hosts that
parse them.

## 2026-09-03 — release fault matrix

Faults are named at persistence and transport boundaries so tests do not
depend on temporary filenames or implementation-local timing. The GA-A matrix
covers partial/corrupt Journal tails, base and CAS mismatches, all Checkpoint
replacement stages, archive path/size rejection, Patch replay/conflict, and
Portable network/payload rejection. A fault before replacement preserves the
prior checkpoint; a post-replacement fault is reported while the newly
completed checkpoint remains reopenable. The matrix has an independent
expected-point list so a missing case cannot make its own completeness check
pass.

## 2026-09-03 — real capacity and performance gate

The CI benchmark uses an actual deterministic 30-slide, 900-element,
120-group, 50 MiB-asset, 20-font corpus. It measures P95 rather than an
average and fails with the observed metric and budget when a limit is missed.
The corpus is intentionally shared by open, render, edit, Journal, recovery,
Checkpoint, and Portable measurements; no fake timing or reduced fixture is
used to satisfy the gate. Binary persistence work may use platform hashing
and a lookup-table CRC implementation, but canonical JSON/revision semantics
remain unchanged.

## 2026-09-03 — R1 Agent selection, regeneration, and safety boundary

`regenerate_selection` is conservatively defined as replacement of the
selected semantic objects only. It preserves each target's current Frame and
reading-order position and emits no broad `slide.setReadingOrder`; the
separate `redesign_others` tool means “protect this selection while redesigning
the rest of the slide.” Full regeneration keeps explicit protected anchors and
reapplies local policy, overrides, geometry policy, animation, and
Fact/Source references to the new instance.

Agent-provided Slide IR is validated at the tool boundary and is authoritative
when present; reverse-inference from the current Document is only the fallback
for ordinary regeneration/reflow. Hybrid declarative Recipes accept the
common GA-B/GA-C mixed narrative, metric, chart, and visual block set. A
selection target without a resolvable IR block is rejected instead of silently
deleting or broadening the target.

Core Session Fact synchronization requires an explicit prior display value and
exactly one safe text match; missing or ambiguous matches return a conflict and
leave the snapshot unchanged. Fit resolves a measured font-size boundary and
committed preview warnings are returned to the caller. The only lock-policy
exception is an internal, synchronous flag around the inverse generated by
`Session.undo`; caller-supplied system transactions cannot request that bypass.

## 2026-09-03 — R2 Host, renderer, and animation boundary

R2's Product Host is a small Vite + React application under `apps/host`, with
`@ppte/editor-react` remaining a semantic-operation adapter rather than a
second document model. New/Open/Save, text IME editing, image import and drag,
multi-selection, notes, thumbnails, and presentation controls all derive from
and commit against `document.json`; the DOM is never persisted as content.
The build is self-contained so the generated `dist/index.html` is usable from
`file://` as well as a local HTTP server. File System Access is used only when
the browser grants it; automated or unsupported environments use a `.ppte`
download, which is the conservative save path.

Slide-space values are serialized as valid CSS pixel lengths (`1du = 1px` in
the reference surface), with absolute positioning for every rendered element;
the renderer does not emit `du` declarations. CJK font family names pass
through the renderer sanitizer. Chromium computed-style and screenshot
metadata are checked by the renderer golden test.

`slide.duplicate` is the sole canonical page-copy path: element, paragraph,
run, group, reading-order, protected-anchor, and applicable lineage references
are rekeyed while semantic keys and document-level Fact/Source identities are
preserved. Presenter, Portable, and Host use the same declared appear-step
state machine. Design Compiler quality checks use the shared deterministic
font-metrics layout measurement after draft materialization; a Recipe's
`max-overflow` rule produces a blocking `QUALITY_OVERFLOW` issue when exceeded.

## 2026-09-03 — R3 Portable editable boundary and profile accounting

Quick Fix and Light Edit `.ppte.html` files now carry a self-contained browser
editing boundary: selection, contenteditable text editing, semantic
`text.replaceContent`/image/crop/chart/geometry Operations, composition-safe
commit boundaries, undo/redo, local file input, and project/HTML download
saves. The embedded semantic payload remains authoritative; the rendered DOM
is only a derived editing surface. A file input import verifies the selected
bytes before committing one atomic `asset.upsert` + `image.replaceAsset`
transaction, and failed commits restore both the semantic snapshot and the
resource payload.

Checkpoint and Portable saves use the same document capability inference:
Chart/animation/transition content requires GA-B, while Poster, Widget, Area,
and Donut content requires GA-C. An omitted profile therefore resolves to the
lowest compatible profile; an explicitly lower profile is rejected. Browser
project checkpoints retain the same standard recent-history descriptor as the
Node file-format checkpoint path.

Slide-space `du` values are converted only by the renderer's CSS length
serializer. Portable uses one fixed-size inner canvas and one equal-ratio
viewport transform; no whole-HTML unit replacement is permitted. The bundle
budget measures only the gzip runtime (`Viewer 1.2 MB`, `Quick Fix 2 MB`,
`Light Edit 3 MB`); Asset/Font resources are reported separately and embedded
once. Light Edit exposes the complete Quick Fix editing subset plus crop,
Chart Data, and simple geometry operations.

This supersedes the earlier GA-A-default wording for omitted saves: text-only
documents still infer GA-A, while persisted Chart/animation/transition and
GA-C-only capabilities select their minimum profile automatically.

## 2026-09-03 — R4 honest export boundary

PDF and PNG export now capture the same derived Reference HTML surface in a
short-lived, fixed Chromium worker. The worker fixes locale, device scale,
color profile, font synthesis, and print/screenshot settings. Host-supplied
asset bytes are verified against the semantic Asset hash before they become
data URLs; embedded FontAsset bytes are likewise hash-checked and exposed as
deterministic `@font-face` resources. Chromium therefore owns CJK/emoji
shaping, image decoding, opacity, rotation, and PDF font subsetting. Missing
or rejected resources use a neutral fallback and remain visible as
`missing-source`/font warnings; they are never reported as clean native
content. Tiny thumbnail output may retain one derived source-colour ink pixel
per text frame when sub-pixel anti-aliasing would erase the glyph entirely;
this is still degraded raster output and does not alter `document.json`.

Image PPTX uses the same Reference Renderer and places the finished PNG inside
the package, so recipient Office hosts cannot reflow live text. Semantic PPTX
keeps text editable and maps slide background, transforms, opacity, paragraph
spacing/alignment/list data, and RichText runs. It maps common shape paints and
strokes and carries real verified image bytes. Semantic PPTX does not embed a
font package; requested typeface attributes and any missing embedded payload
are reported per affected text element as `font-replacement` risk. Charts and
unsupported widgets remain explicit static/fallback boundaries. The package's
capability report is finalized after resource preparation and is the same
report returned by the export API.

The black-box PDF text helper has one infrastructure-only fallback for hosts
without Poppler's `pdftotext`: PyMuPDF reads the generated PDF text map while
the gate's Unicode assertions remain unchanged.

## 2026-09-03 — R5 recovery, history, and compatibility closure

`document.json` remains the only persisted content source. Checkpoint and
Journal restore state is Host transport only: recent forward Transactions carry
their generated inverse plus before/after revisions in `history/recent.jsonl`
and Journal records, while the in-process restore context is non-enumerable and
never contributes to the canonical document revision. Session restore validates
both the inverse chain and the forward reproduction chain before exposing Undo;
the default bounded surface is the existing 200-entry history policy. Missing
or invalid inverse metadata fails closed rather than claiming Undo coverage.

`PpteFileService.open()` and the explicit
`openCheckpointWithRecovery()`/`recoverCheckpoint()` Host entry points discover
adjacent `*.journal` candidates, then match `documentId` and
`baseCheckpointRevision` before replay. Replay is performed into an isolated,
validated draft. The Host exposes `prompt` (draft available), `recover`,
`discard`, and `save-as`; a Journal is removed only after an explicit discard or
after the recovered snapshot has been checkpointed successfully. A normal
recovery open therefore remains recoverable until the caller completes its
Session checkpoint.

Journal replay accepts a verified hash-based CAS/blob resolver and carries the
checkpoint compatibility profile through every operation and validation step.
This is what permits checkpoint-after image imports and GA-C Widget operations
to recover under their original runtime contract. When a standalone semantic
replay has no resolver, an `asset.upsert` record may still reconstruct the
declared document metadata; a subsequent checkpoint continues to require the
verified bytes, so this fallback is not treated as payload availability.

No new content source, Slidev path, arbitrary HTML source, CRDT, nested Group,
or Run-level font styling is introduced by R5.

## 2026-09-03 — R6 revised-copy review and Patch closure

Review comparison now emits units for every persisted document, slide, element,
Fact/Source, and resource domain that it can identify. A changed field with no
typed Operation is represented as `REVIEW_CAPABILITY_GAP`; it is never silently
treated as unchanged and cannot be accepted into a Transaction. Existing typed
Operations are used for notes, transition, ordering, animation, appearance,
text paragraph/box style, and other supported fields. Delete-versus-any-modify
is always a conflict unit, including when only one surviving copy changed.

Patch application remains base-guarded. A stale target can enter semantic
Compare only when the caller supplies the matching common Base snapshot; no
automatic merge is inferred. A generated Patch carries a proof over its
guarded operations and declared revisions, and both the direct Patch API and
Session Patch entry points verify the resulting `headRevision`.

Patch compatibility is inferred from the revised document content. An explicit
profile that disagrees with that inference is rejected, and apply/preview paths
use the manifest profile for runtime and final compatibility checks. Patch JSON
validation is structural and field-typed: arbitrary data strings, object keys,
RichText text, and controlled Widget `props.code` are data, not executable
source. Override Debt uses the complete supported style-field set for the
element type as its denominator, even when the current preset omits a field.

No new content source, Slidev path, arbitrary HTML source, CRDT, nested Group,
or Run-level font styling is introduced by R6.

## 2026-09-04 — 0.6.0 completion boundaries (pipeline v3)

CEO approved closing the entire 0.5.0 "still not implemented" list. Bounded
interpretations adopted: Video = local metadata + poster fallback only (network
and executable sources rejected at widget registration). PPTX native charts =
Bar/Line/Pie only; Area/Donut stay static with honest capability reporting.
Group Rotate = member transform materialization, never a group coordinate
system (ADR-006 intact). Legacy import = text reduction to semantic elements;
markup is never a runtime content source (ADR-001 intact). Full Portable
reuses the Session Operation Engine (no second mutation path). CRDT /
multi-user / nested Groups / Run-level fonts remain ADR-frozen and were NOT
implemented.
