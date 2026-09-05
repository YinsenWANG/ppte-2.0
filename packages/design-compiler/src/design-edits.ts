import { cloneJson, canonicalHash } from '../../canonical-json/src/index.js'
import { recipeReference, resolveParameters, regenerationProtectedIds, type RecipeControl, type DesignBinding } from '../../design-system/src/index.js'
import { RecipeRegistry } from '../../layout-recipes/src/index.js'
import { validateThemeDefinition } from '../../schema/src/index.js'
import type { PpteDocument, RecipeSpec, Transaction, ThemeDefinition, ExtensionEnvelope } from '../../schema/src/index.js'
import { compileSlide, buildReflowTransaction, type ReflowTransactionOptions } from './index.js'
import { inferSlideIR } from './current-document.js'

export const DESIGN_BINDING_NAMESPACE = 'ppte.design-binding'
/** The UI and agent consume this same finite control schema. */
export function recipeControls(recipe: RecipeSpec): RecipeControl[] {
  const grids = recipe.constraints.filter(c => c.kind === 'grid')
  const slots = recipe.slots.filter(s => s.repeat)
  const applicability = [...new Set([...grids.flatMap(c => c.slotIds), ...slots.map(s => s.key)])]
  return applicability.length ? [{ name: 'columns', label: '列数', type: 'integer', default: Math.min(3, grids[0]?.columns ?? slots[0]?.repeat?.columns ?? 3), options: [1, 2, 3], min: 1, max: 3, applicability, affects: 'layout' }] : []
}
export function parameterizeRecipe(recipe: RecipeSpec, input: Record<string, unknown> = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('RECIPE_PARAMETER_INVALID')
  const parameters = resolveParameters(recipeControls(recipe), input)
  const result = cloneJson(recipe)
  if (parameters.columns !== undefined) {
    for (const c of result.constraints) if (c.kind === 'grid') {
      c.columns = Number(parameters.columns)
      for (const slot of result.slots) if (c.slotIds.includes(slot.key) && (slot.maxCount ?? 1) > 1 && !slot.repeat) slot.repeat = { version: '1.0', maxCount: slot.maxCount!, columns: c.columns, gapX: c.gapX, gapY: c.gapY }
    }
    for (const slot of result.slots) if (slot.repeat) slot.repeat.columns = Number(parameters.columns)
  }
  return { recipe: result, parameters }
}
export function bindingExtension(binding: DesignBinding): ExtensionEnvelope {
  const payload = cloneJson(binding) as unknown as ExtensionEnvelope['payload']
  return { namespace: DESIGN_BINDING_NAMESPACE, version: '1', required: false, byteLength: new TextEncoder().encode(JSON.stringify(payload)).length, payload }
}
export function readDesignBinding(document: PpteDocument, slideId: string): DesignBinding | undefined {
  const entries = document.slides[slideId]?.extensions?.filter(e => e.namespace === DESIGN_BINDING_NAMESPACE) ?? []
  if (!entries.length) return undefined
  const e = entries[0], b = e.payload as unknown as DesignBinding
  if (entries.length !== 1 || e.version !== '1' || !b || b.contractVersion !== '1' || !b.recipeRef || typeof b.recipeRef.id !== 'string' || typeof b.recipeRef.version !== 'string' || !/^sha256-[a-f0-9]{64}$/.test(b.recipeRef.digest) || !b.sourceBlockToElement || typeof b.sourceBlockToElement !== 'object' || Array.isArray(b.sourceBlockToElement) || Object.values(b.sourceBlockToElement).some(id => typeof id !== 'string') || new Set(Object.values(b.sourceBlockToElement)).size !== Object.values(b.sourceBlockToElement).length || !b.parameters || !b.manualOverrides) throw new Error('DESIGN_BINDING_INVALID: explicitly rebuild the binding')
  return cloneJson(b)
}
export interface DesignEditOptions extends ReflowTransactionOptions {
  recipe: RecipeSpec
  parameters?: Record<string, unknown>
  /** Explicit identity registration for legacy/unbound slides or invalid metadata. */
  rebuildBinding?: boolean
}
/** Always reads current values. Binding contains identity and provenance, never old content. */
export function planDesignEdit(document: PpteDocument, options: DesignEditOptions) {
  const slide = document.slides[options.slideId]
  if (!slide) throw new Error('SLIDE_MISSING')
  const previous = options.rebuildBinding ? undefined : readDesignBinding(document, options.slideId)
  if (previous && previous.recipeRef.id === options.recipe.id && previous.recipeRef.version === options.recipe.version && previous.recipeRef.digest !== recipeReference(options.recipe).digest) throw new Error('DESIGN_BINDING_RECIPE_CHANGED: explicitly rebuild the binding')
  const { recipe, parameters } = parameterizeRecipe(options.recipe, options.parameters ?? (previous?.recipeRef.id === options.recipe.id ? previous.parameters : {}))
  let ir = inferSlideIR(document, options.slideId)
  // Initial binding registers exact current IDs, never semantic-key guesses. Shapes and
  // other manual decoration remain outside layout ownership; later additions stay out.
  const mapping = previous?.sourceBlockToElement ?? Object.fromEntries(ir.blocks.filter(b => ['text', 'image', 'chart'].includes(slide.elements[b.key]?.type)).map(b => [b.key, b.key]))
  const ids = new Set(Object.values(mapping))
  const missing = [...ids].filter(id => !slide.elements[id])
  if (missing.length) throw new Error('DESIGN_BINDING_STALE: missing objects; explicitly rebuild the binding')
  ir = { ...ir, blocks: ir.blocks.filter(b => ids.has(b.key)) }
  const draft = compileSlide(ir, { canvas: document.canvas, theme: document.theme, recipes: new RecipeRegistry([recipe]), recipeId: recipe.id, recipeVersion: recipe.version })
  if (draft.validationIssues.some(i => i.severity === 'error')) return { draft, issues: draft.validationIssues, proposals: ['Choose a recipe with more capacity', 'Split the slide with explicit insert-slide permission'] }
  const protectedIds = regenerationProtectedIds(slide)
  for (const id of options.protectedElementIds ?? []) protectedIds.add(id)
  const transaction = buildReflowTransaction(document, draft, { ...options, elementIdsByBlock: Object.fromEntries(ir.blocks.map(b => [b.key, b.key])), protectedElementIds: [...protectedIds] })
  const binding: DesignBinding = { contractVersion: '1', recipeRef: recipeReference(options.recipe), sourceBlockToElement: mapping, parameters, protectionDigest: `sha256-${canonicalHash([...protectedIds].sort())}`, manualOverrides: Object.fromEntries([...ids].map(id => [id, [...Object.keys(('style' in slide.elements[id] ? slide.elements[id].style?.overrides : undefined) ?? {}), ...(slide.elements[id].editPolicy?.lockedFields ?? [])]])) }
  const extensions = [...(slide.extensions ?? []).filter(e => e.namespace !== DESIGN_BINDING_NAMESPACE), bindingExtension(binding)]
  if (canonicalHash(extensions) !== canonicalHash(slide.extensions ?? [])) {
    transaction.operations.push({ opId: `${options.transactionId}:binding`, kind: 'slide.update', slideId: slide.id, patch: { extensions } })
    transaction.scope.permissions.push('structure')
    transaction.changeContract!.allowedOperationKinds!.push('slide.update')
  }
  if (!transaction.operations.length) return { draft, binding, issues: [], proposals: ['Layout is already current; no changes needed'] }
  return { draft, transaction, binding, issues: [], proposals: [] }
}
/** Theme changes have a separate, document-wide scope and never clear local overrides. */
export function planDesignTheme(document: PpteDocument, theme: ThemeDefinition, options: Pick<ReflowTransactionOptions, 'transactionId' | 'baseRevision' | 'actor' | 'createdAt' | 'requireConfirmation'>): Transaction {
  if (validateThemeDefinition(theme).some(i => i.severity === 'error')) throw new Error('DESIGN_THEME_INVALID')
  // A global token change could alter protected rendered styles without touching the
  // object. Require a narrower proposal instead of silently changing those objects.
  if (canonicalHash(theme) !== canonicalHash(document.theme) && Object.values(document.slides).some(s => {
    const styleProtected = { ...s, elements: Object.fromEntries(Object.entries(s.elements).map(([id, e]) => [id, { ...e, editPolicy: e.editPolicy ? { ...e.editPolicy, preserveOnRegenerate: false } : undefined }])), protectedAnchors: s.protectedAnchors?.filter(a => a.preserve.includes('style')) }
    return regenerationProtectedIds(styleProtected).size > 0
  })) throw new Error('DESIGN_THEME_PROTECTED: global theme affects protected objects')
  return { transactionId: options.transactionId, baseRevision: options.baseRevision, actor: options.actor ?? { type: 'human', id: 'design-editor' }, createdAt: options.createdAt ?? '2026-09-06T00:00:00.000Z', scope: { kind: 'document', permissions: ['theme'], allowInsert: false, allowDelete: false }, changeContract: { allowedOperationKinds: ['theme.replace'], maxInsertedElements: 0, maxDeletedElements: 0, maxChangedFacts: 0, maxChangedSources: 0, preserve: { content: 'preserve', data: 'preserve', geometry: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' }, requireConfirmation: options.requireConfirmation ?? true, userIntentSummary: 'Apply theme to the entire document; retain all local overrides.' }, operations: [{ opId: `${options.transactionId}:theme`, kind: 'theme.replace', theme: cloneJson(theme) }] }
}
