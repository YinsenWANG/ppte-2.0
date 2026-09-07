import { readHistory, historyHTML } from './history-wire.js';
import type { HistoryWire } from '../../html-editor/src/versions.js';
import { createHash } from 'node:crypto';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { attr, cleanContent, elements, escapeText, textOf } from './content.js';
import { embedResources, type ResourceOptions } from './resources.js';
import { runtimeScript } from './runtime-bundle.js';
import { packMedia, unpackMedia } from './media-table.js';
export { cleanContent } from './content.js';
export interface Metadata { documentId: string; formatVersion: 1; saveRevision: number; mediaTable?: 1 }
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export function readEnhanced(html: string) {
  const nodes = elements(parse(html, { scriptingEnabled: false }));
  const template = nodes.find(e => e.tagName === 'template' && attr(e, 'id') === 'ppte-content');
  const meta = nodes.find(e => e.tagName === 'script' && attr(e, 'id') === 'ppte-metadata');
  if (!template || !('content' in template) || !meta) throw Error('HTML_DOCUMENT_ENVELOPE_INVALID');
  const content = (template as DefaultTreeAdapterMap['template']).content.childNodes.map(n => n.nodeName === '#text' ? (n as { value: string }).value : '').join('');
  const metadata: Metadata = JSON.parse(textOf(meta));
  if (metadata.formatVersion !== 1 || !/^[a-f0-9]{32}$/.test(metadata.documentId) || !Number.isSafeInteger(metadata.saveRevision) || metadata.saveRevision < 0) throw Error('HTML_DOCUMENT_METADATA_INVALID');
  const table = nodes.find(e => e.tagName === 'script' && attr(e, 'id') === 'ppte-media');
  return { content: unpackMedia(content, table ? JSON.parse(textOf(table)) : undefined), metadata };
}
export function envelope(content: string, metadata: Metadata, history?:HistoryWire) {
  const packed = metadata.mediaTable === 1 ? packMedia(content) : undefined;
  const media = packed ? `<script id="ppte-media" type="application/json">${JSON.stringify(packed.table).replace(/</g, '\\u003c')}</script>` : '';
  const script = runtimeScript.replace(/<\/script/gi, '<\\/script');
  const integrity = createHash('sha256').update(script).digest('base64');
  const title = elements(parse(content, { scriptingEnabled: false })).find(e => e.tagName === 'title');
  const policy = `default-src 'none'; script-src 'sha256-${integrity}'; style-src 'unsafe-inline' data:; frame-src 'self' about:; img-src data:; font-src data:; media-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  return `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeText(title ? textOf(title) : 'PPTe HTML')}</title><style>html,body{margin:0;width:100%;height:100%;background:#111}#ppte-frame{display:block;width:100%;height:100%;border:0}</style></head><body><template id="ppte-content">${escapeText(packed?.content ?? content)}</template>${media}${historyHTML(history)}<script id="ppte-metadata" type="application/json">${JSON.stringify(metadata).replace(/</g, '\\u003c')}</script><iframe id="ppte-frame" title="演示稿" sandbox="allow-same-origin" referrerpolicy="no-referrer"></iframe><script id="ppte-runtime">${script}</script></body></html>`;
}
export async function enhanceHTML(input: string, options: ResourceOptions) {
  // An envelope is never trusted as runtime; extract inert content and rebuild our own shell.
  const nodes = elements(parse(input, { scriptingEnabled: false }));
  const enhanced = nodes.some(e => e.tagName === 'template' && attr(e, 'id') === 'ppte-content');
  const existing = enhanced ? readEnhanced(input) : undefined;
  const embedded = await embedResources(existing?.content ?? input, options);
  const cleaned = cleanContent(embedded.html);
  const metadata: Metadata = existing?.metadata ?? { documentId: hash(cleaned.html).slice(0,32), formatVersion: 1, saveRevision: 0 };
  if (options.mediaTable) metadata.mediaTable = 1;
  return { html: envelope(cleaned.html, metadata, enhanced ? readHistory(input) : undefined), pages: cleaned.pages, issues: cleaned.issues, mediaBytes: embedded.mediaBytes, metadata };
}
/** Save service boundary: rebuild trusted envelope, never save a caller-supplied runtime. */
export function serializeContent(content: string, metadata: Metadata, history?:HistoryWire) {
  const cleaned = cleanContent(content);
  if (cleaned.issues.length) throw Error('UNSAFE_CONTENT: ' + JSON.stringify(cleaned.issues));
  return envelope(cleaned.html, { ...metadata, saveRevision: metadata.saveRevision + 1 }, history);
}
