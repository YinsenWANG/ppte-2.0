---
name: ppte
description: Create, inspect, precisely edit, and deliver editable PPTe presentations using the local PPTe CLI. Use for .ppte projects and PPTe browser copies; ordinary PowerPoint editing is outside this skill.
metadata:
  requires:
    bins: ["node"]
---

Use the installed `ppte` CLI, or `node /path/to/ppte-2.0/dist/apps/cli/index.js` in a built checkout. Do not start an MCP server. Run `ppte --version` and record the application version with delivery evidence; the installed package’s `build-manifest.json` identifies the exact runtime bytes. Application semver is separate from file and Portable profiles. Run `ppte --help` and `ppte schema` when discovering an unfamiliar command. Commands return JSON; a nonzero exit or `ok:false` is a failed operation.

## Create a presentation

Read the user's actual source material using the host Agent's existing file, PDF, image and research tools. You are the authoring model: develop the narrative, preserve factual values and citations, and write a Presentation IR design. PPTe does not supply another model or API key.

Read [references/authoring.md](references/authoring.md) for the design input contract. Use `ppte schema presentation` and `ppte schema slide` for field definitions. Choose layouts to fit the material; do not duplicate one page to satisfy a requested page count. Keep titles, facts, source references and other important content as semantic objects. Images are embedded assets, never arbitrary document scripts.

1. Extract the audience, present/read usage, objective, verified facts/sources and available assets from the actual material. Read the lightweight index with `ppte design list`; consider at most three candidates, then `ppte design inspect <selected-style>` for that style's design rationale, exclusions and executable recipes. Do not load all recipe bodies.
2. Read [references/design-workflow.md](references/design-workflow.md) only when entering design planning. Author real cover, body and complex-data representatives from the same brief, then plan → preview → apply them in a scratch project. Inspect rendered representatives before compiling the full deck. If image inspection is unavailable, record `unverified` and the limitation.
3. Continue directly within existing user authorization; “make the deck” authorizes choosing a style and proceeding. Do not add a mandatory style-approval pause. Compile the full material in a separate fresh project, review its proposed transaction and apply through the same preview/commit engine.
4. After rendering, perform at most two automatic local repair rounds. Record changed object IDs, reasons and hard-constraint results per round. Retain reviewable artifacts and list unresolved failures when the cap is reached; never loop indefinitely or remove facts to pass.
5. `ppte design validate presentation.ppte` reports structural checks separately from visual/Office `unverified`. `ppte deliver presentation.ppte` produces the editable browser copy. Return its `primary:true` artifact, retain `.ppte`, and attach the delivery report with its actual artifact identity. A `.preview.html` is not a deliverable.

Legacy `compile`, `preview`, `commit` and `deliver` remain available. The native workflow uses the current Agent and local CLI, with no MCP server, additional model or model key.

## Edit an existing project

Inspect the relevant document, slide and elements before writing. `ppte tool project.ppte query_elements --args query.json` and `ppte schema query_elements` expose semantic IDs. A generated layout/regeneration tool returns a proposed Transaction rather than silently writing it.

Use the smallest requested scope. Both human and Agent modifications pass through typed Operations; preserve non-target content and respect locked elements, source/fact references and edit policies. Read [references/editing.md](references/editing.md) for a text-edit example.

- `ppte preview project.ppte --transaction edit.json --out review.json [--scope scope.json]` checks the actual diff without modifying the project.
- Review the changed paths, issues and confirmation requirement. Obtain confirmation only when the requested scope or existing user authorization does not already cover the change.
- `ppte commit project.ppte --preview review.json [--confirmed]` commits exactly that reviewed revision and saves it. Use `--confirmed` only when confirmation is actually satisfied.
- Inspect the result and deliver a new editable copy. Replacing an existing derived copy requires `--replace-existing --confirmed`; do not overwrite an unrelated recipient's edits.

`REVISION_CONFLICT` means inspect and preview again. `PROJECT_BUSY` means another writer owns the project lock: retry after it exits; do not delete a live lock. Preserve the original diagnostic if an operation fails. Undo and redo take the current `--expect-revision` and survive CLI process restarts.

## Delivery and boundaries

`ppte host --out editor.html` provides an offline editor that opens `.ppte`. `ppte export` supports PDF, PNG and PPTX; rendering exports require Playwright/Chromium. Report the returned degradation details, especially static chart fallbacks and font limitations. Basic compile/edit/deliver commands need no browser installation, network connection, model configuration or daemon after the npm package is installed.

The standalone HTML is an editable local copy, not a live connection to the source. Use the review/patch tools to reconcile revised copies; do not claim cloud sync or multiplayer collaboration. MCP remains an optional adapter only for hosts that require typed MCP tools and cannot execute a CLI.

For candidate installation, independent release status, history recovery and rollback, read [M0 migration notes](references/m0-migration.md).
