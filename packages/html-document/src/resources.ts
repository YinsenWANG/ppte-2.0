import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { parse, serialize } from 'parse5';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import { attr, elements, setText, textOf, dataAllowed } from './content.js';

export interface ResourceOptions { root: string; base: string; assetMap?: Record<string, string>; maxBytes?: number; cacheContext?: string; mediaTable?: boolean }
const mime: Record<string, string> = { '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.avif':'image/avif','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf','.mp4':'video/mp4','.webm':'video/webm','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav' };
// Process-local LRU: no handles, permission decisions, or visual interpretations.
// Actual bytes are reread on each invocation; the digest, MIME, encoder version,
// root and caller requirement/transform context form the encoding identity.
const encoded = new Map<string, string>();
let cacheBytes = 0;
const CACHE_LIMIT = 8 * 1024 * 1024;
function retain(key: string, value: string) {
  if(value.length * 2 > CACHE_LIMIT)return;
  while(encoded.size >= 128 || cacheBytes + value.length * 2 > CACHE_LIMIT) {
    const oldest=encoded.keys().next().value!;
    cacheBytes-=encoded.get(oldest)!.length * 2; encoded.delete(oldest);
  }
  encoded.set(key,value); cacheBytes+=value.length * 2;
}
/** Only explicitly local, realpath-confined assets. No fetch, shell, browser or font download. */
export async function embedResources(input: string, options: ResourceOptions) {
  const root = await realpath(options.root);
  let mediaBytes = 0;
  const metrics = { reads:0, encodings:0, hits:0, misses:0, authorizationChecks:0, referencedBytes:0, cacheBytes:0 };
  const files = new Map<string, Promise<Buffer>>();
  const visited = new Set<string>();
  const read = async (url: string, base: string) => {
    const mapped = options.assetMap?.[url];
    if (!mapped && (/^[a-z][\w+.-]*:/i.test(url) || url.startsWith('//'))) throw Error('RESOURCE_AUTHORIZATION_REQUIRED');
    metrics.authorizationChecks++;
    const path = await realpath(mapped ? resolve(root, mapped) : resolve(base, decodeURIComponent(url.split(/[?#]/)[0])));
    const rel = relative(root, path);
    if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw Error('RESOURCE_OUTSIDE_ROOT');
    let pending=files.get(path);
    if(!pending) { metrics.reads++; pending=readFile(path); files.set(path,pending); }
    const bytes = await pending;
    // Budget remains per reference, as before; cache hits do not relax it.
    metrics.referencedBytes += bytes.length;
    mediaBytes += bytes.length;
    if (mediaBytes > (options.maxBytes ?? 64 * 1024 * 1024)) throw Error('RESOURCE_BUDGET_EXCEEDED');
    return { path, bytes };
  };
  const resource = async (url: string, base: string): Promise<string> => {
    if (url.startsWith('#')) return url;
    if (url.startsWith('data:')) { if (!dataAllowed(url)) throw Error('RESOURCE_DATA_UNSAFE'); return url; }
    const { path, bytes } = await read(url, base);
    const type = mime[extname(path).toLowerCase()];
    if (!type) throw Error('RESOURCE_TYPE_UNSUPPORTED');
    const fragment = url.includes('#') ? url.slice(url.indexOf('#')) : '';
    const key=JSON.stringify([root,createHash('sha256').update(bytes).digest('hex'),type,'base64-v1',options.cacheContext ?? '']);
    let payload=encoded.get(key);
    if(payload) { metrics.hits++; encoded.delete(key); encoded.set(key,payload); }
    else { metrics.misses++; metrics.encodings++; payload=`data:${type};base64,${bytes.toString('base64')}`; retain(key,payload); }
    const data = payload + fragment;
    if (!dataAllowed(data)) throw Error('RESOURCE_DATA_UNSAFE');
    return data;
  };
  const css = async (source: string, base: string): Promise<string> => {
    const tree = postcss.parse(source);
    const imports: postcss.AtRule[] = []; tree.walkAtRules('import', r => { imports.push(r); });
    for (const rule of imports) {
      const parsed = valueParser(rule.params); const node = parsed.nodes[0];
      if (!node || !(node.type === 'string' || node.type === 'function' && node.value.toLowerCase() === 'url')) throw Error('CSS_IMPORT_UNSUPPORTED');
      const url = node.type === 'string' ? node.value : valueParser.stringify(node.nodes).trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
      let embedded: string;
      if (url.startsWith('data:')) { if (!dataAllowed(url)) throw Error('RESOURCE_DATA_UNSAFE'); embedded = url; }
      else {
        const { path, bytes } = await read(url, base);
        if (visited.has(path) || visited.size >= 16) throw Error('CSS_IMPORT_CYCLE_OR_DEPTH');
        visited.add(path);
        embedded = `data:text/css;base64,${Buffer.from(await css(bytes.toString('utf8'), dirname(path))).toString('base64')}`;
        visited.delete(path);
      }
      // Keep native layer/supports/media import conditions exactly as authored.
      rule.params = `url("${embedded}")${valueParser.stringify(parsed.nodes.slice(1))}`;
    }
    const declarations: postcss.Declaration[] = []; tree.walkDecls(d => { declarations.push(d); });
    for (const declaration of declarations) {
      const parsed = valueParser(declaration.value);
      const nodes: valueParser.FunctionNode[] = [];
      parsed.walk(n => { if (n.type === 'function' && n.value.toLowerCase() === 'url') nodes.push(n); });
      for (const node of nodes) {
        const url = valueParser.stringify(node.nodes).trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
        const embedded = await resource(url, base);
        node.nodes = [{ type: 'string', quote: '"', value: embedded, sourceIndex: 0, sourceEndIndex: embedded.length }];
      }
      declaration.value = parsed.toString();
    }
    return tree.toString();
  };
  const document = parse(input, { scriptingEnabled: false });
  const jobs: (() => Promise<void>)[] = [];
  for (const el of elements(document)) {
    if (el.tagName === 'link' && attr(el, 'rel')?.toLowerCase() === 'stylesheet') {
      if (attr(el, 'disabled') !== undefined) throw Error('DISABLED_STYLESHEET_UNSUPPORTED');
      const href = attr(el, 'href'); if (!href) throw Error('STYLESHEET_HREF_MISSING');
      const { path, bytes } = await read(href, options.base);
      const media = attr(el, 'media');
      const content = await css(bytes.toString('utf8'), dirname(path));
      el.tagName = el.nodeName = 'style'; el.attrs = el.attrs.filter(a => ['id','class','title'].includes(a.name));
      setText(el, media ? `@media ${media}{${content}}` : content);
    } else if (el.tagName === 'style') setText(el, await css(textOf(el), options.base));
    for (const a of el.attrs) {
      if (a.name === 'style') { const result = await css(`x{${a.value}}`, options.base); a.value = result.slice(result.indexOf('{') + 1, result.lastIndexOf('}')); }
      if (['src','poster','background'].includes(a.name) && !['script','iframe','embed','input'].includes(el.tagName)) jobs.push(async()=>{a.value = await resource(a.value, options.base);});
      if (a.name === 'href' && ['image','use','feImage'].includes(el.tagName)) jobs.push(async()=>{a.value = await resource(a.value, options.base);});
    }
  }
  for(let i=0;i<jobs.length;i+=4) await Promise.all(jobs.slice(i,i+4).map(job=>job()));
  metrics.cacheBytes=cacheBytes;
  return { html: serialize(document), mediaBytes, metrics };
}
