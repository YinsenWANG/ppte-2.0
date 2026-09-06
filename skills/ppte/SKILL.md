---
name: ppte
description: Create native HTML/CSS presentations and deliver one self-contained .ppte.html using the local PPTe HTML-first enhancer.
metadata:
  requires:
    bins: ["node"]
---

Use the current Agent to understand materials, verify facts and write ordinary HTML/CSS. Do not start an MCP server. No second model, model key, Python, Office tool or browser installation is required for static generation.

Use the installed `ppte enhance /workspace/draft.html --out /user/作品.ppte.html`. Install the candidate and this skill once following README.md; reuse them on subsequent requests. Do not install browsers or fonts during ordinary generation.

1. Read the actual materials using the Agent's existing tools. Preserve facts, citations and meaningful text. Consider at most two style directions, choose one, then write the complete HTML directly. Continue directly within existing user authorization; making the presentation authorizes routine design choices.
2. Use native Grid, Flex, typography, gradients, SVG, images and tables. Mark pages with `data-ppte-slide`; otherwise the whole body becomes one page. Optionally supply stable `data-ppte-id` values; the program deterministically fills missing IDs. Keep text as text. Do not turn the design into a layout recipe or another presentation representation.
3. Place authorized local media and CSS beneath the draft directory. CSS imports and URLs, images, video posters and font bytes are embedded by the program. Prefer system Chinese fonts and original lightweight SVG. Do not generate Base64 by hand or download full font families by default. Remote resources, paths outside the input directory, executable HTML and unsupported resource forms fail explicitly; fix the source before delivery.
4. Run the enhancer once. JSON output is a short summary. A nonzero exit or `ok:false` means failure. The output must be a new `.ppte.html` by default (explicit legacy `.html` output remains supported); existing files are never overwritten by this generation command. Keep draft/source material in the workspace, outside the user output directory.
5. When browser tools are already available, inspect the full presentation for overflow and layout. Otherwise report visual verification as unverified. Perform at most two automatic local repair rounds as an absolute ceiling; the HTML-first path allows at most one necessary correction and then reports remaining issues. Never delete facts or shrink all text to satisfy a gate.
6. Return only `作品.ppte.html`. Do not automatically deliver reports, PDF, ZIP, an editor copy or project sidecars. This file already contains the trusted viewing runtime and its single persistent source template.

Use the file directly in a supported browser (file://): the contract makes it the work, editor and presenter without Node, network or a service for readers. Existing `.html` remains readable. The loopback recommendation is retired, including as a required fallback. Original-file autosave requires actual write authorization and confirmed close/readback; otherwise provide full editing and a complete updated-file download. Drafts/downloads are never saved to the original file; download initiation is not proof of disk completion.

S01/S02 acceptance partial: Direct-open controls are implemented; native browser and capability-based save acceptance remains incomplete. `ppte edit FILE` now opens the file and exits; `ppte serve FILE` is an explicit development-only service. Do not recommend that legacy command as the main entry or claim it proves single-file acceptance. PDF is optional through More → Export PDF using browser printing. Safari, native file-picker and human acceptance remain pending.

Preserve selected-node IDs, author CSS, source notes and locked content when making requested HTML changes. Never regenerate a whole deck to change one sentence. Existing HTML is not upgraded automatically; enhancement refuses to overwrite any existing output.
