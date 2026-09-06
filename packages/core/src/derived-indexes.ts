import { equalJson } from '../../canonical-json/src/index.js'
import type { PpteDocument } from '../../schema/src/index.js'
import { buildDerivedIndexes, type DerivedIndexes } from './index.js'

/** Disposable derived state. Only validated Session snapshots are inputs. */
export class IncrementalDerivedIndexes {
  private shards = new Map<string, DerivedIndexes>()
  private indexes: DerivedIndexes
  private base: PpteDocument
  readonly stats = { updatedSlides: 0, rebuilds: 0 }

  constructor(document: PpteDocument) {
    this.base = document
    this.indexes = this.rebuild(document)
  }

  private rebuild(document: PpteDocument): DerivedIndexes {
    const shards = new Map<string, DerivedIndexes>()
    for (const id of Object.keys(document.slides)) shards.set(id, this.buildSlide(document, id))
    const indexes = buildDerivedIndexes(document)
    this.shards = shards
    this.stats.rebuilds++
    return indexes
  }

  private buildSlide(document: PpteDocument, id: string): DerivedIndexes {
    return buildDerivedIndexes({ ...document, slides: { [id]: document.slides[id] } })
  }

  /** Recovery never changes the document, revision, history or journal. */
  reset(document: PpteDocument = this.base): void {
    this.indexes = this.rebuild(document)
    this.base = document
  }

  update(document: PpteDocument): void {
    try {
      const beforeOrder = Object.keys(this.base.slides), afterOrder = Object.keys(document.slides)
      const commonBefore = beforeOrder.filter(id => document.slides[id])
      const commonAfter = afterOrder.filter(id => this.base.slides[id])
      if (commonBefore.some((id, i) => id !== commonAfter[i])) { this.reset(document); return }
      const ids = new Set([...Object.keys(this.base.slides), ...Object.keys(document.slides)])
      const changed = [...ids].filter(id => !equalJson(this.base.slides[id], document.slides[id]))
      this.stats.updatedSlides = changed.length
      const affected = new Map<keyof DerivedIndexes, Set<string>>()
      for (const id of changed) {
        const old = this.shards.get(id)
        const next = document.slides[id] ? this.buildSlide(document, id) : undefined
        for (const shard of [old, next]) if (shard) {
          for (const name of Object.keys(shard) as (keyof DerivedIndexes)[]) {
            const keys = affected.get(name) ?? new Set<string>()
            for (const key of shard[name].keys()) keys.add(key)
            affected.set(name, keys)
          }
        }
        if (next) this.shards.set(id, next)
        else this.shards.delete(id)
      }
      // Reconcile only affected keys. Document order preserves full-build last-wins
      // semantics even when element/group IDs are shared by different slides.
      for (const [name, keys] of affected) {
        const target = this.indexes[name] as Map<string, unknown>
        for (const key of keys) {
          target.delete(key)
          for (const id of Object.keys(document.slides)) {
            const value = this.shards.get(id)![name].get(key)
            if (value === undefined) continue
            if (name === 'assetRefCount') target.set(key, ((target.get(key) as number) ?? 0) + (value as number))
            else if (value instanceof Set) target.set(key, new Set([...(target.get(key) as Set<unknown> ?? []), ...value]))
            else target.set(key, value)
          }
        }
      }
      this.base = document
    } catch {
      // A failed partial update is discarded in full, never exposed to readers.
      this.reset(document)
    }
  }

  snapshot(): DerivedIndexes {
    // Maps and Sets cannot be made immutable with Object.freeze.
    return structuredClone(this.indexes)
  }
}
