#!/usr/bin/env bash
set -euo pipefail

scan_roots=(packages apps)
# importer-legacy is the only bounded, non-runtime migration boundary allowed
# to name and parse legacy text formats. It emits typed semantic elements and
# is intentionally excluded from the runtime second-source guard below.
legacy_importer_glob='!packages/importer-legacy/**'
if rg -n -i --glob '*.ts' --glob '*.tsx' --glob '*.js' --glob '*.jsx' --glob "$legacy_importer_glob" 'slidev|ppte-sidev' "${scan_roots[@]}"; then
  echo 'ERROR: forbidden Slidev route detected in executable source' >&2
  exit 1
fi
if rg -n -i --glob '*.ts' --glob '*.tsx' --glob '*.js' --glob '*.jsx' --glob "$legacy_importer_glob" 'markdown|frontmatter|document[[:space:]_-]*from[[:space:]_-]*dom|reverse[[:space:]_-]*parse.*dom|dom[[:space:]_-]*reverse' "${scan_roots[@]}"; then
  echo 'ERROR: forbidden second-source or DOM reverse-parse marker detected' >&2
  exit 1
fi
echo 'OK: source guard — no runtime Slidev/Markdown source or DOM reverse parsing (bounded legacy importer excluded)'
