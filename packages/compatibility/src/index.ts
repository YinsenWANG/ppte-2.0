import { deepFreeze } from '../../canonical-json/src/index.js'
import { PPTE_COMPATIBILITY_PROFILE, PPTE_FORMAT_VERSION, PPTE_GA_B_COMPATIBILITY_PROFILE, PPTE_GA_C_COMPATIBILITY_PROFILE, PPTE_OPERATION_PROTOCOL_VERSION, PPTE_SCHEMA_VERSION } from '../../schema/src/index.js'
import type { PpteDocument, RuntimeProfile } from '../../schema/src/index.js'
import { PPTE_TEXT_RUN_COMPATIBILITY_PROFILE, PPTE_EDIT_COMPATIBILITY_PROFILE, readPersistedHistoryMetadata, type Operation, type Transaction, type SessionHistoryEntrySnapshot } from '../../schema/src/index.js'

/** A release-tested combination of the independently versioned contracts. */
export interface CompatibilityProfile {
  id: string
  formatVersion: '2'
  schemaVersion: '2.0.0' | '2.1.0'
  operationProtocolVersion: '1.0' | '1.1'
  slideIrVersion: '1.0'
  runtimeSubset: RuntimeProfile
  portableRuntimeVersion: '2.0.0' | '2.1.0'
  layoutRecipeVersion: '1.0'
  widgetAbiVersion: string | null
  patchVersion: string | null
  migration: {
    from: string[]
    direction: 'forward-only'
    preservesSource: boolean
  }
}

export type CompatibilityDisposition = 'native' | 'migrate' | 'readonly' | 'reject'

export interface CompatibilityIssue {
  code: 'COMPATIBILITY_PROFILE_UNSUPPORTED' | 'COMPATIBILITY_PROFILE_MISMATCH' | 'COMPATIBILITY_PROFILE_MIGRATION_REQUIRED'
  message: string
  recovery: string
}

export interface CompatibilityCheck {
  ok: boolean
  disposition: CompatibilityDisposition
  profile?: CompatibilityProfile
  issues: CompatibilityIssue[]
}

export const GA_A_PROFILE: CompatibilityProfile = {
  id: PPTE_COMPATIBILITY_PROFILE,
  runtimeSubset: 'ga-a',
  formatVersion: PPTE_FORMAT_VERSION,
  schemaVersion: PPTE_SCHEMA_VERSION,
  operationProtocolVersion: PPTE_OPERATION_PROTOCOL_VERSION,
  slideIrVersion: '1.0',
  portableRuntimeVersion: '2.0.0',
  layoutRecipeVersion: '1.0',
  widgetAbiVersion: null,
  patchVersion: null,
  migration: {
    from: ['ppte-2.0-ga-a.0', 'ppte-2.2', 'legacy-semantic-json', 'legacy-presentation-package'],
    direction: 'forward-only',
    preservesSource: true,
  },
}

export const GA_B_PROFILE: CompatibilityProfile = {
  id: PPTE_GA_B_COMPATIBILITY_PROFILE,
  runtimeSubset: 'ga-b',
  formatVersion: PPTE_FORMAT_VERSION,
  schemaVersion: PPTE_SCHEMA_VERSION,
  operationProtocolVersion: PPTE_OPERATION_PROTOCOL_VERSION,
  slideIrVersion: '1.0',
  portableRuntimeVersion: '2.0.0',
  layoutRecipeVersion: '1.0',
  widgetAbiVersion: null,
  patchVersion: '1',
  migration: {
    from: [PPTE_COMPATIBILITY_PROFILE],
    direction: 'forward-only',
    preservesSource: true,
  },
}

export const GA_C_PROFILE: CompatibilityProfile = {
  id: PPTE_GA_C_COMPATIBILITY_PROFILE,
  runtimeSubset: 'ga-c',
  formatVersion: PPTE_FORMAT_VERSION,
  schemaVersion: PPTE_SCHEMA_VERSION,
  operationProtocolVersion: PPTE_OPERATION_PROTOCOL_VERSION,
  slideIrVersion: '1.0',
  portableRuntimeVersion: '2.0.0',
  layoutRecipeVersion: '1.0',
  widgetAbiVersion: '1.0',
  patchVersion: '1',
  migration: {
    from: [PPTE_GA_B_COMPATIBILITY_PROFILE],
    direction: 'forward-only',
    preservesSource: true,
  },
}

export const EDIT_PROFILE: CompatibilityProfile = {
  ...GA_C_PROFILE,
  id: PPTE_EDIT_COMPATIBILITY_PROFILE,
  operationProtocolVersion: '1.1',
  portableRuntimeVersion: '2.1.0',
  migration: { from: [GA_A_PROFILE.id, GA_B_PROFILE.id, GA_C_PROFILE.id], direction: 'forward-only', preservesSource: true },
}

export const TEXT_RUN_PROFILE: CompatibilityProfile = {
  ...EDIT_PROFILE, id: PPTE_TEXT_RUN_COMPATIBILITY_PROFILE, schemaVersion: '2.1.0',
  migration: { from: [GA_A_PROFILE.id, GA_B_PROFILE.id, GA_C_PROFILE.id, EDIT_PROFILE.id], direction: 'forward-only', preservesSource: true },
}

const PROFILES: Readonly<Record<string, CompatibilityProfile>> = {
  [GA_A_PROFILE.id]: GA_A_PROFILE,
  [GA_B_PROFILE.id]: GA_B_PROFILE,
  [GA_C_PROFILE.id]: GA_C_PROFILE,
  [EDIT_PROFILE.id]: EDIT_PROFILE,
  [TEXT_RUN_PROFILE.id]: TEXT_RUN_PROFILE,
}

deepFreeze(PROFILES)

/** Capabilities are cumulative sets, never a lexical ordering of profile names. */
export const PROFILE_CAPABILITIES = deepFreeze({
  [GA_A_PROFILE.id]: ['semantic-core'],
  [GA_B_PROFILE.id]: ['semantic-core', 'charts-animation', 'patch'],
  [GA_C_PROFILE.id]: ['semantic-core', 'charts-animation', 'patch', 'widgets-poster-extended-charts'],
  [EDIT_PROFILE.id]: ['semantic-core', 'charts-animation', 'patch', 'widgets-poster-extended-charts', 'slide-unset'],
  [TEXT_RUN_PROFILE.id]: ['semantic-core', 'charts-animation', 'patch', 'widgets-poster-extended-charts', 'slide-unset', 'text-run-font'],
})

export function profileIncludes(reader: string, required: string): boolean {
  return Boolean(PROFILE_CAPABILITIES[reader] && PROFILE_CAPABILITIES[required]?.every(capability => PROFILE_CAPABILITIES[reader]!.includes(capability)))
}

export const SUPPORTED_COMPATIBILITY_PROFILES = Object.freeze(Object.keys(PROFILES)) as readonly string[]

export function getCompatibilityProfile(id: string): CompatibilityProfile | undefined {
  return PROFILES[id]
}

export function listCompatibilityProfiles(): CompatibilityProfile[] {
  return Object.values(PROFILES).map((profile) => ({ ...profile, migration: { ...profile.migration, from: [...profile.migration.from] } }))
}

export function assertSupportedCompatibilityProfile(id: string): CompatibilityProfile {
  const profile = getCompatibilityProfile(id)
  if (!profile) throw new Error(`COMPATIBILITY_PROFILE_UNSUPPORTED: ${id}`)
  return profile
}

/**
 * Decide what a host may do before it interprets a package. Unknown profiles
 * are never treated as equivalent merely because their container is familiar.
 */
export function checkCompatibility(input: { id?: unknown; formatVersion?: unknown; schemaVersion?: unknown; operationProtocolVersion?: unknown; compatibilityProfile?: unknown }): CompatibilityCheck {
  const formatVersion = String(input.formatVersion ?? '')
  const schemaVersion = String(input.schemaVersion ?? '')
  const operationProtocolVersion = String(input.operationProtocolVersion ?? '')
  const profileId = String(input.compatibilityProfile ?? input.id ?? '')
  const profile = getCompatibilityProfile(profileId)
  if (profile) {
    const hasPackageVersions = input.formatVersion !== undefined || input.schemaVersion !== undefined
    const matches = operationProtocolVersion === profile.operationProtocolVersion && (!hasPackageVersions || (formatVersion === profile.formatVersion && schemaVersion === profile.schemaVersion))
    if (!matches) return {
      ok: false,
      disposition: 'reject',
      profile,
      issues: [{ code: 'COMPATIBILITY_PROFILE_MISMATCH', message: `Profile ${profileId} does not match the independent package versions.`, recovery: 'Keep the package unchanged and use a host that supports the declared profile.' }],
    }
    return { ok: true, disposition: 'native', profile, issues: [] }
  }

  const schemaMajor = Number.parseInt(schemaVersion.split('.')[0] ?? '', 10)
  const formatMajor = Number.parseInt(formatVersion, 10)
  if ((Number.isFinite(schemaMajor) && schemaMajor > 2) || (Number.isFinite(formatMajor) && formatMajor > 2)) return {
    ok: false,
    disposition: 'readonly',
    issues: [{ code: 'COMPATIBILITY_PROFILE_UNSUPPORTED', message: `Package profile ${profileId || '(missing)'} belongs to a newer incompatible format.`, recovery: 'Open it read-only with a newer host or export a supported profile.' }],
  }
  if (Object.values(PROFILES).some((candidate) => candidate.migration.from.includes(profileId))) return {
    ok: false,
    disposition: 'migrate',
    issues: [{ code: 'COMPATIBILITY_PROFILE_MIGRATION_REQUIRED', message: `Package profile ${profileId} is not in the verified native set.`, recovery: 'Run the forward migration and review its report before saving a new package.' }],
  }
  return {
    ok: false,
    disposition: 'reject',
    issues: [{ code: 'COMPATIBILITY_PROFILE_UNSUPPORTED', message: 'Package does not declare a supported Compatibility Profile.', recovery: 'Keep the source package and use a host that recognizes its profile.' }],
  }
}

export function profileDescriptor(id: string = PPTE_COMPATIBILITY_PROFILE): CompatibilityProfile {
  return assertSupportedCompatibilityProfile(id)
}

/**
 * Return the lowest release-tested profile that can interpret a document.
 * This is deliberately based on persisted semantic capabilities, not on the
 * UI surface that happened to save the document.  Every checkpoint and every
 * Portable save therefore makes the same compatibility decision.
 */
export interface PersistedCompatibilityInput {
  recentTransactions?: ReadonlyArray<Transaction>
  redoHistory?: ReadonlyArray<SessionHistoryEntrySnapshot>
  operations?: ReadonlyArray<Operation>
}

export function requiresEditProtocol(input: PersistedCompatibilityInput): boolean {
  const usesUnset = (operations: ReadonlyArray<Operation> = []) => operations.some(op => op.kind === 'shape.setKind' || (op.kind === 'slide.update' && op.unset !== undefined) || (['group.delete', 'fact.delete', 'source.delete'].includes(op.kind) && 'removeEmptyCollection' in op && op.removeEmptyCollection !== undefined))
  const transactionUsesUnset = (tx: Transaction) => usesUnset(tx.operations) || usesUnset(readPersistedHistoryMetadata(tx)?.inverse.operations)
  return usesUnset(input.operations) || Boolean(input.recentTransactions?.some(transactionUsesUnset)) || Boolean(input.redoHistory?.some(entry => transactionUsesUnset(entry.transaction) || transactionUsesUnset(entry.inverse)))
}

/** Scan every persisted envelope, including inverse/redo and inserted slides.
 * Only Run-shaped containers count; component props and extension keys do not upgrade. */
export function hasRunFontOverrides(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(hasRunFontOverrides)
  const object = value as Record<string, unknown>
  const marks = object.marks as Record<string, unknown> | undefined
  return Boolean(typeof object.id === 'string' && typeof object.text === 'string' && marks && (marks.fontFamily !== undefined || marks.fontSize !== undefined)) || Object.entries(object).some(([key, child]) => key !== 'extensions' && hasRunFontOverrides(child))
}

export function inferCompatibilityProfile(document: PpteDocument, persisted: PersistedCompatibilityInput = {}): string {
  if (hasRunFontOverrides(document) || document.schemaVersion === '2.1.0' || hasRunFontOverrides(persisted)) return PPTE_TEXT_RUN_COMPATIBILITY_PROFILE
  if (requiresEditProtocol(persisted)) return PPTE_EDIT_COMPATIBILITY_PROFILE
  const required = new Set<string>(PROFILE_CAPABILITIES[GA_A_PROFILE.id])
  const requireProfile = (id: string) => { for (const capability of PROFILE_CAPABILITIES[id]!) required.add(capability) }
  const inspectElement = (element: Record<string, unknown>) => {
    if (element.type === 'component' || element.chartType === 'area' || element.chartType === 'donut') requireProfile(GA_C_PROFILE.id)
    if (element.type === 'chart' || element.appearStep !== undefined || element.animation !== undefined) requireProfile(GA_B_PROFILE.id)
  }
  const inspectSlide = (slide: Record<string, unknown>) => {
    if (slide.visualStrategy === 'poster') requireProfile(GA_C_PROFILE.id)
    if (slide.transition !== undefined) requireProfile(GA_B_PROFILE.id)
    for (const element of Object.values(slide.elements ?? {})) inspectElement(element as Record<string, unknown>)
  }
  const inspectOperations = (operations: ReadonlyArray<Operation> = []) => {
    for (const operation of operations) {
      if (operation.kind === 'slide.insert') inspectSlide(operation.slide as unknown as Record<string, unknown>)
      if (operation.kind === 'slide.update') inspectSlide(operation.patch as Record<string, unknown>)
      if (operation.kind === 'element.insert') inspectElement(operation.element as unknown as Record<string, unknown>)
      if (operation.kind.startsWith('component.')) requireProfile(GA_C_PROFILE.id)
      if (operation.kind.startsWith('chart.') || ['slide.setTransition', 'element.setAppearStep', 'element.setAnimation'].includes(operation.kind)) requireProfile(GA_B_PROFILE.id)
    }
  }
  inspectOperations(persisted.operations)
  for (const tx of persisted.recentTransactions ?? []) { inspectOperations(tx.operations); inspectOperations(readPersistedHistoryMetadata(tx)?.inverse.operations) }
  for (const entry of persisted.redoHistory ?? []) {
    for (const tx of [entry.transaction, entry.inverse]) { inspectOperations(tx.operations); inspectOperations(readPersistedHistoryMetadata(tx)?.inverse.operations) }
  }
  for (const slide of Object.values(document.slides ?? {})) inspectSlide(slide as unknown as Record<string, unknown>)
  const candidates = Object.values(PROFILES).filter(profile => [...required].every(capability => PROFILE_CAPABILITIES[profile.id]!.includes(capability)))
  return candidates.find(candidate => candidates.every(other => profileIncludes(other.id, candidate.id)))!.id
}

/** Map a persisted profile to the runtime capability subset used for checks. */
export function runtimeProfileForCompatibility(profileId: string): RuntimeProfile {
  return profileId === PPTE_TEXT_RUN_COMPATIBILITY_PROFILE || profileId === PPTE_GA_C_COMPATIBILITY_PROFILE || profileId === PPTE_EDIT_COMPATIBILITY_PROFILE ? 'ga-c' : 'ga-b'
}

/** Validate the document/profile pair at every persistence boundary. */
export function assertDocumentCompatibility(document: PpteDocument, profileId: string, persisted: PersistedCompatibilityInput = {}): void {
  assertSupportedCompatibilityProfile(profileId)
  const minimum = inferCompatibilityProfile(document, persisted)
  if (!profileIncludes(profileId, minimum)) {
    throw new Error(`CHECKPOINT_FAILED: document requires compatibility profile ${minimum}; received ${profileId}.`)
  }
}
