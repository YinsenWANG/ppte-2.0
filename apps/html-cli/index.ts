#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { enhanceHTML } from '../../packages/html-document/src/index.js';

export async function runHTMLCli(args: string[]) {
  if (args.length !== 4 || args[0] !== 'enhance' || args[2] !== '--out' || !/\.html$/i.test(args[3])) throw Error('USAGE: ppte-html enhance input.html --out 作品.html');
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
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const result = await runHTMLCli(process.argv.slice(2)); console.log(summary(result)); if (!result.ok) process.exitCode = 1; }
  catch (e) { console.log(summary({ ok: false, error: (e as NodeJS.ErrnoException).code ?? String(e).slice(0,200) })); process.exitCode = 1; }
}
