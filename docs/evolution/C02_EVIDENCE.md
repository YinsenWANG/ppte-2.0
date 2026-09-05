# C02 acceptance evidence — 2026-09-06

Implementation commit: `8bf277db971d1421abda6475c8209c0f3e9fb5a4` (signed and signed off).
Task-start commit: `6919e4d`. The initial branch already contained the first C02 implementation and the required `tests/history-inverse-roundtrip.test.ts` (introduced by `20d6bdd`). This round completes those changes rather than recreating that file.

| Criterion | Concrete passing evidence in tests/history-inverse-roundtrip.test.ts |
| --- | --- |
| Whitelisted patch/unset and serializable absent-field inverses | Fixed-seed 100-operation metadata roundtrip; every optional metadata key with absent/present values; invalid unset, overlap and scope rejection; exact absent/empty/nested override restoration; absent/empty group collection restoration; transaction schema/TypeScript whitelist agreement. |
| Commit-time inverse proof and atomic rejection | Lossy floating-point group inverse rejected before journal writes; forged binding, modified inverse and changed transaction rejected with unchanged revision/history/redo/journal; caller-supplied preview revision cannot change committed revision; changed transaction is revalidated after preview. |
| Document/history/redo/patch compatibility and legacy 1.0 | Both checkpoint writers reopen and undo/redo absent backgrounds; redo-only checkpoint; serialized review patch and downgrade rejection; Node checkpoint and journal upgrade/replay; explicit legacy 1.0 checkpoint roundtrip; inverse-only and redo-only poster and unset requirements. |
| Frozen edit.1 descriptor, capability inclusion and interpreter binding | Exact descriptor equality and schema registration, nested immutability, inclusion of GA-A/B/C capability sets, rejection of unknown profile, inverse-only inference, versioned proof binding rejection. |

The existing negative assertion in `tests/r1-agent-editing.test.ts` is unchanged; its deliberately invalid patch now needs a TypeScript cast because the operation type itself enforces the whitelist.

Verification of the implementation commit:

- `pnpm typecheck`: passed.
- `pnpm build`: passed.
- `pnpm test`: 137 passed, 0 failed, 0 skipped. Task-start baseline: 129 passed; delta +8.
- `pnpm blackbox:final`: 69 green, 0 red. Task-start baseline: 69 green, 0 red; no new reds.
- JSON parsing of TASKS.json and transaction schema, plus `git diff --check`: passed.

Local measurement: 10 warmup previews followed by 100 measured previews on `makeContractDocument()`, changing the slide name. Full preview including serialized inverse application and binding hashes: median 0.3964 ms, p95 0.5895 ms. This is a local fixture measurement, not a large-document performance guarantee.

Files: the required test file already existed and was extended; this evidence report is new. Changes cover schema types, operation inverses, Core proof consumption, compatibility inference, validation, reviewer, patch application and JSON schemas.

Remaining limits: inverse proof deliberately rejects mathematically lossy changes; history repair/migration workflows remain C03 scope. The interpreter version must be bumped when operation interpretation or strict inverse validation changes. No CRDT, realtime collaboration, nested group coordinates, run-level font sizing, arbitrary widget execution or alternate write engine was added.
