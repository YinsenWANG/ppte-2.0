# Product completion repair — 2026-09-05

This branch includes the existing delivery-layer work from PR #1 and repairs
the product gaps found against v2.3. It is a release candidate, not a claim
that every future feature or every Agent host has received live acceptance.

## Repairs

| Audit finding | Implemented behavior | Evidence |
| --- | --- | --- |
| Host “generate ten pages” duplicated a template using an uploaded filename | Existing host Agent authors real Presentation IR; shared authoring compiler imports distinct content, Sources/Facts/resources, rejects malformed/overflowing designs before mutation | Quarterly source brief and ten-slide design fixture; CLI workflow test; §41-A checks actual values and different content |
| Host had its own operation/session implementation | React Host uses `PpteSession`; inspector exposes geometry, text/style, crop, chart cells, component props and flat-group operations; Agent edits are previewed before acceptance | Existing Host/IME/undo black-box journeys, shared Core tests |
| Portable HTML shipped a separate operation interpreter | Browser entry bundles the same Core, contract checks, renderer, history and file codec | Browser test rejects locked text/invalid crop, visibly redraws an edited chart, saves/reopens and undoes |
| Crop/chart buttons made predetermined changes | Real input dialogs accept crop bounds, every chart cell and rotation; changes rerender from the semantic Document | Browser interaction test |
| npm/Skill use required stdio MCP | Packaged CLI supports compile, inspect, schema, query/propose tools, preview/commit, persisted undo/redo, deliver, export, Host and native Skill installation | Install local `.tgz` with `--omit=optional`, invoke real `bin` symlink, compile/deliver and install Skill/Host |
| Short CLI processes lose session history or race | Checkpoints retain undo and redo; commit receipt binds revisions/transaction/scope; project writers hold exclusive locks; stale edits fail | Separate-process workflow, stale receipt, changed receipt, scope and lock tests |
| Compound authoring history failed reopening | Restore replays forward from the reconstructed before-snapshot; inverses preserve absent optional Source/Fact collections exactly | Compile → checkpoint → reopen → preview → commit → undo → redo test |
| Default new project could not deliver due to undeclared Inter font | Default uses an explicitly declared system sans-serif family; custom embedded fonts still require coverage/resources | New/compile and real packaged delivery |
| GA-A latency budgets failed | Clone once per transaction, reuse validated apply result inside commit, cache frozen snapshot, compare JSON fields directly rather than hashing every subtree; keep external canonical revisions | Original capacity and budget gate passes without relaxed limits or special V8 flags |
| Black-box job could be skipped while CI appeared successful | Independent required job, hard infrastructure preflight, explicit CJK font dependencies, retained JSON evidence; source guard fails if ripgrep is missing | Updated CI workflow; local complete black-box run |

## Local verification

- Node 24.19, pnpm 11.19; typecheck, recursive typecheck and schema/source guards.
- 97 tests passed, zero failures or skips.
- 69 independent black-box cases passed, zero red cases.
- GA-A original corpus: 30 slides, 900 elements, 120 groups, 50 MiB assets,
  20 fonts. Latest p95: human commit 81.5 ms / 100 ms, text 28.8 / 150,
  undo 37.9 / 100, redo 28.6 / 100, checkpoint 1001 / 3000.
  These are local measurements, not a guarantee for every machine.
- Actual packed CLI installed without optional dependencies; basic commands
  work without browser installation. Tarball was approximately 0.88 MB before
  the final documentation rebuild; package output reports exact size.
- Local browser was Chromium 149 because the standard Playwright CDN download
  was unavailable in this environment. CI installs its own matching browser
  and runs Node 22 independently. Local CJK verification used Noto Sans SC;
  CI installs Noto CJK. A rotated PDF baseline can be split by `pdftotext`, so
  that assertion normalizes layout whitespace while requiring the full
  Chinese strings and emoji in their authored order.

## Remaining release boundaries

1. Actual model-driven authoring in each target Agent client still needs a
   live integration run. The ten-page acceptance checks compilation of a
   source-backed design, not a claim that an unconfigured external model ran.
2. npm registry publication and a public package name are not established by
   a local tarball. Do not tell users to execute an unverified registry name.
3. CLI requires host shell execution. MCP-only hosts use the optional adapter.
   stdio MCP is normally a client-launched subprocess, not a separate network
   service; it retains tool discovery and session benefits.
4. System-font appearance depends on the receiving machine. Embed licensed
   fonts with glyph coverage when exact cross-machine typography is required.
5. Editable HTML is a local copy. Reconciliation uses existing review/patch
   tools; this change does not implement live cloud sync, CRDTs or multiplayer.
6. The browser editor still exists for human edits. Replacing MCP changes
   Agent integration, not the need for the editing UI or the shared Core.
