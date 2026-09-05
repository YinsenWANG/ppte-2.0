# E08 Run font contract

Run `marks.fontFamily` accepts a literal family or a theme font-family token;
`marks.fontSize` is a finite positive number in canvas du, like `TextStyle.fontSize`.
An absent mark inherits the effective TextStyle (preset, object override, token).
Explicit Run overrides take priority. `null` is only a formatting-command sentinel:
setting a mark to null deletes it. Clear formatting deletes both new overrides and
all existing marks. Persisted nulls, unknown keys, malformed tokens and non-positive
or non-finite sizes are rejected by the shared literal-reader validator.

Mixed values compare explicit overrides. Inheritance and an explicit override of
the same current value are mixed, because changing the object style affects them
differently. A collapsed selection records pending marks without a transaction;
the next insertion applies them. Nonempty selections preserve outside content,
unaffected Run IDs and paragraph IDs. All durable updates use `text.replaceContent`
through the Operation Engine, including shared Host/Portable controls and rich paste.
Font controls accept `@font.run` token syntax and an empty value restores inheritance.

The complete `ppte-2.1-text-run.1` descriptor requires format 2, schema 2.1.0,
operation protocol 1.1, Slide IR 1.0, Portable runtime 2.1.0, layout recipe 1.0,
widget ABI 1.0, patch 1 and ga-c. Its capabilities include every edit.1 capability
plus `text-run-font`. The edit.1 descriptor remains frozen. No operation envelope
or history container version changed.

The package descriptor declares the minimum reader schema; saving does not rewrite
the snapshot's `schemaVersion` field or canonical revision. The 2.1 reader accepts
both 2.0.0 base snapshots with the registered extension and explicitly declared
2.1.0 snapshots. This preserves exact inverse proofs across the first use of a Run
mark. A base version string alone is never authorization to ignore unknown fields:
the frozen old literal Run schema rejects these fields, and its package manifest
schema rejects the new descriptor. New writers infer the requirement from current
Runs, inserted content, forward history, persisted inverses, redo and patches.
Unrelated component props do not require Run capabilities. Unsupported explicit
old targets fail; no lossy downgrade mode is claimed. Unstyled old snapshots keep
the old descriptor, reference measurement path and rendered layout.

`resolveRunFont` / `effectiveRunStyle` resolve the same family token and size for
coverage, deterministic reference measurement, HTML, SVG, live DOM and native PPTX.
Coverage checks each Run's text against its requested font, including missing theme
tokens and CJK outside subset coverage. Mixed-size reference lines account for each
glyph advance and the largest font on each line. Browser measurements and PDF/PNG
use the actual rendered HTML. PPTX writes per-Run sizes and Latin/East Asian/complex
script typefaces. Capability reports retain requested Run families/sizes and still
report Office font substitution: source font bytes are not embedded in semantic
PPTX. Reference glyph advances and SVG paragraph layout are not a replacement for
browser shaping or an Office fidelity certification.

Executable evidence is in `tests/text-run-style-profile.test.ts` (A03/A08/A13/A17).
The frozen reader fixture is extracted from task-start commit
`4eb6dd9770b1d4ca1349cce2f412a3a1fc00d21b`; it contains the old Run marks subschema and
complete manifest schema. It is repository-owned synthetic test material.
Browser tests write screenshots and Playwright traces to `artifacts/e08/`.
Verification counts, build identity and artifact digests are recorded separately in
`docs/evolution/quality/e08-verification.json` when verification completes.

Actual PowerPoint, Keynote and LibreOffice editing/re-save are unverified; tests
inspect native text XML and exercise Chromium rendering. No client fidelity claim
is made. Real Safari, physical IME and low-performance hardware are also unverified.
