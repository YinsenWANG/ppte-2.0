import { parse, serialize, type DefaultTreeAdapterMap } from 'parse5';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';

export type Element = DefaultTreeAdapterMap['element'];
export type Node = DefaultTreeAdapterMap['node'];
export type Issue = { code: string; detail: string };
export const CONTENT_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' data:; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export function elements(node: Node): Element[] {
  const result: Element[] = [];
  const visit = (n: Node) => {
    if ('tagName' in n) result.push(n);
    if ('childNodes' in n) n.childNodes.forEach(visit);
    if ('content' in n) visit(n.content);
  };
  visit(node); return result;
}
export function attr(el: Element, name: string) { return el.attrs.find(a => a.name === name)?.value; }
export function setAttr(el: Element, name: string, value: string) {
  const a = el.attrs.find(a => a.name === name);
  if (a) a.value = value; else el.attrs.push({ name, value });
}
export function remove(el: Element) {
  const parent = el.parentNode;
  if (parent) parent.childNodes = parent.childNodes.filter(n => n !== el);
}
export function textOf(el: Element) { return el.childNodes.filter(n => n.nodeName === '#text').map(n => (n as DefaultTreeAdapterMap['textNode']).value).join(''); }
export function setText(el: Element, value: string) { el.childNodes = [{ nodeName: '#text', value, parentNode: el }]; }
export function dataAllowed(url: string, depth = 0): boolean {
  if (depth > 8) return false;
  const m = /^data:([^;,]+)(;base64)?,([\s\S]*)$/i.exec(url.split('#')[0]);
  if (!m) return false;
  const mime = m[1].toLowerCase();
  if (/^(image\/(png|jpeg|gif|webp|avif)|font\/(woff2?|ttf|otf)|audio\/(mpeg|ogg|wav)|video\/(mp4|webm|ogg))$/.test(mime)) return !!m[2];
  let decoded: string;
  try { decoded = m[2] ? new TextDecoder().decode(Uint8Array.from(atob(m[3]), c => c.charCodeAt(0))) : decodeURIComponent(m[3]); } catch { return false; }
  if (mime === 'text/css') { try { checkCss(decoded, depth + 1); return true; } catch { return false; } }
  if (mime === 'image/svg+xml') {
    const cleaned = cleanContent(decoded, false, depth + 1);
    return !cleaned.issues.length && elements(parse(decoded, { scriptingEnabled: false })).some(e => e.tagName === 'svg');
  }
  return false;
}
export function checkCss(css: string, depth = 0) {
  const root = postcss.parse(css);
  const checkValue = (value: string) => {
    valueParser(value).walk(n => {
      if (n.type === 'function' && /^(url|src)$/i.test(n.value)) {
        const url = valueParser.stringify(n.nodes).trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
        if (!url.startsWith('#') && !dataAllowed(url, depth)) throw Error('CSS_RESOURCE_NOT_EMBEDDED');
      }
      // String alternatives in image-set can load URLs without url().
      if (n.type === 'function' && /image-set$/i.test(n.value) && n.nodes.some(x => x.type === 'string')) throw Error('CSS_IMAGE_SET_STRING_UNSUPPORTED');
    });
    if (/\\|expression\s*\(|javascript\s*:|-moz-binding|behavior\s*:/i.test(value)) throw Error('CSS_EXECUTABLE_OR_ESCAPED_VALUE');
  };
  root.walkDecls(d => { checkValue(d.value); if (/^(behavior|-moz-binding)$/i.test(d.prop)) throw Error('CSS_EXECUTABLE_PROPERTY'); });
  root.walkAtRules(r => {
    if (r.name.toLowerCase() === 'import') {
      const first = valueParser(r.params).nodes[0];
      if (first?.type === 'string') { if (!dataAllowed(first.value, depth)) throw Error('CSS_RESOURCE_NOT_EMBEDDED'); }
      else checkValue(r.params);
    }
  });
}
const forbidden = new Set(['script','iframe','frame','frameset','object','embed','base','meta','link','form','input','button','textarea','select','option','portal','applet','animate','animatemotion','animatetransform','set','discard']);
const transient = new Set(['contenteditable','autofocus','tabindex','draggable','spellcheck']);
const urls = new Set(['src','href','poster','background','action','formaction','data','cite','longdesc']);
/** Parse without executing. No layout schema: the HTML tree and CSS remain the representation. */
export function cleanContent(input: string, addIds = true, depth = 0) {
  const document = parse(input, { scriptingEnabled: false });
  const issues: Issue[] = [];
  const report = (code: string, detail: string) => { if (issues.length < 200) issues.push({ code, detail: detail.slice(0, 200) }); };
  for (const el of elements(document)) {
    const tag = el.tagName.toLowerCase();
    if ((forbidden.has(tag) && !(tag === 'meta' && (attr(el, 'charset') !== undefined || ['viewport','description','author','keywords','color-scheme'].includes(attr(el, 'name') ?? '')))) || attr(el, 'data-ppte-transient') !== undefined) {
      if (attr(el, 'data-ppte-transient') === undefined && !(tag === 'meta' && attr(el, 'charset'))) report('CONTENT_ELEMENT_REMOVED', tag);
      remove(el); continue;
    }
    el.attrs = el.attrs.filter(a => {
      const name = a.name.toLowerCase();
      if (transient.has(name) || name.startsWith('data-ppte-editor-')) return false;
      if (name.startsWith('on') || ['srcdoc','srcset','ping','download','target','is','http-equiv','nonce'].includes(name)) { report('CONTENT_ATTRIBUTE_REMOVED', `${tag}.${name}`); return false; }
      if (urls.has(name)) {
        if (a.value.startsWith('#') && name === 'href') return true;
        if (['src','poster','background','href'].includes(name) && dataAllowed(a.value, depth) && !(tag === 'a' || tag === 'area')) return true;
        report('CONTENT_URL_REMOVED', `${tag}.${name}`); return false;
      }
      if (['fill','stroke','filter','clip-path','mask','cursor'].includes(name) && /url/i.test(a.value)) { try { checkCss(`x{${name}:${a.value}}`, depth); } catch (e) { report('CONTENT_CSS_REJECTED', String(e)); return false; } }
      if (name === 'style' && !a.value.trim()) return false; // Chromium leaves empty style attributes when contentEditable toggles.
      if (name === 'style') { try { checkCss(`x{${a.value}}`, depth); } catch (e) { report('CONTENT_CSS_REJECTED', String(e)); return false; } }
      return true;
    });
    if (tag === 'style') {
      try { checkCss(textOf(el), depth); } catch (e) { report('CONTENT_CSS_REJECTED', String(e)); remove(el); }
    }
  }
  const all = elements(document);
  if (addIds) {
    let slides = all.filter(e => attr(e, 'data-ppte-slide') !== undefined);
    if (!slides.length) { const body = all.find(e => e.tagName === 'body')!; setAttr(body, 'data-ppte-slide', ''); slides = [body]; }
    // Reserve author IDs first so generated IDs cannot steal a later explicit identity.
    const used = new Set(all.map(e => attr(e, 'data-ppte-id')).filter((v): v is string => !!v));
    const seen = new Set<string>(); let sequence = 0;
    for (const el of all) {
      if (['html','head','title','style','template'].includes(el.tagName)) continue;
      const previous = attr(el, 'data-ppte-id');
      if (previous && !seen.has(previous)) { seen.add(previous); continue; }
      if (previous) report('DUPLICATE_ID_REPLACED', previous);
      let id: string; do { id = `ppte-${++sequence}`; } while (used.has(id));
      setAttr(el, 'data-ppte-id', id); used.add(id); seen.add(id);
    }
    slides.forEach(el => setAttr(el, 'data-ppte-slide', attr(el, 'data-ppte-id')!));
  }
  return { html: serialize(document), issues, pages: elements(document).filter(e => attr(e, 'data-ppte-slide') !== undefined).length };
}
export function frameContent(html: string, deferOffPageMedia = false) {
  // Structural insertion: a quoted > in author attributes cannot precede/break the policy.
  const document = parse(html, { scriptingEnabled: false });
  if (deferOffPageMedia) {
    const all = elements(document), first = all.find(e => attr(e, 'data-ppte-slide') !== undefined);
    for (const el of all) if (['img','video','audio','source'].includes(el.tagName)) {
      let parent: Node | null = el;
      while (parent && parent !== first && !('tagName' in parent && attr(parent, 'data-ppte-slide') !== undefined)) parent = 'parentNode' in parent ? parent.parentNode : null;
      if (!parent || parent === first) continue;
      for (const a of el.attrs) if (['src','poster'].includes(a.name)) a.name = 'data-ppte-editor-media-' + a.name;
    }
  }
  const head = elements(document).find(e => e.tagName === 'head')!;
  const policy = elements(parse(`<meta http-equiv="Content-Security-Policy" content="${CONTENT_CSP}">`)).find(e => e.tagName === 'meta')!;
  policy.parentNode = head; head.childNodes.unshift(policy);
  return serialize(document);
}
export function escapeText(value: string) { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
