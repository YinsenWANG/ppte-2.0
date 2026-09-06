# S00 verification report

S00 freezes `single-file-first-1.1`: one `.ppte.html`, direct `file://` use,
actual-authorization-based original writes and complete-file download fallback.
README, Agent instructions, Skill and actual CLI help share the same policy and
explicit S01/S02 implementation caveat. `ppte edit` still starts the legacy service;
S00 retires its recommendation, not falsely claims the S01 behavior is implemented.

Required evidence: [contract-diff](contract-diff.md) and
[old-new-criteria-map](old-new-criteria-map.md). The latter maps all three S00
acceptance criteria plus F01–F05 and retained H/R requirements to tests/owners.

Validation: `pnpm typecheck`, `pnpm build`, `pnpm test` passed. 58 tests passed,
0 failed, 0 skipped: 53 existing plus 5 added; no deleted/weakened assertions.
[Raw full log](verification/test.log), [focused log](verification/focused.log),
[typecheck](verification/typecheck.log), [build](verification/build.log),
[machine result](verification/result.json). Tests include actual CLI subprocesses,
real enhancement with both file extensions and exclusive-write refusal. Old H00
baseline remains pending with 0 observed runs and all 21 pending reasons.

`preserved-files.json` records hashes from the starting commit for historical
HTML-first evidence, audit, archived assertions and existing tracked HTML files.
All 492 match. The old contract prose is separately preserved byte-for-byte.
No existing sample or user file was renamed, rewritten or upgraded. Package
manifest and lockfile match the starting commit. No runtime implementation changed.

Four-way status:

- Code: contract/help implementation passed; subsequent product implementation is pending.
- Automation: passed as recorded above; existing tests include Chrome automation, which is not proof of new native journeys.
- Real browser: new direct-file/no-Node, Safari and native permission acceptance pending; no such S00 session was performed.
- Human: pending; no reviewer session, controlled model telemetry or low-performance device measurements acquired.

New files: this report, two required evidence maps, old contract snapshot,
preservation hash manifest, five verification logs/results, and
`tests/single-file-contract.test.ts`. Existing baseline assertions only gain explicit
historical version selection; no old evidence is relabelled or repaired.

The implementation and evidence closure are separate signed S00 commits so task
metadata can point to an already existing implementation commit; see result.json
and TASKS.json for its hash. No push is performed. Pre-existing supervisor files
remain untouched in place and are locally excluded through `.git/info/exclude`;
they are not product deliverables or committed evidence.
