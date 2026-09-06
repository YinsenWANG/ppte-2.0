# PPTe HTML-first candidate

> Active development handoff: [single-file-first 1.1](docs/single-file-first/HANDOFF.md), [plan](docs/single-file-first/PLAN.md), [tasks](docs/single-file-first/TASKS.json). These are pending implementation requirements from user review plus audit `ea260ce`, and override conflicting default-service instructions below. The target is direct use of one `.ppte.html`; do not claim that the existing candidate has already completed this plan.

Write ordinary HTML/CSS, enhance it once, deliver **one HTML**. The HTML is the
work, editable source and presentation entry. Use Node.js 22 or newer. Basic
generation has no runtime npm dependencies, browser download, Python, Office,
model key or MCP service. This candidate is not a registry publication.

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
ppte enhance /workspace/draft.html --out /user/作品.html
ppte edit /user/作品.html
```

Keep drafts and source media in the workspace. Enhancement embeds authorized
local resources, preserves native CSS, and refuses existing output files.
No PDF or sidecar is produced. The summary reports visual checks as unverified;
use already available browser tools for optional layout inspection.

`edit` opens the same HTML in a loopback editor bound to its original path.
Keep the process running. Edits autosave after about 800 ms of inactivity;
“已保存到原文件” requires a successful write. Stop and repeat the same command to
reopen the original; the session link rotates. Directly opening HTML supports
reading and clean presentation. Without file write permission, browser drafts
are not original-file saves. Native Safari/file-picker journeys remain pending.

## Optional PDF

Open the HTML in an installed browser, choose More → Export PDF, and use the
browser print dialog. This toolchain is separate from Node-only generation.
No automated PDF dependency is installed with the package. The repository's
`node --test dist/tests/html-player.test.js` separately exercises actual Chrome
printing and macOS PDFKit page/text inspection. It requires development
Playwright, Chrome and macOS Swift/PDFKit; it is not an install prerequisite.

## Recovery and rollback

Save conflicts stop writes: reread the disk version or preserve your draft
before retrying. The editor's recovery versions live in the application cache
(`~/.local/share/ppte-html`); use “恢复上一版本” through the recovery UI. Never delete that cache before recovering work.
No interruption or power-loss guarantee beyond the recorded H02 tests is implied.

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
