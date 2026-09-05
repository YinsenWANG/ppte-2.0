# E01 verification

Implementation commit: `6941d92b6cd248907176598d2670099d531f6668` (GPG signed and signed off).

Verified on branch `evolution`. The task-start blackbox baseline was 69 green / 0 red.
The pre-E01 test suite contained 158 tests; the verified suite contains 171 tests
(13 added, 0 failures, 0 skipped). No existing assertions were removed or weakened.

| Done criterion | Implementation | Concrete tests |
| --- | --- | --- |
| Pure controller and CLI-compatible planners | Structural SessionPort; pure command registry, text replacement and object planners; presentation effects moved to editor-dom | `tests/editor-controller.test.ts`: neutral-platform dependency bundle, planner purity/facade identity, shared text semantics |
| Shared capability, scope, locks, revision and Core history | Both editor facades submit through EditorController; Core remains the only history and mutation owner; profile policy applies before submission | Same file: Host/Portable/CLI comparison, policy across preview/registered/facade commands, atomic mixed locked selection, stale text rejection, journal action ordering |
| Old facades and complete release | interaction and presentation compatibility exports; subscription disposal; DOM listener/observer/URL ownership; shell draft cleanup | Same file: legacy facade identity, disposed queued work/resources/subscriptions, DOM resources; existing `tests/presentation-controller.test.ts` and `tests/surface-mode-contract.test.ts` also pass |
| Single queue, draft epochs and in-flight deduplication; failed dependencies stop | Synchronous facades share a serialization gate with queued commands; same-epoch flush returns one Promise; replacement/cancellation cannot consume an old draft; save effects await flush | Same file: in-flight deduplication/reentrant writes, composing/stale/locked failures, epoch replacement/cancellation, synchronous draft boundary, asynchronous save ordering |

Verification completed before committing:

- `pnpm typecheck`: passed.
- `pnpm build`: passed.
- `pnpm test`: 171 passed / 0 failed / 0 skipped, including browser mode/IME tests.
- `pnpm host:build`: passed (Vite retains its non-fatal large-chunk warning).
- `pnpm blackbox:final`: 69 green / 0 red; no new reds versus baseline.
- `git diff --check`: passed.

Added implementation/test files:

- `packages/editor-controller/src/index.ts`
- `packages/editor-controller/src/commands.ts`
- `packages/editor-controller/src/selection.ts`
- `packages/editor-controller/src/policy.ts`
- `packages/editor-controller/src/mode.ts`
- `packages/editor-dom/src/index.ts`
- `tests/editor-controller.test.ts`

Boundaries and remaining risks:

- Legacy synchronous API methods return `COMMAND_BUSY` if an asynchronous controller
  operation owns the queue; they retain their synchronous signatures.
- Text drafts retain their original revision and conservatively reject intervening
  changes. Target-hash-based rebasing and detailed text-selection UX remain E03 work.
- Rich-text IME and pointer adapters retain platform-specific transient input state;
  their commits, flush guards and persistence history use the shared controller/Core.
- No CRDT, realtime collaboration, nested group coordinates, run font sizing,
  arbitrary widget execution, or document writes outside the Operation Engine were added.
