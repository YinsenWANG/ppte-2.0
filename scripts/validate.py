from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = ROOT / 'schemas'
EXAMPLES = ROOT / 'examples'

pairs = [
    ('document.schema.json', 'minimal-document.json'),
    ('transaction.schema.json', 'text-change-transaction.json'),
    ('slide-ir.schema.json', 'slide-ir.json'),
    ('presentation-ir.schema.json', 'presentation-ir.json'),
    ('recipe.schema.json', 'recipe.json'),
    ('manifest.schema.json', 'manifest.json'),
    ('patch-manifest.schema.json', 'patch-manifest.json'),
    ('portable-origin.schema.json', 'portable-origin.json'),
    ('capability-report.schema.json', 'capability-report.json'),
    ('review.schema.json', 'review.json'),
]

errors: list[str] = []
schema_documents = {name: json.loads((SCHEMAS / name).read_text()) for name in {schema_name for schema_name, _ in pairs}}
schema_registry = Registry()
for schema in schema_documents.values():
    if schema.get('$id'):
        schema_registry = schema_registry.with_resource(schema['$id'], Resource.from_contents(schema))
for schema_name, example_name in pairs:
    schema = schema_documents[schema_name]
    instance = json.loads((EXAMPLES / example_name).read_text())
    try:
        Draft202012Validator.check_schema(schema)
    except Exception as exc:
        errors.append(f'{schema_name}: invalid schema: {exc}')
        continue
    validator = Draft202012Validator(schema, registry=schema_registry)
    for err in sorted(validator.iter_errors(instance), key=lambda e: list(e.path)):
        errors.append(f'{example_name}{list(err.path)}: {err.message}')

# Semantic checks that JSON Schema cannot express cleanly.
doc = json.loads((EXAMPLES / 'minimal-document.json').read_text())
slide_order = doc['slideOrder']
if len(slide_order) != len(set(slide_order)):
    errors.append('document: duplicate slideOrder id')
for sid in slide_order:
    if sid not in doc['slides']:
        errors.append(f'document: missing slide {sid}')
for sid, slide in doc['slides'].items():
    if slide['id'] != sid:
        errors.append(f'{sid}: slide map key/id mismatch')
    element_ids = set(slide['elements'])
    if set(slide['rootOrder']) != element_ids:
        errors.append(f'{sid}: rootOrder must contain every visual element exactly once in this example')
    if len(slide.get('readingOrder', [])) != len(set(slide.get('readingOrder', []))):
        errors.append(f'{sid}: duplicate readingOrder id')
    if not set(slide.get('readingOrder', [])).issubset(element_ids):
        errors.append(f'{sid}: readingOrder references missing element')
    keys = [e.get('semanticKey') for e in slide['elements'].values() if e.get('semanticKey')]
    if len(keys) != len(set(keys)):
        errors.append(f'{sid}: duplicate semanticKey')
    membership: dict[str, str] = {}
    for gid, group in slide.get('groups', {}).items():
        if group['id'] != gid:
            errors.append(f'{sid}/{gid}: group map key/id mismatch')
        for eid in group['memberIds']:
            if eid not in element_ids:
                errors.append(f'{sid}/{gid}: missing member {eid}')
            if eid in membership:
                errors.append(f'{sid}: element {eid} belongs to multiple groups')
            membership[eid] = gid

# Contract consistency: every TS OperationBase literal must exist in JSON Schema enum/const set.
ts = (ROOT / 'packages' / 'schema' / 'src' / 'operations.ts').read_text()
ts_kinds = set(re.findall(r"OperationBase<'([^']+)'>", ts))
transaction_schema = json.loads((SCHEMAS / 'transaction.schema.json').read_text())
schema_kinds: set[str] = set()

def walk(value):
    if isinstance(value, dict):
        if set(value) == {'const'} and isinstance(value['const'], str):
            if '.' in value['const']:
                schema_kinds.add(value['const'])
        for child in value.values():
            walk(child)
    elif isinstance(value, list):
        for child in value:
            walk(child)

walk(transaction_schema['properties']['operations'])
missing_in_schema = ts_kinds - schema_kinds
missing_in_ts = schema_kinds - ts_kinds
if missing_in_schema:
    errors.append(f'operation kinds missing in schema: {sorted(missing_in_schema)}')
if missing_in_ts:
    errors.append(f'operation kinds missing in TypeScript: {sorted(missing_in_ts)}')

# Markdown structural checks.
plan = ROOT / 'docs' / 'PPTe_2.0_完整研发方案_v2.3.md'
if plan.exists():
    text = plan.read_text()
    if text.count('```') % 2:
        errors.append('main plan: unclosed code fence')
    if '\ufffd' in text:
        errors.append('main plan: replacement character detected')

if errors:
    print('\n'.join(f'ERROR: {e}' for e in errors))
    sys.exit(1)

print(f'OK: {len(pairs)} schemas/examples, semantic checks, operation parity, and markdown structure')
