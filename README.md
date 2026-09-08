# PPTe single-file-first

Deliver one self-contained `作品.ppte.html`: the work, editor and presenter in
one file. The default use entry is **file://**, opened directly in a supported
browser, without Node, installation, network or a running service for readers.
Existing `.html` files remain readable and are never automatically rewritten.
PDF export is unfinished; the direct “导出为 PDF” entry is disabled pending a
qualified route and any required architecture approval. Browser printing is not
the product PDF action.

Original-file autosave requires actual browser write authorization. Without it,
the contract requires full editing and a complete updated-file download;
a draft or download must never be called saved to the original file.
The former loopback recommendation is retired, including as a required fallback.

**Implementation status:** S00 freezes this contract; S01/S02 acceptance is partial.
`ppte edit FILE` opens the file and exits. `ppte serve FILE` explicitly starts
an optional development service; it is not a reader prerequisite.
Direct-open controls are implemented; native picker, Safari and human acceptance remain
pending; the new contract does not certify those capabilities.

See [installation, workflow and recovery](README-AGENT.md), the authoritative
[single-file-first plan](docs/single-file-first/PLAN.md),
[tasks](docs/single-file-first/TASKS.json) and [contract](docs/html-first/CONTRACT.md).
This is a local candidate, not an npm publication.

Development and release verification (not required to open a delivered file):

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
pnpm package:pack
pnpm release:check
```

The active source consists of `apps/html-cli` and `packages/html-*`. Packaging
bundles the CLI and its parsed HTML/CSS dependencies, with no install-time
scripts or runtime package dependencies. The trusted runtime is embedded in the
HTML. Default system fonts avoid mandatory font downloads.

Historical implementation and assertions are preserved under `archive/legacy`
and in Git history; they are outside the new build, dependency graph and tarball.
See [retirement record](docs/html-first/evidence/h05/IMPLEMENTATION.md).
