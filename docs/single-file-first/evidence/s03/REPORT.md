# S03 implementation and acceptance evidence

Status: **partial**. Code and Chrome headless automation are implemented/verified within the fixture scope below. Safari, real native file authorization, native Chinese IME, and human design approval remain pending. This report does not close S01/S02, F01, or historical R01/R02/R05/R06 acceptance gaps.

Primary acceptance entry: [验收入口.ppte.html](验收入口.ppte.html). Open the file directly; it embeds the editor/player and requires no HTTP server. It is the actual downloaded and reopened six-page product from the test, not a prototype. PDF is an explicit test export, not an additional default deliverable.

## Implementation

- `commands.ts`: local slide insertion/history retains the live parent and unrelated protected descendants. Each new slide receives one stable UUID identity shared by its slide/object attributes. History validates the inserted node and parent instead of replacing the parent subtree. Ancestor locks still reject insertion. Blank slides preserve author class/inline design and measured dimensions, computed background, font/color and container context.
- `workspace.ts`: accurate background/complex/transparent states; current page follows selection and insertion; scoped iframe scrolling; collapsible sidebars, zoom/reset, nearby formatting, pointer/keyboard size handle and cell-first text selection. Property-input focus and synthetic composition are protected from panel replacement.
- `html-player`: active-page CSS targets the unique object ID, avoiding the old empty/duplicate slide-value overlap.

## Criterion evidence and four-way status

| Acceptance | Code | Automation | Real browser | Human confirmation |
| --- | --- | --- | --- | --- |
| Two additions show only current page before/after save and reopen | Implemented | First S03 test: unique/nonempty identities; exactly one visible page on each start; undo/redo; actual download/reopen; all six pages start while zoomed | Chrome 152 headless file URL passed for download; native authorized original-file journey pending | Pending |
| Locked title allows unrelated insertion and unchanged protection through history | Implemented | First S03 test checks same live title node and identical outerHTML after two insertions, two undos and two redos; existing protection tests retained | Chrome headless passed | Pending |
| Class/Grid/Flex/container-unit dimensions, editing and PDF | Implemented for tested native contexts | First S03 test checks 960×540, Grid/Flex, 44 px cqw text; edits new Flex title; emits PDF and independently parses six 720×405 pt pages with PDFKit | Chrome headless PDF passed; native print dialog/Safari pending | Pending |
| Real solid/gradient/transparent background, no change from viewing | Implemented | First S03 test checks colors and states, content equality, undo, and reopened fields | Chrome headless passed | Pending |
| Mouse/keyboard cell text selection/format | Implemented | Second S03 test uses actual Playwright mouse click and arrow/Shift-arrow keys, then toolbar bold; checks exact selected text span | Installed Chrome headless, real input dispatch; no editor selection API used to select the initial cell | Pending |
| Zoom/collapse/refresh preserve focus/range/IME | Implemented within tested paths | Second S03 test holds same focused input node and input range through clicks; content range retained; synthetic composition records zero interim and one final history item; existing viewport tests unchanged | Chrome headless focus/range passed; actual OS IME not exercised | Native Chinese IME and human confirmation pending |

Required evidence:

- **F02-F05-regressions**: `regressions.json`, first test in `tests/single-file-editing.test.ts`, `slides.pdf`, `verification/test.log`. F02/F03/F04/F05 map respectively to the first four rows above.
- **prototype-implementation-map**: [prototype-implementation-map.md](prototype-implementation-map.md), including explicit fidelity limitations.
- **contextual-ui-screenshots**: `cell-context.png`, `shape-handles.png`, `background-transparent.png`, `contextual.json`. These are actual product Chrome screenshots. Agent inspection is not human signoff.

## Verification and test changes

`pnpm typecheck && pnpm build && pnpm test` final logs are in `verification/`. Two tests added in one new test file; no existing tests or assertions deleted, weakened, or modified. Existing html-editor/html-player tests remain part of the full suite.

Initial failures are retained in `verification/first-existing-tests.log`, `first-new-tests.log`, and `third-tests.log`. The existing table heading assertion exposed the need to retain table context while enabling cell formatting. The new range test initially used Home/End, which did not establish the intended range on this host; it now uses real arrow/Shift-arrow movement and retains the exact span assertion. PDF evidence originally inspected after `page.pdf()` had fired `afterprint` and removed the print host; measurement now precedes that cleanup, and independent PDFKit parsing verifies the emitted PDF. None of those failures is rewritten into a historical pass.

## Remaining gaps and boundaries

- Current full-suite Safari probe returned `session not created`: Safari Settings must enable Allow remote automation. See `safari.json`. This is blocked evidence, not a Safari pass even though the evidence-collection test itself passes.
- No real native picker/authorization/revocation was operated for this S03 journey. Actual download/reopen is verified; it is never labeled original-file saved. Existing S02 contract tests do not replace native authorization proof.
- Composition events are synthetic. OS Chinese IME, user design acceptance and target-user review remain pending. No lower-performance device, no-model-token claims, and no new blind review results are asserted.
- Tested blank-page context is class-based Grid/Flex/container units. Arbitrary complex CSS (including parent selectors, viewport-sensitive layout and unusual positioned/transformed slide roots) is not universally certified. Body-as-slide insertion is explicitly unsupported rather than creating an invalid nested body.
- Zoom changes only the iframe view; responsive author CSS can reflow with available iframe width. Continuous native document flow and one size handle are retained; final prototype fidelity remains a human acceptance item.
- History remains session-local as before. Reopening verifies persisted content/identity, not persistence of the undo stack. S04 full-thumbnail refresh and per-key persistence optimization are outside this change.
