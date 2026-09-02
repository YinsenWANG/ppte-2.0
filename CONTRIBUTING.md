# Contributing

PPTe is an open semantic-document project. Keep the document model portable,
deterministic, and safe to open without executing document content.

Before submitting a change, run:

```text
pnpm install
pnpm typecheck
pnpm test
pnpm validate
pnpm e2e:vertical-slice
```

Changes that add a persisted field, operation, renderer primitive, or recovery
behavior must include the corresponding schema/type, positive and negative
tests, and a note in `docs/DECISIONS.md` when the frozen specification leaves
an implementation detail open. All writes must go through the Operation Engine.
