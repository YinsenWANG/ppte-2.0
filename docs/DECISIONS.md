# Implementation decisions

This file records conservative choices made while implementing the frozen
Week 1–2 slice.

## 2026-09-02 — zero runtime dependencies

The slice uses TypeScript and platform APIs only. This keeps Core usable in
Node, a browser main thread, and a worker without leaking a library-private
document model into the file format.

## 2026-09-02 — stored ZIP checkpoint

The `.ppte` writer emits a deterministic ZIP with stored (uncompressed) entries
and implements the small reader/writer in the Node persistence boundary. The
format remains a ZIP checkpoint while avoiding a dependency whose metadata or
private state could affect canonical content.

## 2026-09-02 — synchronous pure Core API

Preview, commit, diff, validation, and undo are synchronous pure operations in
the vertical slice. Host persistence is the only synchronous I/O boundary;
callers may schedule it as a job without making Core depend on a runtime.

## 2026-09-02 — unsupported future elements are not implemented

The retained public schemas document the forward contract, but the Week 1–2
runtime intentionally accepts and renders only Text, Image, and Shape. Chart,
Widget, Poster, PPTX, Patch, nested Group, and complete Portable editing are
explicitly outside this slice and produce a diagnosable unsupported error when
passed to runtime code.

## 2026-09-02 — journal tail recovery

Journal records are newline-delimited and checksummed. Recovery accepts the
last complete valid record and reports a partial or corrupt tail instead of
silently applying it. Checkpoint replacement is temp-file + fsync + rename;
an interrupted build therefore leaves the prior checkpoint readable.

## 2026-09-02 — workspace typecheck entrypoints

The recursive typecheck gate is exposed by every workspace package and app.
Each entrypoint invokes the repository TypeScript configuration because this
prototype intentionally has one compilation graph covering source and tests.
This keeps the gate complete without inventing package-local compiler
boundaries or changing runtime behavior.
