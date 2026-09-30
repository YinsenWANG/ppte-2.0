# Delivery regeneration from ed1bbdb

Regenerated the current DLV delivery through the repository's documented pipeline. The original installed-runtime assertion failed before regeneration and passes afterward. The entire original author content, including embedded images, is byte-identical; all nine native pages remain.

The pipeline ran `pnpm package:pack`, installed the actual tarball offline with scripts disabled, checked installed CLI help, installed the packaged Skill, and enhanced the original U01 `full-deck.html` once into a new staging directory. All five commands succeeded. The staged delivery and the pipeline's two installation receipts were copied unchanged to their current DLV paths only after checking source content, current runtime, all six receipt hashes, and packaged/installed CLI, Skill and README equality. The enhancer's overwrite protection and all test assertions remain intact.

The exact invocation, artifact locations, old/new hashes and promotion checks are in [regeneration.json](regeneration.json). The tarball, package staging directory, independent installation, installed Skill and previous-delivery backup remain under this workspace's ignored `artifacts/` directory. The current installation paths are in [installation.json](../installation.json).

| Verification | Result | Evidence |
| --- | --- | --- |
| Build, pack, offline install, help, Skill install, enhancement | All pipeline commands passed | [installation-commands.json](../installation-commands.json) |
| Original installed-delivery assertion before regeneration | Failed with stale runtime | [before-delivery-test.log](before-delivery-test.log) |
| Installed-delivery assertion after regeneration | 1 passed, 0 failed | [installed-delivery-test.log](installed-delivery-test.log) |
| Entire `audit-delivery.test.js` | Runtime/receipt check passed; two browser tests blocked at Chrome launch | [focused-delivery-test.log](focused-delivery-test.log) |
| Pipeline script syntax | Passed | [gates.json](gates.json) |
| Diff whitespace check | Passed | [gates.json](gates.json) |

Chrome aborted with SIGABRT; Playwright cleanup also reported `kill EPERM`. The two browser tests did not reach their layout or interaction assertions. No browser pass is claimed, and no full-suite rerun was attempted in this browser-denying sandbox. The supplied hosted and independent failure logs are preserved verbatim alongside this report. Historical DLV full-suite results and screenshots retain their original revision/date.

Hand-authored changes: `scripts/prepare-audit-delivery.mjs` adds an optional installation root; DLV `IMPLEMENTATION.md` documents that invocation and this round; this report records scope and results.

Generated changes: the current DLV `.ppte.html`, `verification/installation.json`, `verification/installation-commands.json`, DLV `SHA256SUMS`, this round's machine observations and logs, and ignored workspace build/package/install outputs. Supplied failure logs are copied evidence. No source deck, source media, product runtime code, README-AGENT, source Skill, test, assertion or dependency changed.

This agent issued no commit or push commands. During final verification, HEAD advanced externally from `ed1bbdb` to `bf9c8ac` (`build: refresh audited delivery from current mobile runtime`), containing the five regeneration changes; history was left untouched. The checksum manifest and this round's evidence remained uncommitted at that observation. No Hermes core, `.env`, or secrets accessed or changed. Native-browser and human acceptance remain pending.
