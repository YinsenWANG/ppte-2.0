import { canonicalHash, canonicalJsonString, cloneJson } from '../../canonical-json/src/index.js'
import { validateCompiledSlideDraft, validatePresentationIR, validateSlideIR } from '../../schema/src/index.js'
import { RecipeRegistry, matchBlocksToSlots, resolveRecipeZones, selectRecipe } from '../../layout-recipes/src/index.js'
import type {
  Asset,
  CanvasSpec,
  CompiledSlideDraft,
  Element,
  ElementDraft,
  Frame,
  PpteDocument,
  PresentationDraft,
  PresentationIR,
  RecipeSpec,
  RichTextDocument,
  SemanticRefs,
  Slide,
  SlideIR,
  SlidePurpose,
  ThemeDefinition,
  Transaction,
  ValidationIssue,
  VisualStrategy,
} from '../../schema/src/index.js'

const SLIDE_PURPOSES = ['cover', 'section', 'statement', 'explanation', 'comparison', 'metrics', 'chart', 'timeline', 'process', 'quote', 'summary', 'closing', 'custom'] as const
const VISUAL_STRATEGIES = ['structured', 'hybrid', 'poster'] as const

export const DEFAULT_COMPILER_VERSION = 'design-compiler-1.0.0'
export const DEFAULT_FONT_METRICS_FINGERPRINT = 'reference-font-metrics-1'

export interface AssetResolution {
  assetId: string
  altText?: string
  metadata?: Asset['artwork']
}

export interface CompileContext {
  canvas: Pick<CanvasSpec, 'width' | 'height'>
  theme?: ThemeDefinition
  recipes?: RecipeRegistry
  recipeId?: string
  recipeVersion?: string
  seed?: string
  compilerVersion?: string
  fontMetricsFingerprint?: string
  historyAcceptance?: Record<string, number>
  resolveAsset?: (block: SlideIR['blocks'][number]) => AssetResolution | string | undefined
  resolveArtwork?: (intent: NonNullable<SlideIR['artworkIntent']>) => AssetResolution | string | undefined
}

export interface CompilePresentationContext extends CompileContext {
  document?: PpteDocument
}

export interface DraftTransactionOptions {
  transactionId: string
  baseRevision: string
  actor?: Transaction['actor']
  createdAt?: string
  reason?: string
  index?: number
}

export interface RegenerateTransactionOptions extends DraftTransactionOptions {
  protectedSemanticKeys?: string[]
  protectedElementIds?: string[]
  requireConfirmation?: boolean
}

export interface ReflowTransactionOptions extends DraftTransactionOptions {
  slideId: string
  requireConfirmation?: boolean
}

export interface ArtworkSafetyResult {
  ok: boolean
  issues: ValidationIssue[]
}

/** Deterministic IR compiler. It only returns drafts and transactions. */
export class DesignCompiler {
  compileSlide(ir: SlideIR, context: CompileContext): CompiledSlideDraft {
    const rawIr = ir as unknown
    const irIssues = validateSlideIR(rawIr)
    const compilerVersion = context.compilerVersion ?? DEFAULT_COMPILER_VERSION
    const fontMetricsFingerprint = context.fontMetricsFingerprint ?? DEFAULT_FONT_METRICS_FINGERPRINT
    const provenanceBase = {
      compilerVersion,
      slideIrDigest: digest(rawIr),
      ...(context.seed === undefined ? {} : { seed: context.seed }),
      fontMetricsFingerprint,
    }
    if (irIssues.some((issue) => issue.severity === 'error')) return emptyDraft(rawIr, provenanceBase, irIssues)

    const registry = context.recipes ?? new RecipeRegistry()
    const selected = context.recipeId ? registry.get(context.recipeId, context.recipeVersion) : selectRecipe(ir, registry, { acceptanceByRecipe: context.historyAcceptance })
    if (!selected) return emptyDraft(ir, provenanceBase, [compilerIssue('RECIPE_MISSING', 'No compatible declarative Recipe was found.', '/layoutIntent')])
    const recipe = 'recipe' in selected ? selected.recipe : selected
    const assignment = matchBlocksToSlots(ir.blocks, recipe)
    const issues: ValidationIssue[] = []
    let drafts: ElementDraft[] = []
    const semanticKeyMap: Record<string, string> = {}
    const controlled = registry.getControlled(recipe.id, recipe.version)
    if (controlled) {
      try {
        const output = controlled.compile(cloneJson({ slideIR: ir, recipe, canvas: context.canvas, ...(context.theme ? { theme: context.theme } : {}) }))
        if (!Array.isArray(output)) issues.push(compilerIssue('CONTROLLED_RECIPE_INVALID', 'A controlled Recipe must return an Element Draft array.', '/elementDrafts'))
        else {
          const controlledDrafts = output as ElementDraft[]
          const controlledValidation = validateCompiledSlideDraft({ slideKey: ir.slideKey, slide: slideDraft(ir), elementDrafts: controlledDrafts, groups: [], readingOrder: controlledDrafts.filter((draft) => draft.role !== 'artwork' && draft.role !== 'background').map((draft) => draft.draftId), semanticKeyMap: {}, validationIssues: [], provenance: provenanceBase })
          if (controlledValidation.some((issue) => issue.severity === 'error')) issues.push(...controlledValidation.map((issue) => ({ ...issue, code: 'CONTROLLED_RECIPE_INVALID' })))
          else {
            drafts = controlledDrafts
            for (const draft of drafts) if (draft.semanticKey) semanticKeyMap[draft.semanticKey] = draft.draftId
          }
        }
      } catch (cause) {
        issues.push(compilerIssue('CONTROLLED_RECIPE_FAILED', cause instanceof Error ? cause.message : String(cause), '/elementDrafts'))
      }
    } else {
      if (assignment.unmatched > 0) issues.push(compilerIssue('RECIPE_SLOT_UNAVAILABLE', `${assignment.unmatched} block(s) could not be assigned to Recipe slots.`, '/blocks'))
      const slotZones = new Map(resolveRecipeZones(recipe, context.canvas).map((zone) => [zone.id, zone]))
      const slotGroups = new Map<string, typeof assignment.assignments>()
      for (const item of assignment.assignments) addToMap(slotGroups, item.slotKey, item)
      for (const item of assignment.assignments) {
        const group = slotGroups.get(item.slotKey) ?? [item]
        const index = group.indexOf(item)
        const slot = recipe.slots.find((candidate) => candidate.key === item.slotKey)
        const zone = slotZones.get(item.slotKey) ?? firstResolvedZone(slotZones)
        const frame = toCanvasFrame(expandZone(zone, group.length, index, ir.layoutIntent?.direction), context.canvas)
        const draft = blockToDraft(ir, item.block, frame, slot?.styleRef, context)
        if (draft) {
          drafts.push(draft)
          if (item.block.semanticKey) semanticKeyMap[item.block.semanticKey] = draft.draftId
          semanticKeyMap[item.block.key] = draft.draftId
        }
      }
    }
    if (ir.visualStrategy === 'hybrid' && ir.artworkIntent && context.resolveArtwork) {
      const artwork = context.resolveArtwork(ir.artworkIntent)
      if (artwork) {
        const resolution = typeof artwork === 'string' ? { assetId: artwork } : artwork
        const artworkDraft: ElementDraft = {
          draftId: draftId(ir.slideKey, 'artwork'),
          kind: 'image',
          role: 'artwork',
          frame: artworkFrame(ir.artworkIntent.placement, context.canvas),
          data: {
            assetId: resolution.assetId,
            fit: 'cover',
            altText: 'Decorative artwork',
            style: { styleRef: defaultStyleForRole('artwork', context) },
            ...(resolution.metadata ? { artworkMetadata: resolution.metadata as unknown as import('../../schema/src/index.js').JsonValue } : {}),
          } as unknown as ElementDraft['data'],
          sourceBlockKey: 'artwork',
        }
        drafts.push(artworkDraft)
      } else issues.push(compilerIssue('ARTWORK_ASSET_UNRESOLVED', 'Artwork intent has no resolved local Asset; the semantic draft remains usable.', '/artworkIntent'))
    }
    const readingOrder = drafts.filter((draft) => draft.role !== 'artwork' && draft.role !== 'background').map((draft) => draft.draftId)
    const draft: CompiledSlideDraft = {
      slideKey: ir.slideKey,
      slide: slideDraft(ir),
      elementDrafts: drafts,
      groups: [],
      readingOrder,
      semanticKeyMap,
      assetIds: drafts.flatMap((item) => { const data = recordData(item.data); return typeof data.assetId === 'string' ? [data.assetId] : [] }),
      validationIssues: issues,
      provenance: { ...provenanceBase, recipeId: recipe.id, recipeVersion: recipe.version },
    }
    draft.validationIssues.push(...validateCompiledSlideDraft(draft))
    draft.validationIssues = uniqueIssues(draft.validationIssues)
    return draft
  }

  compilePresentation(ir: PresentationIR, context: CompilePresentationContext): PresentationDraft {
    const issues = validatePresentationIR(ir as unknown)
    const raw = isRecord(ir as unknown) ? ir as unknown as Record<string, unknown> : {}
    const slides = Array.isArray(raw.slides) ? raw.slides : []
    const slideDrafts = slides.map((slide) => this.compileSlide(slide as SlideIR, context))
    const allIssues = uniqueIssues([...issues, ...slideDrafts.flatMap((draft) => draft.validationIssues)])
    return {
      title: typeof raw.title === 'string' ? raw.title : '',
      slideDrafts,
      validationIssues: allIssues,
      provenance: { compilerVersion: context.compilerVersion ?? DEFAULT_COMPILER_VERSION, ...(context.seed === undefined ? {} : { seed: context.seed }) },
    }
  }
}

export const defaultDesignCompiler = new DesignCompiler()

export function compileSlide(ir: SlideIR, context: CompileContext): CompiledSlideDraft { return defaultDesignCompiler.compileSlide(ir, context) }
export function compilePresentation(ir: PresentationIR, context: CompilePresentationContext): PresentationDraft { return defaultDesignCompiler.compilePresentation(ir, context) }

/** Convert a draft to a semantic Slide without persisting the IR or Recipe. */
export function materializeSlideDraft(draft: CompiledSlideDraft, slideId: string, canvas: Pick<CanvasSpec, 'width' | 'height'>): Slide {
  const elements = Object.fromEntries(draft.elementDrafts.map((item) => [item.draftId, materializeElementDraft(item, draft)]))
  const readingOrder = draft.readingOrder.filter((id) => Boolean(elements[id]))
  return {
    id: slideId,
    name: draft.slideKey,
    rootOrder: draft.elementDrafts.map((item) => item.draftId),
    elements,
    groups: {},
    readingOrder,
    visualStrategy: draft.slide.visualStrategy,
    semantic: { purpose: draft.slide.purpose, keyMessage: draft.slide.message, slideIrDigest: draft.provenance.slideIrDigest, ...(draft.slide.sourceIds ? { sourceIds: cloneJson(draft.slide.sourceIds) } : {}) },
    provenance: { kind: 'generated', recipeId: draft.provenance.recipeId, recipeVersion: draft.provenance.recipeVersion, generationId: draft.provenance.seed },
  }
}

export function buildInitializationTransaction(draft: CompiledSlideDraft, slideId: string, canvas: Pick<CanvasSpec, 'width' | 'height'>, options: DraftTransactionOptions): Transaction {
  const slide = materializeSlideDraft(draft, slideId, canvas)
  return {
    transactionId: options.transactionId,
    baseRevision: options.baseRevision,
    actor: options.actor ?? { type: 'system', id: 'design-compiler' },
    scope: { kind: 'document', permissions: ['structure'], allowInsert: true, allowDelete: false },
    changeContract: {
      allowedOperationKinds: ['slide.insert'],
      maxChangedSlides: 1,
      maxChangedElements: slide.rootOrder.length,
      maxInsertedElements: slide.rootOrder.length,
      maxDeletedElements: 0,
      maxChangedFacts: 0,
      maxChangedSources: 0,
      maxChangedThemeTokens: 0,
      maxChangedStylePresets: 0,
      requireConfirmation: false,
      userIntentSummary: 'Initialize a semantic slide from a validated design draft.',
    },
    reason: options.reason ?? 'Materialize Design Compiler draft',
    createdAt: options.createdAt ?? '2026-09-03T00:00:00.000Z',
    validationLevel: 'L3',
    operations: [{ opId: `${options.transactionId}:slide.insert`, kind: 'slide.insert', slide, index: options.index ?? 0 }],
  }
}

/** Build an explicit geometry-only transaction for “reflow”, without changing content. */
export function buildReflowTransaction(document: PpteDocument, draft: CompiledSlideDraft, options: ReflowTransactionOptions): Transaction {
  const slide = document.slides[options.slideId]
  if (!slide) throw new Error(`SLIDE_MISSING: ${options.slideId}`)
  const operations: Transaction['operations'] = []
  for (const item of draft.elementDrafts) {
    if (!item.semanticKey) continue
    const current = Object.values(slide.elements).find((element) => element.semanticKey === item.semanticKey)
    if (!current) continue
    if (current.frame.x !== item.frame.x || current.frame.y !== item.frame.y) operations.push({ opId: `${options.transactionId}:move:${current.id}`, kind: 'element.move', slideId: options.slideId, elementId: current.id, x: item.frame.x, y: item.frame.y })
    if (current.frame.width !== item.frame.width || current.frame.height !== item.frame.height) operations.push({ opId: `${options.transactionId}:resize:${current.id}`, kind: 'element.resize', slideId: options.slideId, elementId: current.id, frame: cloneJson(item.frame) })
  }
  if (operations.length === 0) operations.push({ opId: `${options.transactionId}:noop`, kind: 'element.move', slideId: options.slideId, elementId: firstElementId(slide), x: slide.elements[firstElementId(slide)].frame.x, y: slide.elements[firstElementId(slide)].frame.y })
  const elementIds = [...new Set(operations.flatMap((operation) => 'elementId' in operation ? [operation.elementId] : []))]
  return {
    transactionId: options.transactionId,
    baseRevision: options.baseRevision,
    actor: options.actor ?? { type: 'agent', id: 'design-compiler' },
    scope: { kind: 'slide', slideIds: [options.slideId], elementIds, permissions: ['geometry'], allowInsert: false, allowDelete: false },
    changeContract: { allowedOperationKinds: ['element.move', 'element.resize'], allowedElementIds: elementIds, maxChangedSlides: 1, maxChangedElements: elementIds.length, maxInsertedElements: 0, maxDeletedElements: 0, maxReplacedAssets: 0, maxChangedFacts: 0, maxChangedSources: 0, maxChangedThemeTokens: 0, maxChangedStylePresets: 0, preserve: { content: 'preserve', data: 'preserve', style: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' }, requireConfirmation: options.requireConfirmation ?? true, userIntentSummary: 'Reflow geometry while preserving semantic content and style.' },
    reason: options.reason ?? 'Apply declarative layout Recipe to existing geometry',
    createdAt: options.createdAt ?? '2026-09-03T00:00:00.000Z',
    validationLevel: 'L3',
    operations,
  }
}

/** Build a replacement transaction; the compiler still never calls Session.commit. */
export function buildRegenerateTransaction(document: PpteDocument, draft: CompiledSlideDraft, slideId: string, options: RegenerateTransactionOptions): Transaction {
  const slide = document.slides[slideId]
  if (!slide) throw new Error(`SLIDE_MISSING: ${slideId}`)
  const protectedKeys = new Set(options.protectedSemanticKeys ?? [])
  const protectedIds = new Set(options.protectedElementIds ?? [])
  const keep = Object.values(slide.elements).filter((element) => protectedIds.has(element.id) || (element.semanticKey !== undefined && protectedKeys.has(element.semanticKey)))
  const keepKeys = new Set(keep.map((element) => element.semanticKey).filter((key): key is string => Boolean(key)))
  const replacements = new Map<string, Element>()
  for (const element of Object.values(slide.elements)) if (element.semanticKey) replacements.set(element.semanticKey, element)
  const materialized = draft.elementDrafts.filter((item) => !(item.semanticKey && keepKeys.has(item.semanticKey))).map((item) => {
    const element = materializeElementDraft(item, draft)
    const prior = item.semanticKey ? replacements.get(item.semanticKey) : undefined
    if (!prior || keep.includes(prior)) return element
    element.provenance = { ...element.provenance, replacesElementId: prior.id, sourceSemanticKey: prior.semanticKey, kind: 'generated' }
    return element
  })
  const removed = Object.values(slide.elements).filter((element) => !keep.includes(element))
  const operations: Transaction['operations'] = []
  for (const element of removed) operations.push({ opId: `${options.transactionId}:delete:${element.id}`, kind: 'element.delete', slideId, elementId: element.id })
  for (const element of materialized) operations.push({ opId: `${options.transactionId}:insert:${element.id}`, kind: 'element.insert', slideId, element, index: slide.rootOrder.length })
  const nextReadingOrder = [...keep.filter((element) => slide.readingOrder?.includes(element.id) ?? true), ...materialized.filter((element) => element.role !== 'artwork' && element.role !== 'background')].map((element) => element.id)
  if (nextReadingOrder.length > 0) operations.push({ opId: `${options.transactionId}:reading-order`, kind: 'slide.setReadingOrder', slideId, readingOrder: nextReadingOrder })
  if (operations.length === 0) throw new Error('REGENERATE_EMPTY: no replacement or protected content was produced.')
  const elementIds = [...new Set([...removed.map((element) => element.id), ...materialized.map((element) => element.id)])]
  return {
    transactionId: options.transactionId,
    baseRevision: options.baseRevision,
    actor: options.actor ?? { type: 'agent', id: 'design-compiler' },
    scope: { kind: 'slide', slideIds: [slideId], elementIds, semanticKeys: [...new Set(elementIds.map((id) => slide.elements[id]?.semanticKey ?? materialized.find((element) => element.id === id)?.semanticKey).filter((key): key is string => Boolean(key)))], permissions: ['structure'], allowInsert: true, allowDelete: true },
    changeContract: { allowedOperationKinds: ['element.delete', 'element.insert', 'slide.setReadingOrder'], maxChangedSlides: 1, maxChangedElements: Math.max(1, elementIds.length), maxInsertedElements: materialized.length, maxDeletedElements: removed.length, maxReplacedAssets: 0, maxChangedFacts: 0, maxChangedSources: 0, maxChangedThemeTokens: 0, maxChangedStylePresets: 0, requireConfirmation: options.requireConfirmation ?? true, userIntentSummary: 'Regenerate a slide through semantic drafts while retaining protected anchors.' },
    reason: options.reason ?? 'Regenerate slide from Design Compiler draft',
    createdAt: options.createdAt ?? '2026-09-03T00:00:00.000Z',
    validationLevel: 'L3',
    operations,
  }
}

export function validateArtworkPlacement(document: PpteDocument, slideId: string): ArtworkSafetyResult {
  const slide = document.slides[slideId]
  if (!slide || slide.visualStrategy !== 'hybrid') return { ok: true, issues: [] }
  const issues: ValidationIssue[] = []
  const artwork = Object.values(slide.elements).filter((element) => element.type === 'image' && element.role === 'artwork')
  const protectedElements = Object.values(slide.elements).filter((element) => element.role !== 'artwork' && element.role !== 'background' && element.role !== 'decorative')
  for (const element of artwork) {
    const asset = element.type === 'image' ? document.assets[element.assetId] : undefined
    const metadata = asset?.artwork
    if (!metadata) { issues.push(compilerIssue('ARTWORK_METADATA_MISSING', `Artwork ${element.id} has no safety metadata.`, `/slides/${slideId}/elements/${element.id}`)); continue }
    if (!metadata.safeTextRegions?.length) issues.push(compilerIssue('ARTWORK_SAFE_REGIONS_MISSING', `Artwork ${element.id} must declare at least one safe text region.`, `/slides/${slideId}/elements/${element.id}`))
    if (!metadata.focalPoint) issues.push(compilerIssue('ARTWORK_FOCAL_POINT_MISSING', `Artwork ${element.id} must declare a focal point.`, `/slides/${slideId}/elements/${element.id}`))
    if (!metadata.dominantPalette?.length) issues.push(compilerIssue('ARTWORK_PALETTE_MISSING', `Artwork ${element.id} must declare a dominant palette.`, `/slides/${slideId}/elements/${element.id}`))
    for (const region of metadata.avoidTextRegions ?? []) for (const protectedElement of protectedElements) if (intersects(protectedElement.frame, scaleRegion(region, element.frame))) issues.push({ ...compilerIssue('ARTWORK_TEXT_OBSCURED', `Artwork avoidance region intersects semantic element ${protectedElement.id}.`, `/slides/${slideId}/elements/${element.id}`), elementId: protectedElement.id, semanticKey: protectedElement.semanticKey })
    if (metadata.safeTextRegions?.length) for (const protectedElement of protectedElements) if (intersects(protectedElement.frame, element.frame) && !metadata.safeTextRegions.some((region) => intersects(protectedElement.frame, scaleRegion(region, element.frame)))) issues.push({ ...compilerIssue('ARTWORK_SAFE_REGION_MISSING', `No declared safe artwork region contains semantic element ${protectedElement.id}.`, `/slides/${slideId}/elements/${element.id}`), elementId: protectedElement.id, semanticKey: protectedElement.semanticKey })
  }
  return { ok: !issues.some((issue) => issue.severity === 'error'), issues }
}

function blockToDraft(ir: SlideIR, block: SlideIR['blocks'][number], frame: Frame, slotStyleRef: string | undefined, context: CompileContext): ElementDraft | undefined {
  const id = draftId(ir.slideKey, block.key)
  const semanticKey = block.semanticKey ?? `block.${block.key}`
  const role = roleForBlock(block.kind)
  const styleRef = slotStyleRef ?? defaultStyleForRole(role, context)
  const semanticRefs = blockSemanticRefs(block)
  if (block.kind === 'image') {
    const resolved = context.resolveAsset?.(block)
    const assetId = typeof resolved === 'string' ? resolved : resolved?.assetId ?? contentAssetId(block.content)
    if (!assetId) return { draftId: id, kind: 'image', semanticKey, role: role ?? 'image', frame, data: jsonData({ assetId: null, fit: 'cover', style: { styleRef }, ...(semanticRefs ? { semanticRefs } : {}) }), sourceBlockKey: block.key }
    return { draftId: id, kind: 'image', semanticKey, role: role ?? 'image', frame, data: jsonData({ assetId, fit: 'cover', altText: resolved && typeof resolved !== 'string' ? resolved.altText ?? '' : '', style: { styleRef }, ...(semanticRefs ? { semanticRefs } : {}) }), sourceBlockKey: block.key }
  }
  if (block.kind === 'chart') return { draftId: id, kind: 'chart', semanticKey, role: 'chart', frame, data: isRecord(block.content) ? { ...cloneJson(block.content), style: { styleRef }, ...(semanticRefs ? { semanticRefs } : {}) } as ElementDraft['data'] : jsonData({ chartType: 'bar', data: { columns: [], rows: [] }, encoding: { categoryField: '', valueFields: [] }, style: { styleRef }, ...(semanticRefs ? { semanticRefs } : {}) }), sourceBlockKey: block.key }
  const textValue = blockText(block)
  return { draftId: id, kind: 'text', semanticKey, role, frame, data: jsonData({ content: richText(textValue, id), style: { styleRef }, overflowPolicy: 'warn', ...(semanticRefs ? { semanticRefs } : {}) }), sourceBlockKey: block.key }
}

function materializeElementDraft(draft: ElementDraft, compiled: CompiledSlideDraft): Element {
  const data: Record<string, any> = isRecord(draft.data) ? draft.data : {}
  const base = { id: draft.draftId, type: draft.kind, semanticKey: draft.semanticKey, role: draft.role, frame: cloneJson(draft.frame), ...(dataSemanticRefs(data) ? { semanticRefs: dataSemanticRefs(data) } : {}), provenance: { kind: 'generated' as const, recipeId: compiled.provenance.recipeId, recipeVersion: compiled.provenance.recipeVersion } }
  if (draft.kind === 'text') return { ...base, type: 'text', content: isRichText(data.content) ? cloneJson(data.content) : richText('', draft.draftId), style: { styleRef: styleRef(data, 'text.body') }, overflowPolicy: data.overflowPolicy === 'clip' || data.overflowPolicy === 'ellipsis' ? data.overflowPolicy : 'warn' }
  if (draft.kind === 'image') {
    const assetId = typeof data.assetId === 'string' ? data.assetId : ''
    if (!assetId) throw new Error(`ASSET_MISSING: draft ${draft.draftId} has no resolved asset.`)
    return { ...base, type: 'image', assetId, fit: data.fit === 'contain' || data.fit === 'fill' ? data.fit : 'cover', altText: typeof data.altText === 'string' ? data.altText : '', style: { styleRef: styleRef(data, 'image.hero') } }
  }
  if (draft.kind === 'shape') return { ...base, type: 'shape', shape: shapeKind(data.shape), style: { styleRef: styleRef(data, 'shape.card') } }
  if (draft.kind === 'chart') return { ...base, type: 'chart', chartType: chartType(data.chartType), data: chartData(data.data), encoding: chartEncoding(data.encoding), style: { styleRef: styleRef(data, 'chart.default') } }
  return { ...base, type: 'component', componentType: typeof data.componentType === 'string' ? data.componentType : 'core/placeholder', componentVersion: typeof data.componentVersion === 'string' ? data.componentVersion : '1.0.0', props: isRecord(data.props) ? cloneJson(data.props) as Record<string, import('../../schema/src/index.js').JsonValue> : {}, fallback: { kind: 'placeholder', label: typeof data.label === 'string' ? data.label : draft.draftId } }
}

function emptyDraft(ir: unknown, provenance: CompiledSlideDraft['provenance'], issues: ValidationIssue[]): CompiledSlideDraft {
  const raw = isRecord(ir) ? ir : {}
  const rawPurpose = String(raw.purpose)
  const rawStrategy = String(raw.visualStrategy)
  const purpose = SLIDE_PURPOSES.some((item) => item === rawPurpose) ? rawPurpose as SlidePurpose : 'custom'
  const visualStrategy = VISUAL_STRATEGIES.some((item) => item === rawStrategy) ? rawStrategy as VisualStrategy : 'structured'
  const slideKey = typeof raw.slideKey === 'string' ? raw.slideKey : 'invalid'
  return { slideKey, slide: { slideKey, purpose, message: typeof raw.message === 'string' ? raw.message : '', visualStrategy, ...(Array.isArray(raw.sourceIds) ? { sourceIds: raw.sourceIds.filter((item): item is string => typeof item === 'string') } : {}) }, elementDrafts: [], groups: [], readingOrder: [], semanticKeyMap: {}, validationIssues: issues, provenance }
}

function addToMap<T>(map: Map<string, T[]>, key: string, value: T) { const values = map.get(key) ?? []; values.push(value); map.set(key, values) }
function firstResolvedZone(zones: Map<string, RecipeSpec['zones'][number]>): RecipeSpec['zones'][number] { return zones.values().next().value ?? { id: 'fallback', x: 0.08, y: 0.08, width: 0.84, height: 0.84 } }
function expandZone(zone: RecipeSpec['zones'][number], count: number, index: number, direction?: 'horizontal' | 'vertical'): Frame { const columns = direction === 'vertical' ? 1 : Math.min(3, Math.max(1, count)); const rows = Math.ceil(count / columns); const gap = 0.03; const width = (zone.width - gap * (columns - 1)) / columns; const height = (zone.height - gap * (rows - 1)) / rows; return { x: zone.x + (index % columns) * (width + gap), y: zone.y + Math.floor(index / columns) * (height + gap), width, height } }
function toCanvasFrame(frame: Frame, canvas: Pick<CanvasSpec, 'width' | 'height'>): Frame { const normalized = [frame.x, frame.y, frame.width, frame.height].every((value) => value >= 0 && value <= 1); return normalized ? { x: frame.x * canvas.width, y: frame.y * canvas.height, width: frame.width * canvas.width, height: frame.height * canvas.height } : frame }
function artworkFrame(placement: NonNullable<SlideIR['artworkIntent']>['placement'], canvas: Pick<CanvasSpec, 'width' | 'height'>): Frame { if (placement === 'side') return { x: canvas.width * 0.56, y: canvas.height * 0.04, width: canvas.width * 0.40, height: canvas.height * 0.92 }; if (placement === 'center') return { x: canvas.width * 0.20, y: canvas.height * 0.16, width: canvas.width * 0.60, height: canvas.height * 0.68 }; return { x: 0, y: 0, width: canvas.width, height: canvas.height } }
function roleForBlock(kind: SlideIR['blocks'][number]['kind']): Element['role'] { if (kind === 'heading') return 'title'; if (kind === 'source') return 'source'; if (kind === 'metric') return 'metric'; if (kind === 'image') return 'image'; if (kind === 'chart') return 'chart'; if (kind === 'cta') return 'cta'; return 'body' }
function defaultStyleForRole(role: Element['role'], context: CompileContext): string {
  const preferred = role === 'title' ? 'text.title.primary' : role === 'metric' ? 'text.metric.value' : role === 'source' ? 'text.source' : role === 'cta' ? 'text.cta' : role === 'image' || role === 'artwork' ? 'image.hero' : role === 'chart' ? 'chart.default' : role === 'decorative' || role === 'background' ? 'shape.card' : 'text.body'
  const category = role === 'image' || role === 'artwork' ? 'image' : role === 'chart' ? 'chart' : role === 'decorative' || role === 'background' ? 'shape' : 'text'
  const bucket = context.theme?.presets?.[category]
  return bucket && Object.keys(bucket).length > 0 ? (bucket[preferred] ? preferred : Object.keys(bucket).sort()[0]) : preferred
}
function blockText(block: SlideIR['blocks'][number]): string {
  const content = block.content
  if (typeof content === 'string' || typeof content === 'number' || typeof content === 'boolean') return String(content)
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const record = content as Record<string, unknown>
    const label = typeof record.label === 'string' ? record.label : ''
    const value = record.value === undefined ? '' : String(record.value)
    const unit = typeof record.unit === 'string' ? record.unit : ''
    if (label || value || unit) return [label, value ? `${value}${unit}` : ''].filter(Boolean).join(' ')
    return canonicalJsonString(content)
  }
  return block.kind === 'heading' ? block.key : ''
}
function contentAssetId(content: unknown): string | undefined { return isRecord(content) && typeof content.assetId === 'string' ? content.assetId : undefined }
function richText(value: string, id: string): RichTextDocument { return { paragraphs: [{ id: `${id}:paragraph`, runs: [{ id: `${id}:run`, text: value }] }] } }
function digest(value: unknown): string { try { return `sha256-${canonicalHash(value)}` } catch { return 'sha256-invalid-ir' } }
function jsonData(value: unknown): ElementDraft['data'] { return value as ElementDraft['data'] }
function draftId(slideKey: string, blockKey: string): string { return `draft:${safeId(slideKey)}:${safeId(blockKey)}` }
function safeId(value: string): string { return value.replace(/[^A-Za-z0-9_-]/g, '_') }
function compilerIssue(code: string, message: string, path: string): ValidationIssue { return { code, severity: 'error', message, path, recovery: 'Adjust the IR or provide the missing local asset and preview again.' } }
function uniqueIssues(issues: ValidationIssue[]): ValidationIssue[] { const seen = new Set<string>(); return issues.filter((issue) => { const key = `${issue.code}|${issue.path ?? ''}|${issue.message}`; if (seen.has(key)) return false; seen.add(key); return true }) }
function isRecord(value: unknown): value is Record<string, any> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function recordData(value: ElementDraft['data']): Record<string, any> { return isRecord(value) ? value : {} }
function isRichText(value: unknown): value is RichTextDocument { return isRecord(value) && Array.isArray(value.paragraphs) }
function styleRef(data: Record<string, any>, fallback: string): string { return isRecord(data.style) && typeof data.style.styleRef === 'string' && data.style.styleRef ? data.style.styleRef : fallback }
function shapeKind(value: unknown): 'rectangle' | 'rounded-rectangle' | 'ellipse' | 'line' | 'arrow' | 'triangle' | 'diamond' | 'chevron' | 'polygon' { return ['rectangle', 'rounded-rectangle', 'ellipse', 'line', 'arrow', 'triangle', 'diamond', 'chevron', 'polygon'].includes(String(value)) ? value as ReturnType<typeof shapeKind> : 'rounded-rectangle' }
function chartType(value: unknown): 'bar' | 'line' | 'area' | 'pie' | 'donut' { return ['bar', 'line', 'area', 'pie', 'donut'].includes(String(value)) ? value as ReturnType<typeof chartType> : 'bar' }
function chartData(value: unknown): import('../../schema/src/index.js').ChartData { return isRecord(value) && Array.isArray(value.columns) && Array.isArray(value.rows) ? cloneJson(value) as import('../../schema/src/index.js').ChartData : { columns: [], rows: [] } }
function chartEncoding(value: unknown): import('../../schema/src/index.js').ChartEncoding { return isRecord(value) && typeof value.categoryField === 'string' && Array.isArray(value.valueFields) ? cloneJson(value) as import('../../schema/src/index.js').ChartEncoding : { categoryField: '', valueFields: [] } }
function firstElementId(slide: Slide): string { const id = slide.rootOrder[0] ?? Object.keys(slide.elements)[0]; if (!id) throw new Error(`SLIDE_EMPTY: ${slide.id}`); return id }
function slideDraft(ir: SlideIR): CompiledSlideDraft['slide'] { return { slideKey: ir.slideKey, purpose: ir.purpose, message: ir.message, visualStrategy: ir.visualStrategy, ...(ir.sourceIds ? { sourceIds: cloneJson(ir.sourceIds) } : {}) } }
function blockSemanticRefs(block: SlideIR['blocks'][number]): SemanticRefs | undefined { const factIds = block.factIds?.length ? [...new Set(block.factIds)] : undefined; const sourceIds = block.sourceIds?.length ? [...new Set(block.sourceIds)] : undefined; return factIds || sourceIds ? { ...(factIds ? { factIds } : {}), ...(sourceIds ? { sourceIds } : {}) } : undefined }
function dataSemanticRefs(data: Record<string, any>): SemanticRefs | undefined { const refs = isRecord(data.semanticRefs) ? data.semanticRefs : undefined; if (!refs) return undefined; const factIds = Array.isArray(refs.factIds) ? refs.factIds.filter((item): item is string => typeof item === 'string') : []; const sourceIds = Array.isArray(refs.sourceIds) ? refs.sourceIds.filter((item): item is string => typeof item === 'string') : []; return factIds.length || sourceIds.length ? { ...(factIds.length ? { factIds } : {}), ...(sourceIds.length ? { sourceIds } : {}) } : undefined }
function intersects(left: Frame, right: Frame): boolean { return left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y }
function scaleRegion(region: Frame, frame: Frame): Frame { return region.x <= 1 && region.y <= 1 && region.width <= 1 && region.height <= 1 ? { x: frame.x + region.x * frame.width, y: frame.y + region.y * frame.height, width: region.width * frame.width, height: region.height * frame.height } : region }
