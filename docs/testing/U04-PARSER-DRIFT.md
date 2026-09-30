# Historical PDF parser replay

The current contract is single-file-first HTML/CSS, offline editor/presenter.
PDF export remains unfinished and disabled. These tests replay development
PDFs; neither a passing replay nor corrected parser output qualifies a product
PDF route or native/human acceptance.

The historical F04A/U04 PDFs, JSON, raster evidence and decisions remain unchanged.
U04 recorded macOS Darwin 25.6.0 on 2026-09-08. Replay on macOS 27.0.1,
Darwin 27.0.0 (build 26A434), with the same PDF bytes, independently reproduces
all six MuPDF texts/searches and all six PDFKit searches. Four PDFKit texts
remain exact. Both original `fixtures-04` Chromium variants now extract
`变换后的中文 Text` where the frozen PDFKit output extracted
`变换后的中文 T ex t`. F04A has the same extraction change in the standalone
transformed page. Its frozen merged PDF already extracted `Text`.

The test helper admits exactly those two complete strings for `fixtures-04` in
the Chromium replay. It does not normalize arbitrary whitespace, omit text,
allow reordering, or extend this allowance to other fixtures/candidates. Negative
controls reject missing glyphs, unrelated spacing, reordered lines and a trailing
newline. Character count is precisely 43 historically versus 41 currently;
non-whitespace glyph sequence remains equal. Search results stay exact.

F04A retains its recorded whole-document spacing rejection, including
`strictTextAndSizeEqual: false` and the original assessment failure. Live
whole-document equality is required when the standalone extraction has the
observed correction; otherwise the historical rejection must reproduce.
Other failures, overflow/text/color controls and the no-qualified-route gate
remain enforced. An OS parser correction does not rewrite a past observation.

PDFKit character bounds on the transformed page also changed; the four other
historical glyph geometries remain exact. CoreGraphics raster bytes changed for
fixtures-01 and fixtures-04, but not cherry-10. Current replay records these
comparisons in `artifacts/u04-replay/current.json`; it does not assert that these
changed selection bounds or rasters are qualified. U04 A2 still checks all
20 frozen pages with exact MuPDF page sizes, strict quantization rejection,
DOM geometry, recorded PDFKit/MuPDF raster equality, PNG hashes, live full MuPDF
inspection equality, full-text failure diagnostics and unchanged color thresholds.
Historical parser bugs are evidence, not requirements for an OS to retain bugs.

Swift compilation uses an explicit repository-local module cache. Replay
subprocesses have 120-second compile and 15-second inspection limits. This fixes
harness cache confinement, adds bounds, and introduces no product dependency.
The implementation-run raw before/after evidence is in `evidence/`; the requested
parent-directory location was denied by the managed filesystem sandbox.
