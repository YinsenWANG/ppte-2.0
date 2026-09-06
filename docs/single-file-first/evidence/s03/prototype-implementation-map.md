# S03 prototype → implementation map

Reference: `docs/html-first/PLAN.md` §6 and `docs/html-first/UI_PROTOTYPE.html`.
This is an implementation inventory, not a human approval of prototype fidelity.

| Prototype requirement | Product implementation | Actual verification | Remaining acceptance |
| --- | --- | --- | --- |
| Quiet shell, document name, save state, history, mode, presentation, more | Existing S01/S02 shell retained; S03 does not alter save claims | Existing H03 contrast/focus tests, S01 entry and S02 save tests remain unchanged | Human visual review pending |
| Thumbnails/page number/add, collapsible left sidebar | `workspace.ts` canvas controls toggle thumbnails; add inserts after the current slide | `single-file-editing.test.ts` both journeys; `cell-context.png` | Human review pending |
| Canvas zoom at bottom | Ephemeral iframe transform, 25–150%, reset; content DOM and print measurements stay unscaled | Real mouse zoom/collapse preserves focused property input and text selection; all reopened pages present while zoomed | Native IME and Safari pending |
| Selection outline and control handles | Existing outline plus pointer/keyboard size handle for unlocked nontext objects; command history and protection reused | Real shape resize from 60 to 90 px and undo; `shape-handles.png` | Human usability/handle fidelity pending; no claim of eight handles or full rotation handle parity |
| Nearby contextual text tools | Floating format bar positioned relative to selection, follows iframe scroll/viewport changes; pointer formatting retains text range | Real click + arrow-key range in td, bold span assertion; `cell-context.png` | Human review pending; palette remains in adjacent property panel |
| Image/shape/table relevant controls | Existing media/shape commands retained; cells expose text formatting and table structural commands together | Existing H03 selection/media/table tests unchanged; new cell range journey | S06 media insertion/crop scope untouched |
| Accurate page background | Computed color or complex shorthand and explicit transparent/complex state; read-only until change | Red, gradient, transparent values before/after download/reopen; content equality on inspection; undo restores transparency | Other author CSS/browser combinations pending |
| Audience view hides editing controls | Existing player suspend/resume plus unique object selector for active slide | Two consecutive additions, undo/redo, download, all six reopened slides individually presented | Safari pending |

The editor retains native continuous document flow rather than rebuilding author HTML into a new scene representation. There is no assertion that this is pixel-identical to the prototype. No scope adjustment or final design approval has been obtained from the user.
