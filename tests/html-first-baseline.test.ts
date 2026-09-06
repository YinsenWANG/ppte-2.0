import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
const moduleUrl = pathToFileURL(resolve('scripts/html-benchmark.mjs')).href;
const { H00_CONTRACT: CONTRACT, validateContract: validateVersionedContract, evaluate, hash, artifact, capture } = await import(moduleUrl);
// All existing H00 assertions still run against their original frozen version.
const validateContract = (contract: unknown) => validateVersionedContract(contract, CONTRACT.version);
const root = 'docs/html-first/evidence/h00';
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const baseline = JSON.parse(readFileSync(join(root, 'baseline.json'), 'utf8'));

test('H00 acceptance 1: frozen positive HTML contract excludes retired formats and IR pipeline', () => {
  validateContract(manifest.contract);
  assert.deepEqual(CONTRACT.defaultDeliverables, ['html']);
  assert.deepEqual(CONTRACT.optionalExports, ['pdf']);
  assert.equal(CONTRACT.draftIsSaved, false);
  for (const format of ['pptx', 'Office', '.ppte', 'CAS', 'Portable profiles']) {
    for (const field of ['defaultDeliverables', 'optionalExports', 'defaultPipeline']) {
      const changed = structuredClone(manifest.contract); changed[field].push(format);
      assert.throws(() => validateContract(changed), /contract/);
    }
  }
  const tasks = JSON.parse(readFileSync('docs/html-first/TASKS.json', 'utf8'));
  assert.equal(tasks.defaultDeliverable, 'one .html');
  assert.equal(tasks.optionalExport, 'PDF');
  assert.notEqual(tasks.tasks.find((t: { id: string }) => t.id === 'H00').status, 'done');
});

test('H00 acceptance 2: real fixed materials, all nine pairs and cold/hot missing data stay pending', () => {
  const result = evaluate(manifest, baseline, root);
  assert.equal(result.status, 'pending');
  assert.equal(result.observedRuns, 0);
  assert.equal(result.pending.length, 21);
  assert.deepEqual(result.errors, []);
  for (const material of manifest.materials) assert.ok(artifact(root, material.source).length > 100);
  const cli = spawnSync(process.execPath, ['scripts/html-benchmark.mjs'], { encoding: 'utf8' });
  assert.equal(cli.status, 2);
  assert.deepEqual(JSON.parse(cli.stdout), result);
});

// Synthetic submissions exercise evidence validation only, never retained as real runs.
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'h00-test-'));
  const m = structuredClone(manifest); m.model.verification = 'verified';
  const put = (name: string, content: string) => {
    writeFileSync(join(dir, name), content); return { path: name, sha256: hash(content) };
  };
  for (const material of m.materials) material.source = put(`${material.id}.md`, 'synthetic source for validator test');
  const digest = hash(JSON.stringify(m));
  const html = '<!doctype html>' + '<section data-ppte-slide="s">Test</section>'.repeat(12);
  const draft = put('draft.html', html), log = put('run.log', 'synthetic process log'), telemetry = put('usage.json', '{"synthetic":true}');
  const e = structuredClone(baseline); e.manifestSha256 = digest;
  for (const heat of ['cold', 'hot']) e.installation[heat] = { status: 'observed', elapsedMs: 10, log };
  e.runs = e.runs.map((r: { id: string }) => ({ id: r.id, status: 'success', heat: 'hot', model: m.model, manifestSha256: digest,
    commit: 'a'.repeat(40), environment: { device: 'synthetic', os: 'synthetic' },
    timings: { installation: 0, research: 1, generation: 2, tool: 1, correction: 0, total: 4 },
    tokens: { input: 10, output: 20 }, calls: 1, retries: 0, telemetry, log, failures: [],
    firstDraft: draft, bytes: Buffer.byteLength(html), gzipBytes: gzipSync(html).length, mediaBytes: 0 }));
  return { dir, m, e };
}

test('H00 acceptance 2: missing timings/tokens, changed model/materials, omitted runs and fake success fail', () => {
  const f = fixture();
  try {
    assert.equal(evaluate(f.m, f.e, f.dir).status, 'recorded');
    const mutations = [
      (e: any) => { e.runs[0].tokens.input = null; },
      (e: any) => { e.runs[0].tokens.output = -1; },
      (e: any) => { e.runs[0].timings.generation = null; },
      (e: any) => { e.runs[0].timings.total = 1; },
      (e: any) => { e.runs[0].model = { model: 'other' }; },
      (e: any) => { e.manifestSha256 = 'bad'; },
      (e: any) => { e.runs.pop(); },
      (e: any) => { e.runs[1].id = e.runs[0].id; },
      (e: any) => { e.runs[0].firstDraft = null; },
      (e: any) => { e.runs[0].telemetry = null; },
      (e: any) => { e.runs[0].gzipBytes = 0; },
      (e: any) => { e.runs[0].status = 'pending'; },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(f.e); mutate(changed);
      assert.equal(evaluate(f.m, changed, f.dir).status, 'invalid', mutate.toString());
    }
    const changed = structuredClone(f.m); changed.materials[0].pages = 10;
    assert.equal(evaluate(changed, f.e, f.dir).status, 'invalid');
    writeFileSync(join(f.dir, 'draft.html'), '<!doctype html><p>changed</p>');
    assert.equal(evaluate(f.m, f.e, f.dir).status, 'invalid');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('H00 acceptance 2: observed failures are retained, never repaired away or silently excluded', () => {
  const f = fixture();
  try {
    f.e.runs[0].status = 'failure'; f.e.runs[0].failures = ['producer exited before writing HTML'];
    f.e.runs[0].firstDraft = null;
    const result = evaluate(f.m, f.e, f.dir);
    assert.equal(result.status, 'recorded');
    assert.equal(result.failures.length, 1);
    assert.deepEqual(result.failures[0].failures, f.e.runs[0].failures);
    f.e.runs[0].failures = [' '];
    assert.equal(evaluate(f.m, f.e, f.dir).status, 'invalid');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('H00 acceptance 2: artifact bytes must exist inside evidence root including symlink resolution', () => {
  const dir = mkdtempSync(join(tmpdir(), 'h00-path-'));
  try {
    const outside = join(dir, 'outside.txt'); writeFileSync(outside, 'outside');
    const sub = join(dir, 'child');
    capture([process.execPath, '-e', 'process.stdout.write("test")'], sub);
    symlinkSync(outside, join(sub, 'escape'));
    for (const path of [outside, '../outside.txt', 'escape', 'missing']) assert.throws(() => artifact(sub, { path, sha256: hash('outside') }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('H00 acceptance 2: capture records actual subprocess time/bytes/failure and refuses overwrite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'h00-capture-'));
  try {
    const success = capture([process.execPath, '-e', 'process.stdout.write("<!doctype html><p>first</p>")'], join(dir, 'success'));
    assert.equal(success.status, 'captured'); assert.ok(success.elapsedMs > 0);
    assert.equal(success.tokens, null); assert.equal(success.measurementStatus, 'pending');
    assert.equal(success.bytes, readFileSync(join(dir, 'success/first-draft.html')).length);
    assert.throws(() => capture([process.execPath, '-e', ''], join(dir, 'success')), /EEXIST/);
    const failure = capture([process.execPath, '-e', 'process.stdout.write("partial");process.stderr.write("failed");process.exit(7)'], join(dir, 'failure'));
    assert.equal(failure.status, 'failure'); assert.equal(failure.exitCode, 7);
    assert.equal(readFileSync(join(dir, 'failure/first-draft.html'), 'utf8'), 'partial');
    assert.equal(readFileSync(join(dir, 'failure/stderr.log'), 'utf8'), 'failed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('H00 retained exploratory HTML has twelve pages, no runtime/network and real data table; not timing evidence', () => {
  const drafts = JSON.parse(readFileSync(join(root, 'drafts.json'), 'utf8'));
  assert.equal(drafts.status, 'uncontrolled'); assert.equal(drafts.artifacts.length, 3);
  for (const ref of drafts.artifacts) {
    const html = artifact(root, ref).toString();
    assert.equal((html.match(/data-ppte-slide=/g) || []).length, 12);
    assert.doesNotMatch(html, /<script|\b(?:src|href)=["']https?:|@import|url\(/i);
    if (ref.path.endsWith('data.html')) assert.match(html, /<table>/);
  }
});

test('H00 dependency inventory preserves evidence of live retired dependencies without declaring retirement', () => {
  const graph = JSON.parse(readFileSync(join(root, 'import-graph.json'), 'utf8'));
  assert.equal(graph.basisCommit, CONTRACT.authorityCommit);
  assert.equal(graph.sourceFiles, 117); assert.equal(graph.edges.length, 624);
  for (const module of ['core', 'file-format', 'portable-runtime', 'exporter-pptx']) {
    assert.ok(graph.cliReachable.some((p: string) => p.startsWith(`packages/${module}/`)), module);
  }
  assert.ok(graph.packageManifests.some((p: { path: string }) => p.path === 'package.json'));
});
