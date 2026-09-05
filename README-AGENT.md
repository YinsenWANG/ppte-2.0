# PPTe: Skill + npm CLI

The recommended integration is the native `ppte` Skill plus a file-based CLI. The existing host Agent reads materials and writes Presentation IR; PPTe compiles, validates, previews, commits and delivers deterministically. It does not start another Agent, store model credentials, listen on a port, or require an MCP daemon.

## Build and install

```sh
pnpm install --frozen-lockfile
pnpm package:pack
npm install -g ./artifacts/ppte-cli-0.7.0.tgz
ppte --help
```

The tarball is locally installable. It has **not** been published to the npm registry; do not run `npx ppte-cli` against an unrelated public package. `npm exec --package=/absolute/path/ppte-cli-0.7.0.tgz -- ppte --help` is an alternative to global installation.

Install the same native skill in the directory your Agent scans, for example:

```sh
ppte skill-install --out ~/.codex/skills/ppte
# Claude Code example:
ppte skill-install --out ~/.claude/skills/ppte
```

Other hosts can use the same SKILL.md when they support native skills and local shell execution. Configure their documented skill directory; MCP remains available when the host only exposes MCP tools. Live end-to-end runs in each named Agent client are a separate integration gate.

## File workflow

```sh
ppte compile design.json --out presentation.ppte
ppte inspect presentation.ppte
ppte preview presentation.ppte --transaction edit.json --out review.json
ppte commit presentation.ppte --preview review.json
ppte deliver presentation.ppte
ppte host --out editor.html
```

The primary deliverable is `presentation.editable.ppte.html`: open in a browser, edit, save an editable copy, reopen. `.ppte` remains the semantic source project and opens in the Host. The CLI gives exact paths and roles in its JSON response.

`ppte schema presentation`, `ppte schema slide`, `ppte schema transaction` and `ppte schema query_elements` provide contracts. Use `--args file.json` for tool arguments. Preview is read-only; commit binds the preview to both the transaction and current revision. Concurrent writers receive `PROJECT_BUSY`; stale previews receive `REVISION_CONFLICT`. Undo/redo persist in the project between CLI processes.

Compilation, validation, editing and HTML delivery require only Node and the package's small runtime dependency. PDF/PNG and raster PPTX exports additionally need Playwright and Chromium:

```sh
npx playwright install chromium
ppte export presentation.ppte --format pdf --out presentation.pdf
```

## Optional MCP adapter

MCP is retained for clients that expose MCP tools but cannot invoke a shell. It shares the same Core and file adapter. A client configuration can still launch:

```json
{"command":"node","args":["/absolute/checkout/dist/apps/mcp/index.js","/absolute/path/presentation.ppte"]}
```

Use `--readonly` to remove mutation tools. A writable MCP session detects when another client changes its file and rejects stale mutations; reopen the session to inspect the new revision. The CLI has no persistent session and reopens the source each time.

| Decision | Skill + CLI | stdio MCP |
|---|---|---|
| Setup | Install package and native skill | Configure a server in each host |
| Discovery | CLI help, JSON schemas, skill references | Typed tool discovery in the client |
| Lifetime | Short process per invocation | Usually a child process per session |
| State | Versioned project, persisted history, preview receipt | In-memory session plus checkpoints |
| Permissions | Host shell permissions plus Core scope/contract | Client tool permissions plus Core scope/contract |
| Best fit | Local file authoring and batch workflows | MCP-only hosts and repeated low-latency calls |

A Skill is guidance, not an access-control boundary. Validation, locks, scopes and revisions are enforced by the executable. The CLI removes a transport dependency; it does not replace the browser editor needed for manual changes.
