import {poolBytes} from './resource-pool.js'
import { canonicalHash, canonicalRevision } from '../../canonical-json/src/index.js'
import { PpteSession, type HistoryEntry, type JournalSink } from '../../core/src/index.js'
import type { PpteDocument, Transaction } from '../../schema/src/index.js'

export interface BrowserBase {
  document: PpteDocument
  assetBytes: Record<string, Uint8Array>
  fontBytes: Record<string, Uint8Array>
  history: HistoryEntry[]
  redo: HistoryEntry[]
}
type Action = 'commit' | 'undo' | 'redo'
interface Row { action: Action; transaction: Transaction; revision: string; checksum: string }
interface Tail { version: 1; baseId: string; baseRevision: string; rows: Row[] }
const KEY = 'ppte.host.recovery.v1'

/** Large resources/checkpoints live in IndexedDB. The small synchronous,
 * checksummed operation tail is durable before Core mutates memory. Quota or
 * another tab's write rejects the commit; no false "protected" status. */
export class BrowserRecovery implements JournalSink {
  action: Action = 'commit'
  private tail?: Tail
  private encoded?: string
  private db?: IDBDatabase
  private pending:Promise<void>=Promise.resolve()
  private serial<T>(work:()=>Promise<T>):Promise<T>{const task=this.pending.then(work);this.pending=task.then(()=>{},()=>{});return task}
  async initialize(): Promise<{base: BrowserBase; session: PpteSession} | undefined> {
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('ppte-host-recovery', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('bases')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const raw = localStorage.getItem(KEY)
    if (!raw) return
    const tail = JSON.parse(raw) as Tail
    if (tail.version !== 1 || !Array.isArray(tail.rows)) throw new Error('RECOVERY_INVALID: Unsupported recovery journal; existing data was retained.')
    const base = await this.read(tail.baseId)
    if (!base || canonicalRevision(base.document) !== tail.baseRevision) throw new Error('RECOVERY_INVALID: Checkpoint does not match journal; existing data was retained.')
    const replay = new PpteSession(base.document, {history:base.history, redoHistory:base.redo})
    for (const row of tail.rows) {
      if (canonicalHash({action:row.action,transaction:row.transaction,revision:row.revision}) !== row.checksum) throw new Error('RECOVERY_CHECKSUM: Journal is damaged; existing data was retained.')
      const result = row.action === 'undo' ? replay.undo() : row.action === 'redo' ? replay.redo() : replay.commit(row.transaction)
      if (!result.ok || replay.getRevision() !== row.revision) throw new Error('RECOVERY_REVISION: Journal replay failed; existing data was retained.')
    }
    this.tail = tail; this.encoded = raw
    return {base,session:this.attach(replay)}
  }
  attach(session: PpteSession): PpteSession {
    return new PpteSession(session.getDocument(), {history:session.getHistory(),redoHistory:session.getRedoHistory(),journal:this,initialSaveState:'recoverable'})
  }
  replace(base:BrowserBase):Promise<PpteSession>{return this.serial(()=>this.replaceNow(base))}
  private async replaceNow(base: BrowserBase): Promise<PpteSession> {
    const expected=this.encoded
    const checked = new PpteSession(base.document,{history:base.history,redoHistory:base.redo})
    const id = crypto.randomUUID()
    await this.write(id, {...base,assetBytes:poolBytes(base.assetBytes),fontBytes:poolBytes(base.fontBytes)})
    if(this.encoded!==expected)throw new Error('REVISION_CONFLICT: Editing continued while saving; retry the checkpoint.')
    // Detect a second tab before replacing its journal. A staged unused base
    // is harmless; the previous checkpoint and tail remain recoverable.
    this.assertCurrent()
    const tail: Tail = {version:1,baseId:id,baseRevision:checked.getRevision(),rows:[]}
    const encoded = JSON.stringify(tail)
    localStorage.setItem(KEY, encoded)
    this.tail = tail; this.encoded = encoded
    return this.attach(checked)
  }
  resources(assetBytes:Record<string,Uint8Array>,fontBytes:Record<string,Uint8Array>):Promise<void>{return this.serial(()=>this.resourcesNow(assetBytes,fontBytes))}
  private async resourcesNow(assetBytes: Record<string,Uint8Array>,fontBytes: Record<string,Uint8Array>): Promise<void> {
    this.assertCurrent()
    if (!this.tail) throw new Error('RECOVERY_NOT_READY')
    const baseId=this.tail.baseId
    const base=await this.read(baseId)
    if (!base) throw new Error('RECOVERY_BASE_MISSING')
    await this.write(baseId,{...base,assetBytes:{...poolBytes(base.assetBytes),...poolBytes(assetBytes)},fontBytes:{...poolBytes(base.fontBytes),...poolBytes(fontBytes)}})
    if(this.tail.baseId!==baseId)throw new Error('REVISION_CONFLICT: The active project changed during resource import.')
    this.assertCurrent()
  }
  append(transaction: Transaction, resultRevision?: string): void {
    this.assertCurrent()
    if (!this.tail || !resultRevision) throw new Error('RECOVERY_NOT_READY: Editing requires working browser storage.')
    const value={action:this.action,transaction,revision:resultRevision}
    const next={...this.tail,rows:[...this.tail.rows,{...value,checksum:canonicalHash(value)}]}
    const encoded=JSON.stringify(next)
    try { localStorage.setItem(KEY,encoded) } catch { throw new Error('RECOVERY_STORAGE_FULL: Save a project checkpoint before continuing; this edit was not committed.') }
    this.tail=next;this.encoded=encoded
  }
  private assertCurrent() {
    if ((localStorage.getItem(KEY) ?? undefined) !== this.encoded) throw new Error('REVISION_CONFLICT: Another editor tab changed this project. Reload to recover its current state.')
  }
  private read(id:string):Promise<BrowserBase|undefined> {
    return new Promise((resolve,reject)=>{const r=this.db!.transaction('bases').objectStore('bases').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})
  }
  private write(id:string,base:BrowserBase):Promise<void> {
    return new Promise((resolve,reject)=>{const t=this.db!.transaction('bases','readwrite');t.objectStore('bases').put(base,id);t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error??new Error('RECOVERY_WRITE_FAILED'))})
  }
}
