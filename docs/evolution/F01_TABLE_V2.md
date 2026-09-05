# F01 Table v2 model and operation contract

F01 keeps tables as `ComponentElement` with `componentType: core/table` and
`componentVersion: 2.0.0`. Its props are the complete `TableModel`, with `version: 2`.
Rows, columns and cells have immutable caller-assigned IDs scoped to the component;
orders contain IDs, and each row/column pair has exactly one cell. Axis sizes are
positive document units. Headers live in column labels; caption is retained.

## Data, merges and display

Cell value is a JSON scalar. General display stringifies strings, booleans and
numbers and displays null as empty text. Number-only `percent` and `fixed:2`
formats derive display from the value. Optional rich text is allowed only for a
string cell whose paragraph text matches that scalar exactly. Setting a value
clears previous rich text and display format unless replacements are supplied.

Merges name an anchor cell and consecutive ordered row/column ID ranges. The
anchor is the top-left cell. The anchor supplies the displayed value; all covered
cells, styles and fact/source references remain stored and become visible on
split. Overlapping, nonrectangular and misanchored merges fail atomically. Axis
changes that break a merged rectangle require an explicit split first. Empty
axes are supported; malformed/ragged v1 input is rejected without padding or
silently discarding data.

## Operation Engine and migration

`planTableOperation` produces a scoped transaction and removed-reference cell ID
list for both UI and Agent callers. Supported kinds are `table.migrate`,
`table.setCellValue`, `table.setCellStyle`, `table.insertRows`, `table.deleteRows`,
`table.moveRows`, the corresponding column operations, `table.resizeRows`,
`table.resizeColumns`, `table.mergeCells` and `table.splitCell`. Move indexes refer
to the remaining axis after removing the selected IDs. Insertions supply new axis
records and all corresponding cells; IDs are never derived from current positions.

`migrateTableV1` is a pure proposal helper with a migration report. Only
`table.migrate` commits the proposal. It preserves the source element ID, scalar
types, headers and caption, creates deterministic initial IDs, and rejects unknown
v1 props rather than dropping them. No file is overwritten by migration.
`table.restore` is the typed full-snapshot inverse, including component version;
undoing migration restores the exact v1 representation. Core proves serialized
inverse revision equality before any commit.

The same validator covers generic props replacement/merge, element insertion,
slide insertion, typed restore, document validation and both checkpoint writers.
Deletion of any cell fact/source binding, including through generic props or
whole-element/slide deletion, requires an impact-review Change Contract.
The planner names affected cell IDs and requests confirmation; a contract that
preserves facts cannot authorize removal. Unrelated table elements are outside
its selection scope. Covered cells remain visible to fact/source indexes.

## Persistence and capabilities

`ppte-2.1-table.1` declares format 2, schema 2.1.0, operation protocol 1.1,
slide IR 1.0, runtime subset ga-c, Portable runtime 2.1.0, layout recipe 1.0,
widget ABI 2.0 and patch 1. It contains the text-run profile capabilities plus
`table-v2`. Profile inference includes document, forward/inverse history,
redo-only history, inserted objects, raw props snapshots and patch operations.
Explicit lower profiles fail rather than losing data. Unknown profiles fail.
The independent document schema remains compatible with 2.0.0 documents; the
checkpoint manifest declares the minimum registered capability descriptor.

F01 provides deterministic HTML/SVG anchor-value rendering. The v2 widget declares
static fallback export policy. Rich-text style UI, TSV entry, advanced table
presentation and native Office table export belong to F02/F03; F01 does not claim
native editable Office tables or real-client fidelity.

## Evidence

`tests/table-v2-contract.test.ts` contains ten Node tests covering all three done
criteria, all fourteen operation kinds (including inverse and migration), scalar
and merge behavior, generic bypass negatives, scoped fact/source references,
reviewed deletion, literal JSON Schemas, Host/Portable checkpoint reopening,
redo-only profile requirements, patch replay and a 40-step fixed-seed (`0xf01`)
undo/redo sequence. Full-run results are recorded in the F01 quality report and
TASKS.json after verification.
