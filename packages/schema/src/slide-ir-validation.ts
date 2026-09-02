import type { ValidationIssue } from './operations.js'
import type {
  BlockIR,
  LayoutConstraint,
  LayoutIntent,
  LayoutZone,
  PresentationIR,
  ProtectedContentIR,
  RecipeSlot,
  RecipeSpec,
  SlideIR,
} from './slide-ir.js'

const SLIDE_PURPOSES = new Set(['cover', 'section', 'statement', 'explanation', 'comparison', 'metrics', 'chart', 'timeline', 'process', 'quote', 'summary', 'closing', 'custom'])
const VISUAL_STRATEGIES = new Set(['structured', 'hybrid', 'poster'])
const DENSITIES = new Set(['low', 'medium', 'high'])
const BLOCK_KINDS = new Set(['heading', 'paragraph', 'metric', 'image', 'chart', 'comparison', 'quote', 'process', 'timeline', 'source', 'cta'])
const IMPORTANCES = new Set(['primary', 'secondary', 'supporting'])
const EDITABILITY_TARGETS = new Set(['full', 'property', 'replace'])
const CONSTRAINT_KINDS = new Set(['align', 'stack', 'grid', 'gap', 'padding', 'min-size', 'max-size', 'aspect-ratio', 'keep-together', 'avoid-region', 'safe-area', 'baseline'])
const MAX_STRING = 4096
const MAX_BLOCKS = 64
const MAX_ARRAY = 128

/** Validate a model-produced Slide IR without executing or interpreting its data as code. */
export function validateSlideIR(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const add = (message: string, path = '/') => issues.push({ code: 'SLIDE_IR_INVALID', severity: 'error', message, path })
  const object = record(value, add, 'Slide IR')
  if (!object) return issues
  checkKnown(object, ['irVersion', 'slideKey', 'purpose', 'message', 'visualStrategy', 'density', 'blocks', 'layoutIntent', 'artworkIntent', 'protectedContent', 'sourceIds'], add)
  requireString(object, 'irVersion', add, '1.0')
  requireString(object, 'slideKey', add)
  requireString(object, 'message', add)
  if (typeof object.purpose !== 'string' || !SLIDE_PURPOSES.has(object.purpose)) add('purpose must be a supported Slide Purpose.', '/purpose')
  if (typeof object.visualStrategy !== 'string' || !VISUAL_STRATEGIES.has(object.visualStrategy)) add('visualStrategy must be structured, hybrid, or poster.', '/visualStrategy')
  if (typeof object.density !== 'string' || !DENSITIES.has(object.density)) add('density must be low, medium, or high.', '/density')
  if (!Array.isArray(object.blocks) || object.blocks.length < 1 || object.blocks.length > MAX_BLOCKS) add(`blocks must contain 1–${MAX_BLOCKS} items.`, '/blocks')
  const blocks = Array.isArray(object.blocks) ? object.blocks : []
  const blockKeys = new Set<string>()
  for (const [index, block] of blocks.entries()) validateBlock(block, index, blockKeys, add)
  for (const [index, block] of blocks.entries()) {
    if (!isRecord(block)) continue
    for (const key of arrayOfStrings(block.keepTogetherWith)) if (!blockKeys.has(key)) add(`keepTogetherWith references unknown block ${key}.`, `/blocks/${index}/keepTogetherWith`)
  }
  if (object.layoutIntent !== undefined) validateLayoutIntent(object.layoutIntent, add)
  if (object.artworkIntent !== undefined) validateArtworkIntent(object.artworkIntent, add)
  if (object.protectedContent !== undefined) {
    if (!Array.isArray(object.protectedContent) || object.protectedContent.length > MAX_ARRAY) add(`protectedContent must be an array of at most ${MAX_ARRAY} items.`, '/protectedContent')
    else object.protectedContent.forEach((item, index) => validateProtectedContent(item, index, add))
  }
  validateStringArray(object.sourceIds, '/sourceIds', add)
  return issues
}

export function validatePresentationIR(value: unknown): ValidationIssue[] {
  const issues = validateBasePresentation(value)
  const object = isRecord(value) ? value : undefined
  if (!object) return issues
  const add = (message: string, path = '/') => issues.push({ code: 'PRESENTATION_IR_INVALID', severity: 'error', message, path })
  checkKnown(object, ['irVersion', 'title', 'audience', 'objective', 'narrative', 'slides', 'themeIntent', 'sourceIds'], add)
  if (!Array.isArray(object.narrative) || object.narrative.length > MAX_ARRAY) add(`narrative must be an array of at most ${MAX_ARRAY} items.`, '/narrative')
  const slides = Array.isArray(object.slides) ? object.slides : []
  const slideKeys = new Set<string>()
  slides.forEach((slide, index) => {
    const slideIssues = validateSlideIR(slide).map((issue) => ({ ...issue, code: 'PRESENTATION_IR_INVALID', path: `/slides/${index}${issue.path === '/' ? '' : issue.path}` }))
    issues.push(...slideIssues)
    if (isRecord(slide) && typeof slide.slideKey === 'string') {
      if (slideKeys.has(slide.slideKey)) add(`Duplicate slideKey ${slide.slideKey}.`, `/slides/${index}/slideKey`)
      slideKeys.add(slide.slideKey)
    }
  })
  if (Array.isArray(object.narrative)) for (const [index, raw] of object.narrative.entries()) {
    const path = `/narrative/${index}`
    if (!isRecord(raw)) { add('Narrative section must be an object.', path); continue }
    checkKnown(raw, ['key', 'title', 'message', 'slideKeys'], add, path)
    requireString(raw, 'key', add, undefined, path)
    requireString(raw, 'title', add, undefined, path)
    validateStringArray(raw.slideKeys, `${path}/slideKeys`, add)
    for (const key of arrayOfStrings(raw.slideKeys)) if (!slideKeys.has(key)) add(`Narrative references unknown slide ${key}.`, `${path}/slideKeys`)
  }
  if (object.themeIntent !== undefined) validateThemeIntent(object.themeIntent, add)
  validateStringArray(object.sourceIds, '/sourceIds', add)
  return issues
}

export function validateRecipeSpec(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const add = (message: string, path = '/') => issues.push({ code: 'RECIPE_INVALID', severity: 'error', message, path })
  const object = record(value, add, 'Recipe')
  if (!object) return issues
  checkKnown(object, ['id', 'version', 'supports', 'slots', 'zones', 'constraints', 'variants', 'artworkSafeRegions', 'qualityRules'], add)
  requireString(object, 'id', add)
  requireString(object, 'version', add)
  if (!Array.isArray(object.supports)) add('supports must contain at least one purpose.', '/supports')
  else validateStringArray(object.supports, '/supports', add, 1)
  if (Array.isArray(object.supports)) for (const [index, purpose] of object.supports.entries()) if (!SLIDE_PURPOSES.has(purpose)) add(`Unsupported Recipe purpose ${purpose}.`, `/supports/${index}`)
  if (!Array.isArray(object.slots) || object.slots.length < 1 || object.slots.length > MAX_ARRAY) add(`slots must contain 1–${MAX_ARRAY} items.`, '/slots')
  const slots = Array.isArray(object.slots) ? object.slots : []
  const slotKeys = new Set<string>()
  slots.forEach((slot, index) => validateRecipeSlot(slot, index, slotKeys, add))
  if (!Array.isArray(object.zones) || object.zones.length < 1 || object.zones.length > MAX_ARRAY) add(`zones must contain 1–${MAX_ARRAY} items.`, '/zones')
  const zones = Array.isArray(object.zones) ? object.zones : []
  const zoneIds = new Set<string>()
  zones.forEach((zone, index) => validateZone(zone, index, zoneIds, add))
  if (!Array.isArray(object.constraints) || object.constraints.length > MAX_ARRAY) add(`constraints must be an array of at most ${MAX_ARRAY} items.`, '/constraints')
  if (Array.isArray(object.constraints)) object.constraints.forEach((constraint, index) => validateConstraint(constraint, index, slotKeys, zoneIds, add))
  if (object.variants !== undefined && (!Array.isArray(object.variants) || object.variants.length > MAX_ARRAY)) add(`variants must contain at most ${MAX_ARRAY} items.`, '/variants')
  if (Array.isArray(object.variants)) object.variants.forEach((variant, index) => validateRecipeVariant(variant, index, zoneIds, add))
  if (object.artworkSafeRegions !== undefined) validateRects(object.artworkSafeRegions, '/artworkSafeRegions', add)
  if (object.qualityRules !== undefined && (!Array.isArray(object.qualityRules) || object.qualityRules.length > MAX_ARRAY)) add(`qualityRules must contain at most ${MAX_ARRAY} items.`, '/qualityRules')
  if (Array.isArray(object.qualityRules)) object.qualityRules.forEach((rule, index) => validateQualityRule(rule, index, add))
  return issues
}

export function validateCompiledSlideDraft(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const add = (message: string, path = '/') => issues.push({ code: 'COMPILED_DRAFT_INVALID', severity: 'error', message, path })
  const object = record(value, add, 'Compiled slide draft')
  if (!object) return issues
  checkKnown(object, ['slideKey', 'slide', 'elementDrafts', 'groups', 'readingOrder', 'semanticKeyMap', 'assetIds', 'validationIssues', 'provenance'], add)
  requireString(object, 'slideKey', add)
  if (!isRecord(object.slide)) add('slide must be a slide draft object.', '/slide')
  else {
    checkKnown(object.slide, ['slideKey', 'purpose', 'message', 'visualStrategy', 'sourceIds'], add, '/slide')
    requireString(object.slide, 'slideKey', add, undefined, '/slide')
    requireString(object.slide, 'message', add, undefined, '/slide')
    if (typeof object.slideKey === 'string' && object.slide.slideKey !== object.slideKey) add('slide.slideKey must match the compiled slideKey.', '/slide/slideKey')
    if (!SLIDE_PURPOSES.has(String(object.slide.purpose))) add('slide purpose is unsupported.', '/slide/purpose')
    if (!VISUAL_STRATEGIES.has(String(object.slide.visualStrategy))) add('slide visualStrategy is unsupported.', '/slide/visualStrategy')
    validateStringArray(object.slide.sourceIds, '/slide/sourceIds', add)
  }
  if (!Array.isArray(object.elementDrafts)) add('elementDrafts must be an array.', '/elementDrafts')
  const drafts = Array.isArray(object.elementDrafts) ? object.elementDrafts : []
  const ids = new Set<string>()
  const keys = new Set<string>()
  drafts.forEach((draft, index) => {
    if (!isRecord(draft)) { add('Element draft must be an object.', `/elementDrafts/${index}`); return }
    checkKnown(draft, ['draftId', 'kind', 'semanticKey', 'role', 'frame', 'data', 'sourceBlockKey'], add, `/elementDrafts/${index}`)
    requireString(draft, 'draftId', add, undefined, `/elementDrafts/${index}`)
    if (typeof draft.draftId === 'string' && ids.has(draft.draftId)) add(`Duplicate draftId ${draft.draftId}.`, `/elementDrafts/${index}/draftId`)
    if (typeof draft.draftId === 'string') ids.add(draft.draftId)
    if (!['text', 'image', 'shape', 'chart', 'component'].includes(String(draft.kind))) add('Element draft kind is unsupported.', `/elementDrafts/${index}/kind`)
    if (!validRect(draft.frame)) add('Element draft frame must be finite and positive.', `/elementDrafts/${index}/frame`)
    else if (isRecord(draft.frame)) checkKnown(draft.frame, ['x', 'y', 'width', 'height'], add, `/elementDrafts/${index}/frame`)
    if (draft.semanticKey !== undefined) {
      if (typeof draft.semanticKey !== 'string' || !draft.semanticKey) add('Element draft semanticKey must be non-empty.', `/elementDrafts/${index}/semanticKey`)
      else if (keys.has(draft.semanticKey)) add(`Duplicate draft semanticKey ${draft.semanticKey}.`, `/elementDrafts/${index}/semanticKey`)
      else keys.add(draft.semanticKey)
    }
    if (draft.role !== undefined && !['title', 'subtitle', 'body', 'caption', 'metric', 'source', 'logo', 'image', 'chart', 'artwork', 'background', 'decorative', 'navigation', 'cta', 'custom'].includes(String(draft.role))) add('Element draft role is unsupported.', `/elementDrafts/${index}/role`)
    if (draft.sourceBlockKey !== undefined && (typeof draft.sourceBlockKey !== 'string' || !draft.sourceBlockKey)) add('Element draft sourceBlockKey must be non-empty when present.', `/elementDrafts/${index}/sourceBlockKey`)
    if (!isJsonValue(draft.data, 0)) add('Element draft data must be JSON-safe and bounded.', `/elementDrafts/${index}/data`)
  })
  if (!Array.isArray(object.readingOrder)) add('readingOrder must be an array.', '/readingOrder')
  else {
    const readingIds = new Set<string>()
    for (const [index, id] of object.readingOrder.entries()) {
      if (typeof id !== 'string' || !ids.has(id)) add(`readingOrder references unknown draft ${String(id)}.`, `/readingOrder/${index}`)
      else if (readingIds.has(id)) add(`readingOrder contains duplicate draft ${id}.`, `/readingOrder/${index}`)
      else readingIds.add(id)
    }
  }
  if (!isRecord(object.semanticKeyMap)) add('semanticKeyMap must be an object.', '/semanticKeyMap')
  else for (const [key, id] of Object.entries(object.semanticKeyMap)) { if (!key || typeof id !== 'string' || !ids.has(id)) add(`semanticKeyMap entry ${key} must reference a draft.`, `/semanticKeyMap/${escapePointer(key)}`) }
  if (object.assetIds !== undefined) validateStringArray(object.assetIds, '/assetIds', add)
  if (!Array.isArray(object.groups)) add('groups must be an array.', '/groups')
  else {
    const groupIds = new Set<string>()
    object.groups.forEach((group, index) => {
      const path = `/groups/${index}`
      if (!isRecord(group)) { add('Draft group must be an object.', path); return }
      checkKnown(group, ['draftId', 'memberDraftIds'], add, path)
      requireString(group, 'draftId', add, undefined, path)
      if (typeof group.draftId === 'string') {
        if (groupIds.has(group.draftId)) add(`Duplicate group draftId ${group.draftId}.`, `${path}/draftId`)
        groupIds.add(group.draftId)
        if (ids.has(group.draftId)) add(`Group draftId ${group.draftId} collides with an element draft.`, `${path}/draftId`)
      }
      if (!Array.isArray(group.memberDraftIds) || group.memberDraftIds.length < 1) add('Draft group memberDraftIds must be non-empty.', `${path}/memberDraftIds`)
      else {
        const members = new Set<string>()
        for (const [memberIndex, memberId] of group.memberDraftIds.entries()) {
          if (typeof memberId !== 'string' || !ids.has(memberId)) add(`Draft group references unknown member ${String(memberId)}.`, `${path}/memberDraftIds/${memberIndex}`)
          else if (members.has(memberId)) add(`Draft group repeats member ${memberId}.`, `${path}/memberDraftIds/${memberIndex}`)
          members.add(memberId)
        }
      }
    })
  }
  if (!Array.isArray(object.validationIssues)) add('validationIssues must be an array.', '/validationIssues')
  else if (object.validationIssues.length > MAX_ARRAY) add(`validationIssues must contain at most ${MAX_ARRAY} items.`, '/validationIssues')
  else object.validationIssues.forEach((item, index) => {
    if (!isRecord(item)) { add('Compiled validation issue must be an object.', `/validationIssues/${index}`); return }
    checkKnown(item, ['code', 'severity', 'message', 'slideId', 'elementId', 'semanticKey', 'factId', 'path', 'recovery', 'causeId'], add, `/validationIssues/${index}`)
    requireString(item, 'code', add, undefined, `/validationIssues/${index}`)
    requireString(item, 'message', add, undefined, `/validationIssues/${index}`)
    if (!['error', 'warning', 'info'].includes(String(item.severity))) add('Compiled validation issue severity is invalid.', `/validationIssues/${index}/severity`)
  })
  if (!isRecord(object.provenance)) add('provenance must be an object.', '/provenance')
  else {
    checkKnown(object.provenance, ['compilerVersion', 'recipeId', 'recipeVersion', 'slideIrDigest', 'seed', 'fontMetricsFingerprint'], add, '/provenance')
    for (const field of ['compilerVersion', 'slideIrDigest', 'fontMetricsFingerprint'] as const) requireString(object.provenance, field, add, undefined, '/provenance')
    for (const field of ['recipeId', 'recipeVersion', 'seed'] as const) if (object.provenance[field] !== undefined && (typeof object.provenance[field] !== 'string' || !object.provenance[field])) add(`${field} must be a non-empty string when present.`, `/provenance/${field}`)
  }
  return issues
}

function validateBasePresentation(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!isRecord(value)) return [{ code: 'PRESENTATION_IR_INVALID', severity: 'error', message: 'Presentation IR must be an object.', path: '/' }]
  if (value.irVersion !== '1.0') issues.push({ code: 'PRESENTATION_IR_INVALID', severity: 'error', message: 'irVersion must be 1.0.', path: '/irVersion' })
  if (typeof value.title !== 'string' || !value.title || value.title.length > MAX_STRING) issues.push({ code: 'PRESENTATION_IR_INVALID', severity: 'error', message: 'title must be a non-empty bounded string.', path: '/title' })
  for (const field of ['audience', 'objective'] as const) if (value[field] !== undefined && (typeof value[field] !== 'string' || value[field].length > MAX_STRING)) issues.push({ code: 'PRESENTATION_IR_INVALID', severity: 'error', message: `${field} must be a bounded string.`, path: `/${field}` })
  if (!Array.isArray(value.slides) || value.slides.length < 1 || value.slides.length > MAX_ARRAY) issues.push({ code: 'PRESENTATION_IR_INVALID', severity: 'error', message: `slides must contain 1–${MAX_ARRAY} items.`, path: '/slides' })
  return issues
}

function validateBlock(value: unknown, index: number, keys: Set<string>, add: (message: string, path?: string) => void) {
  const path = `/blocks/${index}`
  if (!isRecord(value)) { add('Block must be an object.', path); return }
  checkKnown(value, ['key', 'kind', 'content', 'semanticKey', 'factIds', 'sourceIds', 'importance', 'emphasis', 'keepTogetherWith', 'preferredAspectRatio', 'editabilityTarget'], add, path)
  requireString(value, 'key', add, undefined, path)
  if (typeof value.key === 'string') { if (keys.has(value.key)) add(`Duplicate block key ${value.key}.`, `${path}/key`); keys.add(value.key) }
  if (typeof value.kind !== 'string' || !BLOCK_KINDS.has(value.kind)) add('Block kind is unsupported.', `${path}/kind`)
  if (typeof value.importance !== 'string' || !IMPORTANCES.has(value.importance)) add('Block importance is invalid.', `${path}/importance`)
  if (value.content !== undefined && !isJsonValue(value.content, 0)) add('Block content must be JSON-safe and bounded.', `${path}/content`)
  for (const field of ['semanticKey', 'emphasis', 'editabilityTarget'] as const) if (value[field] !== undefined && typeof value[field] !== 'string') add(`${field} must be a string.`, `${path}/${field}`)
  if (value.emphasis !== undefined && !['normal', 'strong'].includes(String(value.emphasis))) add('Block emphasis is invalid.', `${path}/emphasis`)
  if (value.editabilityTarget !== undefined && !EDITABILITY_TARGETS.has(String(value.editabilityTarget))) add('Block editabilityTarget is invalid.', `${path}/editabilityTarget`)
  if (value.preferredAspectRatio !== undefined && (!finitePositive(value.preferredAspectRatio))) add('preferredAspectRatio must be positive and finite.', `${path}/preferredAspectRatio`)
  validateStringArray(value.factIds, `${path}/factIds`, add)
  validateStringArray(value.sourceIds, `${path}/sourceIds`, add)
  validateStringArray(value.keepTogetherWith, `${path}/keepTogetherWith`, add)
}

function validateLayoutIntent(value: unknown, add: (message: string, path?: string) => void) {
  if (!isRecord(value)) { add('layoutIntent must be an object.', '/layoutIntent'); return }
  checkKnown(value, ['balance', 'direction', 'hierarchy', 'rhythm', 'whitespace', 'preferredRecipeIds', 'avoidRecipeIds'], add, '/layoutIntent')
  if (!['text-led', 'visual-led', 'balanced'].includes(String(value.balance))) add('layoutIntent.balance is invalid.', '/layoutIntent/balance')
  if (value.direction !== undefined && !['horizontal', 'vertical'].includes(String(value.direction))) add('layoutIntent.direction is invalid.', '/layoutIntent/direction')
  if (value.hierarchy !== undefined && !['single-focus', 'dual-focus', 'grid'].includes(String(value.hierarchy))) add('layoutIntent.hierarchy is invalid.', '/layoutIntent/hierarchy')
  if (value.rhythm !== undefined && !['calm', 'dynamic'].includes(String(value.rhythm))) add('layoutIntent.rhythm is invalid.', '/layoutIntent/rhythm')
  if (value.whitespace !== undefined && !['compact', 'normal', 'generous'].includes(String(value.whitespace))) add('layoutIntent.whitespace is invalid.', '/layoutIntent/whitespace')
  validateStringArray(value.preferredRecipeIds, '/layoutIntent/preferredRecipeIds', add)
  validateStringArray(value.avoidRecipeIds, '/layoutIntent/avoidRecipeIds', add)
}

function validateArtworkIntent(value: unknown, add: (message: string, path?: string) => void) {
  if (!isRecord(value)) { add('artworkIntent must be an object.', '/artworkIntent'); return }
  checkKnown(value, ['subject', 'function', 'placement', 'safeTextRegions', 'avoidTextRegions', 'styleKeywords'], add, '/artworkIntent')
  for (const field of ['subject', 'function', 'placement'] as const) if (typeof value[field] !== 'string' || !value[field] || String(value[field]).length > MAX_STRING) add(`artworkIntent.${field} is required and bounded.`, `/artworkIntent/${field}`)
  if (!['evidence', 'illustration', 'background', 'atmosphere'].includes(String(value.function))) add('artworkIntent.function is invalid.', '/artworkIntent/function')
  if (!['full-bleed', 'side', 'center', 'background'].includes(String(value.placement))) add('artworkIntent.placement is invalid.', '/artworkIntent/placement')
  validateRects(value.safeTextRegions, '/artworkIntent/safeTextRegions', add)
  validateRects(value.avoidTextRegions, '/artworkIntent/avoidTextRegions', add)
  validateStringArray(value.styleKeywords, '/artworkIntent/styleKeywords', add)
}

function validateProtectedContent(value: unknown, index: number, add: (message: string, path?: string) => void) {
  const path = `/protectedContent/${index}`
  if (!isRecord(value)) { add('Protected content must be an object.', path); return }
  checkKnown(value, ['semanticKey', 'factId', 'preserve'], add, path)
  const hasSemantic = typeof value.semanticKey === 'string' && value.semanticKey.length > 0
  const hasFact = typeof value.factId === 'string' && value.factId.length > 0
  if (hasSemantic === hasFact) add('Protected content must specify exactly one semanticKey or factId.', path)
  if (!Array.isArray(value.preserve) || value.preserve.length < 1 || value.preserve.some((item) => !['content', 'data', 'style', 'geometry', 'asset'].includes(String(item)))) add('Protected content preserve is invalid.', `${path}/preserve`)
}

function validateRecipeSlot(value: unknown, index: number, keys: Set<string>, add: (message: string, path?: string) => void) {
  const path = `/slots/${index}`
  if (!isRecord(value)) { add('Recipe slot must be an object.', path); return }
  checkKnown(value, ['key', 'accepts', 'required', 'minCount', 'maxCount', 'maxChars', 'preferredAspectRatio', 'styleRef', 'semanticRole'], add, path)
  requireString(value, 'key', add, undefined, path)
  if (typeof value.key === 'string') { if (keys.has(value.key)) add(`Duplicate slot key ${value.key}.`, `${path}/key`); keys.add(value.key) }
  if (!Array.isArray(value.accepts)) add('accepts must contain at least one block kind.', `${path}/accepts`)
  else validateStringArray(value.accepts, `${path}/accepts`, add, 1)
  if (Array.isArray(value.accepts)) for (const [itemIndex, kind] of value.accepts.entries()) if (!BLOCK_KINDS.has(kind)) add(`Unsupported slot block kind ${kind}.`, `${path}/accepts/${itemIndex}`)
  if (value.required !== undefined && typeof value.required !== 'boolean') add('required must be boolean.', `${path}/required`)
  for (const field of ['minCount', 'maxCount'] as const) if (value[field] !== undefined && (!Number.isInteger(value[field]) || Number(value[field]) < 0)) add(`${field} must be a non-negative integer.`, `${path}/${field}`)
  if (value.minCount !== undefined && value.maxCount !== undefined && Number(value.minCount) > Number(value.maxCount)) add('minCount must not exceed maxCount.', path)
  if (value.maxChars !== undefined && (!Number.isInteger(value.maxChars) || Number(value.maxChars) < 1)) add('maxChars must be a positive integer.', `${path}/maxChars`)
  if (value.preferredAspectRatio !== undefined && !finitePositive(value.preferredAspectRatio)) add('preferredAspectRatio must be positive and finite.', `${path}/preferredAspectRatio`)
  if (value.styleRef !== undefined && typeof value.styleRef !== 'string') add('styleRef must be a string.', `${path}/styleRef`)
}

function validateRecipeVariant(value: unknown, index: number, zoneIds: Set<string>, add: (message: string, path?: string) => void) {
  const path = `/variants/${index}`
  if (!isRecord(value)) { add('Recipe variant must be an object.', path); return }
  checkKnown(value, ['id', 'when', 'zoneOverrides'], add, path)
  requireString(value, 'id', add, undefined, path)
  if (value.when !== undefined && !isJsonValue(value.when, 0)) add('Recipe variant when must be bounded JSON data.', `${path}/when`)
  if (value.zoneOverrides !== undefined) {
    if (!isRecord(value.zoneOverrides)) add('Recipe variant zoneOverrides must be an object.', `${path}/zoneOverrides`)
    else for (const [zoneId, override] of Object.entries(value.zoneOverrides)) {
      if (!zoneIds.has(zoneId)) add(`Recipe variant references unknown zone ${zoneId}.`, `${path}/zoneOverrides/${escapePointer(zoneId)}`)
      if (!isRecord(override)) add('Recipe zone override must be an object.', `${path}/zoneOverrides/${escapePointer(zoneId)}`)
      else { checkKnown(override, ['id', 'x', 'y', 'width', 'height'], add, `${path}/zoneOverrides/${escapePointer(zoneId)}`); for (const field of ['x', 'y', 'width', 'height'] as const) if (override[field] !== undefined && (!finite(override[field]) || Number(override[field]) < 0 || Number(override[field]) > 1)) add(`Zone override ${field} must be normalized.`, `${path}/zoneOverrides/${escapePointer(zoneId)}/${field}`) }
    }
  }
}

function validateQualityRule(value: unknown, index: number, add: (message: string, path?: string) => void) {
  const path = `/qualityRules/${index}`
  if (!isRecord(value)) { add('Recipe quality rule must be an object.', path); return }
  checkKnown(value, ['kind', 'value'], add, path)
  if (!['max-elements', 'min-font-size', 'max-overflow', 'required-reading-order'].includes(String(value.kind))) add('Recipe quality rule kind is invalid.', `${path}/kind`)
  if (!(typeof value.value === 'boolean' || finite(value.value))) add('Recipe quality rule value must be a finite number or boolean.', `${path}/value`)
}

function validateThemeIntent(value: unknown, add: (message: string, path?: string) => void) {
  if (!isRecord(value)) { add('themeIntent must be an object.', '/themeIntent'); return }
  checkKnown(value, ['tone', 'density', 'brandKeywords', 'preferredColors', 'avoidColors'], add, '/themeIntent')
  if (value.tone !== undefined && !['formal', 'modern', 'editorial', 'technical', 'playful'].includes(String(value.tone))) add('themeIntent.tone is invalid.', '/themeIntent/tone')
  if (value.density !== undefined && !DENSITIES.has(String(value.density))) add('themeIntent.density is invalid.', '/themeIntent/density')
  validateStringArray(value.brandKeywords, '/themeIntent/brandKeywords', add)
  validateStringArray(value.preferredColors, '/themeIntent/preferredColors', add)
  validateStringArray(value.avoidColors, '/themeIntent/avoidColors', add)
}

function validateZone(value: unknown, index: number, ids: Set<string>, add: (message: string, path?: string) => void) {
  const path = `/zones/${index}`
  if (!isRecord(value)) { add('Layout zone must be an object.', path); return }
  checkKnown(value, ['id', 'x', 'y', 'width', 'height'], add, path)
  requireString(value, 'id', add, undefined, path)
  if (typeof value.id === 'string') { if (ids.has(value.id)) add(`Duplicate zone id ${value.id}.`, `${path}/id`); ids.add(value.id) }
  for (const field of ['x', 'y', 'width', 'height'] as const) if (!finite(value[field]) || Number(value[field]) < 0 || Number(value[field]) > 1 || (field === 'width' || field === 'height') && Number(value[field]) <= 0) add(`Zone ${field} must be a normalized finite value in 0..1${field === 'x' || field === 'y' ? '' : ' with a positive size'}.`, `${path}/${field}`)
  if (finite(value.x) && finite(value.width) && Number(value.x) + Number(value.width) > 1) add('Zone x + width must not exceed 1.', `${path}/width`)
  if (finite(value.y) && finite(value.height) && Number(value.y) + Number(value.height) > 1) add('Zone y + height must not exceed 1.', `${path}/height`)
}

function validateConstraint(value: unknown, index: number, slotIds: Set<string>, zoneIds: Set<string>, add: (message: string, path?: string) => void) {
  const path = `/constraints/${index}`
  if (!isRecord(value) || typeof value.kind !== 'string' || !CONSTRAINT_KINDS.has(value.kind)) { add('Layout constraint kind is unsupported.', path); return }
  const knownByKind: Record<string, string[]> = {
    align: ['kind', 'slotIds', 'axis', 'mode'], stack: ['kind', 'slotIds', 'axis', 'gap'], grid: ['kind', 'slotIds', 'columns', 'gapX', 'gapY'], gap: ['kind', 'slotIds', 'axis', 'value'], padding: ['kind', 'zoneId', 'top', 'right', 'bottom', 'left'],
    'min-size': ['kind', 'slotId', 'width', 'height'], 'max-size': ['kind', 'slotId', 'width', 'height'], 'aspect-ratio': ['kind', 'slotId', 'ratio'], 'keep-together': ['kind', 'slotIds'], 'avoid-region': ['kind', 'slotId', 'region'], 'safe-area': ['kind', 'slotId'], baseline: ['kind', 'slotIds'],
  }
  checkKnown(value, knownByKind[value.kind] ?? ['kind'], add, path)
  const constraint = value as Record<string, unknown>
  const checkSlots = (items: unknown) => { if (!Array.isArray(items) || items.length < 1) add('Constraint slotIds must be non-empty.', `${path}/slotIds`); else for (const id of items) if (typeof id !== 'string' || !slotIds.has(id)) add(`Constraint references unknown slot ${String(id)}.`, `${path}/slotIds`) }
  if (['align', 'stack', 'grid', 'gap', 'keep-together', 'baseline'].includes(value.kind)) checkSlots(value.slotIds)
  if (['min-size', 'max-size', 'aspect-ratio', 'avoid-region'].includes(value.kind) && (typeof value.slotId !== 'string' || !slotIds.has(value.slotId))) add(`Constraint references unknown slot ${String(value.slotId)}.`, `${path}/slotId`)
  if (value.kind === 'safe-area' && value.slotId !== '*' && (typeof value.slotId !== 'string' || !slotIds.has(value.slotId))) add(`Constraint references unknown slot ${String(value.slotId)}.`, `${path}/slotId`)
  if (value.kind === 'padding' && (typeof value.zoneId !== 'string' || !zoneIds.has(value.zoneId))) add(`Constraint references unknown zone ${String(value.zoneId)}.`, `${path}/zoneId`)
  for (const field of ['gap', 'value', 'ratio', 'gapX', 'gapY', 'width', 'height', 'top', 'right', 'bottom', 'left'] as const) if (constraint[field] !== undefined && !finiteNonNegative(constraint[field])) add(`${field} must be finite and non-negative.`, `${path}/${field}`)
  if (value.kind === 'grid' && (!Number.isInteger(value.columns) || Number(value.columns) < 1)) add('Grid columns must be a positive integer.', `${path}/columns`)
  if (value.kind === 'align' && (!['x', 'y'].includes(String(value.axis)) || !['start', 'center', 'end'].includes(String(value.mode)))) add('Align axis or mode is invalid.', path)
  if (['stack', 'gap'].includes(value.kind) && !['horizontal', 'vertical'].includes(String(value.axis))) add('Stack/gap axis is invalid.', `${path}/axis`)
}

function validateRects(value: unknown, path: string, add: (message: string, path?: string) => void) {
  if (value === undefined) return
  if (!Array.isArray(value) || value.length > MAX_ARRAY) { add(`Rect list must contain at most ${MAX_ARRAY} items.`, path); return }
  value.forEach((item, index) => { if (!validRect(item)) add('Rect must contain finite x/y and positive width/height.', `${path}/${index}`) })
}

function validateStringArray(value: unknown, path: string, add: (message: string, path?: string) => void, minimum = 0) {
  if (value === undefined) return
  if (!Array.isArray(value) || value.length < minimum || value.length > MAX_ARRAY || value.some((item) => typeof item !== 'string' || !item || item.length > MAX_STRING)) { add(`Value must be an array of ${minimum > 0 ? `at least ${minimum} and ` : ''}at most ${MAX_ARRAY} non-empty strings.`, path); return }
  if (new Set(value).size !== value.length) add('Array values must be unique.', path)
}

function requireString(object: Record<string, unknown>, field: string, add: (message: string, path?: string) => void, expected?: string, prefix = '') {
  const path = `${prefix}/${field}` || `/${field}`
  if (typeof object[field] !== 'string' || !object[field] || String(object[field]).length > MAX_STRING) add(`${field} must be a non-empty bounded string.`, path)
  else if (expected !== undefined && object[field] !== expected) add(`${field} must be ${expected}.`, path)
}

function checkKnown(object: Record<string, unknown>, known: string[], add: (message: string, path?: string) => void, prefix = '') {
  const allowed = new Set(known)
  for (const key of Object.keys(object)) if (!allowed.has(key)) add(`Unknown field ${key}.`, `${prefix}/${escapePointer(key)}` || '/')
}

function record(value: unknown, add: (message: string, path?: string) => void, label: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) { add(`${label} must be an object.`); return undefined }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function finitePositive(value: unknown): value is number { return finite(value) && value > 0 }
function finiteNonNegative(value: unknown): value is number { return finite(value) && value >= 0 }
function validRect(value: unknown): boolean { return isRecord(value) && finite(value.x) && finite(value.y) && finitePositive(value.width) && finitePositive(value.height) }
function arrayOfStrings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] }
function escapePointer(value: string): string { return value.replaceAll('~', '~0').replaceAll('/', '~1') }

function isJsonValue(value: unknown, depth: number): boolean {
  if (depth > 8) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return typeof value !== 'string' || (value.length <= MAX_STRING && !value.includes('\u0000'))
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.length <= MAX_ARRAY && value.every((item) => isJsonValue(item, depth + 1))
  if (isRecord(value)) return Object.keys(value).length <= MAX_ARRAY && Object.entries(value).every(([key, item]) => key.length <= MAX_STRING && !key.includes('\u0000') && isJsonValue(item, depth + 1))
  return false
}

export function isSlideIR(value: unknown): value is SlideIR { return validateSlideIR(value).every((issue) => issue.severity !== 'error') }
export function isPresentationIR(value: unknown): value is PresentationIR { return validatePresentationIR(value).every((issue) => issue.severity !== 'error') }
export function isRecipeSpec(value: unknown): value is RecipeSpec { return validateRecipeSpec(value).every((issue) => issue.severity !== 'error') }
