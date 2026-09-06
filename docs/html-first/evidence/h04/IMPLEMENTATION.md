# H04 implementation and verification

Authority: README.md, PLAN.md, TASKS.json and REVIEW_DISPOSITION.md read directly from `bbcd46bde2c608b5a56e617f316c5dcb5534857e`. No replacement plan or retired-format implementation.

## Behavior

- `html-player` owns presentation index, reveal count, fullscreen, black screen and private presenter window. Read/edit use the original live document; presentation adds only a transient stylesheet. Exit restores prior read/edit mode, editor selection and current slide. Remount attaches listeners to the new document.
- The existing reading launcher (bottom-right hover or keyboard focus, 编辑 / 保存) reveals Edit, Present and More → Export PDF without requiring file authorization. Keeping the initial read surface free of chrome preserves the existing H01 exact-pixel assertion. Presentation hides every editor/launcher element and selection outline. Controls start hidden; pointer motion or Tab reveals them for 1.8 seconds. `←/→`, PageUp/PageDown and Space navigate; `B`/`.` toggles black; Esc exits; `P` opens the speaker window. Black is a viewport overlay above all controls; click or forward navigation restores it. Fullscreen rejection, absence or synchronous failure leaves windowed presentation usable.
- Native video/audio clicks do not navigate. Leaving a slide, blackening or exiting pauses media. `[data-ppte-step]` reveals in DOM order; previous reverses reveals before returning a page. `data-ppte-transition="fade"` or `"slide"` animates CSS properties for 180ms and honors reduced-motion preference.
- The speaker window displays notes, elapsed seconds and a scaled next-slide preview with navigation. Preview content is cleaned and sandboxed without scripts or save credentials. Popup rejection gives a control-bar explanation; closing the window does not stop the audience.
- `html-print` is built only on explicit Export PDF or browser beforeprint. It clones the current DOM into transient, CSS-isolated pages, retaining native text/SVG, revealing all steps, replacing videos with posters and suppressing notes/UI. Browser page size follows the first slide; other sizes fit proportionally. Print completion/cancellation removes the clone and restores the prior mode. There is no screenshot-to-PDF path or default PDF creation.
- Browser printing needs no added package. Automated validation uses the repository's optional development Chrome/Playwright installation; it is not imported by the generated HTML or CLI. No new automatic export CLI/dependency installation is imposed on generation.
- Chromium can add empty style attributes when toggling contentEditable. Safe serialization now removes these semantically empty attributes; the strict pre/post content equality test remains intact.

## Acceptance evidence

All five new tests execute through `node --test dist/tests/html-player.test.js`. Existing H03 assertions and H01 pixel/content assertions are unchanged. The H01 closed import allowlist is extended only for the two explicitly authorized H04 packages; additional assertions require both modules and reject retired modules/browser tool dependencies in both graphs. No unexpected-import check is removed.

1. **Clean audience:** test `H04 acceptance 1/2` checks hidden editor/workspace/other slides, no selection outline, initial and idle-hidden controls, and every screenshot pixel for true black. Audience screenshot is taken after the page transition finishes.
2. **Recovery paths:** tests `H04 acceptance 1/2`, `H04 acceptance 2`, and `H04 actual fullscreen exit...` exercise rejected fullscreen (injected), actual Chrome fullscreen/exit, actual video playback → pause, media click, black restore, Esc mode/selection restoration, blocked popup (injected), a real popup with visible next-slide content, shared navigation, popup close, Grid layout and document remount.
3. **PDF:** test `H04 acceptance 3` writes an actual Chrome PDF and independently parses it using macOS PDFKit. It asserts exactly two 720 × approximately 405 pt pages, every expected title/reveal as selectable text, no editor/notes text, native poster replacement, and unchanged source content. `slides.pdf` and `pdf.json` are retained. This is a representative layout check, not a promise that arbitrary overflowing author CSS can never clip.
4. **On demand / allowed formats:** test `H04 acceptance 4` checks generation and reading create only HTML, no print clone exists until requested, the menu invokes print exactly once, cancellation cleans up, and the new player/print/CLI source paths contain no retired-format imports. The original HTML pipeline tests additionally cover the generation graph. Whole legacy repository/distribution removal belongs to H05 and is not declared completed by this test.

## Limits and review disposition

H04 remains **partial** until actual Safari presentation/printing is verified. Safari WebDriver on this host reports that Allow remote automation is disabled; Chrome headless tests are not Safari or human evidence. Native OS print-dialog selection/save interaction is not automated; PDF content is verified through Chrome's real print engine. No cross-platform font equivalence or arbitrary CSS overflow guarantee is claimed. PDFKit in this test is macOS-only development verification, not a product dependency. External hyperlinks remain subject to H01's existing content security contract.

R01: new Chrome audience/black/fullscreen/speaker behavior verified; Safari verification pending. R02: existing H03 tests retained; speaker controls share neutral typography, focus and button styling. R03/R04: no new human aesthetic or controlled model/performance claim; H00/H06 remain open. R05: real Chrome PDF/HTML evidence added; Safari pending; Office remains retired scope, with full distribution cleanup in H05. R06: no new installer/recovery claim; H02/H05 retain their recorded limits. No legacy runtime defects were repaired or waived as proof of new behavior.

The two pre-existing pipeline input/output files are preserved and locally excluded, following the repository's existing `.git/info/exclude` convention. No push or branch switch.

## Final gate

Implementation commits: `c9e35fdd7ddb1cdafb4418e6c9ea257374cc183b` and `7c1a6c46676566e346edc2af24974752d4288897`, both GPG signed with sign-off. `pnpm typecheck`, `pnpm build`, and `pnpm test` passed. Full suite: **439 passed, 0 failed, 0 skipped** (434 → 439; +5 / −0), 283,214 ms. Focused H01/H03/H04: **22 passed**. Logs and machine-readable results are in `verification/`. Two development full runs were superseded by changes and are not claimed as passed.

Runtime is 287,678 raw bytes / 83,659 gzip bytes; the playable sample is 290,961 raw bytes. `example.html` is the single-file experience. `audience.png`, `black.png`, `presenter.png`, `slides.pdf` and `pdf.json` are internal acceptance evidence, not automatic user deliverables.

New source files: `packages/html-player/package.json`, `packages/html-player/src/index.ts`, `packages/html-print/package.json`, `packages/html-print/src/index.ts`, `tests/html-player.test.ts`. Integration updates: editor workspace, safe content cleanup, the explicit HTML dependency test allowlist and workspace lockfile. No release/blackbox script changed.
