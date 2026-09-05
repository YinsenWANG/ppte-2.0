import { canonicalHash, cloneJson } from '../../canonical-json/src/index.js'
import { validatePresentationIR, validateRecipeSpec, validateThemeDefinition } from '../../schema/src/index.js'
import type { PresentationIR, RecipeSpec, ThemeDefinition, Slide, ProtectedContentIR, ProtectedAnchor, Rect } from '../../schema/src/index.js'

export interface PackageRef { id: string; version: string; digest: string }
export interface LicenseEntry {
  resource: string
  kind: 'brand' | 'font' | 'photo' | 'recipe' | 'preview'
  license: string
  source: string
  notice: string
}
export interface BrandSpec {
  contractVersion: '1'
  id: string
  version: string
  colors: ThemeDefinition['tokens']['colors']
  fontRoles: ThemeDefinition['tokens']['fontFamilies']
  logoAssetRefs: string[]
  safeAreas: Rect[]
  forbidden: string[]
  licenses: LicenseEntry[]
}
export interface StylePack {
  contractVersion: '1'
  id: string
  version: string
  description: string
  suitableFor: string[]
  unsuitableFor: string[]
  density: 'low' | 'medium' | 'high'
  theme: ThemeDefinition
  rules: { image: string[]; line: string[]; chart: string[] }
  recipeRefs: PackageRef[]
  previews: string[]
  licenses: LicenseEntry[]
  digest: string
}
export type ControlName = 'columns' | 'captionDensity' | 'imageSide'
export interface RecipeControl {
  name: ControlName
  label: string
  type: 'integer' | 'enum'
  default: number | string
  options: Array<number | string>
  min?: number
  max?: number
  applicability: string[]
  affects: 'layout' | 'caption' | 'image'
}
export interface RecipeManifest {
  contractVersion: '1'
  recipeRef: PackageRef
  purpose: RecipeSpec['supports']
  slotRefs: string[]
  controls: RecipeControl[]
  capacity: { maxBlocks: number; overflow: 'reject-or-propose'; textUnit: 'unicode-code-point' }
  capabilities: Record<'html-edit' | 'html-present' | 'pdf' | 'pptx-image' | 'pptx-semantic', 'unverified' | 'unsupported'>
  structuralFingerprint: string
  samples: Array<{ kind: 'normal' | 'boundary' | 'overload'; locale: 'zh-CN'; input: PresentationIR }>
  licenses: LicenseEntry[]
  digest: string
}
export interface DesignPlan {
  contractVersion: '1'
  presentation: PresentationIR
  brandRef?: PackageRef
  styleRef: PackageRef
  usage: 'present' | 'read'
  seed: string
  selections: Array<{ slideKey: string; recipeRef: PackageRef; reason: string; contentBudget: number }>
}
/** Optional generation metadata; no text, slots, or authoritative protection snapshot. */
export interface DesignBinding {
  contractVersion: '1'
  recipeRef: PackageRef
  sourceBlockToElement: Record<string, string>
  parameters: Partial<Record<ControlName, number | string>>
  manualOverrides: Record<string, string[]>
}
export interface TrustPolicy { trustedDigests: readonly string[]; allowedLicenses: readonly string[] }

export function packageDigest(value: object): string {
  const { digest: _digest, ...payload } = value as Record<string, unknown>
  return `sha256-${canonicalHash(payload)}`
}
export function recipeReference(recipe: RecipeSpec): PackageRef {
  return { id: recipe.id, version: recipe.version, digest: packageDigest(recipe) }
}
export function structuralFingerprint(recipe: RecipeSpec): string {
  return packageDigest({ slots: recipe.slots, zones: recipe.zones, constraints: recipe.constraints, variants: recipe.variants ?? [], qualityRules: recipe.qualityRules ?? [] })
}
/** Generated search summary; slot definitions remain exclusively in RecipeSpec. */
export function createRecipeManifest(recipe: RecipeSpec, metadata: Pick<RecipeManifest, 'controls' | 'capacity' | 'capabilities' | 'samples' | 'licenses'>): RecipeManifest {
  const manifest: RecipeManifest = {
    ...cloneJson(metadata), contractVersion: '1', recipeRef: recipeReference(recipe),
    purpose: [...recipe.supports], slotRefs: recipe.slots.map(slot => slot.key),
    structuralFingerprint: structuralFingerprint(recipe), digest: '',
  }
  manifest.digest = packageDigest(manifest)
  return manifest
}

function requireThat(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
function exact(value: unknown, fields: string[], required = fields): asserts value is Record<string, unknown> {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), 'PACKAGE_OBJECT_REQUIRED')
  const record = value as Record<string, unknown>
  requireThat(Object.keys(record).every(key => fields.includes(key)) && required.every(key => Object.hasOwn(record, key)), 'PACKAGE_FIELDS_INVALID')
}
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(item => typeof item === 'string' && item.length > 0) }
export function assertPackageVersion(version: string): void {
  requireThat(typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version), 'PACKAGE_VERSION_INVALID: exact stable semver required')
}
function ref(value: PackageRef): void {
  exact(value, ['id', 'version', 'digest'])
  requireThat(typeof value.id === 'string' && value.id.length > 0, 'PACKAGE_ID_INVALID')
  assertPackageVersion(value.version)
  requireThat(/^sha256-[a-f0-9]{64}$/.test(value.digest), 'PACKAGE_DIGEST_INVALID')
}
function licenses(entries: LicenseEntry[], policy: TrustPolicy): void {
  requireThat(Array.isArray(entries) && entries.length > 0, 'PACKAGE_LICENSE_MISSING')
  const seen = new Set<string>()
  for (const entry of entries) {
    exact(entry, ['resource', 'kind', 'license', 'source', 'notice'])
    requireThat(strings([entry.resource, entry.license, entry.source, entry.notice]) && ['brand', 'font', 'photo', 'recipe', 'preview'].includes(entry.kind), 'PACKAGE_LICENSE_INVALID')
    requireThat(!seen.has(entry.resource), 'PACKAGE_LICENSE_DUPLICATE')
    seen.add(entry.resource)
    requireThat(policy.allowedLicenses.includes(entry.license), 'PACKAGE_LICENSE_DENIED')
  }
}
function envelope(value: { contractVersion: string; digest: string; licenses: LicenseEntry[] }, policy: TrustPolicy): void {
  requireThat(value.contractVersion === '1', 'PACKAGE_CONTRACT_UNSUPPORTED: retain original; explicit migration required')
  requireThat(value.digest === packageDigest(value), 'PACKAGE_DIGEST_MISMATCH')
  requireThat(policy.trustedDigests.includes(value.digest), 'PACKAGE_UNTRUSTED')
  licenses(value.licenses, policy)
}
const controlOptions = { columns: [1, 2, 3], captionDensity: ['low', 'medium', 'high'], imageSide: ['left', 'right'] } as const
export function resolveParameters(controls: RecipeControl[], input: Record<string, unknown> = {}): Partial<Record<ControlName, number | string>> {
  requireThat(Array.isArray(controls), 'RECIPE_CONTROLS_INVALID')
  const result: Partial<Record<ControlName, number | string>> = {}
  for (const control of controls) {
    exact(control, ['name', 'label', 'type', 'default', 'options', 'min', 'max', 'applicability', 'affects'], ['name', 'label', 'type', 'default', 'options', 'applicability', 'affects'])
    requireThat(Object.hasOwn(controlOptions, control.name) && !Object.hasOwn(result, control.name), 'RECIPE_CONTROL_NOT_ALLOWED')
    const allowed: readonly (number | string)[] = controlOptions[control.name]
    requireThat(control.type === (control.name === 'columns' ? 'integer' : 'enum') && control.affects === ({ columns: 'layout', captionDensity: 'caption', imageSide: 'image' }[control.name]), 'RECIPE_CONTROL_TYPE_INVALID')
    requireThat(typeof control.label === 'string' && control.label.length && strings(control.applicability) && control.applicability.length > 0, 'RECIPE_CONTROL_LABEL_INVALID')
    requireThat(Array.isArray(control.options) && control.options.length > 0 && new Set(control.options).size === control.options.length && control.options.every(option => allowed.includes(option)) && control.options.includes(control.default), 'RECIPE_CONTROL_OPTIONS_INVALID')
    requireThat(control.name === 'columns' ? (control.min === undefined || Number.isInteger(control.min) && control.min >= 1) && (control.max === undefined || Number.isInteger(control.max) && control.max <= 3) && control.options.every(option => Number(option) >= (control.min ?? 1) && Number(option) <= (control.max ?? 3)) : control.min === undefined && control.max === undefined, 'RECIPE_CONTROL_BOUNDS_INVALID')
    const value = Object.hasOwn(input, control.name) ? input[control.name] : control.default
    requireThat(control.options.includes(value as never), 'RECIPE_PARAMETER_INVALID')
    result[control.name] = value as number | string
  }
  requireThat(Object.keys(input).every(key => Object.hasOwn(result, key)), 'RECIPE_PARAMETER_NOT_ALLOWED')
  return result
}
export function validateRecipeManifest(manifest: RecipeManifest, recipe: RecipeSpec, policy: TrustPolicy): void {
  exact(manifest, ['contractVersion', 'recipeRef', 'purpose', 'slotRefs', 'controls', 'capacity', 'capabilities', 'structuralFingerprint', 'samples', 'licenses', 'digest'])
  envelope(manifest, policy)
  ref(manifest.recipeRef)
  requireThat(validateRecipeSpec(recipe).every(issue => issue.severity !== 'error'), 'RECIPE_SPEC_INVALID')
  requireThat(canonicalHash(manifest.recipeRef) === canonicalHash(recipeReference(recipe)), 'RECIPE_REFERENCE_MISMATCH')
  requireThat(canonicalHash(manifest.purpose) === canonicalHash(recipe.supports), 'RECIPE_PURPOSE_MISMATCH')
  requireThat(canonicalHash(manifest.slotRefs) === canonicalHash(recipe.slots.map(slot => slot.key)), 'RECIPE_SLOT_REFS_MISMATCH')
  requireThat(manifest.structuralFingerprint === structuralFingerprint(recipe), 'RECIPE_STRUCTURE_MISMATCH')
  resolveParameters(manifest.controls)
  requireThat(manifest.controls.every(control => control.applicability.every(key => manifest.slotRefs.includes(key))), 'RECIPE_CONTROL_SLOT_UNKNOWN')
  exact(manifest.capacity, ['maxBlocks', 'overflow', 'textUnit'])
  requireThat(Number.isSafeInteger(manifest.capacity.maxBlocks) && manifest.capacity.maxBlocks > 0 && manifest.capacity.overflow === 'reject-or-propose' && manifest.capacity.textUnit === 'unicode-code-point', 'RECIPE_CAPACITY_INVALID')
  exact(manifest.capabilities, ['html-edit', 'html-present', 'pdf', 'pptx-image', 'pptx-semantic'])
  requireThat(Object.values(manifest.capabilities).every(value => value === 'unverified' || value === 'unsupported'), 'RECIPE_CAPABILITY_EVIDENCE_REQUIRED')
  requireThat(Array.isArray(manifest.samples) && manifest.samples.length === 3 && new Set(manifest.samples.map(sample => sample.kind)).size === 3, 'RECIPE_SAMPLES_REQUIRED')
  for (const sample of manifest.samples) {
    exact(sample, ['kind', 'locale', 'input'])
    requireThat(['normal', 'boundary', 'overload'].includes(sample.kind) && sample.locale === 'zh-CN' && validatePresentationIR(sample.input).every(issue => issue.severity !== 'error'), 'RECIPE_SAMPLE_INVALID')
    requireThat(/[\u3400-\u9fff]/u.test(JSON.stringify(sample.input.slides.map(slide => slide.blocks))), 'RECIPE_CJK_SAMPLE_REQUIRED')
    requireThat(sample.input.slides.length > 0 && sample.input.slides.every(slide => sample.kind === 'normal' ? slide.blocks.length < manifest.capacity.maxBlocks : sample.kind === 'boundary' ? slide.blocks.length === manifest.capacity.maxBlocks : slide.blocks.length > manifest.capacity.maxBlocks), 'RECIPE_SAMPLE_CAPACITY_MISMATCH')
  }
  requireThat(manifest.licenses.some(entry => entry.kind === 'recipe' && entry.resource === recipe.id), 'RECIPE_LICENSE_MISSING')
}
export function validateStylePack(pack: StylePack, policy: TrustPolicy): void {
  exact(pack, ['contractVersion', 'id', 'version', 'description', 'suitableFor', 'unsuitableFor', 'density', 'theme', 'rules', 'recipeRefs', 'previews', 'licenses', 'digest'])
  envelope(pack, policy)
  assertPackageVersion(pack.version)
  requireThat(strings([pack.id, pack.description]) && strings(pack.suitableFor) && strings(pack.unsuitableFor) && strings(pack.previews) && ['low', 'medium', 'high'].includes(pack.density), 'STYLE_METADATA_INVALID')
  exact(pack.rules, ['image', 'line', 'chart'])
  requireThat(Object.values(pack.rules).every(strings), 'STYLE_RULES_INVALID')
  requireThat(Array.isArray(pack.recipeRefs) && pack.recipeRefs.length > 0, 'STYLE_RECIPES_REQUIRED')
  pack.recipeRefs.forEach(ref)
  exact(pack.theme, ['id', 'name', 'tokens', 'presets', 'extensions'], ['id', 'name', 'tokens', 'presets'])
  requireThat(strings([pack.theme.id, pack.theme.name]), 'STYLE_THEME_INVALID')
  exact(pack.theme.tokens, ['colors', 'fontFamilies', 'fontSizes', 'spacing', 'radii', 'shadows'])
  exact(pack.theme.presets, ['text', 'shape', 'image', 'chart'])
  requireThat(validateThemeDefinition(pack.theme).length === 0, 'STYLE_THEME_INVALID')
  for (const family of Object.values(pack.theme.tokens.fontFamilies)) requireThat(pack.licenses.some(entry => entry.kind === 'font' && entry.resource === family), 'STYLE_FONT_LICENSE_MISSING')
  for (const preview of pack.previews) requireThat(pack.licenses.some(entry => entry.kind === 'preview' && entry.resource === preview), 'STYLE_PREVIEW_LICENSE_MISSING')
}
/** No latest-version fallback: a missing pin is an explicit failure, including old versions. */
export function resolvePackage<T extends { id: string; version: string; digest: string }>(reference: PackageRef, available: readonly T[]): T {
  ref(reference)
  const matches = available.filter(value => value.id === reference.id && value.version === reference.version)
  requireThat(matches.length === 1, 'PACKAGE_VERSION_UNAVAILABLE_OR_AMBIGUOUS')
  requireThat(matches[0].digest === reference.digest && packageDigest(matches[0]) === reference.digest, 'PACKAGE_DIGEST_MISMATCH')
  return cloneJson(matches[0])
}
export function compileBrandTheme(brand: BrandSpec, theme: ThemeDefinition, policy: TrustPolicy): ThemeDefinition {
  exact(brand, ['contractVersion', 'id', 'version', 'colors', 'fontRoles', 'logoAssetRefs', 'safeAreas', 'forbidden', 'licenses'])
  requireThat(brand.contractVersion === '1', 'PACKAGE_CONTRACT_UNSUPPORTED')
  assertPackageVersion(brand.version)
  requireThat(policy.trustedDigests.includes(packageDigest(brand)), 'PACKAGE_UNTRUSTED')
  licenses(brand.licenses, policy)
  requireThat(strings([brand.id]) && strings(brand.logoAssetRefs) && strings(brand.forbidden), 'BRAND_INVALID')
  requireThat(Object.values(brand.colors).every(value => typeof value === 'string' && /^#[a-fA-F0-9]{6}$/.test(value)) && strings(Object.values(brand.fontRoles)), 'BRAND_TOKENS_INVALID')
  requireThat(Array.isArray(brand.safeAreas) && brand.safeAreas.every(area => { exact(area, ['x', 'y', 'width', 'height']); return [area.x, area.y, area.width, area.height].every(Number.isFinite) && area.width > 0 && area.height > 0 }), 'BRAND_SAFE_AREA_INVALID')
  for (const resource of [brand.id, ...brand.logoAssetRefs, ...Object.values(brand.fontRoles)]) requireThat(brand.licenses.some(entry => entry.resource === resource && entry.kind === (Object.values(brand.fontRoles).includes(resource) ? 'font' : 'brand')), 'BRAND_RESOURCE_LICENSE_MISSING')
  const result = cloneJson(theme)
  Object.assign(result.tokens.colors, brand.colors)
  Object.assign(result.tokens.fontFamilies, brand.fontRoles)
  requireThat(validateThemeDefinition(result).length === 0, 'BRAND_THEME_INVALID')
  return result
}
export function designRuleLayers(brand: BrandSpec, recipe: RecipeSpec, style: StylePack) {
  return { brand: { severity: 'error' as const, colors: brand.colors, fontRoles: brand.fontRoles, logoAssetRefs: brand.logoAssetRefs, safeAreas: brand.safeAreas, forbidden: brand.forbidden }, recipe: { severity: 'error' as const, slots: recipe.slots, constraints: recipe.constraints, qualityRules: recipe.qualityRules ?? [] }, aesthetic: { severity: 'suggestion' as const, rules: style.rules, density: style.density } }
}
/** Whole-object replacement conservatively retains any protected field. IR can only add. */
export function regenerationProtectedIds(slide: Slide, additions: ProtectedContentIR[] = []): Set<string> {
  const anchors: ProtectedAnchor[] = [...(slide.protectedAnchors ?? [])]
  for (const addition of additions) {
    if (addition.semanticKey) anchors.push({ target: { kind: 'semantic', semanticKey: addition.semanticKey }, preserve: addition.preserve })
    if (addition.factId) anchors.push({ target: { kind: 'fact', factId: addition.factId }, preserve: addition.preserve })
  }
  return new Set(Object.values(slide.elements).filter(element => element.locked || element.editPolicy?.protected || element.editPolicy?.mode === 'locked' || element.editPolicy?.agentEditable === false || element.editPolicy?.preserveOnRegenerate || element.editPolicy?.lockedFields?.length || anchors.some(anchor => anchor.preserve.length > 0 && (anchor.target.kind === 'element' ? anchor.target.elementId === element.id : anchor.target.kind === 'semantic' ? anchor.target.semanticKey === element.semanticKey : element.semanticRefs?.factIds?.includes(anchor.target.factId)))).map(element => element.id))
}
