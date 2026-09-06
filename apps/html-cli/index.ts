#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { readFile, writeFile, mkdir, cp, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startEditor, digest } from '../../packages/html-save/src/index.js';
import { spawn } from 'node:child_process';
import { enhanceHTML } from '../../packages/html-document/src/index.js';

export async function runHTMLCli(args: string[]) {
  if (args.length === 0 || args[0] === '--help') return {ok:true,commands:['ppte enhance input.html --out 作品.html','ppte edit 作品.html [--no-open] [--port=PORT]','ppte skill-install --out DIRECTORY'],pdf:'Open HTML → More → Export PDF. Browser print is optional; generation requires only Node.js.'};
  if (args[0] === 'skill-install') {
    if(args.length!==3 || args[1]!=='--out')throw Error('USAGE: ppte skill-install --out DIRECTORY');
    const out=resolve(args[2]);
    const here=dirname(fileURLToPath(import.meta.url));
    let source=resolve(here,'skills/ppte');
    try {await readdir(source);} catch {source=resolve(here,'../../../skills/ppte');}
    // Exclusive directory creation protects existing user skills, including symlinks.
    await mkdir(dirname(out),{recursive:true});await mkdir(out);
    for(const name of await readdir(source)) await cp(resolve(source,name),resolve(out,name),{recursive:true,errorOnExist:true,force:false});
    return {ok:true,path:out,hint:'Installed once; reuse for future presentations. Existing skills are never overwritten.'};
  }
  if(args[0] === 'edit') {
    if(!args[1] || args.slice(2).some(x=>x!=='--no-open' && !/^--port=\d+$/.test(x)))throw Error('USAGE: ppte edit file.html [--no-open] [--port=PORT]');
    const file=resolve(args[1]);
    const portArg=args.find(x=>x.startsWith('--port='));
    const port=portArg?Number(portArg.slice(7)):20000+parseInt(digest(file).slice(0,4),16)%30000;
    const editor=await startEditor(file,{port});
    if(!args.includes('--no-open')) {
      const command=process.platform==='darwin'?'open':process.platform==='win32'?'explorer':'xdg-open';
      const child=spawn(command,[editor.url],{stdio:'ignore'});child.on('error',()=>{});child.unref();
    }
    process.once('SIGTERM',()=>void editor.close());process.once('SIGINT',()=>void editor.close());
    return {ok:true,url:editor.url,path:file,hint:'Keep this process running. Restart with the same command and open its new session link.'};
  }
  if (args.length !== 4 || args[0] !== 'enhance' || args[2] !== '--out' || !/\.html$/i.test(args[3])) throw Error('USAGE: ppte enhance input.html --out 作品.html');
  const input = resolve(args[1]), output = resolve(args[3]);
  if (input === output) throw Error('OUTPUT_MUST_BE_NEW');
  const result = await enhanceHTML(await readFile(input, 'utf8'), { root: dirname(input), base: dirname(input) });
  // Refuse unsafe delivery instead of silently dropping executable content or CSS.
  if (result.issues.length) return { ok: false, errors: [...new Set(result.issues.map(i => i.code))].slice(0,8), rejected: result.issues.length };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, result.html, { flag: 'wx' });
  // JSON paths are bounded too; full path stays available from the caller's explicit --out.
  return { ok: true, path: Buffer.byteLength(JSON.stringify(output)) <= 700 ? output : 'See --out path', pages: result.pages, bytes: Buffer.byteLength(result.html), mediaBytes: result.mediaBytes, visual: 'unverified' };
}
export function summary(value: object) {
  const json = JSON.stringify(value);
  return Buffer.byteLength(json) <= 1024 ? json : JSON.stringify({ ok: false, error: 'DIAGNOSTIC_TOO_LARGE', hint: 'Use shorter paths or simplify the rejected input.' });
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try { const result = await runHTMLCli(process.argv.slice(2)); console.log(summary(result)); if (!result.ok) process.exitCode = 1; }
  catch (e) { console.log(summary({ ok: false, error: (e as NodeJS.ErrnoException).code ?? String(e).slice(0,200) })); process.exitCode = 1; }
}
