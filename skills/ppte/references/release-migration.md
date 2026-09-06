# Staged candidate, upgrade and rollback

The package's `release-policy.json` binds the runtime build and compatibility
profile descriptors. It is a format policy, not a release approval. Check the
checkout's `docs/evolution/quality/release-manifest.json` and run
`pnpm release:check` after building. G0 → G4 promotion requires all preceding
stage tasks, client acceptance and manual A21 evidence. A green automated suite
cannot replace real Safari, Office, physical-device or human-panel evidence.

Record four independent actions: Git push/tag, npm publication, local
runtime/Skill installation, and existing HTML upgrade. A local tarball and a
temporary installation do not mean npm publication or user installation. Do not
push, publish or replace a user's installation without task authorization.

## Reproduce the candidate and drill

In a built checkout:

```sh
C06_OUTPUT=artifacts/q02-native node --test dist/tests/npm-native-skill.test.js
Q02_OUTPUT=artifacts/q02-drill node --test dist/tests/release-candidate.test.js
pnpm release:check
```

Use a fresh Q02_OUTPUT destination. The drill retains its receipt, old and new
tarballs/build manifests, original project/profile, reports and delivered HTML.
The old tarball is the public C06 candidate pinned in the fixture provenance;
it is not asserted to be a previously published npm release. Repeating npm pack
for the same staged bytes must reproduce its digest. Installations may fetch
fflate; subsequent CLI commands block Node networking, omit model credentials,
and do not start MCP. This does not claim an OS-level network isolation test.

## Upgrade without losing the original

1. Retain the original `.ppte`, every adjacent journal/CAS object and diagnostic,
   original HTML (including recipient edits), old tarball/runtime build, package
   report and manifest profile. Verify retained SHA-256 and sizes before work.
2. Install the candidate into a separate local directory. Install its Skill to
   a new directory; an existing destination must fail without overwriting.
3. Copy the project to a fresh work directory. Inspect using the candidate,
   perform authorized edits through preview/commit, then deliver. Keep the
   original project and original HTML unchanged. The versioned-copy flow returns
   the actual new path; each delivered copy has its own identity and report.
4. Reopen, undo/redo and verify before rollout. Preserve any failure and stop
   promotion on save/reopen, fact protection or presentation-control regressions.

## Rollback is runtime selection, not automatic document downgrade

Stop new upgrades. Reinstall the retained old tarball in a separate directory
and open a COPY of the retained old project that its profile supports. Verify
its revision against the old report. Keep the new project and new runtime too.
Do not lower manifest/profile numbers, delete history or disable capabilities
to force a new project through an old reader. The drill checks that the actual
old reader rejects the newer table profile without modifying those bytes.
Unsupported profiles require a compatible verified reader; read-only/export is
an option only where that reader actually supports it, never a promised old
reader preview. Existing HTML copies do not update or downgrade automatically.

Retained digests establish byte integrity, not publisher authentication.
