import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const { CONTRACT, H00_CONTRACT, validateContract, evaluate, hash } = await import(pathToFileURL(resolve('scripts/html-benchmark.mjs')).href);
const read = (path: string) => readFileSync(path, 'utf8');
const json = (path: string) => JSON.parse(read(path));
const evidence = 'docs/single-file-first/evidence/s00';
const oldRoot = 'docs/html-first/evidence/h00';
const cli = (...args: string[]) => spawnSync(process.execPath, ['dist/apps/html-cli/index.js', ...args], { encoding: 'utf8' });

test('S00 frozen current contract rejects weakened requirements and cross-version relabelling', () => {
  validateContract(CONTRACT);
  validateContract(H00_CONTRACT, 'html-first-1.0');
  assert.equal(CONTRACT.version, 'single-file-first-1.1');
  assert.deepEqual(CONTRACT.defaultDeliverables, ['ppte.html']);
  assert.deepEqual(CONTRACT.readableExtensions, ['.html', '.ppte.html']);
  assert.equal(CONTRACT.defaultUseEntry, 'file://');
  assert.deepEqual(CONTRACT.readerRequirements, ['supported-browser']);
  assert.equal(CONTRACT.originalFileAutosave, 'actual-writable-handle-authorization-required');
  assert.equal(CONTRACT.saveSuccess, 'original-file-write-close-and-readback-confirmed');
  assert.equal(CONTRACT.fallback, 'complete-updated-ppte.html-download');
  for (const key of ['draftIsSaved', 'downloadIsSaved', 'requiredService']) assert.equal(CONTRACT[key], false);
  for (const key of ['representation', 'requiredAttributes', 'metadata', 'optionalExports', 'retired']) assert.deepEqual(CONTRACT[key], H00_CONTRACT[key]);
  assert.throws(() => validateContract(H00_CONTRACT), /contract/);
  assert.throws(() => validateContract(CONTRACT, H00_CONTRACT.version), /contract/);
  assert.throws(() => validateContract(CONTRACT, 'unknown'), /contract/);
  for (const [key, value] of Object.entries({ defaultUseEntry:'http://127.0.0.1', defaultDeliverables:['html'], downloadIsSaved:true, draftIsSaved:true, requiredService:true, readerRequirements:['node'], saveSuccess:'download-started', retired:[] })) {
    assert.throws(() => validateContract({ ...CONTRACT, [key]:value }), /contract/, key);
  }
});

test('S00 version changes cannot promote the historical baseline or bypass missing telemetry', () => {
  const manifest = json(`${oldRoot}/manifest.json`), baseline = json(`${oldRoot}/baseline.json`);
  const original = evaluate(manifest, baseline, oldRoot);
  assert.equal(original.status, 'pending'); assert.equal(original.observedRuns, 0); assert.equal(original.pending.length, 21);
  const relabelled = { ...manifest, contract:CONTRACT };
  assert.equal(evaluate(relabelled, baseline, oldRoot).status, 'invalid');
  assert.equal(evaluate(relabelled, baseline, oldRoot, CONTRACT.version).status, 'invalid');
  // Explicit new-version binding still has exactly the same missing measurements.
  const rebound = { ...baseline, manifestSha256:hash(JSON.stringify(relabelled)) };
  const current = evaluate(relabelled, rebound, oldRoot, CONTRACT.version);
  assert.equal(current.status, 'pending'); assert.deepEqual(current.pending, original.pending);
  assert.equal(current.observedRuns, 0);
  const oldTasks = json('docs/html-first/TASKS.json');
  const historical = spawnSync('git', ['show', '9856db3:docs/html-first/TASKS.json'], { encoding:'utf8' });
  assert.equal(historical.status, 0);
  assert.deepEqual(oldTasks.tasks, JSON.parse(historical.stdout).tasks);
  assert.equal(oldTasks.planVersion, H00_CONTRACT.version);
  assert.equal(oldTasks.currentContract.version, CONTRACT.version);
  assert.equal(oldTasks.currentContract.defaultDeliverable, 'one .ppte.html');
});

test('S00 active instructions and actual CLI help agree on delivery and disclose migration', () => {
  for (const path of ['README.md', 'README-AGENT.md', 'skills/ppte/SKILL.md', 'docs/html-first/CONTRACT.md']) {
    const text = read(path);
    assert.match(text, /\.ppte\.html/, path); assert.match(text, /file:\/\//, path);
    assert.match(text, /S01\/S02/, path);
    assert.match(text, /loopback[\s\S]*(?:retired|退休)/, path);
    assert.doesNotMatch(text, /ppte edit \/user\/|Keep the process running\./, path);
  }
  const result = cli('--help'); assert.equal(result.status, 0, result.stderr);
  assert.ok(Buffer.byteLength(result.stdout) <= 1024);
  const help = JSON.parse(result.stdout);
  assert.equal(help.ok, true); assert.equal(help.contract, CONTRACT.version);
  assert.match(help.commands[0], /--out 作品\.ppte\.html$/);
  assert.match(help.entry, /file:\/\//); assert.match(help.entry, /no Node or service/);
  assert.match(help.save, /actual write authorization/); assert.match(help.save, /Draft\/download is not saved/);
  assert.match(help.migration, /S01\/S02 acceptance partial/); assert.match(help.migration, /ppte edit opens file and exits/);
  assert.match(help.migration, /recommendation is retired/);
  const invalid = cli('enhance'); assert.equal(invalid.status, 1);
  assert.match(JSON.parse(invalid.stdout).error, /作品\.ppte\.html/);
});

test('S00 no new runtime or dependency requirement and historical bytes stay unchanged', () => {
  const preserved = json(`${evidence}/preserved-files.json`);
  assert.equal(preserved.basisCommit, '9856db3cef4da0d6ea6aca5a46b7039a166b995c');
  assert.ok(Object.keys(preserved.files).length > 100);
  for (const [path, digest] of Object.entries(preserved.files)) assert.equal(hash(readFileSync(path)), digest, path);
  const oldContract = spawnSync('git', ['show', '9856db3:docs/html-first/CONTRACT.md'], { encoding:'utf8' });
  assert.equal(oldContract.status, 0);
  assert.equal(read(`${evidence}/CONTRACT.html-first-1.0.md`), oldContract.stdout);
  for (const path of ['package.json', 'pnpm-lock.yaml']) {
    const old = spawnSync('git', ['show', `9856db3:${path}`], { encoding:'utf8' });
    assert.equal(old.status, 0); assert.equal(read(path), old.stdout);
  }
  assert.equal(CONTRACT.requiredService, false);
  assert.equal(CONTRACT.loopbackRecommendation, 'retired');
});

test('S00 real enhancement supports both extensions and refuses to rewrite existing user files', () => {
  const dir = mkdtempSync(join(tmpdir(), 's00-'));
  try {
    const source = join(dir, 'source.html');
    const original = '<!doctype html><html><body><section data-ppte-slide="one"><h1>兼容文稿</h1></section></body></html>';
    writeFileSync(source, original);
    for (const name of ['作品.ppte.html', '旧命名.html']) {
      const out = join(dir, name), result = cli('enhance', source, '--out', out);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(JSON.parse(result.stdout).ok, true);
      const bytes = read(out); assert.match(bytes, /兼容文稿/); assert.match(bytes, /data-ppte-slide/);
      const again = cli('enhance', source, '--out', out);
      assert.equal(again.status, 1); assert.equal(JSON.parse(again.stdout).error, 'EEXIST');
      assert.equal(read(out), bytes);
    }
    assert.equal(read(source), original);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});
