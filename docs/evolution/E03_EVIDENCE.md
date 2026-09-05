# E03 acceptance evidence

Implementation commit: `4e933ab237f0647cde7c1c7e85fc6f511f35703e` (GPG signed and signed off).
This evidence module records the verified implementation commit; it avoids a
circular self-hash in TASKS.json.

| Done criterion | Concrete node --test evidence |
|---|---|
| Precise basic marks; UTF-16/grapheme/IDs and caret mapping | `tests/text-range-editing.test.ts`: exact Studio bold/color; reverse, cross-paragraph, whole and collapsed ranges; mixed marks; all five marks and clear; unchanged paragraph/run IDs; collision-safe split IDs; UTF-16 emoji ZWJ and accent snapping; PositionMap. Each mark transform commits through Core and survives archive reopen, undo and redo. Chromium tests restore the selected Studio after toolbar focus, reject stale revision/root selection, apply pending marks and rich paste, and change whole-box size without run font fields. |
| Composition deduplication; rejected flush/conflict retains drafts; only Core undo | The buffer test verifies composition blocking, duplicate hash no-ops, a resettable 750 ms burst, retained text/selection on rejected commit, safe replanning after an unrelated revision, and target-hash conflicts. Both production browser journeys intercept keyboard undo/redo, keep the Agent's target change and the local draft, reject undo after conflict, and support explicit draft discard. Existing `tests/surface-mode-contract.test.ts` exercises actual Host storage rejection and invalid Portable input without losing the draft. |
| Active DOM retained in both shells now | The DOM helper test checks exact active-node identity, focus and selected text across an unrelated update. Both actual Host and generated file Portable journeys commit an unrelated image move during composition, then assert identical active text DOM, focus and caret before committing the text. Existing presentation and chart browser tests also pass with the in-place reconciler. |
| Concurrent save/compositionend/blur submits once; failed flush blocks undo | The buffer test issues concurrent compositionend/save/save/blur flush requests and gets one Core history entry. Both production journeys click Save twice during composition, then deliver compositionend, duplicate input and blur, and assert exactly one added history entry. A text draft plus font-size/blur race produces exactly two entries (one text transaction and one size transaction). Failed composition, rejected commit and target conflict all block undo without changing Core history. |

Verification before implementation commit:

- `pnpm typecheck && pnpm build && pnpm test`: passed; **182 passed**, 0 failed,
  0 skipped. Task-start baseline: 176; delta: **+6** tests. The two new production
  journeys build/run Host and generated Portable in Chromium.
- `pnpm blackbox:final`: **69 green, 0 red**, same as task-start baseline.
  Full reports: `quality/e03-blackbox-start.json` and
  `quality/e03-blackbox-final.json`, including measured runtime build identities.
- `git diff --check` and TASKS.json JSON parsing: passed.
- Existing assertions were retained, including legacy Portable composition error
  codes, SVG chart update checks and Host stale-tab recovery behavior.

Production behavior and boundaries:

- Native is still the only production input kernel. No new dependency, CRDT,
  realtime collaboration, run font schema or second persistent history was added.
  Every persistent text/style change goes through the Operation Engine.
- A clean buffer hash suppresses duplicate trailing input/blur/save writes.
  Ordinary input and input with pending marks use a configurable 750 ms idle
  burst; formatting, paste, blur, saving and presentation flush that burst.
  Composition is never committed midway.
- Replanning is permitted only when the target content still matches the draft
  baseline. Target changes preserve the local draft and produce a conflict.
  Host's existing cross-tab recovery-lease conflict restores its old canvas
  snapshot while retaining the failed text in the visible draft panel and buffer.
  Retrying does not bypass the lease or target checks.
- DOM text mapping shares one paragraph/list traversal with selection mapping.
  Rich paste uses an inert parse and emits only text and supported marks; scripts,
  media/resource nodes, event handlers and unrelated attributes are discarded.
- Inspector numeric controls retain their DOM across a text flush. Full Portable
  exposes an explicitly whole-box font-size input; smaller profiles keep their
  existing command permissions. Selection font sizes remain E08.

Required new implementation files:

- `packages/richtext-adapter/src/ranges.ts`
- `packages/richtext-adapter/src/transforms.ts`
- `packages/richtext-adapter/src/edit-buffer.ts`
- `packages/editor-dom/src/text-selection.ts`
- `tests/text-range-editing.test.ts`

This evidence module adds this report and the two blackbox JSON reports.

Remaining risks / unverified manual acceptance: synthetic Chromium composition
and candidate-event tests do not certify a physical Chinese OS input method,
candidate-window behavior, physical Safari or lower-performance hardware. Those
manual A09/Q01 checks remain explicit; this E03 completion records implemented
production contracts and passing automated evidence, not a manual-client claim.
The 750 ms burst is the documented prototype default, not a human latency study.
