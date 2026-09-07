# UI03 — Page navigation and native layout composition

UI03 implements the four acceptance items in the production editor. HTML/CSS remains the content source; the design prototype is not imported. UI04/UI07 keep responsibility for serialization, original-file authority, autosave and portable history.

- The page rail is a flex column with an independently scrolling list and a non-overlapping Add Page footer above the workspace bottom controls. Rebuilding thumbnails retains list scroll position; typing still uses incremental thumbnail refresh.
- New pages clone declared page attributes/classes/inline CSS and the explicit content-container chain (or first native Flex/Grid container). They get fresh slide/container/text identities and blank content. Computed viewport width/height/background are no longer written as inline styles, preserving media queries, container queries, percentage widths, aspect ratios and declared fixed canvases. Source author IDs are not duplicated. ID-specific styling and arbitrary complex author templates are not represented as a new master-page system.
- Images stay in the author content/insertion container. After native layout, insertion reserves margin below overlapping headings; it does not change author heading/container styles or absolutize the page. A still-overlapping or zero-size result is removed and reports an actionable placement error without adding history. Existing order/alignment/margin, resize and non-destructive crop controls remain available. This is a bounded placement strategy, not automatic reflow of every possible author mask/stacking context.
- Each page exposes labeled Up/Down buttons, Alt+Up/Down on its thumbnail, and native thumbnail drag sorting. All use one Commands relocation transaction, moving the original DOM node without cloning its media or identities. Undo/redo checks parent/anchor/protection conflicts. Selection follows page identity after moves and undo; keyboard focus returns to the moved thumbnail. Boundary moves are disabled. Cross-parent page moves reject rather than changing author wrapper semantics.

## Acceptance and actual tests

All tests run in the repository framework (`node --test dist/tests/*.test.js`) against freshly bundled product HTML in installed Chrome headless, offline at file://. No force clicks, HTTP server or browser-cache version substitution.

| Acceptance | Tests / evidence |
| --- | --- |
| 添加页无控制条遮挡 | acceptance 1: 12-page rail at 1440/1024 widths, bounding boxes and elementFromPoint hit, list scrolling leaves footer stationary, normal mouse Add, insertion after current page, undo/redo; rail.png |
| 响应式新页保真 | acceptance 2: fresh unique identities/container structure, no inline pixel width/height, navigate and compare visible original/new page at 1440/820/1024 in read/edit modes, fixed 960×540 and Grid, actual download and fresh-process 700px offline reopen; responsive.png, sample.ppte.html |
| 图片不被标题挡住且可调整 | acceptance 3: title outside a z-index:0 content ancestor, no heading overlap, real center hit and normal reselect, UI order/width/crop/undo, original title CSS preserved and serialized edits; image.png |
| 页面排序具备键盘等效 | acceptance 4: Enter on Down, Alt+Up, moved-thumbnail focus, boundary disabled buttons, actual dragTo, identical IDs/order after undo/redo, protected page rejection leaves DOM/history unchanged; sorting.png |
| Prior N01–N03 composition regression | additional test re-enhances the exact 09-07 audit source (12-page Cherry Studio manuscript), adds a blank page preserving its absolute Flex .page container, inserts/selects/reorders an image through UI, confirms real hit and downloads; audit.png, audit-sample.ppte.html |

The images used as insertion fixtures are deterministic screenshot crops, not user-supplied photo batches or semantic image-selection evidence. The audit manuscript is an existing authored regression fixture, not a new research/fact-verification deliverable.

## Verification boundaries

`verification/result.json` records implementation commit, commands, exit status, timestamp/platform, artifact hashes and four-layer status. Screenshots/JSON captures supplement the TAP assertions; a capture is not a standalone pass verdict.

First-run test failures are retained in `verification/first-test-failure.log`: the rail's second iteration began on a different current page; reading-mode comparisons incorrectly compared a hidden page against the visible page; an empty style attribute was compared with absence instead of its CSS declarations. Tests now explicitly navigate to the intended page, compare each page while visible and compare cssText. No existing test assertion or performance threshold was weakened.

Safari, native original-file authorization, system IME, screen reader, physical touch and owner/target-user reviews remain pending, with null measurements and reasons. N01–N03 have new bounded code/Chrome automation evidence, not blanket human/browser closure. N04 PDF, S04 performance/telemetry/real-device and S06/UI07 current-media lifecycle gaps remain unchanged; S06–S08 stay partial. UI05 and UI06 are not completed by this round.

The included single-file samples are actual product downloads, not the final CLOSING delivery. `sample.ppte.html` was opened offline in a fresh Chrome process by acceptance 2. No push is performed. The pre-existing pipeline brief is retained in place and locally excluded to leave a clean tracked worktree.

The initial full suite passed 96/97. Its S04 thumbnail test selected every page-rail button, so the new Up/Down button was mistaken for the second thumbnail. Only that locator now selects `button[aria-current]`; all seven revision/local-refresh/tool/index assertions are unchanged. The failing log is retained in `verification/initial-full-test.log`.
