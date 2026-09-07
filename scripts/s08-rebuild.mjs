// Rebuild run-record.json for the 18 completed runs whose runner crashed at record-write
// (Buffer bug fixed 09-07 13:1x). Model calls themselves completed and all artifacts exist.
// Timing source: provider rollout session span (session_meta.timestamp -> last event timestamp).
// This is documented methodology, not fabricated data: phase breakdown unavailable => null+reason.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
const sha = f => createHash('sha256').update(readFileSync(f)).digest('hex');
const ROOT = '/tmp/ppte6/docs/single-file-first/evidence/h06';
const manifest = JSON.parse(readFileSync('/tmp/ppte6/docs/html-first/evidence/h00/manifest.json', 'utf8'));
const msha = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
const out = [];
for (const dir of readdirSync(ROOT).sort()) {
  const d = resolve(ROOT, dir);
  if (!/^(cherry|product|data)-[123]-(direct|enhanced)$/.test(dir)) continue;
  const [, mm, rep, mode] = dir.match(/^(.*)-([123])-(direct|enhanced)$/);
  const id = mm + ':' + rep + ':' + mode;
  const telPath = d + '/telemetry-rollout.jsonl';
  if (!existsSync(telPath)) { out.push({ id, rebuilt: false, why: 'no telemetry' }); continue; }
  let t0 = null, t1 = null, tokens = null, calls = 0;
  for (const line of readFileSync(telPath, 'utf8').split('\n').filter(Boolean)) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'session_meta' && t0 === null) t0 = Date.parse(e.payload?.timestamp || e.timestamp);
    const ets = Date.parse(e.timestamp || 0);
    if (Number.isFinite(ets)) t1 = Math.max(t1 ?? 0, ets);
    const tc = (e.type === 'token_count' && e.info?.total_token_usage) ? e.info.total_token_usage : ((e.type === 'event_msg' && e.payload?.type === 'token_count' && e.payload.info?.total_token_usage) ? e.payload.info.total_token_usage : null);
      if (tc) {
        const u = tc;
      tokens = { input: u.input_tokens, cachedInput: u.cached_input_tokens, output: u.output_tokens, reasoning: u.reasoning_output_tokens, total: u.total_tokens };
    }
    if (e.type === 'event_msg' && e.payload?.type === 'user_message') calls++;
  }
  const draft = existsSync(d + '/first-draft.html') ? d + '/first-draft.html' : null;
  let failures = [];
  let html = draft ? readFileSync(draft, 'utf8') : '';
  const slides = draft ? (html.match(/\bdata-ppte-slide(?=[\s=>])/g) || []).length : 0;
  const bytes = draft ? readFileSync(draft).length : 0;
  if (!draft) failures.push('missing first draft');
  else {
    if (!/<!doctype html>/i.test(html.slice(0, 400))) failures.push('not doctype-initial');
    if (bytes < 4000) failures.push('too small: ' + bytes);
    if (slides !== 12) failures.push('slide count ' + slides + ' != 12');
  }
  if (mode === 'enhanced') {
    if (!existsSync(d + '/draft.html')) failures.push('no draft.html => enhance chain unproven');
    else if (draft && sha(d + '/draft.html') === sha(draft)) failures.push('final identical to draft: CLI NOT executed');
    else if (!(/id="ppte-content"/.test(html) && /id="ppte-frame"/.test(html) && /id="ppte-metadata"/.test(html))) failures.push('final is not real enhance output (container signature absent)');
  }
  if (!tokens) failures.push('no token telemetry');
  const rec = {
    id, status: failures.length ? 'failure' : 'success', heat: 'hot',
    rebuiltAt: new Date().toISOString(), rebuildReason: 'runner crashed writing record (Buffer bug); model call itself completed',
    commit: spawnSync('/usr/bin/git', ['-C', '/tmp/ppte6', 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
    model: manifest.model,
    environment: { device: 'yinsenMac-mini M4', node: process.version, timing: 'provider session span (session_meta -> last event)', caveat: 'shared background load with pipeline v7 after 12:32; ratios are the verdict metric' },
    timings: { installation: 0, research: null, generation: (t1 && t0) ? t1 - t0 : null, tool: null, correction: null, total: (t1 && t0) ? t1 - t0 : null },
    phaseNotes: 'provider session span covers model generation incl. in-session tool calls; research/tool/correction split unavailable for rebuilt records',
    tokens, calls: Math.max(calls, 1), retries: 0,
    manifestSha256: msha,
    telemetry: { path: dir + '/telemetry-rollout.jsonl', sha256: sha(telPath) },
    firstDraft: draft ? { path: dir + '/first-draft.html', sha256: sha(draft) } : null,
    bytes, gzipBytes: draft ? gzipSync(readFileSync(draft)).length : 0, mediaBytes: 0,
    failures,
  };
  writeFileSync(d + '/run-record.json', JSON.stringify(rec, null, 2) + '\n');
  out.push({ id, status: rec.status, wall_s: rec.timings.total ? Math.round(rec.timings.total / 1000) : null, tokens: tokens?.total, bytes, fails: failures.map(f => f.slice(0, 40)) });
}
console.log(JSON.stringify(out, null, 1));
