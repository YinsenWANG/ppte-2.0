/**
 * Release fault vocabulary shared by the reference runtime and its tests.
 * Faults are named at the persistence boundary so a host can inject them
 * without knowing the implementation's temporary-file names.
 */
export type FaultPoint =
  | 'journal.partial-tail'
  | 'journal.checksum'
  | 'journal.base-revision'
  | 'journal.asset-missing'
  | 'checkpoint.build'
  | 'checkpoint.fsync'
  | 'checkpoint.before-rename'
  | 'checkpoint.rename'
  | 'checkpoint.after-rename'
  | 'archive.path-traversal'
  | 'archive.size-limit'
  | 'patch.replay'
  | 'patch.conflict'
  | 'portable.network'
  | 'portable.payload'

export type FaultDomain = FaultPoint extends `${infer Domain}.${string}` ? Domain : never

export const GA_A_FAULT_POINTS = Object.freeze([
  'journal.partial-tail',
  'journal.checksum',
  'journal.base-revision',
  'journal.asset-missing',
  'checkpoint.build',
  'checkpoint.fsync',
  'checkpoint.before-rename',
  'checkpoint.rename',
  'checkpoint.after-rename',
  'archive.path-traversal',
  'archive.size-limit',
  'patch.replay',
  'patch.conflict',
  'portable.network',
  'portable.payload',
] as const satisfies readonly FaultPoint[])

export interface FaultMatrixCase {
  id: FaultPoint
  domain: FaultDomain
  expectedCode: string
  preservesOriginal: boolean
  expectedRecovery: 'retain-checkpoint' | 'retain-journal' | 'reject-input' | 'readonly'
  description: string
}

export const GA_A_FAULT_MATRIX: readonly FaultMatrixCase[] = Object.freeze([
  { id: 'journal.partial-tail', domain: 'journal', expectedCode: 'JOURNAL_CORRUPT', preservesOriginal: true, expectedRecovery: 'retain-journal', description: 'A truncated final journal record is not replayed.' },
  { id: 'journal.checksum', domain: 'journal', expectedCode: 'JOURNAL_CORRUPT', preservesOriginal: true, expectedRecovery: 'retain-journal', description: 'A checksum mutation stops replay at the last valid record.' },
  { id: 'journal.base-revision', domain: 'journal', expectedCode: 'JOURNAL_BASE_MISMATCH', preservesOriginal: true, expectedRecovery: 'retain-journal', description: 'A journal from another checkpoint is never applied.' },
  { id: 'journal.asset-missing', domain: 'journal', expectedCode: 'ASSET_MISSING', preservesOriginal: true, expectedRecovery: 'retain-journal', description: 'A journal requiring an unavailable asset remains unapplied.' },
  { id: 'checkpoint.build', domain: 'checkpoint', expectedCode: 'CHECKPOINT_FAULT_INJECTED', preservesOriginal: true, expectedRecovery: 'retain-checkpoint', description: 'A build interruption leaves the target checkpoint untouched.' },
  { id: 'checkpoint.fsync', domain: 'checkpoint', expectedCode: 'CHECKPOINT_FAULT_INJECTED', preservesOriginal: true, expectedRecovery: 'retain-checkpoint', description: 'A durability interruption leaves the target checkpoint untouched.' },
  { id: 'checkpoint.before-rename', domain: 'checkpoint', expectedCode: 'CHECKPOINT_FAULT_INJECTED', preservesOriginal: true, expectedRecovery: 'retain-checkpoint', description: 'An interruption before replacement leaves the target checkpoint untouched.' },
  { id: 'checkpoint.rename', domain: 'checkpoint', expectedCode: 'CHECKPOINT_FAULT_INJECTED', preservesOriginal: true, expectedRecovery: 'retain-checkpoint', description: 'A replacement failure leaves the old target readable.' },
  { id: 'checkpoint.after-rename', domain: 'checkpoint', expectedCode: 'CHECKPOINT_FAULT_INJECTED', preservesOriginal: false, expectedRecovery: 'retain-checkpoint', description: 'A post-replacement report is recoverable by reopening the new complete checkpoint.' },
  { id: 'archive.path-traversal', domain: 'archive', expectedCode: 'ARCHIVE_INVALID', preservesOriginal: true, expectedRecovery: 'reject-input', description: 'An unsafe archive path is rejected before extraction.' },
  { id: 'archive.size-limit', domain: 'archive', expectedCode: 'ARCHIVE_INVALID', preservesOriginal: true, expectedRecovery: 'reject-input', description: 'An archive over the configured bound is rejected.' },
  { id: 'patch.replay', domain: 'patch', expectedCode: 'PATCH_BASE_MISMATCH', preservesOriginal: true, expectedRecovery: 'reject-input', description: 'A patch already applied to a different revision is rejected.' },
  { id: 'patch.conflict', domain: 'patch', expectedCode: 'PATCH_CONFLICT', preservesOriginal: true, expectedRecovery: 'reject-input', description: 'A conflicting patch does not overwrite the current document.' },
  { id: 'portable.network', domain: 'portable', expectedCode: 'PORTABLE_NETWORK_DISABLED', preservesOriginal: true, expectedRecovery: 'reject-input', description: 'A network dependency cannot enter an offline package.' },
  { id: 'portable.payload', domain: 'portable', expectedCode: 'PORTABLE_PAYLOAD_UNSAFE', preservesOriginal: true, expectedRecovery: 'reject-input', description: 'An unsafe portable payload is rejected.' },
])

export interface FaultInjector {
  hit(point: FaultPoint): void
}

export class PlannedFaultInjector implements FaultInjector {
  private readonly planned: Set<FaultPoint>

  constructor(points: Iterable<FaultPoint> = []) {
    this.planned = new Set(points)
  }

  hit(point: FaultPoint): void {
    if (this.planned.has(point)) throw new Error(`CHECKPOINT_FAULT_INJECTED: ${point}`)
  }
}

export function assertFaultMatrixComplete(cases: readonly FaultMatrixCase[] = GA_A_FAULT_MATRIX): void {
  const expected = new Set<FaultPoint>(GA_A_FAULT_POINTS)
  const actual = new Set<FaultPoint>(cases.map((item) => item.id))
  if (actual.size !== cases.length || expected.size !== actual.size || [...expected].some((point) => !actual.has(point))) throw new Error('FAULT_MATRIX_INCOMPLETE: GA-A fault coverage is incomplete.')
}
