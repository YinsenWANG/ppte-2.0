import { historyHTML } from '../../html-document/src/history-wire.js';
import { cleanContent } from '../../html-document/src/content.js';
import { mediaDigest, packMedia, unpackMedia } from '../../html-document/src/media-table.js';

export interface Version { id:string; time:number; name:string; kind:'auto'|'manual'|'before-restore'; block:string; resources:string[]; restoredFrom?:string }
export interface VersionIndex { schemaVersion:1; documentId:string; maxAuto:number; maxBytes:number; versions:Version[]; lastAuto:number }
/** Full checkpoints have no parent dependency. Payload strings remain inert until requested. */
export interface HistoryWire { index:string; blocks:Record<string,string>; resources:Record<string,string> }
const MiB=1024*1024, hardLimit=128*MiB, snapshotLimit=32*MiB;
const bytes=(s:string)=>new TextEncoder().encode(s).length;
const idOK=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const safe=(html:string)=>{if(bytes(html)>snapshotLimit)throw Error('版本内容超过 32 MiB 安全上限');const c=cleanContent(html);if(c.issues.length)throw Error('版本含不安全内容，不能恢复');return c.html;};
export class Versions {
  warning=''; decoded=0;
  private state?:VersionIndex;
  private blocks:Record<string,string>={}; private resources:Record<string,string>={};
  private cache?:{html:string;packed:ReturnType<typeof packMedia>};
  constructor(readonly documentId:string, private original?:HistoryWire, private currentResources:()=>Record<string,string>=()=>({})) {}
  replace(wire:HistoryWire|undefined,resources:Record<string,string>){this.original=wire;this.currentResources=()=>resources;this.state=undefined;this.blocks={};this.resources={};this.cache=undefined;this.warning='';this.decoded=0;}
  get index():VersionIndex {
    if(this.state)return structuredClone(this.state);
    try {
      if(!this.original) this.state={schemaVersion:1,documentId:this.documentId,maxAuto:20,maxBytes:16*MiB,versions:[],lastAuto:0};
      else {
        if(bytes(this.original.index)>MiB)throw Error('历史索引过大');
        const x=JSON.parse(this.original.index);
        if(x.schemaVersion!==1||x.documentId!==this.documentId||!Array.isArray(x.versions)||x.versions.length>1000||!Number.isFinite(x.lastAuto))throw Error('未知或损坏的历史格式');
        this.checkLimits(x.maxAuto,x.maxBytes);
        const ids=new Set();
        for(const v of x.versions) {
          if(!idOK(v.id)||ids.has(v.id)||!idOK(v.block)||(!Number.isFinite(v.time)||v.time<0||v.time>8640000000000000)||typeof v.name!=='string'||v.name.length>200||!['auto','manual','before-restore'].includes(v.kind)||!Array.isArray(v.resources)||v.resources.length>4096||!v.resources.every(idOK)||(v.restoredFrom!==undefined&&!idOK(v.restoredFrom)))throw Error('版本索引损坏');
          ids.add(v.id);
        }
        this.state=x;
        this.blocks={...this.original.blocks};this.resources={...this.original.resources};
      }
      return structuredClone(this.state!);
    }catch(e){this.warning=String(e)+'；原始历史保留，当前内容仍可保存。';throw e;}
  }
  private checkLimits(count:number,size:number){if(!Number.isInteger(count)||count<0||count>200||!Number.isSafeInteger(size)||size<1024||size>hardLimit)throw Error('容量须为 1 KiB–128 MiB，自动版本数须为 0–200');}
  private packed(html:string){if(this.cache?.html!==html)this.cache={html,packed:packMedia(safe(html))};return this.cache.packed;}
  private collect(index:VersionIndex,blocks:Record<string,string>,resources:Record<string,string>){
    const b=new Set(index.versions.map(v=>v.block)),r=new Set(index.versions.flatMap(v=>v.resources));
    return {blocks:Object.fromEntries(Object.entries(blocks).filter(([id])=>b.has(id))),resources:Object.fromEntries(Object.entries(resources).filter(([id])=>r.has(id)))};
  }
  private size(index:VersionIndex,blocks:Record<string,string>,resources:Record<string,string>,current:Record<string,string>){
    return bytes(historyHTML({index:JSON.stringify(index),blocks,resources:Object.fromEntries(Object.entries(resources).filter(([id])=>!Object.hasOwn(current,id)))}));
  }
  usage(currentHTML?:string){const index=this.index,resources={...this.currentResources(),...this.resources};const pool=this.original?{blocks:this.blocks,resources}:this.collect(index,this.blocks,resources);return this.size(index,pool.blocks,pool.resources,currentHTML?packMedia(currentHTML).table.resources:this.currentResources());}
  /** Pruning commits atomically; only unnamed automatic versions are eligible. */
  private commit(index:VersionIndex,blocks:Record<string,string>,resources:Record<string,string>,current:Record<string,string>,protect?:string){
    let pool=this.collect(index,blocks,{...this.currentResources(),...resources});
    const over=()=>index.versions.filter(v=>v.kind==='auto'&&!v.name).length>index.maxAuto||this.size(index,pool.blocks,pool.resources,current)>index.maxBytes;
    while(over()){
      const oldest=index.versions.filter(v=>v.kind==='auto'&&!v.name&&v.id!==protect).sort((a,b)=>a.time-b.time)[0];
      if(!oldest)throw Error('历史容量已满；新增历史暂停。请删除旧版本或调整上限；当前内容仍可保存或下载。');
      index.versions=index.versions.filter(v=>v.id!==oldest.id);pool=this.collect(index,pool.blocks,pool.resources);
    }
    this.state=index;this.blocks=pool.blocks;this.resources=pool.resources;this.original=undefined;this.warning='';
  }
  add(html:string,kind:Version['kind'],name='',now=Date.now(),restoredFrom?:string):Version|undefined {
    const index=this.index;
    if(kind==='auto'&&(index.maxAuto===0||now-index.lastAuto<300000))return;
    if(name.length>200)throw Error('版本名称最多 200 字');
    const packed=this.packed(html),block=mediaDigest(packed.content);
    const same=index.versions.find(v=>v.block===block);
    // Preserve a restoration event even when its content already exists; block bytes remain shared.
    if(same&&kind!=='before-restore'){
      if(name){same.name=name;same.kind='manual';this.commit(index,this.blocks,this.resources,packed.table.resources,same.id);}
      return same;
    }
    const v:Version={id:mediaDigest(`${block}:${now}:${index.versions.length}:${kind}`),time:now,name,kind,block,resources:Object.keys(packed.table.resources),...(restoredFrom?{restoredFrom}:{})};
    if(index.versions.length>=1000)throw Error('历史版本总数已达 1000，请删除旧版本');
    index.versions.push(v);if(kind==='auto')index.lastAuto=now;
    this.commit(index,{...this.blocks,[block]:packed.content},{...this.currentResources(),...this.resources,...packed.table.resources},packed.table.resources,v.id);
    return v;
  }
  automatic(html:string,now=Date.now()){try{return this.add(html,'auto','',now);}catch(e){this.warning=String(e);return undefined;}}
  rename(id:string,name:string){if(!name.trim()||name.length>200)throw Error('请输入 1–200 字名称');const x=this.index,v=x.versions.find(v=>v.id===id);if(!v)throw Error('版本不存在');v.name=name;this.commit(x,this.blocks,this.resources,this.currentResources(),id);}
  remove(id:string){const x=this.index;x.versions=x.versions.filter(v=>v.id!==id);const pool=this.collect(x,this.blocks,{...this.currentResources(),...this.resources});this.state=x;this.blocks=pool.blocks;this.resources=pool.resources;this.original=undefined;this.warning='';}
  limits(maxAuto:number,maxBytes:number,currentHTML:string){this.checkLimits(maxAuto,maxBytes);const x=this.index;x.maxAuto=maxAuto;x.maxBytes=maxBytes;this.commit(x,this.blocks,this.resources,packMedia(currentHTML).table.resources);}
  preview(id:string){
    const v=this.index.versions.find(v=>v.id===id);if(!v)throw Error('版本不存在');
    const block=this.blocks[v.block];if(typeof block!=='string'||bytes(block)>snapshotLimit||mediaDigest(block)!==v.block)throw Error('此版本不可恢复：内容检查点缺失或损坏');
    const pool={...this.currentResources(),...this.resources},selected:Record<string,string>={};let total=bytes(block);
    for(const id of v.resources){const value=pool[id];if(typeof value!=='string')throw Error('此版本不可恢复：资源缺失');total+=bytes(value);if(total>snapshotLimit)throw Error('版本超过解码安全上限');selected[id]=value;}
    // Validates digests and references only for this checkpoint, never executes author scripts.
    for(const [id,value] of Object.entries(selected)){const count=block.split('ppte-resource:'+id).length-1;total+=(count-1)*bytes(value);if(total>snapshotLimit)throw Error('版本展开超过安全上限');}
    const html=safe(unpackMedia(block,{version:1,resources:selected}));this.decoded++;return html;
  }
  restore(id:string,current:string){const target=this.preview(id);this.add(current,'before-restore','',Date.now(),id);return target;}
  wire(current:Record<string,string>={},documentId=this.documentId):HistoryWire|undefined {
    // Unknown/truncated data survives ordinary saves byte-for-byte (as inert text).
    if(this.original)return {...this.original,...(this.state&&documentId!==this.documentId?{index:JSON.stringify({...this.state,documentId})}:{}),resources:Object.fromEntries(Object.entries({...this.currentResources(),...this.original.resources}).filter(([id])=>!Object.hasOwn(current,id)))};
    if(!this.state)return undefined;
    const pool=this.collect(this.state,this.blocks,{...this.currentResources(),...this.resources});
    return {index:JSON.stringify({...this.state,documentId}),blocks:pool.blocks,resources:Object.fromEntries(Object.entries(pool.resources).filter(([id])=>!Object.hasOwn(current,id)))};
  }
}
