import { readFileSync } from 'node:fs';
import { releaseBlockers, validateReleaseActions, releaseDigest, verifyReleaseRetention } from '../dist/packages/node-runtime/src/release.js';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const manifest = read('docs/evolution/quality/release-manifest.json');
const blockers = releaseBlockers(read('docs/evolution/TASKS.json'), read('docs/evolution/quality/client-matrix.json'));
validateReleaseActions(manifest.actions);
for (const file of manifest.evidenceFiles ?? []) {
  try { if (releaseDigest(file.path) !== file.sha256) blockers.push(`Stale evidence: ${file.path}`); }
  catch { blockers.push(`Missing evidence: ${file.path}`); }
}
const build = read('artifacts/build-manifest.json');
if (JSON.stringify(build) !== JSON.stringify(manifest.buildManifest)) blockers.push('Candidate build identity differs from current build');
for (const criterion of ['1', '2', '3']) {
  if (manifest.criteria?.[criterion]?.status !== 'pass') blockers.push(`Q02 criterion ${criterion}: incomplete`);
}
if (manifest.verification?.status !== 'pass') blockers.push('Q02: final verification incomplete');
try { verifyReleaseRetention(manifest.retention.directory, read(manifest.retention.receipt)); }
catch (error) { blockers.push(`Q02 retention: ${error.message}`); }
if (manifest.status !== 'ready') blockers.push(`Q02 manifest: ${manifest.status}`);
if (!manifest.evidenceFiles?.length) blockers.push('Q02: no retained verification evidence');
console.log(JSON.stringify({ ok: blockers.length === 0, blockers, actions: manifest.actions }, null, 2));
process.exitCode = blockers.length ? 1 : 0;
