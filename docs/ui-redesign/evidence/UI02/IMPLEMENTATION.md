# UI02 — Unified insertion and object properties

The production editor now has one Insert menu for text, rectangle/ellipse/line, local images and tables. It edits native author HTML through the existing Commands and save/version controller. The design prototype and its coordinate model are not runtime dependencies.

- `insert-menu.ts`: inline SVG + text, two levels with Back, Escape, outside click, arrow/Home/End navigation, trigger focus restoration, a 5 × 6 table picker with hover/focus dimensions and bounded numeric sizes (50 rows/columns, 1000 cells). T is restricted to editing outside text/input controls. Menu DOM/styles are transient and outside the author iframe.
- `commands.ts`: bounded insert, duplicate and delete transactions; fresh object/cell identities; source image decoding and the existing media pipeline; insertion follows the current object's parent or an author content/Grid/Flex/semantic container. New objects participate in native flow, retain proportional image display, and receive their own stacking level above positioned content. Author container CSS and existing objects are not absolutized or restyled. Unsupported merged-table structure operations reject atomically instead of targeting the wrong cells.
- `workspace.ts`: contextual text/font/size/bold/color/alignment, shape fill/border/radius (no line fill), non-destructive image crop/focus/reset/replace, selected-cell text/fill/border and current-row/column operations. Common styles report mixed values. Geometry is collapsible; native flow exposes container alignment/spacing/order instead of fake X/Y. Absolute objects expose an explicit selection/page/parent alignment reference. Properties live in the right rail; the redundant always-visible image picker is removed.
- Locked siblings do not block unrelated insertion. Locked ancestors and conflicting/overlapping transactions reject; duplicate/delete/resize and multi-style changes use existing undo/redo. Table structure changes preserve cell selection by identity, not stale DOM references. Property-button focus is recovered after rerender. Save state, default autosave, portable checkpoints and file authority remain the UI04/UI07 implementation, with no new serialization path.

## Acceptance mapping

`tests/ui02-objects.test.ts` runs with node --test on dist and drives installed Chrome headless over file://, offline, without force clicks.

| Acceptance | Test and evidence |
| --- | --- |
| Four object types insert and adjust | acceptance 1: text styling, all three shapes, resize/undo, local image chooser event/crop, selected-row/column table operations, actual download and a fresh browser process reopening all four types; objects.png and sample.ppte.html |
| Preserve author layout | acceptance 2: Flex/current insertion point, Grid/order/container alignment, native flow/margins, mixed values and atomic multi-edit undo, absolute page alignment/undo, exact author style preservation; flow.png |
| Protection and history | acceptance 3: locked sibling preserved during insertion, insert/duplicate/delete undo/redo, unlock/undo, bad image UI recovery, invalid table size/overlapping selection/locked ancestor rejected with unchanged DOM/history |
| Icons/controls/focus | acceptance 4: four named local SVG items, author button CSS isolation, keyboard submenu/Escape/trigger focus, table focus dimensions and vertical navigation/numeric sizes, outside close, visible focus, T input/mode guards; menu-focus.png |

Existing media acceptance keeps all its assertions. Its old property-rail file input interaction now uses Insert → Image → Playwright's real filechooser event with setFiles. This is browser automation of a local chooser, not evidence of native original-file write authorization. Existing image ID prefix is preserved. No test was removed or threshold reduced.

Early runs exposed a stale table-cell reference after structure changes, an image identity-prefix regression, range-aware font toggle state, and an exact accessible-label issue on the alignment selector. These were fixed. The new bold assertion checks every rendered text run, preserving the existing full-selection span contract rather than requiring styles only on the wrapper. The layout test clicks the visible left-hand author text (8,8 within the paragraph): the author's absolute heading covers the block's center. This uses normal browser hit testing, not force; the author CSS is retained and asserted unchanged. A serialization assertion specifically checks exported menu DOM, allowing the embedded runtime implementation string to remain in the single HTML.

## Evidence boundaries

Final commands, exact implementation commit, timestamps/platform, log hashes and acceptance results are in verification/result.json. Browser captures alone are not pass assertions; the TAP log is the automated verdict. The sample is the exact product download from acceptance 1, a synthetic UI02 fixture, not the final UI06 design/content delivery.

Safari, native original-file permission dialogs, OS IME, screen reader, physical touch and owner/target-user visual review remain pending with null measurements and reasons. Existing N01–N04, S04 performance/real-device, S06 current-media decoding/lifecycle, S07 and S08 gaps are not closed by this task. Arbitrary author masks and nested stacking contexts still need UI03/N03 real-material coverage; flow layout is preserved rather than flattened to remove such author constraints.
