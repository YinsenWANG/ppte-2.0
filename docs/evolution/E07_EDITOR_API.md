# E07 offline editor entry points

Host and full Portable share page navigation, stage, selection formatting and object
properties. Native disclosure summaries collapse pages/properties; Enter/Space
activate them and Escape closes the focused disclosure. File controls are keyboard
focusable. Portable quick-fix/light-edit keep their capability limits.

Browser integrations should call `PPTEHost.enterEdit()` or
`PPTEPortable.enterEdit()` before issuing edits. A viewer refuses enterEdit; this
method never grants capabilities. `setTextMarks(patch)` additionally requires an
active text editing session and a remembered DOM selection (focus the text, then
select the exact range). Without a text session it fails; it must not guess a range.
During presentation all writes remain guarded. No new API implicitly leaves
presentation to perform a write.

```js
const editor = window.PPTEPortable;
if (!editor.enterEdit().ok) throw new Error('This copy cannot be edited');
const target = { elementId: 'text_title' };
const revision = editor.getRevision();
const result = editor.editText(target, 'Updated title');
if (!result.ok) throw new Error(JSON.stringify(result.issues));
editor.undo();
editor.redo();
editor.saveAsEditableCopy(); // downloaded independent HTML, not source overwrite
```

Legacy `PortableRuntime.editText(target, value, baseRevision?)` keeps the optional
revision argument. Browser `editText(target, value)`, selection, geometry, preview,
commit, undo/redo and save aliases keep their signatures. Plain text replacement
preserves untouched rich text through editRichText. Property and gesture planners
produce typed Operations; EditorController/Core alone commit and own history.
Host legacy inspector style controls delegate to the shared property planner.

Create a project with Host New or the CLI, then deliver its full Portable copy.
Portable is an independent editable document, not a project picker or live source
connection. Save HTML and reopen it directly; export the source .ppte for Host or
CLI PDF/PPTX export. No Office fidelity or physical IME verification is implied.
