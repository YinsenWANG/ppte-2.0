# E02 acceptance evidence

Implementation commit: `1469cc38029ffc9385b18d87d751dfe1ce54240c` (GPG signed, signed off).
This evidence module records the already verified implementation commit so the
TASKS.json record does not contain a circular or fabricated self-hash.

| Task done criterion | Concrete node --test evidence |
|---|---|
| Same Chinese / selection / paste / history corpus | `tests/text-kernel-poc.test.ts`: native and prosemirror tests run all seven fixture cases in Chromium, characterize formatting/identity faults, commit actual outputs through Core, checkpoint/reopen and undo/redo each emitted transaction. |
| Bundle / startup costs, faults, maintenance and explicit choice | The measurement-evidence test checks all raw sample counts, p50/p95 arithmetic, frozen budget version and increments, source/fixture hashes, environment, all profile caps and ADR decision. The first two tests assert the recorded candidate faults. See `decisions/text-kernel.md`. |
| No whole-canvas model, second history or cloud requirement | Production-bundle test verifies both Host/Portable exclude PM and experiment imports. Both browser tests block network requests, prevent browser history events and verify draft isolation, Core-only writes and persisted history. The measurement test excludes history/collab packages; every measured input verifies active-node stability and unchanged unrelated semantic slide. |

Verification before implementation commit:

- `pnpm typecheck`: passed.
- `pnpm build`: passed.
- `pnpm test`: 176 passed, 0 failed, 0 skipped; start baseline 171, delta +5.
- `pnpm blackbox:final`: 69 green, 0 red; start baseline 69/0, no new reds.
- Browser sampling: both candidates × 12/30/100 pages × 20 cold + 20 warm + 30 input samples. All incremental budgets and absolute profile caps pass against unchanged c01-m1-v1.
- `git diff --check` and TASKS.json JSON parse: passed.

New implementation files: `tests/helpers/text-kernel-poc.ts`,
`tests/helpers/text-kernel-prosemirror.ts`, `tests/text-kernel-poc.test.ts`,
`tests/fixtures/evolution/text-poc.json`, `scripts/text-kernel-poc.mjs`,
`docs/evolution/decisions/text-kernel.md`,
`docs/evolution/quality/e02-text-kernel-measurements.json`,
`docs/evolution/quality/e02-blackbox-start.json`,
`docs/evolution/quality/e02-blackbox-final.json`. This evidence file is added by the
acceptance module. Package manifest and lockfile pin development-only PM packages.

Decision: retain native as the sole production kernel. Runtime bundles are
unchanged; the test-only PM candidate adds 183,347 raw / 55,979 gzip bytes over the
native experiment, within budget, but its minimal mapper regenerates run IDs.
Native still needs E03 range/format-paste work. Experimental success means the
comparison ran and the faults are recorded, not that those faults are accepted
as completed production features.

Remaining risks / unverified acceptance: real OS Chinese IME and candidate UI,
physical Safari, lower-performance device, toolbar selection restoration,
arbitrary rich HTML sanitization, complete grapheme navigation and full-canvas
DOM retention. E02 is complete as a controlled selection experiment; A08–A10
remain shared production acceptance work in E03/E07/E08.
