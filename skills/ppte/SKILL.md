---
name: ppte
description: Create, inspect, precisely edit, and deliver editable PPTe presentations using the local PPTe CLI. Use for .ppte projects and PPTe browser copies; ordinary PowerPoint editing is outside this skill.
metadata:
  requires:
    bins: ["node"]
---

Use the installed `ppte` CLI, or `node /path/to/ppte-2.0/dist/apps/cli/index.js` in a built checkout. Do not start an MCP server. Run `ppte --help` and `ppte schema` when discovering an unfamiliar command. Commands return JSON; a nonzero exit or `ok:false` is a failed operation.

## Create a presentation

Read the user's actual source material using the host Agent's existing file, PDF, image and research tools. You are the authoring model: develop the narrative, preserve factual values and citations, and write a Presentation IR design. PPTe does not supply another model or API key.

Read [references/authoring.md](references/authoring.md) for the design input contract. Use `ppte schema presentation` and `ppte schema slide` for field definitions. Choose layouts to fit the material; do not duplicate one page to satisfy a requested page count. Keep titles, facts, source references and other important content as semantic objects. Images are embedded assets, never arbitrary document scripts.

1. Write the design to a JSON file.
2. `ppte compile design.json --out presentation.ppte` validates the whole design, compiles it through the Design Compiler and commits through Core. Fix any errors against the same material; never relabel a placeholder as successful AI generation.
3. Inspect the resulting slides and validation issues with `ppte inspect` and `ppte tool`. Render/export representative slides and visually inspect them if the host supports image inspection. Verify cited numbers, reading order, overflow and actual page variety.
4. `ppte deliver presentation.ppte` produces the editable browser copy. Return the artifact marked `primary:true`; retain `.ppte` as the source project. A `.preview.html` is not a deliverable.

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
