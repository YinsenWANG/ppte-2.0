// S08 installation cold/hot for merged-main candidate (protocol: shared install for both arms).
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const TGZ = '/tmp/ppte6/artifacts/ppte-html-1.0.0-html.0.tgz';
const sha = createHash('sha256').update(readFileSync(TGZ)).digest('hex');
const measure = (heat, dir, cache) => {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  const r = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--prefer-offline', '--cache', cache, TGZ], { cwd: dir, encoding: 'utf8', timeout: 900000 });
  const ms = Date.now() - t0;
  return { heat, elapsedMs: ms, status: r.status === 0 ? 'observed' : 'failed', exit: r.status, sha256: sha, log: (r.stdout || '') + (r.stderr || '') };
};
const coldCache = '/tmp/s08-npm-cache';
rmSync(coldCache, { recursive: true, force: true });
const cold = measure('cold', '/tmp/s08-inst-cold', coldCache);
const hot = measure('hot', '/tmp/s08-inst-hot', coldCache);
writeFileSync('/tmp/ppte6/docs/single-file-first/evidence/h06-installation.json', JSON.stringify({ cold, hot, measuredAt: new Date().toISOString(), note: 'isolated dirs, separate npm caches; candidate tarball of merged main' }, null, 2));
console.log(JSON.stringify({ coldMs: cold.elapsedMs, hotMs: hot.elapsedMs, sha: sha.slice(0, 12) }));
