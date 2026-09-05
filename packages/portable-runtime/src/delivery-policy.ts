import type { PortableProfile } from '../../schema/src/index.js'

/** The product-level default for a user-facing editable delivery. */
export const STANDARD_DELIVERY_PROFILE = 'full-portable' as const

/** Suffix used for the primary browser-editable delivery artifact. */
export const STANDARD_EDITABLE_SUFFIX = '.editable.ppte.html' as const

/** Typical attachment SLO for the complete, uncompressed HTML artifact. */
export const STANDARD_ARTIFACT_TARGET_BYTES = 20 * 1024 * 1024

export const EDITABLE_DELIVERY_PROFILES = ['quick-fix', 'light-edit', 'full-portable'] as const

export type EditableDeliveryProfile = (typeof EDITABLE_DELIVERY_PROFILES)[number]
export type DeliveryArtifactRole = 'editable-browser-copy' | 'source-project'

export interface DeliveryPolicy {
  profile: EditableDeliveryProfile
  editableSuffix: typeof STANDARD_EDITABLE_SUFFIX
  artifactTargetBytes: typeof STANDARD_ARTIFACT_TARGET_BYTES
  runtimeBudgetBytes: number
}

export interface DeliveryMetrics {
  bytes: number
  runtimeGzipBytes: number
  resourceBytes: number
  budgetBytes: number
}

export interface DeliveryArtifactAssessment {
  ok: boolean
  code?: 'DELIVERY_ARTIFACT_LARGE' | 'PORTABLE_BUDGET_EXCEEDED'
  warning?: string
}

export function isEditableDeliveryProfile(profile: PortableProfile | string | undefined): profile is EditableDeliveryProfile {
  return EDITABLE_DELIVERY_PROFILES.includes(profile as EditableDeliveryProfile)
}

/**
 * Resolve the one product default. PortableRuntime itself deliberately keeps
 * its lower-level constructor default as `viewer`; only delivery calls this
 * policy when the caller omits a profile.
 */
export function resolveDeliveryPolicy(profile?: PortableProfile): DeliveryPolicy {
  const effectiveProfile = profile ?? STANDARD_DELIVERY_PROFILE
  if (!isEditableDeliveryProfile(effectiveProfile)) throw new Error(`DELIVERY_PROFILE_UNSUPPORTED: ${effectiveProfile}`)
  return {
    profile: effectiveProfile,
    editableSuffix: STANDARD_EDITABLE_SUFFIX,
    artifactTargetBytes: STANDARD_ARTIFACT_TARGET_BYTES,
    runtimeBudgetBytes: runtimeBudgetFor(effectiveProfile),
  }
}

export function runtimeBudgetFor(profile: EditableDeliveryProfile | 'viewer'): number {
  if (profile === 'viewer') return 1_200_000
  if (profile === 'quick-fix') return 2_000_000
  return 3_000_000
}

export function deliveryRoleLabel(role: DeliveryArtifactRole): string {
  return role === 'editable-browser-copy' ? '浏览器可编辑副本' : 'PPTe Host 源项目'
}

/**
 * Apply the delivery-only raw artifact SLO. The runtime gzip budget remains a
 * buildPortable hard gate; this function makes the separate attachment gate
 * explicit without silently changing profile or mutating user resources.
 */
export function assessDeliveryArtifact(metrics: DeliveryMetrics, policy: DeliveryPolicy, allowLargePortable = false): DeliveryArtifactAssessment {
  if (metrics.runtimeGzipBytes > metrics.budgetBytes || metrics.runtimeGzipBytes > policy.runtimeBudgetBytes) {
    return { ok: false, code: 'PORTABLE_BUDGET_EXCEEDED' }
  }
  if (metrics.bytes > policy.artifactTargetBytes) {
    const actualMiB = (metrics.bytes / (1024 * 1024)).toFixed(2)
    const budgetMiB = (policy.artifactTargetBytes / (1024 * 1024)).toFixed(0)
    const warning = `图片/字体资源使可编辑副本达到 ${actualMiB} MiB，超过 ${budgetMiB} MiB 标准交付目标。`
    return allowLargePortable ? { ok: true, warning } : { ok: false, code: 'DELIVERY_ARTIFACT_LARGE', warning }
  }
  return { ok: true }
}
