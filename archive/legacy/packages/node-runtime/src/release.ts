import { createHash } from 'node:crypto'
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ReleaseTasks {
  releaseGates: Record<string, string[]>
  tasks: { id: string; status: string; evidence?: (string | { commit?: string; tests?: string[]; testFiles?: string[] })[] }[]
}
/** Q02 itself is closed only after this pre-promotion gate and its drill pass.
 * This checks recorded acceptance; it does not manufacture human observations. */
export function releaseBlockers(tasks: ReleaseTasks, client: { status: string; releaseBlockers: string[] }): string[] {
  const blockers: string[] = []
  for (const id of new Set(Object.values(tasks.releaseGates).flat())) {
    if (id === 'Q02') continue
    const matches = tasks.tasks.filter(t => t.id === id)
    const task = matches[0]
    if (matches.length !== 1 || !task) { blockers.push(`${id}: missing or duplicate task`); continue }
    if (task.status !== 'done') blockers.push(`${id}: ${task.status}`)
    else {
      const evidence = task.evidence ?? []
      const hasCommit = evidence.some(e => typeof e === 'string' ? /^commit:[a-f0-9]{40}$/.test(e) : /^[a-f0-9]{40}$/.test(e.commit ?? ''))
      const testPaths = evidence.flatMap(e => typeof e === 'string' ? [e] : [...(e.tests ?? []), ...(e.testFiles ?? [])])
      if (!hasCommit || !testPaths.some(p => /^tests\/.*\.test\.ts$/.test(p))) blockers.push(`${id}: missing commit/test evidence`)
    }
  }
  if (client.status !== 'pass') blockers.push(`Q01 clients: ${client.status}`)
  blockers.push(...client.releaseBlockers.map(b => `Q01: ${b}`))
  return blockers
}

export const releaseActionNames = ['git', 'npm', 'localInstall', 'htmlUpgrade'] as const
export type ReleaseActionName = typeof releaseActionNames[number]
export interface ReleaseAction { status: 'pass' | 'fail' | 'not-run' | 'blocked' | 'unverified'; scope: string; evidence: string[] }
export function validateReleaseActions(actions: Record<string, ReleaseAction>): void {
  if (JSON.stringify(Object.keys(actions).sort()) !== JSON.stringify([...releaseActionNames].sort())) throw new Error('RELEASE_ACTIONS: record all four actions separately')
  for (const action of Object.values(actions)) {
    if (!['pass', 'fail', 'not-run', 'blocked', 'unverified'].includes(action.status) || !action.scope?.trim() || !Array.isArray(action.evidence)) throw new Error('RELEASE_ACTIONS: invalid action')
    if (action.status === 'pass' && action.evidence.length === 0) throw new Error('RELEASE_ACTIONS: pass requires evidence')
  }
}
export const releaseDigest = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex')
export const requiredRetainedRoles = ['source', 'sourceProfile', 'oldTarball', 'oldBuild', 'oldReport', 'candidateTarball', 'candidateBuild', 'candidateReport'] as const
export interface RetainedInput { role: string; path: string }
export interface RetainedFile { role: string; file: string; sha256: string; bytes: number }
export interface RetentionReceipt { version: 'q02-retention-v1'; automaticDowngrade: false; files: RetainedFile[] }
/** Copies evidence only. No project/profile transformation and no Engine bypass.
 * Caller supplies ALL adjacent journal/CAS files as additional named roles.
 * Failure leaves INCOMPLETE and existing bytes for diagnosis; never overwrites. */
export function retainReleaseInputs(destination: string, inputs: RetainedInput[]): RetentionReceipt {
  for (const role of requiredRetainedRoles) if (inputs.filter(i => i.role === role).length !== 1) throw new Error(`RELEASE_RETENTION: missing/duplicate ${role}`)
  const roles = new Set<string>()
  for (const input of inputs) {
    if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(input.role) || roles.has(input.role)) throw new Error('RELEASE_RETENTION: unsafe/duplicate role')
    roles.add(input.role)
    if (!lstatSync(input.path).isFile()) throw new Error('RELEASE_RETENTION: regular files required')
  }
  mkdirSync(destination)
  writeFileSync(join(destination, 'INCOMPLETE'), 'Do not promote: retention has not completed.\n', { flag: 'wx' })
  const receipt: RetentionReceipt = { version: 'q02-retention-v1', automaticDowngrade: false, files: [] }
  for (const input of inputs) {
    const before = releaseDigest(input.path)
    const file = `${input.role}.retained`
    copyFileSync(input.path, join(destination, file), constants.COPYFILE_EXCL)
    if (releaseDigest(join(destination, file)) !== before || releaseDigest(input.path) !== before) throw new Error('RELEASE_RETENTION: source changed during copy')
    receipt.files.push({ role: input.role, file, sha256: before, bytes: lstatSync(join(destination, file)).size })
  }
  writeFileSync(join(destination, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
  verifyRetainedFiles(destination, receipt)
  unlinkSync(join(destination, 'INCOMPLETE'))
  return receipt
}
export function verifyReleaseRetention(directory: string, receipt: RetentionReceipt): void {
  if (existsSync(join(directory, 'INCOMPLETE'))) throw new Error('RELEASE_RETENTION: incomplete retention')
  verifyRetainedFiles(directory, receipt)
}
function verifyRetainedFiles(directory: string, receipt: RetentionReceipt): void {
  if (receipt.version !== 'q02-retention-v1' || receipt.automaticDowngrade !== false) throw new Error('RELEASE_RETENTION: invalid receipt')
  for (const role of requiredRetainedRoles) if (receipt.files.filter(f => f.role === role).length !== 1) throw new Error('RELEASE_RETENTION: missing/duplicate role')
  const seen = new Set<string>()
  for (const file of receipt.files) {
    if (!/^[a-zA-Z][a-zA-Z0-9-]*\.retained$/.test(file.file) || file.file !== `${file.role}.retained` || seen.has(file.file)) throw new Error('RELEASE_RETENTION: unsafe/duplicate path')
    seen.add(file.file)
    const path = join(directory, file.file)
    if (!lstatSync(path).isFile() || lstatSync(path).size !== file.bytes || releaseDigest(path) !== file.sha256) throw new Error('RELEASE_RETENTION: digest mismatch')
  }
}
