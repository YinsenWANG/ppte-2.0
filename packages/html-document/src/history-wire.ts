import { parse } from 'parse5';
import { attr, elements, escapeText, textOf } from './content.js';
import type { HistoryWire } from '../../html-editor/src/versions.js';
/** Inert transport; unknown schemas remain opaque, including through CLI re-enhancement. */
export function readHistory(html:string):HistoryWire|undefined {
 const nodes=elements(parse(html,{scriptingEnabled:false})),index=nodes.find(e=>attr(e,'id')==='ppte-history-index');
 if(!index)return;
 const read=(kind:string)=>Object.fromEntries(nodes.filter(e=>e.tagName==='template'&&attr(e,kind)!==undefined&&'content' in e).map(e=>[attr(e,kind)!,textOf((e as any).content)]));
 return {index:textOf(index),blocks:read('data-ppte-version-block'),resources:read('data-ppte-version-resource')};
}
export function historyHTML(wire?:HistoryWire){
 if(!wire)return '';
 const templates=(kind:string,values:Record<string,string>)=>Object.entries(values).map(([id,value])=>`<template ${kind}="${escapeText(id).replace(/"/g,'&quot;')}">${escapeText(value)}</template>`).join('');
 return `<script id="ppte-history-index" type="application/json">${wire.index.replace(/</g,'\\u003c')}</script>`+templates('data-ppte-version-block',wire.blocks)+templates('data-ppte-version-resource',wire.resources);
}

export function validateHistoryWire(value:unknown):HistoryWire {
 const w=value as HistoryWire;if(!w||typeof w.index!=='string'||w.index.length>1024*1024)throw Error('HISTORY_WIRE_INVALID');
 for(const pool of [w.blocks,w.resources])if(!pool||typeof pool!=='object'||Array.isArray(pool)||Object.entries(pool).some(([id,v])=>!/^[a-f0-9]{64}$/.test(id)||typeof v!=='string'))throw Error('HISTORY_WIRE_INVALID');
 return w;
}
