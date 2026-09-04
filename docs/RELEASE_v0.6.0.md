# PPTe 2.0 v0.6.0 — Bounded Completion Release (2026-09-04)

Baseline: v0.5.0 (reference core, GA-C validated). This release closes the five
plan items explicitly listed as "still not implemented" in 0.5.0, as approved
by the CEO ("把没做的全部做完"). Design-frozen boundaries (CRDT, multi-user
collaboration, Run-level font styling, nested Groups) are unchanged — they are
ADR decisions, not gaps.

## What was added

| Capability | Implementation | Boundary |
|---|---|---|
| Controlled Video Widget (`core/video@1.0.0`) | Local source metadata + poster/static fallback in the semantic document; checkpoint round-trip preserved | Network/data/javascript sources rejected at registration; offline surfaces degrade to poster with explicit element-scoped report — not native playback |
| Native PPTX charts | Bar/Line/Pie exported as real PowerPoint chart parts (categories + numeric values round-trip via python-pptx); capability items marked `nativeChart: true` | Area/Donut remain static/degraded (reported as such) |
| `full-portable` profile | Self-contained `file://` editor: multi-selection, single-element Move/Resize/Scale/Rotate, Crop, Chart Data, Undo/Redo, Save-as-new-project | All persistent edits go through the existing Session Operation Engine; no second mutation path |
| Group Rotate | Explicit per-member frame + `rotationDeg` materialization with exact inverse | No group frame/transform/coordinate system introduced (ADR-006 preserved) |
| Bounded legacy import | Slidev/Markdown **text** → semantic heading/body Text (deterministic markup cleanup); JSON-compatible semantic snapshot migration | Raw markup is never executed or retained as a runtime document source; unsupported formats rejected with explicit migration report |

## Gate evidence (re-run at release time)

- `node scripts/blackbox-gates.mjs --report`: **16 groups, 62 green / 0 red**
  (11 previous groups + video-widget, pptx-chart, full-portable, group-rotate,
  legacy-import; section-41 A–J included)
- `npm run typecheck` / `npm test` / `npm run validate`: pass
- Independent verification by the orchestrator (not the implementation agent):
  cumulative milestone `legacy-import` green 62/0; capability claims spot-
  checked against source (video source rejection, rotate inverse, native chart
  part assertion).

## Still not implemented (unchanged frozen boundaries)

CRDT; multi-user/real-time collaboration; nested Groups; Run-level font or
font-size styling; full legacy markup/runtime import; browser/OS pixel-matrix
lab; direct writes bypassing the Operation Engine.

## Commits

`3e7c3ba` legacy import · `73ebe0c` group rotate · `403dd72` video widget ·
`4016712` native pptx charts · `1e698ab` full-portable · plus gate/docs
commits (`6a370bc`, `c6ec1d8`, `7aa3fa0`, `f9291be`, `dc14a08`).
