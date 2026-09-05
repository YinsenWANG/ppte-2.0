# M0 candidate verification and migration

A local candidate is not an npm release. Record these actions independently:

| Action | Evidence required |
| --- | --- |
| Git push | Remote and pushed commit, or `not-run` |
| Candidate tarball | Filename, SHA-256, application version and runtime buildId |
| npm publication | Registry/version and publication result, or `not-run` |
| Skill installation | Destination and result; distinguish temporary verification from the user's installation |

In a built checkout, `pnpm package:pack` stages the package and creates a local tarball. It does not push or publish. The repeatable clean-install check is:

```sh
C06_OUTPUT=artifacts/c06-candidate node --test dist/tests/npm-native-skill.test.js
```

Run `pnpm typecheck`, `pnpm build`, `pnpm test`, then `pnpm blackbox:final` before promoting a candidate. The clean-install check preserves its tested tarball and candidate-report.json when C06_OUTPUT is set. It uses a new npm installation/cache and a temporary home; optional Playwright is omitted. After installation Node network APIs are blocked and no model credentials are inherited. Installation itself may fetch the required fflate dependency. This is an automated CLI journey through the installed Skill instructions, not evidence of a human or model-host evaluation.

Install the tested tarball with `npm install /absolute/path/ppte-cli-0.9.0-next.0.tgz`. Discover the actual application version using `ppte --version`; inspect the package's build-manifest.json for runtimeBuildId. Install the native Skill with `ppte skill-install --out /chosen/skills/ppte`. An existing Skill directory is rejected: retain the old directory and review the new version in a separate destination. Basic compile/edit/deliver needs no MCP, model key or browser; PDF/PNG rendering still requires optional Playwright/Chromium.

Keep original projects, adjacent journal/CAS data, old runtime builds and old tarballs. Legal old 1.0 projects retain their supported semantics; newer operations can require the 1.1/edit.1 compatibility descriptor. An old reader must not silently rewrite capabilities it does not understand. Never manually lower a profile to force a downgrade.

For damaged history, use `ppte history-inspect source.ppte`, then `ppte history-repair source.ppte --out /new/recovery-directory`. Inspect the returned report. Full history reconstruction requires an exact checkpoint base (`--base`); without one, only the proven suffix can be retained. A valid snapshot is not proof that all original undo history was recovered. Preserve originals on failure and retain diagnostics for incomplete resources or unsupported history.

Deliver a new editable HTML from the verified source. Legacy HTML without identity, changed runtime bytes, and recipient edits are not evidence that an old copy can be reused. The versioned-copy delivery flow preserves those files; reconcile recipient edits through review/patch. HTML copies are independent files and do not upgrade automatically. Identity hashes verify bytes, not publisher authentication.

Stop promotion on a new regression. Retaining an older runtime does not downgrade files already written with new capabilities. Real Safari, physical-device performance and manual agent-host evaluation require separate evidence; the public failure corpus uses synthetic equivalents rather than private user originals.
