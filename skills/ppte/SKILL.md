---
name: ppte
description: Inspect, explain, preview, and safely edit semantic PPTe presentations through the PPTe MCP server.
metadata:
  requires:
    bins: ["node"]
---

PPTe is a semantic presentation format and runtime: slides, elements, facts, sources, assets, theme, and typed Operations are kept as one validated document. With the PPTe MCP server you can inspect structure and validation, demonstrate/render or explain a slide, search content, compare a revised copy, generate a page or layout transaction, and make a bounded local edit.

Use the normal workflow: inspect the document and relevant slide/element first; produce or receive a Transaction; call `preview_transaction`; review its actual diff and issues; call `commit_transaction` only after the preview is acceptable; then call `get_validation_issues` or inspect the changed element/document again. Generated tools return reviewable Transactions, so a generated change is not persisted until it is committed.

Respect the granted scope, element identity, semantic references, and confirmation requirements. Never commit without a successful preview. If a tool fails, report its original result and issue codes verbatim—do not claim success, hide a rejected change, or invent a green verification.

Install and connect the server using the four-agent examples in the repository root [`README-AGENT.md`](../../README-AGENT.md). The command needs Node and a `.ppte` path; use `--readonly` when the agent must not expose mutation tools.
