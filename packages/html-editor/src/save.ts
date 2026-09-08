import type { HistoryWire } from './versions.js';
export type SaveState = 'saved' | 'dirty' | 'saving' | 'draft' | 'unauthorized' | 'conflict' | 'failed';
export interface Snapshot { history?:HistoryWire; content: string; hash: string; metadata: {documentId: string; saveRevision: number}; fileKey: string; name: string; recoveryHash?: string }
export interface Adapter { authorize?():Promise<void>; load(): Promise<Snapshot>; write(expected: string, content: string): Promise<Snapshot> }
export async function sha(text: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join(''); }
// Recovery compares canonical content and persisted revision; disk conflicts use full file bytes.
export const recoveryFingerprint = (s: Pick<Snapshot, 'content' | 'metadata'>) => sha(JSON.stringify([s.metadata.documentId,s.metadata.saveRevision,s.content]));
export function loopbackAdapter(token: string, history?:()=>HistoryWire|undefined): Adapter {
  const call = async (route: string, data?: object) => {
    const response = await fetch(route,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const result = await response.json(); if (!response.ok) throw Error(result.error); return result;
  };
  return {load:()=>call('/api/file'),write:(expected,content)=>call('/api/save',{expected,content,...(history?{history:history()}:{} )})};
}
export interface FileHandle { name: string; queryPermission(o:object):Promise<string>; requestPermission(o:object):Promise<string>; getFile():Promise<{text():Promise<string>}>; createWritable():Promise<{write(s:string):Promise<void>;close():Promise<void>;abort():Promise<void>}> }
export function fileAdapter(handle: FileHandle, decode:(s:string)=>Snapshot, encode:(content:string,revision:number)=>string): Adapter {
  const load = async () => { const text = await (await handle.getFile()).text(); const decoded=decode(text); return {...decoded,hash:await sha(text),recoveryHash:await recoveryFingerprint(decoded),fileKey:handle.name,name:handle.name}; };
  return {load,async authorize(){if(await handle.queryPermission({mode:'readwrite'})!=='granted' && await handle.requestPermission({mode:'readwrite'})!=='granted')throw Error('PERMISSION_REVOKED');}, async write(expected,content) {
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
  state: SaveState = 'unauthorized'; detail = ''; revision = 0; confirmedFileRevision: number | null = null; exportedRevision: number | null = null; draftAvailable = false; composing = false; dirty = false;
  private timer?: ReturnType<typeof setTimeout>; private running = false;
  autoSave = true; lastSavedAt: number | null = null;
  private deadline?: ReturnType<typeof setTimeout>;
  private queued = false;
  private lastDraft?: string;
  private draftRevision = -1;
  private draftBase = '';
  draftError = '';
  private draftTimer?: ReturnType<typeof setTimeout>;
  private cached?: {revision:number; content:string};
  snapshotContent() {
    if(this.cached?.revision!==this.revision)this.cached={revision:this.revision,content:this.content()};
    return this.cached.content;
  }
  constructor(public adapter:Adapter|undefined, public base:Snapshot, private content:()=>string, private notify:()=>void, private storage?: Pick<Storage,'getItem'|'setItem'|'removeItem'>, public key = '') {}
  get dirtyRevision() { return this.revision; }
  get busy() { return this.running; }
  set(state:SaveState,detail='') { this.state=state;this.detail=detail;this.notify(); }
  draft() {
    if(this.composing)return;
    try {
      if (!this.storage) throw Error('草稿存储不可用');
      const base=this.base.recoveryHash ?? this.base.hash;
      if(this.draftAvailable && this.draftRevision===this.revision && this.draftBase===base)return;
      const value=JSON.stringify({documentId:this.base.metadata.documentId,base:this.base.recoveryHash ?? this.base.hash,revision:this.revision,time:Date.now(),content:this.snapshotContent()} satisfies Draft);
      this.storage.setItem(this.key,value);this.lastDraft=value;this.draftAvailable=true;this.draftRevision=this.revision;this.draftBase=base;this.draftError='';
    }
    catch { this.draftAvailable=false;this.draftError='草稿存储不可用或配额已满；文件保存仍可重试';if(!this.detail)this.detail=this.draftError;this.notify(); }
  }
  preserveRecovery(content:string, draft?:Draft) {
    try { this.storage?.setItem(this.key+':retained',JSON.stringify(draft ?? {documentId:this.base.metadata.documentId,base:this.base.recoveryHash??this.base.hash,revision:this.revision,time:Date.now(),content})); }
    catch { this.draftError='恢复副本暂仅保留在当前页面；浏览器缓存不可用';this.notify(); }
  }
  dismissRecovery() { try { this.storage?.removeItem(this.key+':retained');if(!this.dirty)this.storage?.removeItem(this.key); } catch {} if(this.dirty){this.draftAvailable=false;this.draft();} }
  recover():Draft|undefined { try { const raw=this.storage?.getItem(this.key) ?? this.storage?.getItem(this.key+':retained');if(!raw)return;const d=JSON.parse(raw);if(typeof d.content!=='string'||d.documentId!==this.base.metadata.documentId)throw Error();if(d.base!==(this.base.recoveryHash ?? this.base.hash)){this.set('conflict','草稿基准已变化；可保留草稿或重新读取文件');}return d; }catch{this.draftError='草稿不可读取；文件保存仍可使用';this.notify();} }
  change() { this.dirty=true;this.revision++;if(!['conflict','failed','unauthorized'].includes(this.state)||this.state==='unauthorized'&&(!this.detail||this.detail.startsWith('尚未关联写入文件')))this.set(this.running?'saving':this.adapter?'dirty':'draft');if(!this.composing)this.schedule(); }
  exported(revision:number) { this.exportedRevision=revision;this.set(this.state,'已发起下载，原文件未覆盖（下载是否落盘由浏览器决定）'); }
  // First edit is recoverable immediately; sustained typing checkpoints at most every
  // 200ms (plus main-thread scheduling delay). This is a disclosed crash-loss window.
  schedule() {
    clearTimeout(this.timer);
    if(!this.draftTimer) {
      if(this.lastDraft===undefined && !this.draftError)this.draft();
      // A known unavailable cache should not repeatedly block typing with a full
      // large-document JSON write. Retry during continued editing after 2s; explicit
      // save/visibility/close checkpoints still attempt immediately. No draft is deleted.
      this.draftTimer=setTimeout(()=>{this.draftTimer=undefined;if(this.dirty)this.draft();},this.draftError?2000:200);
    }
    if(this.adapter && this.autoSave && !['conflict','failed','unauthorized'].includes(this.state)) {
      this.timer=setTimeout(()=>void this.flush(false),1000);
      this.deadline ??= setTimeout(()=>void this.flush(false),10000);
    }
  }
  setAutoSave(active:boolean) { this.autoSave=active;clearTimeout(this.timer);clearTimeout(this.deadline);this.deadline=undefined;if(active&&this.dirty&&!this.composing)this.schedule();this.notify(); }
  composition(active:boolean) {this.composing=active;clearTimeout(this.timer);clearTimeout(this.deadline);this.deadline=undefined;if(!active&&this.dirty)this.schedule();}
  async flush(manual=true) {
    clearTimeout(this.timer);clearTimeout(this.deadline);this.deadline=undefined;
    if(this.composing||!this.dirty||this.state==='conflict'||!manual&&['failed','unauthorized'].includes(this.state))return;
    if(this.running){this.queued ||= manual;return;}
    if(!this.adapter){this.draft();this.set('draft',this.detail);return;}
    this.running=true;const rev=this.revision;this.set('saving');
    try {
      const next=await this.adapter.write(this.base.hash,this.snapshotContent());this.base=next;this.confirmedFileRevision=rev;this.lastSavedAt=Date.now();
      if(rev===this.revision){
        this.dirty=false;
        // Another window may have replaced this recovery entry while the file write
        // was pending. Its unsaved content must survive our acknowledgement.
        try{if(this.lastDraft!==undefined&&this.storage?.getItem(this.key)===this.lastDraft)this.storage.removeItem(this.key);}catch{}
        this.lastDraft=undefined;this.set('saved');
      }
      else {this.set('dirty');this.draft();this.schedule();}
    } catch(e) {this.draft();const message=String(e);this.set(message.includes('CONFLICT')?'conflict':/PERMISSION|NotAllowedError|SecurityError/.test(message)?'unauthorized':'failed',message);}
    finally {this.running=false;if(this.queued){this.queued=false;if(this.state==='dirty')void this.flush();}}
  }
}
