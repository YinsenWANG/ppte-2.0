# Retired implementation snapshot

`legacy/` preserves the pre-H05 source, tests, schemas, fixtures and release
scripts as historical material. Existing assertions are unchanged; they are
not tests of the HTML-first candidate. This directory is excluded from the
workspace, TypeScript build, CI and npm package. Shared HTML test fixtures and
the viewport helper remain active where still used.

For a complete runnable historical checkout (including the matching docs and
HTML-era source), use commit `7c1a6c46676566e346edc2af24974752d4288897` in a
separate detached worktree. Do not run the archived release scripts from the
new repository root or install them over a current user installation.
