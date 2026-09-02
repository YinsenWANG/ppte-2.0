import { PPTE_COMPATIBILITY_PROFILE, PPTE_FORMAT_VERSION, PPTE_OPERATION_PROTOCOL_VERSION, PPTE_SCHEMA_VERSION } from '../../schema/src/index.js'

/** A release-tested combination of the independently versioned contracts. */
export interface CompatibilityProfile {
  id: string
  formatVersion: '2'
  schemaVersion: '2.0.0'
  operationProtocolVersion: '1.0'
  slideIrVersion: '1.0'
  portableRuntimeVersion: '2.0.0'
  layoutRecipeVersion: '1.0'
  widgetAbiVersion: null
  patchVersion: null
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

const PROFILES: Readonly<Record<string, CompatibilityProfile>> = {
  [GA_A_PROFILE.id]: GA_A_PROFILE,
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
  if (profileId.startsWith('ppte-') || Object.values(PROFILES).some((candidate) => candidate.migration.from.includes(profileId))) return {
    ok: false,
    disposition: 'migrate',
    issues: [{ code: 'COMPATIBILITY_PROFILE_MIGRATION_REQUIRED', message: `Package profile ${profileId} is not in the GA-A verification set.`, recovery: 'Run the forward migration and review its report before saving a new package.' }],
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
