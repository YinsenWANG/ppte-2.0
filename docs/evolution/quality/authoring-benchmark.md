# D07 authoring benchmark evidence protocol

D07 is **partial** and G2 is **blocked**. The checked-in report contains no human sessions or generated decks. Passing the contract tests or the blackbox `D07-evidence` case does not pass G2. No visual scores, repair times, Office results or Agent outputs have been invented.

## Fixed inputs

`tests/fixtures/evolution/authoring-benchmark.json` fixes five material categories × presentation/reading, source-backed numerical answers, caveats, audiences, two original Apache-2.0 SVG assets, and ten versioned edit scripts. These are synthetic materials with no private customer data. Any manifest change changes its canonical digest and invalidates previous submissions.

Use baseline and candidate checkouts with the same pinned Agent/model configuration, system prompt, task prompt, material, environment and budget. Record that complete Agent configuration in `agent` (or a digest of a retained configuration), not just a provider name. Execute each task twice using seeds 1701 and 1702; retain both first outputs even when they fail. Never select only the best repetition. Commit and build identity may differ between sides; inputs and budgets may not. Keep the original and repaired artifacts separately when repairs occur. All document edits use the existing preview/commit Operation Engine.

## Collecting evidence

The typed input contract is exported from `packages/reviewer/src/authoring-benchmark.ts`. Put a `BenchmarkSubmission` under `submission` in a report JSON; the committed empty report is the starting template. Paths are repository-relative and SHA-256 refers to actual retained bytes. Artifact identity covers source, history, resources, fonts, runtime, renderer, exporter and configuration; observations copy its canonical digest so a changed identity invalidates observations. The producer is responsible for obtaining those identity values from the actual artifacts. The gate checks consistency and bytes, not authenticity of a human attestation.

Each run needs all checks in each of four independent lines. Content covers facts and deletion; editing covers locks and undo/reopen; rendering covers presentation leakage, real media behavior and accurate degradation; visual covers hierarchy, density, composition, asset purpose and rhythm. Record individual failing items, page/object references and explanatory notes. Visual observations require PNG evidence. Recipe overlap permission is directional and scoped to recipe and page role; it never excuses illegibility, clipping, lost content or out-of-bounds objects. If a check has no applicable object (for example, no video), document that scope with evidence; do not assert actual playback occurred.

Use the owner plus at least two distinct target users. For every material task and applicable edit script, each person executes one baseline and one candidate timed session, tied to one of the retained repetitions. Record elapsed time, help count, repair time (zero only when observed), repair operations and explicit failures. Missing values remain null/unverified. Invalid sessions and all copies of a duplicated person/task/script/side session are excluded from pass counts and repair comparisons. Failure descriptions and repair operations must contain nonblank text. Keep recordings/logs or signed review notes as attachments; never use the synthetic test helper for release evidence. G2 requires non-regressing per-person/per-task repair totals with some observed improvement. This conservative rule is descriptive, not a claim of statistical significance. The small panel cannot establish population-level percentages.

Baseline failures remain in the comparison. Candidate failures, missing observations, missing files, inconsistent identities, unverified applicable tasks, or an incomplete panel keep the gate blocked. No other quality line compensates for a failure. Full format/client calibration remains outstanding: record actual HTML edit/presentation, PDF, image/semantic PPTX and chosen Office client evidence before claiming their fidelity. The current evidence validator does not independently open Office clients or prove those producer attestations.

## Stage and command

M1 requires eight scripts. M2 additionally requires protected layout changes. Table editing is M3-only: it is deferred at G2, contributes no pass, and its absence/failure cannot block G2. M3 requires all ten scripts. The separate M3 media/live-tool extension remains a Q01 follow-up and is not certified by this D07 evaluator.

After `pnpm build`, run:

```sh
pnpm benchmark:authoring docs/evolution/quality/benchmark-report.json M2
```

The command is read-only, prints the recomputed gate, and exits 1 for blocked or malformed evidence. It checks attachment hashes and repository containment, including symlinks, and PNG signatures. It does not trust a submitted `gate.status`. The default report deliberately exits 1. The ordinary blackbox suite asserts this rejection contract; its green result is not a human G2 pass.

Outstanding work: forty retained paired generations; actual reviewer panel sessions and repair comparison; representative-page screenshot/overlap calibration; actual format/client evidence. Keep TASKS.json partial until these are complete.
