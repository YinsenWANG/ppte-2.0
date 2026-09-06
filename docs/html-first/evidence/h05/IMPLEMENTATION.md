# H05 — HTML-only installable candidate

Authority: the four documents at `bbcd46bde2c608b5a56e617f316c5dcb5534857e`.
Implementation commit: `b57fdc9f2354b5e6e49a356c0e5092fb72a77fb1` (GPG signed and signed off).

Implementation base: `033460300ac21cd62359ca0aa550b5bff1aed67c`.

H05's four packaging criteria are verified. This does not mark H04's pending
Safari journey or H00/H06's human/model measurements complete. No publication,
global installation change or push was performed.

## Implementation and scope retirement

The default `ppte` bin now bundles only `apps/html-cli`, the HTML packages and
HTML/CSS parsers. The candidate is independently named `ppte-html@1.0.0-html.0`.
Its actual npm archive has six files and no runtime, optional or peer npm
dependencies, lifecycle scripts, Host, MCP, schemas or legacy content formats.
`stage-html.mjs` is an alias of the same staging implementation for H02 tests.
Staging refuses an existing unmarked directory. Build cleans generated `dist`
so compiled retired tests cannot survive a checkout upgrade.

The retired apps, packages (including the Office exporter), schema/format
configuration, fixtures, Skill references, old release/blackbox scripts and
assertions moved intact to `archive/legacy`. They are outside the workspace,
TypeScript includes, CI and tarball. This is **scope retirement**, not a repair
or passing result. `retired-tests.json` records all 60 old test files with
pre-change SHA-256; the new node test verifies their unchanged bytes. The
original Git revision remains the complete runnable historical environment.
No existing HTML-first acceptance assertion was modified or removed.

Root dev dependencies no longer contain React, ProseMirror or fflate. Basic
package generation needs only Node; browser and PDF test dependencies are
separate development tools. CI now targets the existing macOS Chrome/PDFKit
suite and no longer installs or executes Office/Python conversion gates. The
edited CI workflow itself has not been executed on hosted GitHub runners.

Skill installation creates a new directory exclusively, works from the actual
installed bundle and refuses a duplicate. The 3,402-byte Skill describes direct
HTML authoring, one-file delivery, original-file editing and optional printing.
README documents independent install, one-time Skill reuse, cache recovery,
rollback and historical tools. Existing global tools and user works are untouched.

## Acceptance and real tests

All commands below run repository TypeScript compiled to `dist`, via node:test.

| Criterion | Evidence |
| --- | --- |
| Static dependency graph AND actual npm tarball | `dist/tests/html-package.test.js`, acceptance 1: inspect esbuild CLI/runtime input edges and builtin-only external imports; inspect npm's actual packed file list and installed manifest. `verification/dependency-graph.json`, `pack.json`, `candidate.tgz`. |
| Generate with no external tooling; separate PDF verification | Acceptance 2: offline npm install, PATH containing no executables, absent browser directory, and active network/process-denial hooks (both probed to fail); installed command still emits one HTML. Separate packaged-HTML Chrome print test plus unchanged H04 Chrome/PDFKit two-page, text, size and clean-output assertions. `verification/node-only.json`, `packaged.pdf`, `release.log`. This is environmental isolation on this host, not a claim that this machine has no browsers installed. |
| Runtime <=250 KB gzip; light HTML <=1 MB | Acceptance 3 measures the installed candidate's three unchanged twelve-page H00 drafts; each media count is zero. `verification/sizes.json`, `example.html`. This is an actual size measurement, not controlled model speed/aesthetic evidence. |
| Old files unchanged; independent installation/recovery | Acceptance 4 compares old project bytes and both legacy/current HTML bytes after refused overwrite, refused legacy edit, failed staging into a user directory, candidate removal/reinstallation and repeated Skill install. README recovery instructions are checked in the actual package. Existing H02 installed-service save/restart, interruption and recovery tests also pass. `verification/recovery.json`, `test.log`. |

Runtime: **287,678 raw bytes / 83,659 gzip bytes**. Twelve-page light HTML:
Cherry **301,744 / 87,923**, product **301,392 / 87,762**, data
**302,430 / 87,970** raw/gzip bytes; media **0** for each. Exact tarball size and
integrity are in the retained npm receipt. No media compression or fact removal
was used. Default fonts remain system fonts.

## Verification and test accounting

`pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm package:pack` and
`pnpm release:check` all pass; logs are retained under `verification/`.
Before: **439** tests, including **392** retired-path tests. Those 392 remain
as unmodified historical assertions in 60 archived test files; they are not
counted as passing this candidate. Active prior HTML tests: **47**. Added:
**6**. New active total: **53 passed, 0 failed, 0 skipped**. Release check
separately passes **6 H05 + 5 H04** tests. No assertion was weakened to fix a
failure. Early H05 tests exposed a Skill copy bug (exclusive mkdir plus copying
the directory itself); copying its entries fixes it while preserving refusal
to overwrite. New graph checks recognize esbuild's disabled builtin stubs;
print checks query text inside the production shadow root before afterprint
cleanup. No existing tests changed.

## Retained review obligations

- R01: H04's Chrome presentation evidence retained; Safari remains pending.
- R02: H03 evidence retained; packaging makes no new human usability claim.
- R03/D07: H00/H06 real materials, human blind review and editorial quality
  remain pending; the obsolete recipe corpus is retired, not passed.
- R04/P01: current runtime/HTML size measured here; end-to-end model timing,
  tokens and low-performance-device evidence remain H00/H06 gaps.
- R05/Q01: whole Office product/dependency/distribution path retired. HTML/PDF
  Chrome checks pass; Safari and native print-dialog journeys are not closed.
- R06/Q02: actual candidate pack, isolated offline install, original-file save
  regression tests and reinstall evidence retained. Old project/CAS/profile
  drills are retired. H02's native permission and real browser limitations
  remain; package success is not an assertion of power-loss durability.

Pipeline-provided untracked `brief5-H05.md` and `out5-H04.txt` were preserved
outside the worktree at `/tmp/ppte5-pipeline-h05-inputs/`, not deleted or committed.
