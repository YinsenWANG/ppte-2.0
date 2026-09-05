# Product completion audit remediation — 0.8.0

Baseline: `7fcf43a` on `fix/product-completion`, reviewed against the original v2.3 plan and the user's npm + native Skill integration decision. This document records implemented work and observed acceptance; it does not turn untested integrations into a blanket “100% complete” claim.

## Implemented audit fixes

| Audit finding | Delivered behavior | Evidence |
|---|---|---|
| Browser edits lost on refresh | IndexedDB base/resources plus synchronous checksummed localStorage journal before Core commit; refresh restores history and redo; damaged data remains read-only | `tests/host-completion.test.ts` exercises edit/reload/undo/reload/redo, stale tabs and corrupted journal |
| Save/open race | Recovery checkpoint and resource writes are serialized; immediate reopen waits for checkpoint completion | §41-B real IME → download → immediate reopen → undo |
| Rich text marks lost | Unicode-aware text edits preserve unaffected paragraphs, runs, marks and list metadata in Host and Portable | Pure text identity/marks test and browser save/reopen assertions |
| Groups edited only first member | First selection targets the whole group; Alt/double-click targets a member; move/resize emits group Operations | Browser inspector group geometry + existing group inverse black-box checks |
| Missing editing affordances | Page delete/order, align/distribute, presets/reset, mark/paragraph controls, image replacement, explicit fit/clip, Escape cancel | Host controls use Core transactions; geometry/text regression |
| Missing Review surface | Two-/three-way field comparison, explicit local/revised decisions, conflicts, preview/accept/cancel, patch upload/export with resources | Actual conflicting title/body revisions accepted selectively, then undone |
| Missing design entry points | Content-preserving layout and protected-element regeneration preview; accepting uses the same Core revision | Existing compiler scope/anchor tests plus Host preview path |
| Missing Recipe Studio | Drag/numeric zones, full declarative spec edit, immutable local versions/rollback/import/export, boundary corpus, rendered draft previews, diagnostics and downloadable snapshots; baseline hash comparison; local confirmed-use counts | Browser drag/save/reload and 17-case corpus test; no executable recipe imports |
| Browser default paragraph spacing | Renderer explicitly uses zero default paragraph margins while preserving authored before/after spacing; default title fits its semantic frame | Actual browser glyph bounds plus unchanged PNG pixel gates |
| Fonts absent from Host | Embedded FontFaces mounted before load; actual browser glyph bounds measured after fonts settle, explicit fit action | Rendering inspection; deterministic non-browser metrics retained as a separate diagnostic |
| Unicode PDF gate red | Content-stream-order extraction with `pdftotext -raw` avoids geometrical interleaving of rotated lines; exact CJK/emoji content assertion retained | Full `export:1` gate green; independent PNG visual gates unchanged |
| Native review tools missing | CLI `validate`, `diff`, `patch-create`, `patch-preview`; receipts bind patch bytes; CAS persists old/new resource versions for recovery and undo | Native resource replacement patch → commit → fresh-process undo/redo |
| Unknown schema handling | Unsupported versions offer original-data read-only inspection and original-file download; active project is unchanged | Future-version browser regression |
| Only canned Agent authoring evidence | This Codex session read project material, authored a new ten-slide, multiple-layout IR and exercised installed CLI compile/validate/inspect/deliver/skill-install/host | `examples/acceptance/project-brief.md`, `project-design.json`, `native-run.json` |

## Acceptance recorded locally

- Full tests: 100 passed, 0 failed. Includes browser-driven and cross-process regression.
- Full black-box suite: 69 green, 0 red; original §41 A–J groups included. The fixed-file §41-A is supplemented by the separate current-host authoring run, not relabeled as a model call.
- Root and workspace type checks, 15 schema/example validations and source guards passed.
- Original GA-A capacity/performance budgets passed using the standard Node runtime: 30 slides, 900 elements, 120 groups, 50 MiB assets, 20 fonts.
- `ppte-cli@0.8.0` tarball installed into an isolated prefix with `--omit=optional`; native compile/validate/inspect/HTML delivery/Skill installation/Host generation passed without starting MCP.
- New ten-slide project compiled and delivered successfully; representative PNG reviewed visually. Rendering exports preserve their explicit rasterization/degradation reports.

See `product-acceptance-2026-09-05.json` for compact machine-readable evidence. Remote CI is an additional platform check, linked from the pull request; local results are not substituted for its status.

## Integration and format boundaries

The supported primary path is npm CLI + native Skill, not a model service or MCP daemon. The optional stdio adapter remains tested independently. Browser storage belongs to one editor URL/profile; clearing it removes recovery data. Save a portable/project copy for durable transfer. Keep the CLI `.cas` and `.journal` siblings while a project has active recovery/history resource dependencies.

The compiler's font metrics are deterministic reference metrics. The Host now offers actual-browser checks, but this is not a claim that every operating system/font renders identically. PNG and image PPTX are raster outputs; semantic PPTX supports the documented subset and reports degradation. Office/Keynote application-specific visual certification was not performed in this environment.

Recipe corpus failures stay visible. A sample without an image does not certify image-ratio handling; draft hashes are deterministic layout regression snapshots, not a claim of cross-platform pixel identity. Local acceptance counts are only this browser's confirmed applications.

The current Codex integration was exercised. Claude Code and Cherry Studio were not claimed as live-tested clients. The npm tarball is an installable release candidate, not a public npm registry publication. No external account, public package identity or release credentials were invented. Unsupported future versions are inspected read-only; no speculative downgrade or destructive migration is offered.
