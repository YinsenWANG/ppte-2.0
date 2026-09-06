# PPTe HTML-first candidate

> Active development handoff: [single-file-first 1.1](docs/single-file-first/HANDOFF.md), [plan](docs/single-file-first/PLAN.md), [tasks](docs/single-file-first/TASKS.json). These are pending implementation requirements from user review plus audit `ea260ce`, and override conflicting default-service instructions below. The target is direct use of one `.ppte.html`; do not claim that the existing candidate has already completed this plan.

Write ordinary HTML/CSS, enhance it once, deliver **one `作品.ppte.html`**.
Default use is **file://**: the file is the work, editor and presenter; readers
require only a supported browser, no Node, installation, network or service.
Node.js 22 or newer is needed only for authoring with the CLI. Basic generation
has no runtime npm dependencies, browser download, Python, Office, model key or
MCP service. This candidate is not a registry publication.

## Independent installation (once)

Build in this checkout: `pnpm install --frozen-lockfile && pnpm package:pack`.
Install the exact local tarball into a separate directory; keep your current
installation and its skill unchanged:

```sh
npm install --prefix "$HOME/.local/ppte-html-candidate" --offline --ignore-scripts /absolute/path/ppte-html-1.0.0-html.0.tgz
"$HOME/.local/ppte-html-candidate/node_modules/.bin/ppte" --help
"$HOME/.local/ppte-html-candidate/node_modules/.bin/ppte" skill-install --out "$HOME/.codex/skills/ppte-html-candidate"
```

Use this absolute command or a shell alias for `ppte`; do not replace the old
global executable. Point your Agent at the installed skill once and reuse it.
Skill installation refuses to overwrite an existing directory.

## One-file workflow

```sh
ppte enhance /workspace/draft.html --out /user/作品.ppte.html
```

Keep drafts and source media in the workspace. Enhancement embeds authorized
local resources, preserves native CSS, and refuses existing output files.
No PDF or sidecar is produced. The summary reports visual checks as unverified;
use already available browser tools for optional layout inspection.

Open `/user/作品.ppte.html` directly in a supported browser (file://).
Existing `.html` remains readable; this naming convention is not a new ZIP/IR
format and does not rename existing files.

Original-file autosave requires actual writable-file authorization, not just API
presence. Confirm a write only after close and readback verification. Without an
API or when permission is denied, the contract requires complete editing and a
complete updated-file download. Drafts/downloads are never saved to the original;
download initiation means “已生成更新文件；原文件未覆盖”, not confirmed download to disk.
Cancellation, conflicts and storage failures must retain edits and disclose the
limitation. Browser storage is a convenience, not a reliable original-file copy.

The loopback recommendation is retired; a service must not become the fallback
for missing browser permissions. **S01/S02 pending:** the current legacy
`ppte edit FILE [--no-open] [--port=PORT]` still starts loopback. Its planned
replacement opens the file in the default browser and exits. Direct-open controls
and capability-based save UX are not yet accepted. Do not present legacy service
journeys as proof of this contract. Safari and native file-picker journeys remain
pending, as does human confirmation.

## Optional PDF

Open the HTML in an installed browser, choose More → Export PDF, and use the
browser print dialog. This toolchain is separate from Node-only generation.
No automated PDF dependency is installed with the package. The repository's
`node --test dist/tests/html-player.test.js` separately exercises actual Chrome
printing and macOS PDFKit page/text inspection. It requires development
Playwright, Chrome and macOS Swift/PDFKit; it is not an install prerequisite.

## Recovery and rollback

Under the new contract, conflicts stop writes: retain/download current edits or
explicitly reread the disk version. A copied/moved file must not silently restore
another file's draft. Reopening must check actual permission again. S02 will
verify these direct-file recovery paths; no power-loss guarantee is implied.

For users recovering work from the **legacy optional service only**, its recovery
versions remain in `~/.local/share/ppte-html`; use “恢复上一版本” through that legacy
UI and keep the cache until recovery is complete. This migration note does not
make the service or its cache a prerequisite for using new files.

To roll back the candidate, stop its editor and restore your previous command
alias and Agent skill selection. You can retain or remove only the isolated
candidate install directory. This does not rewrite HTML or delete user files.
Already generated HTML retains its embedded runtime; reinstalling a package does
not upgrade it. Back up a work before requesting explicit changes to that work.

Legacy tools remain at Git commit `7c1a6c46676566e346edc2af24974752d4288897`
and under `archive/legacy` for historical inspection. For a complete runnable
legacy environment, create a separate detached checkout at that commit and use
its installation instructions. Existing legacy projects stay with that tool;
they are not opened, migrated, removed or rewritten by this candidate.
