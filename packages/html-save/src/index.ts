import { readHistory, validateHistoryWire } from '../../html-document/src/history-wire.js';
import type { HistoryWire } from '../../html-editor/src/versions.js';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, open, rename, unlink, readdir, stat, realpath, chmod } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { readEnhanced, serializeContent, envelope } from '../../html-document/src/index.js';
export const digest = (text: string) => createHash('sha256').update(text).digest('hex');
export const dataDirectory = () => join(homedir(), '.local', 'share', 'ppte-html');
export interface SaveOptions { cacheDir?: string; port?: number; fault?: (phase: string) => void | Promise<void> }
/** One OS lock per canonical file, shared across ports and processes. Never evict a live owner. */
async function lock(path: string) {
  for (let i = 0; i < 100; i++) {
    try { const handle = await open(path, 'wx', 0o600); await handle.writeFile(String(process.pid)); await handle.close(); return async () => { await unlink(path); }; }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const pid = Number(await readFile(path, 'utf8').catch(() => '0'));
      if (pid > 0) { try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') { await unlink(path).catch(() => {}); continue; } } }
      await new Promise(r => setTimeout(r, 20));
    }
  }
  throw Error('FILE_BUSY');
}
export async function bindFile(input: string, options: SaveOptions = {}) {
  const file = await realpath(resolve(input));
  if (!/\.html$/i.test(file)) throw Error('HTML_REQUIRED');
  readEnhanced(await readFile(file, 'utf8'));
  const key = digest(file), cache = join(options.cacheDir ?? dataDirectory(), key);
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const snapshot = async () => { const html = await readFile(file, 'utf8'); return { ...readEnhanced(html), history:readHistory(html), hash: digest(html), fileKey: key, name: file.split('/').pop()! }; };
  let queue: Promise<unknown> = Promise.resolve();
  const versions = async () => { const entries=await Promise.all((await readdir(cache)).filter(n=>/^version-[a-f0-9]{64}\.html$/.test(n)).map(async n=>({n,time:(await stat(join(cache,n))).mtimeMs})));return entries.sort((a,b)=>b.time-a.time).map(v=>v.n); };
  const save = (expected: string, content: string, history?:HistoryWire) => {
    const job = queue.catch(() => {}).then(async () => {
      const release = await lock(join(cache, 'write.lock'));
      const temporary = join(dirname(file), `.ppte-${key.slice(0,12)}.tmp`);
      try {
        if (await realpath(file) !== file) throw Error('FILE_IDENTITY_CHANGED');
        const before = await readFile(file, 'utf8');
        if (digest(before) !== expected) throw Error('CONFLICT');
        const info = await stat(file); if (!(info.mode & 0o222)) throw Error('READ_ONLY');
        const next = serializeContent(content, readEnhanced(before).metadata, history ?? readHistory(before));
        if (Buffer.byteLength(next) > 16 * 1024 * 1024) throw Error('FILE_TOO_LARGE');
        // Recoverable previous bytes are committed before replacing the original.
        const version = await open(join(cache, `version-${expected}.html`), 'w', 0o600);
        try { await version.writeFile(before); await version.sync(); } finally { await version.close(); }
        await options.fault?.('before-write');
        await unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; });
        const handle = await open(temporary, 'wx', info.mode & 0o777);
        try { await handle.writeFile(next); await handle.sync(); } finally { await handle.close(); }
        await chmod(temporary, info.mode & 0o777);
        if (digest(await readFile(temporary, 'utf8')) !== digest(next)) throw Error('VERIFY_FAILED');
        await options.fault?.('before-replace');
        if (await realpath(file) !== file || digest(await readFile(file, 'utf8')) !== expected) throw Error('CONFLICT');
        await rename(temporary, file);
        const directory = await open(dirname(file), 'r'); try { await directory.sync(); } finally { await directory.close(); }
        await options.fault?.('after-replace');
        const confirmed = await snapshot(); if (confirmed.hash !== digest(next)) throw Error('CONFLICT_AFTER_WRITE');
        // Bound history by both count and bytes, newest first. Rotation is not a save failure.
        try {
          const history = await Promise.all((await versions()).map(async n => ({n,...await stat(join(cache,n))})));
          history.sort((a,b) => b.mtimeMs-a.mtimeMs); let bytes = 0;
          for (const [i,v] of history.entries()) { bytes += v.size; if (i >= 10 || bytes > 32*1024*1024) await unlink(join(cache,v.n)); }
        } catch { /* A confirmed write remains confirmed; later saves retry pruning. */ }
        return confirmed;
      } finally { await unlink(temporary).catch(() => {}); await release(); }
    }); queue = job; return job;
  };
  return { file, key, snapshot, save, versions, async restore(expected: string, version: string) {
    if (!(await versions()).includes(version)) throw Error('VERSION_NOT_FOUND');
    return save(expected, readEnhanced(await readFile(join(cache,version),'utf8')).content);
  } };
}
export async function startEditor(file: string, options: SaveOptions = {}) {
  const binding = await bindFile(file, options), token = randomBytes(32).toString('hex');
  let origin = '';
  const server = createServer(async (req,res) => {
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
    const json = (status: number, data: unknown) => { res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data)); };
    try {
      if (req.socket.remoteAddress !== '127.0.0.1' || req.headers.host !== origin.slice(7)) return json(403,{error:'LOOPBACK_ONLY'});
      if (req.headers.origin && req.headers.origin !== origin) return json(403,{error:'ORIGIN_DENIED'});
      if (req.headers['sec-fetch-site'] === 'cross-site') return json(403,{error:'CROSS_SITE_DENIED'});
      if (req.method === 'GET' && req.url === '/') {
        const current = await binding.snapshot();
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"frame-ancestors 'none'"});
        return res.end(envelope(current.content,current.metadata,readHistory(await readFile(binding.file,'utf8'))).replace("connect-src 'none'", "connect-src 'self'"));
      }
      if (req.headers.authorization !== `Bearer ${token}`) return json(403,{error:'TOKEN_REQUIRED'});
      if (req.method === 'GET' && req.url === '/api/file') return json(200,await binding.snapshot());
      if (req.method === 'GET' && req.url === '/api/versions') return json(200,await binding.versions());
      if (req.method !== 'POST' || !['/api/save','/api/restore'].includes(req.url ?? '')) return json(404,{error:'ROUTE_DENIED'});
      if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') return json(403,{error:'REQUEST_DENIED'});
      const chunks:Buffer[]=[]; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 16*1024*1024) { json(413,{error:'BODY_TOO_LARGE'});return; } chunks.push(Buffer.from(chunk)); }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8')), field = req.url === '/api/save' ? 'content' : 'version';
      if (!data || typeof data.expected !== 'string' || !/^[a-f0-9]{64}$/.test(data.expected) || typeof data[field] !== 'string' || Object.keys(data).sort().join(',') !== [field,'expected',...(data.history!==undefined&&field==='content'?['history']:[])].sort().join(',')) return json(400,{error:'INVALID_REQUEST'});
      return json(200,field === 'content' ? await binding.save(data.expected,data.content,data.history===undefined?undefined:validateHistoryWire(data.history)) : await binding.restore(data.expected,data.version));
    } catch (e) { const error = (e as NodeJS.ErrnoException).code ?? (e as Error).message; json(error.includes('CONFLICT') ? 409 : 422,{error}); }
  });
  await new Promise<void>((done,reject) => {server.once('error',reject);server.listen(options.port ?? 0,'127.0.0.1',done);});
  origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  return { server, binding, token, origin, url:`${origin}/#token=${token}`, close:() => new Promise<void>(r => server.close(() => r())) };
}
