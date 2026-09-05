# C04 — verified artifact identity and delivery

Implementation commit: `a0c207ea7c1f88fe53731fa20553a9b4ae6b47fd`. The separate evidence commit records this existing, reachable implementation commit; no self-referential commit placeholder is used.

Environment: Node v22.23.2, pnpm 11.22.0, branch evolution, application 0.9.0-next.0.
Runtime build ID (SHA-256 of escaped embedded executable bytes): `1498765a8e827ac7991f0009361bb371e814d9ce42e22346d3d0400284eb6d96`.

## Per-criterion evidence

| Criterion | Concrete tests in `tests/artifact-identity.test.ts` | Result |
| --- | --- | --- |
| Actual runtime/renderer/shell/resource/font/history/capability/configuration/compatibility descriptor identity | `A05 identity binds every actual component and excludes generation time`; `A05 audit checks resource declarations even when identity is recomputed`; `A05 embedded font bytes are audited independently of a recomputed identity`; existing runtime and redo-only history tests | Pass. Each component mutation invalidates identity; shell includes CSS/CSP; renderer binds executable plus rendered surface; resources hash decoded bytes individually; fonts include system/embedded declarations and policy. Undo and redo are separate inputs. |
| Old API defaults to error; explicit versioned-copy, conflict rejection, atomic short-digest collision handling | `A05 old API errors on stale identity while explicit new flow creates and reuses real copy`; `A05 short digest collisions and dangling symlinks create fresh sibling without clobber`; `A05 atomic publication retries a writer arriving after target preflight`; `A05 conflicting legacy flags reject and confirmed replacement retains recoverable exact bytes`; existing old-runtime delivery test | Pass. No-clobber publication uses atomic hard-link creation, retries only target collisions, and preserves a competing writer. Confirmed replacement retains `.previous` or numbered backup before atomic rename. Existing `tests/delivery.test.ts` fault and sibling-path tests also pass unchanged. |
| Single application version, preserved profiles, byte audit | `A19 root version, CLI, Portable and byte-derived build manifest agree; old profiles remain`; `A19 staged distributable carries root version and exact build manifest`; audit tests above | Pass. Root package version generates the version module and build manifest. CLI, Portable and staging agree. All four legacy Portable profiles still build and audit. Host tab title consumes the same generated version. Skill instructs recording installed version/build manifest. |

## Verification

- Task-start existing compiled test baseline: **145 passed, 0 failed**.
- `pnpm typecheck && pnpm build && pnpm test`: **154 passed, 0 failed**, delta **+9**. All pre-existing test bodies/assertions retained.
- `pnpm blackbox:final` before changes: **69 green, 0 red**.
- `pnpm blackbox:final` after changes: **69 green, 0 red**, no new reds.
- `git diff --check`: passed.
- TASKS JSON parsed with Python before the evidence commit.

`tests/artifact-identity.test.ts`, listed as a newFile in the plan, already existed at task start; it was expanded with nine tests. This evidence document is the newly added tracked file. Generated build manifests and staging outputs remain under ignored `artifacts/`.

## Scope and remaining risks

Digests identify content, not publishers or signatures. Legacy HTML without the new build manifest remains readable but cannot be reused by delivery without a matching audited identity. System font declarations do not assert identical installed font bytes on another machine. Runtime and renderer are bundled together, so renderer identity conservatively changes with any executable change.

Backups are local siblings and require user-managed retention; atomicity depends on the existing local filesystem hard-link/rename support. The race test deterministically inserts a competing writer between preflight and publication; it is not a distributed filesystem stress test.

Application semver was retained; no npm publication, global installation, registry version inventory, network-disconnected tarball acceptance, or push was performed. The A19 staging/version slice is covered here; full installation/offline workflows remain the related release tasks' responsibility.

## Gate repair verification

This fix round retains implementation commit `a0c207ea7c1f88fe53731fa20553a9b4ae6b47fd` and the per-criterion tests above. Two independent races were reproduced:

- The initial full suite returned **153 passed, 1 failed, 154 total**. `tests/host-completion.test.ts` failed on `page.reload: net::ERR_FILE_NOT_FOUND`: three concurrent test files rebuilt the shared Host directory with `emptyOutDir`. All three now build into unique temporary directories. The staging script accepts optional output and Host input directories, retaining its default release paths. The staging test also compares the staged Host bytes with its isolated input.
- After isolating builds, four concurrent runs of the three affected test files reproduced **two C05 failures** at the final Space-to-exit assertion. Host's deferred presentation frame stole focus from the exit button. Entry now preserves focus already inside the presentation surface. `tests/surface-mode-contract.test.ts` explicitly defers that frame until the exit control is focused and asserts focus survives before pressing Space. Restoring the original unconditional focus while keeping the test produced `false !== true` at `deferred presentation entry preserves control focus`; the fixed implementation passes. No existing assertions were removed or relaxed.

Final verification after restoring the fix:

- `pnpm typecheck && pnpm build && pnpm test`: **154 passed, 0 failed**. Test count delta for this repair: **0**; existing tests gained regression assertions. Original C04 implementation delta remains **+9**.
- Four concurrent runs of `node --test dist/tests/artifact-identity.test.js dist/tests/host-completion.test.js dist/tests/surface-mode-contract.test.js`: **18/18 each, 72/72 total**.
- Subsequent `pnpm blackbox:final`: **69 green, 0 red**, matching this round's task-start **69/0** baseline.
- No tracked files added in this repair. Required `tests/artifact-identity.test.ts` exists and passes; the two Host test files and existing evidence were strengthened.

The staging CLI test links the repository's installed dependencies into the temporary package, matching its prior dependency resolution through the repository parent. It verifies staged bytes and versions, not a fresh offline dependency installation. Browser regression coverage is Chromium automation; the previously documented platform and publisher-authentication limitations remain.
