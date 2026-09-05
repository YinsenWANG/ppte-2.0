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
