# E02 — Active text kernel decision

Decision: **retain native as the single production path**. ProseMirror remains a
pinned, development-only experiment. This selects the implementation direction
for E03; it does not close A08–A10 or certify the existing editor's formatting UI.

## Controlled experiment

Run `pnpm test` for the node --test contracts (including real Chromium DOM tests).
Run `pnpm experiment:text-kernel` after installation to reproduce measurements;
it writes `/tmp/e02-text-kernel-measurements.json`, never overwriting frozen evidence.
The committed report is `../quality/e02-text-kernel-measurements.json`.
The shared corpus is `tests/fixtures/evolution/text-poc.json`.

Both candidates mount one contenteditable text box. Native uses browser Range /
Selection, browser insertText/insertHTML/bold commands and the production
`editRichText` / `ImeTextEditSession` boundary. The POC explicitly joins paragraph
innerText with one newline: raw p.innerText aggregation was observed to introduce
double paragraph separators. This small experiment normalization is **not** a
claim that Host/Portable already handle every paragraph DOM shape correctly.
ProseMirror uses the actual EditorView, EditorState, TextSelection and a limited
paragraph/text/boolean-mark schema. Model 1.25.11, state 1.4.4 and view 1.42.3 are
pinned in the development lockfile. Installed TypeScript declarations are the API
reference used for the experiment. No Tiptap or history plugins are installed.

The adapters are intentionally small enough to expose integration costs: the PM
mapper carries paragraph metadata but regenerates run IDs; this is a limitation of
this adapter, not an assertion that ProseMirror cannot preserve semantic IDs.
Native still loses newly added selection and paste marks at its plain-text diff
boundary. Neither candidate is credited with production features it lacks.

| Same case | Native observation | ProseMirror observation |
|---|---|---|
| Chinese composition: intermediate Latin input, replace with candidate, compositionend + duplicate input | Expected Chinese text; no composition-time transaction; one final transaction | Same |
| Mixed Chinese, emoji ZWJ and combining accent insertion | Exact expected code units retained | Same |
| Reverse selection spanning two paragraphs | Exact replacement text | Same |
| Multiline plain paste | Exact paragraph text | Same |
| Bold only Studio | Known fault: newly added marks disappear | Correct selected bold text |
| Two-paragraph formatted paste | Known fault: pasted bold disappears | Bold retained |
| No-edit semantic identity | Paragraphs, runs and marks unchanged; zero transaction | Known fault: regenerated run IDs can create a spurious edit |
| Rejected commit / explicit cancel | Draft retained; stale revision cannot overwrite document; cancel leaves Core unchanged | Same shared commit boundary |
| Commit / checkpoint / reopen / undo / redo | Exact document roundtrip for every emitted transaction | Same |

These are fault-characterization assertions, not skipped tests or false acceptance
passes: tests assert the observed losses and the expected successful behavior
separately. They can be replaced with success assertions only when the actual
adapter is fixed. No pre-existing assertion was weakened.

## Frozen budget and measured cost

Budget: **c01-m1-v1**, unchanged from C01. Same Apple M4 / macOS arm64 device,
Chromium 151.0.7922.34, 1440×900, headless. The 12/30/100-page C01 corpus has
no binary fonts or images and uses the same system-font policy. Every candidate
has 20 fresh-process cold starts, 20 immediate warm reloads and 30 input samples
per deck size. Cold does not mean flushed OS caches. Ready waits for the portable
API, active editor, fonts, image decodes and two frames. Input is active editor
mutation + public Operation Engine commit + two frames, not OS key-to-paint IME
latency. The full-portable runtime is identical for both candidates.

| Active-text bundle including experiment bridge | Raw bytes | gzip bytes |
|---|---:|---:|
| Native | 15,789 | 5,194 |
| ProseMirror | 199,136 | 61,173 |
| PM minus native | 183,347 | 55,979 |
| Frozen incremental limit | 350,000 | 100,000 |

| Pages | Cold p95 delta ms | Warm p95 delta ms | Input p95 delta ms |
|---|---:|---:|---:|
| 12 | -0.24 | -0.48 | -2.54 |
| 30 | 0.00 | 26.44 | -7.36 |
| 100 | 6.40 | 1.41 | -4.11 |
| Frozen maximum increment | 100 | 50 | 16 |

All measured incremental budgets pass. Negative deltas are noisy observations,
not a claim that adding PM accelerates the product. All four absolute profile
gzip caps pass using each actual profile build plus the standalone adapter gzip
(a conservative no-cross-bundle-deduplication estimate). Viewer includes this cost
only for the budget comparison; it does not activate editing. Production added
runtime cost is **zero** because neither POC entry is imported by production.
Metafile tests check both Host and Portable dependency graphs.

Raw samples, p50/p95, environment, base commit, source hashes, corpus revisions,
HTML hashes, profile bytes and decision arithmetic are committed and checked by
node --test. Each input sample asserts exact committed text, active editor DOM
identity and an unchanged unrelated semantic slide. This only certifies the
external active-text experiment: whole-canvas DOM retention is not measured or
claimed. `text-measurement.ts` and portable build semantics need no change.

## Correctness and maintenance tradeoff

PM improves local formatting behavior and fits the budget. It does not, in this
minimal experiment, eliminate the PPTe-specific work: lossless run identity,
selection PositionMap, supported-mark/HTML sanitization policy, draft conflict
handling and Core history arbitration all still need an adapter. Importing it
now would add three direct and two transitive development dependencies to the
production path before proving a lossless semantic roundtrip.

Native has zero new production dependencies and already preserves unchanged
semantic run IDs through the existing diff. Its maintenance burden is explicit:
E03 must implement stable range transforms, safe rich paste, paragraph DOM
mapping, selection restoration and browser history interception in both shells.
The POC's deprecated browser execCommand calls are stimulus for the comparison,
not the recommended new production formatting API. PM maintenance would replace
some DOM command work with schema/position/identity mapping and library upgrades;
it would not replace the Operation Engine. No hours-saved estimate is invented.

Therefore choose native for E03 and keep only one production path. A future
proposal to switch must demonstrate lossless ID/marks conversion, complete the
same failing cases, rerun this frozen budget, and supply real IME evidence. Budget
success alone is insufficient to justify switching today.

## Boundaries and remaining acceptance

Only the active text draft is private editor state. Neither candidate stores a
canvas model, nested Group coordinates, run font sizes, CRDT state or executable
widgets. The fixture and PM schema do not introduce a persisted document format.
All writes use planned transactions through Core; checkpoint/reopen tests use
real archive bytes. beforeinput historyUndo/historyRedo is intercepted at the
POC boundary and there is no PM history plugin. Core owns undo/redo; production
shell integration remains E03/E07 work. Network requests are blocked in browser
experiments; there is no cloud setup or runtime requirement.

**unverified:** real Chinese OS input methods and candidate-window cancellation,
physical Safari, lower-performance hardware, full Host/Portable selection-toolbar
journeys, arbitrary rich HTML sanitization, grapheme-boundary navigation and
whole-canvas node stability. Synthetic composition events are not an OS IME test.
The corpus verifies preserving complete emoji/accent sequences when inserted,
not every possible cursor movement inside a grapheme. E02 selects a path and
records faults; A08/A09/A10 final acceptance remains shared with E03/E07/E08.
