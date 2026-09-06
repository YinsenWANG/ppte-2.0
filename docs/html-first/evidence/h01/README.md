# H01 — HTML-native enhancement and single-file delivery

Authority: `bbcd46bde2c608b5a56e617f316c5dcb5534857e`, read directly: README.md, PLAN.md, TASKS.json and REVIEW_DISPOSITION.md. This implements H01; H00's missing controlled model/browser journeys stay partial. H02–H06 are not closed by these results.

## Use the implementation

```sh
pnpm build
node dist/apps/html-cli/index.js enhance tests/fixtures/html-first/layout.html --out /tmp/h01-delivery/作品.html
```

The output must be new. The command writes exactly one HTML, rejects existing files, and returns bounded JSON (at most 1 KB in the acceptance test). Source drafts/resources belong in a separate working directory. The file is independently readable, with no network or model credentials. Original-file save adapters and editing UI are subsequent stages, not implied by this viewing artifact. `example.html` is the retained actual enhancement of H00’s twelve-page Cherry draft, not a UI mockup or a new controlled model run.

## Acceptance evidence

All acceptance tests execute with `node --test dist/tests/html-document.test.js`; see `verification/h01.tap` and the full-suite `verification/test.log`.

| Acceptance | Real test and observation |
| --- | --- |
| Grid/Flex/SVG/typography, nested styles/resources remain faithful | Tests 1–2 load the original local HTML and enhanced iframe in Chromium at 960×640. Rectangles, display, font, grid tracks, gap, color and SVG fill are equal; PNG bytes are exactly equal. The font is the existing synthetic D03 metrics fixture (its block glyphs are intentional, not a font/aesthetic acceptance). Fixture includes native CSS nesting, stylesheet import with media condition, nested relative SVG URLs, a local font, gradients, native table, inline SVG and an inert nested template. Font load and imported border are explicitly asserted. `before.png`, `after.png`, `layout.json`. Deterministic generation, preserved author IDs, duplicate repair and template escaping are tested. Test 9 additionally checks SVG URI-fragment preservation across re-enhancement. |
| 100 save/reopen cycles; no accumulated content or editor state; no executed injection | Test 3 edits the iframe DOM, calls the production runtime serializer, writes its result to the same filesystem path from the test harness, closes the page, and opens a new page, 100 times. One persistent template/runtime/metadata/frame remain; content is stable after the first edit; revision reaches 100. Byte growth is limited to two revision digits. `contenteditable`, selection attributes and marked temporary handles are removed. This proves serialization and file round trips, **not an H02 product save adapter**. Tests 4–5 reject executable HTML/CSS/SVG and forged metadata. Independently injected script, event, CSS/image network, top navigation and form attempts are blocked by the actual sandbox/CSP: a listening HTTP endpoint receives zero requests and browser failures report `csp`. Unsafe DOM cannot be serialized. |
| Only 作品.html is added by default | Tests 6–7 run the actual CLI subprocess with empty PATH, no model keys, and Node network/subprocess APIs disabled. A negative network probe confirms the guard is active. Exactly one HTML appears; JSON is <=1 KB and visual status remains unverified. Test 9 additionally enforces the diagnostic byte limit for unusually escaped characters. Duplicate output cannot overwrite bytes. Unsafe input creates no output. Missing, unauthorized/out-of-root/symlink resources, cyclic CSS imports and resource budgets fail explicitly. |
| Representative content bypasses old representations | Test 8 uses esbuild's actual transitive CLI and browser-runtime module graphs: the only repository package is `packages/html-document`. No Core, Recipe, IR, Portable, MCP or browser dependency enters generation. All three H00 drafts enhance directly into twelve-page HTML; native heading/paragraph/table text records are unchanged. `imports-and-drafts.json`. |

## Local technical decisions

- parse5 is the inert HTML parser, shared between Node and the browser runtime. PostCSS and its value parser process native CSS without translating layout into another representation. No HTML string regex is used as the sanitizer; CSP is inserted structurally as the first head element.
- The sole persistent content is escaped HTML **text inside one inert template**, including the original document's head/body and nested templates. This avoids HTML raw-text/nested-template breakouts without storing a second JSON/Base64 content mirror. Resource data URLs are the actual inline media, not another project archive.
- The parent contains only build-owned runtime, minimal frame styling and three metadata fields (`documentId`, `formatVersion`, `saveRevision`). A SHA-256 CSP hash permits only the exact runtime script. The same-origin iframe has `sandbox="allow-same-origin"` without scripts; its own first-head CSP blocks script, network, frames, objects, forms and base URLs. Parent click interception prevents even same-frame anchor navigation. No content code receives save permissions or tokens.
- The live iframe DOM is the serialization source. Persistent IDs survive edits. Missing IDs are assigned deterministically while reserving every author identity before allocating; duplicates receive a diagnostic and replacement. Unmarked ordinary HTML uses its body as one page.
- The Node save boundary rebuilds the envelope from cleaned content. It never trusts a caller's runtime or outer shell. The browser serializer does not mutate/acknowledge saved revision in memory: H02 must acknowledge successful writes and coordinate revisions. Returning serialized bytes does not mean “saved”.
- Resources are read by Node, confined using realpath to the authorized root, with a 64 MiB default cumulative read budget. CSS import cycles/depth are bounded. CSS import media/layer/supports syntax remains native; data URLs contain rewritten relative resources. The library additionally accepts an explicit URL-to-local-file map; the CLI currently accepts only local draft-directory resources.
- The existing legacy CLI/release scripts remain historical until H05. New generation has its own `apps/html-cli` entry and no legacy imports. The root build still checks historical code to retain existing regression assertions. The Skill now selects native HTML creation; historical references are retained without routing new generation through them.

## Measurements and limits

`verification/result.json` records actual commit, test totals, hashes and sizes. The runtime is measured raw and gzip; the three twelve-page light drafts are below 1 MB. These are H01 implementation observations, not H06 model-time/token or aesthetic comparisons.

The screenshot/browser tests use automated Chromium on this machine, not manual Chrome/Safari, real user acceptance or cross-platform font equivalence. H00's original drafts remain explicitly uncontrolled. Full Safari/file permission/local autosave/recovery journeys await H02 and H06.

Supported resource forms cover CSS `url()`/`@import`, local stylesheets, image/video/audio `src`, posters/backgrounds and SVG image/use hrefs (including URI fragments). Unsupported executable/escaped CSS values, string-form `image-set`, `srcset`, interactive forms, SVG animation elements, unsafe SVG resource contents and navigation links are diagnosed/rejected rather than silently delivered with altered visuals. External references inside SVG files must already be safely embedded. System-font fallback remains platform-dependent. No claim is made that arbitrary third-party web applications can be faithfully converted.

## Review carryover

- R01 remains open for H04: this reader has no editing controls, but has not implemented/validated full present/blackout/Esc/presenter behavior.
- R02 remains open for H03: no new property panel or editing UI is claimed.
- R03/R04 remain open for H00/H06: H01 adds native-design fidelity and concrete byte measurements, not controlled aesthetic/token/end-to-end performance evidence.
- R05: automated HTML isolation/fidelity/serialization evidence added here; real-browser editing/save/PDF acceptance remains pending. Office-specific work is retired from the **new invocation graph**, not repaired and not yet removed from the historical tarball.
- R06: safe content serialization is implemented; installation, original-file write failure/recovery and release rollback remain assigned to H02/H05/H06. Old CAS/Portable recovery obligations receive no new work. No claim that the old release packaging has already been retired.

No existing test assertion was removed or weakened. Early H01 test development identified (and corrected) over-rejection of safe viewport metadata, counting CSP-blocked request events as actual network traffic, and comparing non-contiguous DOM text via serialized substring matching; final tests assert structural text equality and an actual zero-request HTTP receiver.
