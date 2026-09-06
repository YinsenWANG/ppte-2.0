import { buildPortableCheckpointBytes } from '../../portable-runtime/src/shared.js'
import {poolBytes,resolveBytes} from './resource-pool.js'
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
  recoverySessionId?: string
  private key = KEY
  private active?: string
  private predecessor?: { key: string; encoded?: string }
  private validateBase(base: BrowserBase): void {
    buildPortableCheckpointBytes(base.document, { runtimeProfile: 'ga-c', assetBytes: resolveBytes(base.assetBytes, base.document.assets), fontBytes: resolveBytes(base.fontBytes, base.document.fonts) })
  }
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
    // A legacy entry remains forensic evidence even after namespace migration.
    // Do not silently ignore newly discovered corruption in that entry.
    const legacyRaw = localStorage.getItem(KEY)
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as Tail
      if (!legacy || legacy.version !== 1 || !Array.isArray(legacy.rows)) throw new Error('RECOVERY_INVALID: Unsupported legacy recovery journal; existing data was retained.')
    }
    this.active = localStorage.getItem(`${KEY}.active`) ?? undefined
    this.recoverySessionId = this.active
    this.key = this.active ? `${KEY}.${this.active}` : KEY
    const raw = localStorage.getItem(this.key)
    if (!raw) {
      if (this.active) throw new Error('RECOVERY_INVALID: Active recovery tail is missing; existing data was retained.')
      return
    }
    const tail = JSON.parse(raw) as Tail
    if (tail.version !== 1 || !Array.isArray(tail.rows)) throw new Error('RECOVERY_INVALID: Unsupported recovery journal; existing data was retained.')
    const base = await this.read(tail.baseId)
    if (!base || canonicalRevision(base.document) !== tail.baseRevision) throw new Error('RECOVERY_INVALID: Checkpoint does not match journal; existing data was retained.')
    this.validateBase(base)
    const replay = new PpteSession(base.document, {history:base.history, redoHistory:base.redo})
    for (const row of tail.rows) {
      if (!['commit', 'undo', 'redo'].includes(row.action)) throw new Error('RECOVERY_INVALID: Unknown journal action; existing data was retained.')
      if (canonicalHash({action:row.action,transaction:row.transaction,revision:row.revision}) !== row.checksum) throw new Error('RECOVERY_CHECKSUM: Journal is damaged; existing data was retained.')
      const result = row.action === 'undo' ? replay.undo() : row.action === 'redo' ? replay.redo() : replay.commit(row.transaction)
      if (!result.ok || replay.getRevision() !== row.revision) throw new Error('RECOVERY_REVISION: Journal replay failed; existing data was retained.')
    }
    this.validateBase({...base, document: replay.getDocument()})
    this.tail = tail; this.encoded = raw
    // Fork before attaching a writer; the recovered tail/base remain forensic evidence.
    return {base,session:await this.serial(()=>this.replaceNow({...base, document: replay.getDocument(), history:[...replay.getHistory()], redo:[...replay.getRedoHistory()]}, false))}
  }
  attach(session: PpteSession): PpteSession {
    return new PpteSession(session.getDocument(), {history:session.getHistory(),redoHistory:session.getRedoHistory(),journal:this,initialSaveState:'recoverable'})
  }
  replace(base:BrowserBase):Promise<PpteSession>{return this.serial(()=>this.replaceNow(base))}
  private async replaceNow(base: BrowserBase, activate = true): Promise<PpteSession> {
    this.validateBase(base)
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
    const recoverySessionId = crypto.randomUUID()
    const key = `${KEY}.${recoverySessionId}`
    localStorage.setItem(key, encoded)
    // Opening another tab stages a private copy, but does not seize the active
    // writer. Its first edit must still match the source tail it observed.
    if (activate) {
      localStorage.setItem(`${KEY}.active`, recoverySessionId)
      this.active = recoverySessionId; this.predecessor = undefined
    } else this.predecessor = { key: this.key, encoded: this.encoded }
    this.key = key; this.recoverySessionId = recoverySessionId
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
    try {
      localStorage.setItem(this.key,encoded)
      if (this.predecessor) {
        localStorage.setItem(`${KEY}.active`, this.recoverySessionId!)
        this.active = this.recoverySessionId; this.predecessor = undefined
      }
    } catch { throw new Error('RECOVERY_STORAGE_FULL: Save a project checkpoint before continuing; this edit was not committed.') }
    this.tail=next;this.encoded=encoded
  }
  private assertCurrent() {
    if (this.predecessor && (localStorage.getItem(this.predecessor.key) ?? undefined) !== this.predecessor.encoded) throw new Error('REVISION_CONFLICT: Another editor changed the recovery source.')
    if ((localStorage.getItem(this.key) ?? undefined) !== this.encoded || (localStorage.getItem(`${KEY}.active`) ?? undefined) !== this.active) throw new Error('REVISION_CONFLICT: Another editor tab changed this project. Reload to recover its current state.')
  }
  private read(id:string):Promise<BrowserBase|undefined> {
    return new Promise((resolve,reject)=>{const r=this.db!.transaction('bases').objectStore('bases').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})
  }
  private write(id:string,base:BrowserBase):Promise<void> {
    return new Promise((resolve,reject)=>{const t=this.db!.transaction('bases','readwrite');t.objectStore('bases').put(base,id);t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error??new Error('RECOVERY_WRITE_FAILED'))})
  }
}
