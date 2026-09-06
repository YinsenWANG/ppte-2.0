---
name: ppte
description: Create native HTML/CSS presentations and deliver one self-contained HTML using the local PPTe HTML-first enhancer.
metadata:
  requires:
    bins: ["node"]
---

Use the current Agent to understand materials, verify facts and write ordinary HTML/CSS. Do not start an MCP server. No second model, model key, Python, Office tool or browser installation is required for static generation.

Use the installed `ppte enhance /workspace/draft.html --out /user/作品.html`. Install the candidate and this skill once following README.md; reuse them on subsequent requests. Do not install browsers or fonts during ordinary generation.

1. Read the actual materials using the Agent's existing tools. Preserve facts, citations and meaningful text. Consider at most two style directions, choose one, then write the complete HTML directly. Continue directly within existing user authorization; making the presentation authorizes routine design choices.
2. Use native Grid, Flex, typography, gradients, SVG, images and tables. Mark pages with `data-ppte-slide`; otherwise the whole body becomes one page. Optionally supply stable `data-ppte-id` values; the program deterministically fills missing IDs. Keep text as text. Do not turn the design into a layout recipe or another presentation representation.
3. Place authorized local media and CSS beneath the draft directory. CSS imports and URLs, images, video posters and font bytes are embedded by the program. Prefer system Chinese fonts and original lightweight SVG. Do not generate Base64 by hand or download full font families by default. Remote resources, paths outside the input directory, executable HTML and unsupported resource forms fail explicitly; fix the source before delivery.
4. Run the enhancer once. JSON output is a short summary. A nonzero exit or `ok:false` means failure. The output must be a new `.html`; existing files are never overwritten by this generation command. Keep draft/source material in the workspace, outside the user output directory.
5. When browser tools are already available, inspect the full presentation for overflow and layout. Otherwise report visual verification as unverified. Perform at most two automatic local repair rounds as an absolute ceiling; the HTML-first path allows at most one necessary correction and then reports remaining issues. Never delete facts or shrink all text to satisfy a gate.
6. Return only `作品.html`. Do not automatically deliver reports, PDF, ZIP, an editor copy or project sidecars. This file already contains the trusted viewing runtime and its single persistent source template.

For editing, run `ppte edit /user/作品.html`: the loopback service binds the original file, autosaves after an input pause, and retains recovery versions in the application cache. Keep the process running. Only a confirmed file write means saved. Direct file opening supports reading/presentation; without file write permission edits are drafts until explicitly saved. PDF is optional through More → Export PDF using browser printing. Do not claim untested Safari or native file-picker behavior as verified.

Preserve selected-node IDs, author CSS, source notes and locked content when making requested HTML changes. Never regenerate a whole deck to change one sentence. Existing HTML is not upgraded automatically; enhancement refuses to overwrite any existing output.
