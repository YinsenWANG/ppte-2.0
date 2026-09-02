# Contributing

PPTe is an open semantic-document project. Keep the document model portable,
deterministic, and safe to open without executing document content.

Before submitting a change, run:

```text
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm validate
pnpm e2e:vertical-slice
pnpm e2e:milestone
pnpm e2e:beta
pnpm e2e:ga-a
```

Changes that add a persisted field, operation, renderer primitive, or recovery
behavior must include the corresponding schema/type, positive and negative
tests, and a note in `docs/DECISIONS.md` when the frozen specification leaves
an implementation detail open. All writes must go through the Operation Engine.

The GA-A E2E also enforces the published capacity corpus and P95 performance
budgets. Do not lower a budget, reduce the corpus, add `skip`/`only`, or alter
the test meaning to make a gate pass. If a local environment cannot meet a
budget, report the measured failure and its cause.

Compatibility changes must preserve the forward-only migration rule and must
not overwrite the source package. Migration reports need deterministic output,
explicit degradation, and enough source identity to support review. New
failure paths should use the public error semantics from
`packages/schema/src/errors.ts` and identify the recovery action.
