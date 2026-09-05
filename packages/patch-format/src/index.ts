import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { encodePatch, decodePatch } from './codec.js'
import type { PptePatch } from '../../schema/src/index.js'
export * from './codec.js'

export function writePatch(target: string, patch: PptePatch): { path: string; bytes: number } {
  const data = encodePatch(patch)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, data)
  return { path: target, bytes: data.length }
}

export function readPatch(target: string): PptePatch {
  return decodePatch(new Uint8Array(readFileSync(target)))
}
