#!/usr/bin/env bash
set -euo pipefail

scan_roots=(packages apps)
if rg -n -i --glob '*.ts' --glob '*.tsx' --glob '*.js' --glob '*.jsx' 'slidev|ppte-sidev' "${scan_roots[@]}"; then
  echo 'ERROR: forbidden Slidev route detected in executable source' >&2
  exit 1
fi
if rg -n -i --glob '*.ts' --glob '*.tsx' --glob '*.js' --glob '*.jsx' 'markdown|frontmatter|document[[:space:]_-]*from[[:space:]_-]*dom|reverse[[:space:]_-]*parse.*dom|dom[[:space:]_-]*reverse' "${scan_roots[@]}"; then
  echo 'ERROR: forbidden second-source or DOM reverse-parse marker detected' >&2
  exit 1
fi
echo 'OK: source guard — no Slidev, Markdown source, or DOM reverse parsing'
