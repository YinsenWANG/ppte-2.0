# PPTe HTML-first

Create a presentation as native HTML/CSS, deliver one self-contained HTML,
edit it with `ppte edit 作品.html`, and autosave back to the original file.
Open that file again to read or present; PDF is an explicit browser print action.

See [installation, workflow and recovery](README-AGENT.md) and the authoritative
[HTML-first plan](docs/html-first/README.md). This is a local candidate, not an
npm publication. H00/H02/H04/H06 retain their documented real-browser and human
verification gaps; packaging does not close those gaps.

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
