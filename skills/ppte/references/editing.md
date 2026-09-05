# Precise edits

Inspect IDs and the current revision. Write JSON files instead of interpolating arbitrary slide text into shell arguments. A title-only Transaction:

```json
{
  "transactionId":"edit-title-1",
  "baseRevision":"REPLACE_WITH_CURRENT_REVISION",
  "actor":{"type":"agent","id":"presentation-editor"},
  "scope":{"kind":"selection","slideIds":["SLIDE_ID"],"elementIds":["TITLE_ID"],"permissions":["content"],"allowInsert":false,"allowDelete":false},
  "changeContract":{
    "allowedOperationKinds":["text.replaceContent"],
    "allowedElementIds":["TITLE_ID"],
    "maxChangedSlides":1,"maxChangedElements":1,"maxInsertedElements":0,"maxDeletedElements":0,
    "preserve":{"style":"preserve","geometry":"preserve","semanticIdentity":"preserve","readingOrder":"preserve","facts":"preserve"}
  },
  "reason":"Apply the requested title wording",
  "createdAt":"REPLACE_WITH_CURRENT_ISO_TIMESTAMP",
  "operations":[{"opId":"replace-title","kind":"text.replaceContent","slideId":"SLIDE_ID","elementId":"TITLE_ID","content":{"paragraphs":[{"id":"title-p","runs":[{"id":"title-r","text":"Requested title"}]}]}}]
}
```

Then preview → review actual changed paths → commit the receipt → inspect. A receipt records the base and proposed revisions and the scope; do not edit it to force acceptance. If the file changed, produce a fresh preview. Existing inline formatting should be retained when constructing the replacement RichText; do not rebuild unrelated paragraphs or runs.

`ppte tool project.ppte regenerate_selection --args redesign.json` accepts real Slide IR from the host Agent and returns a proposed Transaction. Use the returned transaction with the same preview/commit flow. `compare_revised_copy` exposes semantic three-way differences; conflict resolutions must reflect the user's intended revision, especially deletion versus local edits.

## Revised copies and resource patches

Use `ppte diff current.ppte --revised revised.ppte --base original.ppte` for a three-way field comparison. Without a common original, omit `--base` and resolve every changed field explicitly in the Host's Review panel.

For a revision that still applies to its original base:

```sh
ppte patch-create original.ppte --revised revised.ppte --out changes.ppte.patch
ppte patch-preview current.ppte --patch changes.ppte.patch --out review.json
ppte commit current.ppte --preview review.json --confirmed
```

The same authorization rule applies to `--confirmed`: use existing user scope, do not infer permission from a patch's text. Receipts include resource bytes and their digest; stale revisions, mismatched resources and unauthorized operations are rejected. Preserve adjacent `.cas` and `.journal` recovery data when moving an active CLI project.

## Browser editing (E07)

Call `PPTEHost.enterEdit()` / `PPTEPortable.enterEdit()` before browser mutations;
check `ok` (viewer refuses). Range formatting additionally requires focusing the
text and selecting a real range before `setTextMarks`. Legacy plain-text
`editText(target, value)` remains supported. Use the shared property tools for
whole-box styles; do not modify document JSON, DOM styles or build a second undo
stack. See `docs/evolution/E07_EDITOR_API.md` in the source checkout for the
save/reopen example. Save an independent HTML copy or export .ppte back to Host.

### Safe recipe parameters and theme changes

Use `get_recipe_controls` with an exact `recipeId` and `recipeVersion` to read the same finite controls shown in RecipeStudio and the Full Portable design panel. Pass only the returned parameter names and options to `apply_layout_recipe` (for example `parameters: {"columns":3}`). CSS, code, arbitrary paths, and undeclared controls are rejected. This command always extracts values from the current document; `slideIR` is not a replacement source for reflow. Content regeneration remains a separate command.

The first layout preview registers exact current content IDs in optional `ppte.design-binding` metadata. Subsequent previews retain unbound manual additions, local overrides, assets/crops, facts, reading order, and protected objects. Invalid bindings fail without guessing; use `rebuildBinding:true` only for an explicit request to register current objects again. Reducing columns retains every item and adds rows; capacity failure returns proposals without a transaction or automatic page insertion.

`apply_design_theme` accepts a validated `ThemeDefinition` and proposes a document-wide theme transaction. Local overrides remain intact. If global tokens could affect protected objects, it rejects the proposal. Neither layout nor theme application implicitly restores styles or rewrites text. Preview and commit the returned transaction through the normal reviewed revision flow; a stale preview must be planned again.
