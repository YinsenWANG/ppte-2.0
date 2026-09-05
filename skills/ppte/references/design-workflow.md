# Progressive native design

Run `ppte design list` for a lightweight index and at most three candidates. Optional `--query` filters candidate summaries; `--limit` is 1..3. Then run `ppte design inspect business` (or another listed ID). This returns that style's design rationale, unsuitable cases, rules, licenses and full executable recipes. Do not preload the whole library. `ppte schema design` is the command contract; `ppte schema presentation` remains the content contract.

Write `workflow.json` with this structure, replacing input with the complete real authoring envelope described in [authoring.md](authoring.md):

```json
{
  "style": "business",
  "usage": "present",
  "stage": "representatives",
  "representativeKeys": {"cover":"opening", "body":"explanation", "data":"results"},
  "input": {"presentation": {"irVersion":"1.0", "title":"Actual title", "narrative":[], "slides":[]}}
}
```

The skeleton's empty slides deliberately fail validation; it is not finished material. Choose three distinct existing keys: a cover, a body, and a metrics/chart/comparison/table page with the actual complex material. Preserve numbers, source/fact IDs, images and explicit semantic keys. Fit declared capacities; do not invent filler, delete important facts, or silently shrink typography. `usage` records present/read intent; author density appropriate to that usage, with no claim of automatic density conversion.

```sh
ppte new representatives.ppte
ppte design plan representatives.ppte --args workflow.json --out representatives.plan.json
ppte design preview representatives.ppte --plan representatives.plan.json --out representatives.review.json
ppte design apply representatives.ppte --preview representatives.review.json
ppte design validate representatives.ppte
ppte export representatives.ppte --format png --slide slide_1 --out cover.png
```

Export/inspect each representative, including body and data. Report unsupported rendering or unavailable image inspection as `unverified`; structural validation is not visual approval. Planning returns a DesignPlan, bounded candidate report, proposed Transaction and resource bytes. An infeasible result has `ok:false` and no transaction: retain that report, correct the actual input, and do not apply it. The compiler does not create a second model or require network credentials.

Change `stage` to `deck`, retain the same full input and representative keys, and use a new `presentation.ppte` with the same plan → preview → apply sequence. Planning only accepts empty projects, so it cannot replace human edits. Compare the complete slide/block/source inventory against the original material. Review preview issues and scope; apply directly if existing authorization covers the work. `--confirmed` is for a confirmation requirement already satisfied by user authorization, not a mandatory extra question.

After rendering the whole deck, use `ppte tool ... apply_layout_recipe`, `regenerate_selection`, or typed edits for the smallest requested scope. These return proposals and respect locked/protected objects and current content. Save each proposed transaction separately:

```sh
ppte design preview presentation.ppte --transaction repair-1.json --out repair-1.review.json --round 1
ppte design apply presentation.ppte --preview repair-1.review.json
ppte design validate presentation.ppte
```

At most two automatic repair rounds (`--round 1`, then `--round 2`); round 0 is initial creation. Keep a report entry for each round with changed object IDs, reason, preview issues, resulting revision and rendered hard-constraint findings. No third automatic round; the CLI rejects round 3. Do not reset the counter to evade the cap. If still failing, retain the last project, receipts and images and report unfinished items. Scope expansion, destructive rebinding or new facts need actual authorization; same-scope work proceeds without repeated approval.

Finally `ppte deliver presentation.ppte` returns the editable copy and delivery evidence. Run `ppte design validate presentation.ppte --artifact <returned-editable-path>` to audit the actual delivered bytes and obtain ArtifactIdentity. Retain both reports and ArtifactIdentity (source/history/resources/runtime/renderer/configuration), plus source material digest, chosen style/recipe references, representative results and repair log. `design validate` is a structural snapshot report, not an export certification. Never label unknown visual or Office checks as passed; Office real-open/edit/resave remains `unverified` until actually tested. Return the primary editable artifact and `.ppte` source with remaining issues. Do not claim npm publication or git push when only local delivery ran.
