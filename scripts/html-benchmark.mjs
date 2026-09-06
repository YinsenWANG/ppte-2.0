#!/usr/bin/env node
// H00 evidence tooling. No product renderer, model client or retired delivery imports.
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const H00_CONTRACT = {
  version: 'html-first-1.0', authorityCommit: 'bbcd46bde2c608b5a56e617f316c5dcb5534857e',
  defaultDeliverables: ['html'], optionalExports: ['pdf'],
  representation: 'DOM/CSS', requiredAttributes: ['data-ppte-slide', 'data-ppte-id'],
  metadata: ['documentId', 'formatVersion', 'saveRevision', 'notes', 'sources', 'editConstraints'],
  defaultPipeline: ['author-html', 'enhance', 'static-check', 'optional-visual-check', 'deliver-html'],
  saveSuccess: 'original-file-write-confirmed', draftIsSaved: false,
  retired: ['PPTX', 'PPT', 'Office', 'ODP', 'Keynote', '.ppte', 'CAS', 'Portable profiles', 'Presentation IR', 'Recipe'],
};
// Version selection is explicit: historical evidence must never be relabelled as S00.
export const CONTRACT = {
  ...H00_CONTRACT,
  version: 'single-file-first-1.1', authorityCommit: '9856db3cef4da0d6ea6aca5a46b7039a166b995c',
  defaultDeliverables: ['ppte.html'], readableExtensions: ['.html', '.ppte.html'],
  defaultUseEntry: 'file://', readerRequirements: ['supported-browser'],
  defaultPipeline: ['author-html', 'enhance', 'static-check', 'optional-visual-check', 'deliver-ppte.html'],
  saveSuccess: 'original-file-write-close-and-readback-confirmed',
  originalFileAutosave: 'actual-writable-handle-authorization-required',
  fallback: 'complete-updated-ppte.html-download', downloadIsSaved: false,
  requiredService: false, loopbackRecommendation: 'retired',
  editCommandTarget: 'open-file-and-exit',
};
export function validateContract(contract, version = CONTRACT.version) {
  const expected = version === H00_CONTRACT.version ? H00_CONTRACT : version === CONTRACT.version ? CONTRACT : null;
  if (!expected || JSON.stringify(contract) !== JSON.stringify(expected)) throw Error('HTML contract differs from selected frozen contract');
}
export function artifact(root, ref) {
  if (!ref || typeof ref.path !== 'string' || isAbsolute(ref.path)) throw Error('missing/absolute artifact');
  const base = realpathSync(root), path = realpathSync(resolve(base, ref.path));
  const rel = relative(base, path);
  if (rel.startsWith('..') || isAbsolute(rel)) throw Error('artifact escapes evidence root');
  const bytes = readFileSync(path);
  if (!bytes.length || hash(bytes) !== ref.sha256) throw Error(`missing/tampered bytes: ${ref.path}`);
  return bytes;
}
const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const integer = n => finite(n) && Number.isInteger(n);
const phases = ['installation', 'research', 'generation', 'tool', 'correction', 'total'];
export function evaluate(manifest, evidence, root, contractVersion = H00_CONTRACT.version) {
  const pending = [], errors = [];
  try {
    validateContract(manifest.contract, contractVersion);
    if (manifest.version !== 1 || manifest.repetitions !== 3 || manifest.materials.length !== 3) throw Error('three materials / three pairs required');
    if (new Set(manifest.materials.map(m => m.id)).size !== 3) throw Error('duplicate material');
    for (const m of manifest.materials) {
      artifact(root, m.source);
      if (m.pages !== 12 || m.resourceTier !== 'light' || JSON.stringify(m.resources) !== '[]' || !m.prompt) throw Error('material configuration mismatch');
    }
    if (!manifest.model.model || !manifest.model.reasoning) throw Error('model/reasoning must be frozen');
    if (manifest.model.verification !== 'verified') pending.push('model configuration has not been verified by provider telemetry');
    if (evidence.manifestSha256 !== hash(JSON.stringify(manifest))) throw Error('manifest digest mismatch');
    for (const heat of ['cold', 'hot']) {
      const entry = evidence.installation?.[heat];
      if (!entry || entry.status === 'pending') { pending.push(`${heat} installation measurement`); continue; }
      if (entry.status !== 'observed' || !finite(entry.elapsedMs)) throw Error('invalid installation measurement');
      artifact(root, entry.log);
    }
    const expected = manifest.materials.flatMap(m => Array.from({ length: 3 }, (_, i) => ['direct', 'enhanced'].map(side => `${m.id}:${i + 1}:${side}`))).flat();
    if (!Array.isArray(evidence.runs) || evidence.runs.length !== 18 || new Set(evidence.runs.map(r => r.id)).size !== 18 || evidence.runs.some(r => !expected.includes(r.id))) throw Error('must retain every one of eighteen run slots');
    for (const run of evidence.runs) {
      if (run.status === 'pending') {
        if (!run.reason || run.timings !== null || run.tokens !== null || run.firstDraft !== null || run.failures !== null) throw Error('pending run must not invent measurements');
        pending.push(run.id); continue;
      }
      if (!['success', 'failure'].includes(run.status) || run.heat !== 'hot') throw Error('invalid run status/environment');
      if (JSON.stringify(run.model) !== JSON.stringify(manifest.model) || run.manifestSha256 !== evidence.manifestSha256) throw Error('uncontrolled model/materials');
      if (!/^[a-f0-9]{40}$/.test(run.commit) || !run.environment?.device || !run.environment?.os) throw Error('missing commit/environment');
      if (!phases.every(p => finite(run.timings?.[p])) || run.timings.total < phases.slice(0, -1).reduce((n, p) => n + run.timings[p], 0)) throw Error('invalid/missing phase timing');
      if (!integer(run.tokens?.input) || !integer(run.tokens?.output) || !integer(run.calls) || run.calls < 1 || !integer(run.retries)) throw Error('missing token/call telemetry');
      artifact(root, run.telemetry); // Raw provider/runner record, not estimated from HTML length.
      if (!Array.isArray(run.failures) || run.failures.some(f => typeof f !== 'string' || !f.trim()) || (run.status === 'failure' && !run.failures.length) || (run.status === 'success' && run.failures.length)) throw Error('invalid failures');
      artifact(root, run.log);
      if (run.firstDraft) {
        const bytes = artifact(root, run.firstDraft), html = bytes.toString();
        if (!/<!doctype html>/i.test(html)) throw Error('not HTML');
        if (run.status === 'success' && (html.match(/\bdata-ppte-slide(?=[\s=>])/g) || []).length !== 12) throw Error('page count mismatch');
        if (run.bytes !== bytes.length || run.gzipBytes !== gzipSync(bytes).length || run.mediaBytes !== 0) throw Error('invalid byte accounting');
      } else if (run.status === 'success') throw Error('success without actual first draft');
    }
  } catch (error) { errors.push(error.message); }
  return { status: errors.length ? 'invalid' : pending.length ? 'pending' : 'recorded', pending, errors,
    observedRuns: evidence.runs?.filter(r => ['success', 'failure'].includes(r.status)).length ?? 0,
    failures: evidence.runs?.filter(r => r.status === 'failure').map(r => ({ id: r.id, failures: r.failures })) ?? [],
    note: 'Recorded is evidence completeness, not H06 speed/aesthetic/browser acceptance. Raw telemetry still requires review.' };
}
// Execute a configured producer once; preserve stdout (including partial HTML), stderr,
// failure and wall time. No retries, repairs or tokens are fabricated. A unique directory
// makes an accidental rerun unable to overwrite a first draft.
export function capture(command, directory) {
  if (!Array.isArray(command) || !command.length || command.some(v => typeof v !== 'string')) throw Error('command must be a nonempty argv array');
  mkdirSync(directory); // deliberately not recursive / not overwrite
  const start = performance.now(), startedAt = new Date().toISOString();
  const result = spawnSync(command[0], command.slice(1), { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 600000 });
  const elapsedMs = performance.now() - start;
  const stdout = result.stdout ?? Buffer.alloc(0), stderr = result.stderr ?? Buffer.alloc(0);
  writeFileSync(join(directory, 'first-draft.html'), stdout);
  writeFileSync(join(directory, 'stderr.log'), stderr);
  const record = { status: result.status === 0 && !result.error ? 'captured' : 'failure', startedAt, elapsedMs,
    exitCode: result.status, signal: result.signal, error: result.error?.message ?? null,
    firstDraft: { path: 'first-draft.html', sha256: hash(stdout) }, bytes: stdout.length, gzipBytes: gzipSync(stdout).length,
    tokens: null, phases: null, measurementStatus: 'pending',
    reason: 'Subprocess wall time only; provider tokens, phase timing, model identity and controlled run binding required.' };
  writeFileSync(join(directory, 'capture.json'), JSON.stringify(record, null, 2) + '\n');
  return record;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === 'capture') {
      const separator = process.argv.indexOf('--');
      if (separator !== 4) throw Error('usage: html-benchmark.mjs capture NEW_DIRECTORY -- COMMAND [ARGS]');
      const result = capture(process.argv.slice(separator + 1), resolve(process.argv[3]));
      console.log(JSON.stringify(result)); process.exitCode = result.status === 'failure' ? 1 : 0;
    } else {
      const root = resolve(process.argv[2] ?? 'docs/html-first/evidence/h00');
      const report = evaluate(JSON.parse(readFileSync(join(root, 'manifest.json'))), JSON.parse(readFileSync(join(root, 'baseline.json'))), root);
      console.log(JSON.stringify(report, null, 2)); process.exitCode = report.status === 'invalid' ? 1 : report.status === 'pending' ? 2 : 0;
    }
  } catch (error) { console.log(JSON.stringify({ status: 'invalid', errors: [error.message] })); process.exitCode = 1; }
}

// S04 engineering samples are separate from controlled model-run acceptance.
// In particular, a mock adapter or an unfrozen machine can never pass native S04.
export function compareEditorSamples(before, after) {
  if(before.sourceSha256!==after.sourceSha256 || JSON.stringify(before.environment)!==JSON.stringify(after.environment))throw Error('UNCONTROLLED_EDITOR_COMPARISON');
  if(before.samples.pages!==12 || after.samples.pages!==12 || before.samples.text!==after.samples.text)throw Error('EDITOR_CONTENT_CHANGED');
  const limits={input:50,turn:100,save:1500};
  const results={};
  for(const [kind,limit] of Object.entries(limits)) {
    const a=before.samples[kind],b=after.samples[kind],minimum=kind==='save'?10:30;
    if(![a,b].every(s=>Array.isArray(s)&&s.length>=minimum&&s.every(finite)))throw Error('INSUFFICIENT_EDITOR_SAMPLES');
    const percentile=s=>[...s].sort((a,b)=>a-b)[Math.ceil(s.length*.95)-1];
    results[kind]={beforeP95Ms:percentile(a),afterP95Ms:percentile(b),limitMs:limit,engineeringWithinLimit:percentile(b)<=limit};
  }
  return {status:'partial',results,nativeAcceptance:'pending: frozen reference and low-performance hardware, real file permission/write journey required',modelTelemetry:'unavailable'};
}
