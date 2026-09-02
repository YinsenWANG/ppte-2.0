# Changelog

All notable changes to the PPTe reference runtime are recorded here.

## [0.2.0-rc.1] — 2026-09-03

### Added

- GA-A Compatibility Profile `ppte-2.0-ga-a.1` with independent version
  checks and explicit native, forward-migrate, read-only, and reject paths.
- Data-only legacy semantic snapshot migration with deterministic IDs,
  materialized flat Groups, typed Style Preset reattachment, retained
  non-required Run-style notes, source digest, and a reviewable report.
- Public error semantics for impact, content safety, save safety,
  recoverability, retryability, and recovery guidance.
- Named Journal/Checkpoint/archive/patch/Portable fault matrix and checkpoint
  fault injection coverage.
- GA-A capacity and P95 performance budget helpers plus the CI acceptance
  corpus and bundle-size checks.
- Public Compatibility Profile schema/example and updated open-source
  contributor and release documentation.

### Reliability

- Kept the prior checkpoint readable across build, fsync, pre-replacement,
  replacement, and post-replacement fault points unless replacement had
  completed.
- Optimized binary asset hashing and stored-archive CRC verification while
  preserving canonical document hashing and byte verification.

### Scope

- The candidate does not add Chart, Widget, Poster, PPTX, nested Groups,
  Group Rotate, Portable Light Edit, CRDT, real-time collaboration, or full
  legacy markup import.
