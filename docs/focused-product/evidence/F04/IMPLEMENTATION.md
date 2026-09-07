# F04: pending — no qualified PDF route

No PDF product implementation is delivered. F04A concluded **③ neither route qualified**, with canStartF04=false. The [F04 contract](../../PDF-AND-CORE-REVIEW.md) permits implementation only after route qualification; the bounded stop rule prohibits further library trials or a general CSS-to-PDF engine. This task request does not override that prerequisite.

Reviewed in order: PLAN/TASKS, PDF-AND-CORE-REVIEW, b93ffed's actual audit path docs/audits/2026-09-07-main-d1db13d/REPORT.md, and UI DESIGN. Also inspected commit 5987af6 and F04A's implementation and assessment. Existing B1/B2, native saving, media/performance and UI validation gaps are not closed by this record.

## Route evidence and boundaries

The [assessment](../F04A/assessment.json) and [page comparison package](../F04A/COMPARE.html) are historical F04A evidence, not newly generated product PDFs. The browser candidate produces 25 pages from 20 inputs and fails font/layout fidelity. Chromium search/order and transform consistency remain unqualified. See [F04A's report](../F04A/IMPLEMENTATION.md) for openable PDFs, actual font limitations, performance measurement limits and pending manual selection records. Chromium still uses the browser print pipeline.

The existing top-level PDF entry remains disabled. No product code, dependency, service, upload, image-PDF fallback or architecture changed. Additional product capabilities removed: **none**. No further route trials were run.

Conclusion ② / awaiting-user-decision / HOLD does not apply: the external candidate has not passed. Architecture approval cannot substitute for quality qualification. F04 remains pending; reopening bounded validation would require explicit new scope, and any resulting architecture decision must still follow the agreed protocol.

## Acceptance and verification

All four feature acceptance items remain pending at code / automated / real-browser / human layers. [result.json](verification/result.json) records each reason and its existing real regression-test mapping:

| Item | Missing requirement | Existing guardrail, not feature acceptance |
|---|---|---|
| A1 | Qualified route and any necessary architecture authorization | F04A acceptance 4: three decisions and rejection gate |
| A2 | Faithful whole-deck PDF with selectable/searchable/copyable text | F04A acceptance 1–3: reopen real PDFs and retain strict failure assertions |
| A3 | Single PDF, progress/cancel/retry, unchanged editing state | F01 A1/A2: disabled entry and no printing only |
| A4 | Qualified offline single-HTML support | F04A acceptance 2/3: external comparison and explicitly pending native/human evidence |

No new feature means no new mirror or placeholder tests. Existing assertions are unchanged. Repository gate results only establish regression health and correct rejection of failed routes. They do not complete F04. Logs, commands, tested commit, timestamps and platform are recorded in verification/result.json. Physical desktop operations and human PDF visual/selection/copy/search approval remain pending.

The pre-existing brief9-F04.md is preserved byte-for-byte and its exact filename added only to local .git/info/exclude; it is not task evidence. No push.

Final repository gates on signed commit 903dcd1: pnpm typecheck, pnpm build and pnpm test passed; 143 passed, 0 failed, 16 existing skips (159 tests). No feature acceptance status changed. This evidence-only follow-up records that run.
