# Implementation decisions

This file records conservative choices made while implementing the frozen
Week 1–2 slice and Stable Core milestone.

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
