import { existsSync, fsyncSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256HexBytes } from '../../canonical-json/src/index.js'

export interface ContentAddressedStoreOptions {
  maxBlobBytes?: number
}

/** Host-private content store. The package remains the only source of truth. */
export class ContentAddressedStore {
  private readonly maxBlobBytes: number

  constructor(readonly root: string, options: ContentAddressedStoreOptions = {}) {
    this.maxBlobBytes = options.maxBlobBytes ?? 256 * 1024 * 1024
    if (!Number.isInteger(this.maxBlobBytes) || this.maxBlobBytes <= 0) throw new Error('CAS_INVALID: maxBlobBytes must be a positive integer.')
    mkdirSync(root, { recursive: true, mode: 0o700 })
  }

  put(data: Uint8Array, expectedHash?: string): string {
    if (data.length > this.maxBlobBytes) throw new Error('CAS_LIMIT: blob exceeds maxBlobBytes.')
    const hash = `sha256-${sha256HexBytes(data)}`
    if (expectedHash !== undefined && normalizeHash(expectedHash) !== normalizeHash(hash)) throw new Error('CAS_HASH_MISMATCH: content does not match expected hash.')
    const target = this.pathFor(hash)
    if (existsSync(target)) {
      this.verify(target, hash)
      return hash
    }
    const temporary = join(this.root, `.${hash}.${process.pid}.${Date.now()}.tmp`)
    let descriptor: number | undefined
    try {
      descriptor = openSync(temporary, 'wx', 0o600)
      writeFileSync(descriptor, data)
      fsyncSync(descriptor)
      closeSync(descriptor)
      descriptor = undefined
      renameSync(temporary, target)
      fsyncDirectory(this.root)
      return hash
    } catch (cause) {
      if (existsSync(target)) {
        this.verify(target, hash)
        return hash
      }
      throw new Error(`CAS_WRITE_FAILED: ${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      if (descriptor !== undefined) closeSync(descriptor)
      if (existsSync(temporary)) unlinkSync(temporary)
    }
  }

  has(hash: string): boolean {
    const path = this.pathFor(hash)
    if (!existsSync(path)) return false
    this.verify(path, hash)
    return true
  }

  get(hash: string): Uint8Array | undefined {
    const path = this.pathFor(hash)
    if (!existsSync(path)) return undefined
    this.verify(path, hash)
    return new Uint8Array(readFileSync(path))
  }

  require(hash: string): Uint8Array {
    const data = this.get(hash)
    if (!data) throw new Error(`CAS_MISSING: ${hash}`)
    return data
  }

  pathFor(hash: string): string {
    const normalized = normalizeHash(hash)
    if (!/^sha256-[0-9a-f]{64}$/.test(normalized)) throw new Error(`CAS_INVALID_HASH: ${hash}`)
    return join(this.root, normalized)
  }

  private verify(path: string, expectedHash: string): void {
    const stat = statSync(path)
    if (!stat.isFile() || stat.size > this.maxBlobBytes) throw new Error(`CAS_INVALID: blob is not a valid file: ${expectedHash}`)
    const actual = `sha256-${sha256HexBytes(new Uint8Array(readFileSync(path)))}`
    if (actual !== normalizeHash(expectedHash)) throw new Error(`CAS_HASH_MISMATCH: ${expectedHash}`)
  }
}

function normalizeHash(hash: string): string {
  return (hash.startsWith('sha256-') ? hash : `sha256-${hash}`).toLowerCase()
}

function fsyncDirectory(path: string) {
  try {
    const descriptor = openSync(path, 'r')
    fsyncSync(descriptor)
    closeSync(descriptor)
  } catch {
    // Directory fsync is not available on every supported host filesystem.
  }
}
