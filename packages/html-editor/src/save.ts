export type SaveState = 'saved' | 'dirty' | 'saving' | 'draft' | 'unauthorized' | 'conflict' | 'failed';
export interface Snapshot { content: string; hash: string; metadata: {documentId: string; saveRevision: number}; fileKey: string; name: string }
export interface Adapter { authorize?():Promise<void>; load(): Promise<Snapshot>; write(expected: string, content: string): Promise<Snapshot> }
export async function sha(text: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join(''); }
export function loopbackAdapter(token: string): Adapter {
  const call = async (route: string, data?: object) => {
    const response = await fetch(route,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const result = await response.json(); if (!response.ok) throw Error(result.error); return result;
  };
  return {load:()=>call('/api/file'),write:(expected,content)=>call('/api/save',{expected,content})};
}
export interface FileHandle { name: string; queryPermission(o:object):Promise<string>; requestPermission(o:object):Promise<string>; getFile():Promise<{text():Promise<string>}>; createWritable():Promise<{write(s:string):Promise<void>;close():Promise<void>;abort():Promise<void>}> }
export function fileAdapter(handle: FileHandle, decode:(s:string)=>Snapshot, encode:(content:string,revision:number)=>string): Adapter {
  const load = async () => { const text = await (await handle.getFile()).text(); return {...decode(text),hash:await sha(text),fileKey:handle.name,name:handle.name}; };
  return {load,async authorize(){if(await handle.requestPermission({mode:'readwrite'})!=='granted')throw Error('PERMISSION_REVOKED');}, async write(expected,content) {
    const perform = async () => {
      if (await handle.queryPermission({mode:'readwrite'}) !== 'granted') throw Error('PERMISSION_REVOKED');
      const before = await load(); if (before.hash !== expected) throw Error('CONFLICT');
      const output = encode(content,before.metadata.saveRevision+1);
      const stream = await handle.createWritable();
      try { if ((await load()).hash !== expected) throw Error('CONFLICT'); await stream.write(output); await stream.close(); }
      catch (e) { await stream.abort().catch(()=>{}); throw e; }
      const after = await load(); if (after.hash !== await sha(output)) throw Error('CONFLICT_AFTER_WRITE'); return after;
    };
    if (globalThis.navigator?.locks) return navigator.locks.request(`ppte:${handle.name}`,perform);
    return perform();
  }};
}
export interface Draft { documentId:string; base:string; revision:number; time:number; content:string }
export class SaveController {
  state: SaveState = 'unauthorized'; detail = ''; revision = 0; composing = false; dirty = false;
  private timer?: ReturnType<typeof setTimeout>; private running = false;
  constructor(public adapter:Adapter|undefined, public base:Snapshot, private content:()=>string, private notify:()=>void, private storage?: Pick<Storage,'getItem'|'setItem'|'removeItem'>, public key = '') {}
  set(state:SaveState,detail='') { this.state=state;this.detail=detail;this.notify(); }
  draft() {
    try { if (!this.storage) throw Error('草稿存储不可用'); this.storage.setItem(this.key,JSON.stringify({documentId:this.base.metadata.documentId,base:this.base.hash,revision:this.revision,time:Date.now(),content:this.content()} satisfies Draft)); }
    catch { this.detail='草稿存储不可用或配额已满；修改尚未写入文件';this.notify(); }
  }
  recover():Draft|undefined { try { const raw=this.storage?.getItem(this.key);if(!raw)return;const d=JSON.parse(raw);if(typeof d.content!=='string'||d.documentId!==this.base.metadata.documentId)throw Error();if(d.base!==this.base.hash){this.set('conflict','草稿基准已变化；可保留草稿或重新读取文件');}return d; }catch{this.set('failed','草稿不可读取');} }
  change() { this.dirty=true;this.revision++;this.set(this.adapter?'dirty':'draft');if(!this.composing)this.schedule(); }
  schedule() { clearTimeout(this.timer); this.draft(); this.timer=setTimeout(()=>void this.flush(),800); }
  composition(active:boolean) {this.composing=active;clearTimeout(this.timer);if(!active&&this.dirty)this.schedule();}
  async flush() {
    clearTimeout(this.timer);if(this.composing||this.running||!this.dirty||this.state==='conflict')return;
    if(!this.adapter){this.draft();this.set('draft',this.detail);return;}
    this.running=true;const rev=this.revision;this.set('saving');
    try {
      const next=await this.adapter.write(this.base.hash,this.content());this.base=next;
      if(rev===this.revision){this.dirty=false;try{this.storage?.removeItem(this.key);}catch{}this.set('saved');}
      else {this.set('dirty');this.schedule();}
    } catch(e) {this.draft();const message=String(e);this.set(message.includes('CONFLICT')?'conflict':message.includes('PERMISSION')?'unauthorized':'failed',message);}
    finally {this.running=false;}
  }
}
