import { validateRecipeSpec } from '../../schema/src/index.js'
import type { BlockIR, CanvasSpec, LayoutConstraint, LayoutZone, RecipeSpec, SlideIR, SlidePurpose } from '../../schema/src/index.js'

export interface RecipeCandidate {
  recipe: RecipeSpec
  score: number
  reasons: string[]
}

export interface RecipeAcceptanceHistory {
  /** Optional stable acceptance signal keyed by recipe id@version. */
  acceptanceByRecipe?: Record<string, number>
}

export interface ControlledRecipe {
  spec: RecipeSpec
  trusted: true
  compile: (input: unknown) => unknown
}

/** Registry entries are data-first. Executable handlers are never serialized. */
export class RecipeRegistry {
  private readonly declarative = new Map<string, RecipeSpec>()
  private readonly controlled = new Map<string, ControlledRecipe>()

  constructor(specs: RecipeSpec[] = builtInRecipeSpecs()) {
    for (const spec of specs) this.register(spec)
  }

  register(spec: RecipeSpec): void {
    const issues = validateRecipeSpec(spec)
    if (issues.some((issue) => issue.severity === 'error')) throw new Error(issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n'))
    const key = recipeKey(spec)
    if (this.declarative.has(key) || this.controlled.has(key)) throw new Error(`RECIPE_ID_CONFLICT: ${key}`)
    this.declarative.set(key, spec)
  }

  registerControlled(recipe: ControlledRecipe): void {
    if (recipe.trusted !== true || typeof recipe.compile !== 'function') throw new Error('CONTROLLED_RECIPE_UNTRUSTED: a trusted compile handler is required.')
    const issues = validateRecipeSpec(recipe.spec)
    if (issues.some((issue) => issue.severity === 'error')) throw new Error(issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n'))
    const key = recipeKey(recipe.spec)
    if (this.declarative.has(key) || this.controlled.has(key)) throw new Error(`RECIPE_ID_CONFLICT: ${key}`)
    this.controlled.set(key, recipe)
  }

  get(id: string, version?: string): RecipeSpec | undefined {
    if (version) return this.declarative.get(`${id}@${version}`) ?? this.controlled.get(`${id}@${version}`)?.spec
    const candidates = this.list().filter((recipe) => recipe.id === id)
    return candidates.sort(compareVersions).at(-1)
  }

  getControlled(id: string, version: string): ControlledRecipe | undefined { return this.controlled.get(`${id}@${version}`) }

  list(): RecipeSpec[] { return [...this.declarative.values(), ...[...this.controlled.values()].map((entry) => entry.spec)].map(cloneSpec) }

  listDeclarative(): RecipeSpec[] { return [...this.declarative.values()].map(cloneSpec) }

  listControlled(): RecipeSpec[] { return [...this.controlled.values()].map((entry) => cloneSpec(entry.spec)) }
}

export function recipeKey(recipe: Pick<RecipeSpec, 'id' | 'version'>): string { return `${recipe.id}@${recipe.version}` }

export function selectRecipe(ir: SlideIR, registry = new RecipeRegistry(), history: RecipeAcceptanceHistory = {}): RecipeCandidate | undefined {
  const candidates = registry.list().map((recipe) => scoreRecipe(ir, recipe, history.acceptanceByRecipe?.[recipeKey(recipe)]))
  return candidates.filter((candidate) => candidate.score > Number.NEGATIVE_INFINITY).sort((left, right) => right.score - left.score || left.recipe.id.localeCompare(right.recipe.id) || left.recipe.version.localeCompare(right.recipe.version))[0]
}

export function scoreRecipe(ir: SlideIR, recipe: RecipeSpec, historicalAcceptance?: number): RecipeCandidate {
  if (ir.purpose !== 'custom' && !recipe.supports.includes(ir.purpose) && !recipe.supports.includes('custom')) return { recipe, score: Number.NEGATIVE_INFINITY, reasons: ['purpose-mismatch'] }
  const reasons: string[] = []
  let score = recipe.supports.includes(ir.purpose) ? 50 : 10
  if (ir.layoutIntent?.preferredRecipeIds?.includes(recipe.id)) { score += 40; reasons.push('preferred-by-layout-intent') }
  if (ir.layoutIntent?.avoidRecipeIds?.includes(recipe.id)) { score -= 80; reasons.push('avoided-by-layout-intent') }
  const capacity = matchBlocksToSlots(ir.blocks, recipe)
  score += capacity.matched * 5
  score -= capacity.unmatched * 12
  if (capacity.unmatched === 0) reasons.push('all-blocks-have-a-slot')
  if (ir.visualStrategy === 'hybrid' && recipe.id.includes('hybrid')) { score += 12; reasons.push('hybrid-strategy') }
  if (ir.visualStrategy !== 'hybrid' && recipe.id.includes('hybrid')) score -= 8
  const preferredWhitespace = ir.layoutIntent?.whitespace
  if (preferredWhitespace === 'generous' && recipe.id.includes('editorial')) { score += 4; reasons.push('whitespace-fit') }
  const textualChars = ir.blocks.filter((block) => ['heading', 'paragraph', 'quote', 'source', 'cta'].includes(block.kind)).reduce((sum, block) => sum + blockTextLength(block.content), 0)
  const maxChars = recipe.slots.filter((slot) => slot.maxChars !== undefined).reduce((sum, slot) => sum + (slot.maxChars ?? 0), 0)
  if (maxChars > 0) { if (textualChars <= maxChars) { score += 3; reasons.push('text-length-fit') } else { score -= 8; reasons.push('text-length-pressure') } }
  const imageBlocks = ir.blocks.filter((block) => block.kind === 'image' && block.preferredAspectRatio !== undefined)
  if (imageBlocks.length > 0 && recipe.slots.some((slot) => slot.preferredAspectRatio !== undefined)) { score += 2; reasons.push('image-ratio-aware') }
  if (ir.visualStrategy === 'hybrid' && ir.artworkIntent?.safeTextRegions?.length && recipe.artworkSafeRegions?.length) { score += 3; reasons.push('artwork-safe-region-fit') }
  if (historicalAcceptance !== undefined && Number.isFinite(historicalAcceptance)) {
    score += Math.max(-10, Math.min(10, historicalAcceptance * 10))
    reasons.push('historical-acceptance')
  }
  return { recipe, score, reasons }
}

export function matchBlocksToSlots(blocks: BlockIR[], recipe: RecipeSpec): { matched: number; unmatched: number; assignments: Array<{ block: BlockIR; slotKey: string }> } {
  const counts = new Map<string, number>()
  const assignments: Array<{ block: BlockIR; slotKey: string }> = []
  let unmatched = 0
  for (const block of blocks) {
    const slot = recipe.slots.find((candidate) => candidate.accepts.includes(block.kind) && (candidate.maxCount === undefined || (counts.get(candidate.key) ?? 0) < candidate.maxCount))
    if (!slot) { unmatched += 1; continue }
    counts.set(slot.key, (counts.get(slot.key) ?? 0) + 1)
    assignments.push({ block, slotKey: slot.key })
  }
  for (const slot of recipe.slots) {
    const minimum = slot.minCount ?? (slot.required ? 1 : 0)
    const actual = counts.get(slot.key) ?? 0
    if (actual < minimum) unmatched += minimum - actual
  }
  return { matched: assignments.length, unmatched, assignments }
}

export function recipeCoverage(registry = new RecipeRegistry()): { declarative: number; controlled: number; ratio: number } {
  const declarative = registry.listDeclarative().length
  const controlled = registry.listControlled().length
  const total = declarative + controlled
  return { declarative, controlled, ratio: total === 0 ? 1 : declarative / total }
}

/** Resolve the declarative constraint vocabulary into deterministic normalized zones. */
export function resolveRecipeZones(recipe: RecipeSpec, canvas?: Pick<CanvasSpec, 'width' | 'height' | 'safeArea'>): LayoutZone[] {
  const zones = recipe.zones.map((zone) => ({ ...zone }))
  const byId = new Map(zones.map((zone) => [zone.id, zone]))
  const selected = (ids: string[] | undefined) => (ids ?? []).map((id) => byId.get(id)).filter((zone): zone is LayoutZone => Boolean(zone))
  const all = (slotId: string) => slotId === '*' ? zones : selected([slotId])
  for (const constraint of recipe.constraints) applyConstraint(constraint, selected, all, byId, zones, canvas)
  return zones.map(clampZone)
}

export function builtInRecipeSpecs(): RecipeSpec[] {
  return [
    recipe('cover.split', ['cover', 'section'], [slot('title', ['heading'], true), slot('subtitle', ['paragraph', 'quote'], false), slot('artwork', ['image'], false)], [zone('title', 0.08, 0.14, 0.48, 0.24), zone('subtitle', 0.08, 0.42, 0.44, 0.18), zone('artwork', 0.58, 0.08, 0.34, 0.84)], ['safe-area']),
    recipe('statement.focus', ['statement', 'summary'], [slot('title', ['heading'], true), slot('body', ['paragraph', 'quote', 'source'], false), slot('support', ['image', 'metric'], false)], [zone('title', 0.08, 0.12, 0.84, 0.18), zone('body', 0.12, 0.38, 0.76, 0.28), zone('support', 0.26, 0.72, 0.48, 0.16)], ['safe-area']),
    recipe('explanation.text-visual', ['explanation'], [slot('title', ['heading'], true), slot('body', ['paragraph', 'source'], false, 1, 2), slot('visual', ['image', 'comparison', 'process', 'timeline'], false)], [zone('title', 0.08, 0.08, 0.84, 0.14), zone('body', 0.08, 0.28, 0.42, 0.56), zone('visual', 0.56, 0.24, 0.36, 0.62)], ['safe-area']),
    recipe('metrics.kpi-row', ['metrics'], [slot('title', ['heading'], true), slot('metrics', ['metric'], true, 1, 6)], [zone('title', 0.08, 0.08, 0.84, 0.14), zone('metrics', 0.08, 0.30, 0.84, 0.48)], ['safe-area', 'grid']),
    recipe('comparison.two-column', ['comparison'], [slot('title', ['heading'], true), slot('left', ['comparison', 'paragraph', 'metric'], false), slot('right', ['comparison', 'paragraph', 'metric'], false)], [zone('title', 0.08, 0.08, 0.84, 0.14), zone('left', 0.08, 0.30, 0.38, 0.56), zone('right', 0.54, 0.30, 0.38, 0.56)], ['safe-area', 'gap']),
    recipe('timeline.horizontal', ['timeline'], [slot('title', ['heading'], true), slot('timeline', ['timeline', 'process'], true)], [zone('title', 0.08, 0.08, 0.84, 0.14), zone('timeline', 0.08, 0.34, 0.84, 0.42)], ['safe-area', 'baseline']),
    recipe('process.steps', ['process'], [slot('title', ['heading'], true), slot('steps', ['process', 'paragraph'], true, 1, 6)], [zone('title', 0.08, 0.08, 0.84, 0.14), zone('steps', 0.08, 0.32, 0.84, 0.48)], ['safe-area', 'grid']),
    recipe('quote.focus', ['quote'], [slot('quote', ['quote'], true), slot('source', ['source', 'paragraph'], false)], [zone('quote', 0.14, 0.20, 0.72, 0.38), zone('source', 0.24, 0.66, 0.52, 0.12)], ['safe-area']),
    recipe('closing.cta', ['closing'], [slot('title', ['heading'], true), slot('body', ['paragraph', 'source'], false), slot('cta', ['cta'], true)], [zone('title', 0.10, 0.16, 0.80, 0.16), zone('body', 0.18, 0.38, 0.64, 0.18), zone('cta', 0.32, 0.68, 0.36, 0.14)], ['safe-area']),
    // GA-B/GA-C hybrid pages may mix narrative text, metrics, charts, and
    // visual blocks in one slide. Keep one deterministic content slot so the
    // declarative matcher does not reject a valid mixed semantic page merely
    // because its data-bearing object is not the first block.
    recipe('hybrid.editorial', ['cover', 'section', 'statement', 'explanation', 'summary', 'closing', 'comparison', 'metrics', 'chart', 'timeline', 'process'], [slot('title', ['heading'], true), slot('content', ['paragraph', 'metric', 'source', 'cta', 'quote', 'chart', 'comparison', 'process', 'timeline'], false), slot('artwork', ['image'], false)], [zone('title', 0.08, 0.10, 0.54, 0.18), zone('content', 0.08, 0.34, 0.50, 0.48), zone('artwork', 0.58, 0.04, 0.38, 0.92)], ['safe-area', 'avoid-region']),
    recipe('summary.grid', ['summary', 'metrics'], [slot('title', ['heading'], true), slot('cards', ['metric', 'paragraph', 'image'], true, 1, 6)], [zone('title', 0.08, 0.08, 0.84, 0.14), zone('cards', 0.08, 0.30, 0.84, 0.54)], ['safe-area', 'grid']),
    recipe('chart.focus', ['chart'], [slot('title', ['heading'], true), slot('chart', ['chart', 'image'], true), slot('source', ['source'], false)], [zone('title', 0.08, 0.08, 0.84, 0.14), zone('chart', 0.12, 0.28, 0.76, 0.54), zone('source', 0.12, 0.86, 0.76, 0.06)], ['safe-area']),
  ]
}

function recipe(id: string, supports: SlidePurpose[], slots: RecipeSpec['slots'], zones: RecipeSpec['zones'], constraintKinds: string[]): RecipeSpec {
  return {
    id,
    version: '1.0.0',
    supports,
    slots,
    zones,
    constraints: constraintKinds.flatMap((kind): RecipeSpec['constraints'] => {
      if (kind === 'safe-area') return [{ kind: 'safe-area', slotId: '*' }]
      if (kind === 'grid') return [{ kind: 'grid', slotIds: slots.filter((item) => item.key !== 'title').map((item) => item.key), columns: 3, gapX: 0.03, gapY: 0.04 }]
      if (kind === 'gap') return [{ kind: 'gap', slotIds: slots.map((item) => item.key), axis: 'horizontal', value: 0.03 }]
      if (kind === 'baseline') return [{ kind: 'baseline', slotIds: slots.map((item) => item.key) }]
      if (kind === 'avoid-region') return [{ kind: 'avoid-region', slotId: slots.find((item) => item.key === 'content')?.key ?? slots[0].key, region: { x: 0.58, y: 0.04, width: 0.38, height: 0.92 } }]
      return []
    }),
    qualityRules: [{ kind: 'max-elements', value: 35 }, { kind: 'max-overflow', value: 0 }],
  }
}

function slot(key: string, accepts: BlockIR['kind'][], required = false, minCount?: number, maxCount?: number) {
  return { key, accepts, required, ...(minCount === undefined ? {} : { minCount }), ...(maxCount === undefined ? {} : { maxCount }) }
}
function zone(id: string, x: number, y: number, width: number, height: number) { return { id, x, y, width, height } }
function cloneSpec(spec: RecipeSpec): RecipeSpec { return structuredClone(spec) }
function compareVersions(left: RecipeSpec, right: RecipeSpec): number { return left.version.localeCompare(right.version) }
function blockTextLength(value: unknown): number { if (typeof value === 'string') return value.length; if (typeof value === 'number' || typeof value === 'boolean') return String(value).length; if (value && typeof value === 'object' && !Array.isArray(value)) return Object.values(value as Record<string, unknown>).reduce<number>((sum, item) => sum + blockTextLength(item), 0); return 0 }

function applyConstraint(constraint: LayoutConstraint, selected: (ids: string[] | undefined) => LayoutZone[], all: (id: string) => LayoutZone[], byId: Map<string, LayoutZone>, zones: LayoutZone[], canvas?: Pick<CanvasSpec, 'width' | 'height' | 'safeArea'>) {
  if (constraint.kind === 'padding') {
    const zone = byId.get(constraint.zoneId)
    if (zone) { zone.x += constraint.left; zone.y += constraint.top; zone.width -= constraint.left + constraint.right; zone.height -= constraint.top + constraint.bottom }
    return
  }
  if (constraint.kind === 'safe-area') {
    const safe = canvas?.safeArea ? { x: canvas.safeArea.left / (canvas.width || 1), y: canvas.safeArea.top / (canvas.height || 1), width: 1 - (canvas.safeArea.left + canvas.safeArea.right) / (canvas.width || 1), height: 1 - (canvas.safeArea.top + canvas.safeArea.bottom) / (canvas.height || 1) } : { x: 0, y: 0, width: 1, height: 1 }
    for (const zone of all(constraint.slotId)) { zone.x = Math.max(zone.x, safe.x); zone.y = Math.max(zone.y, safe.y); zone.width = Math.min(zone.width, safe.width); zone.height = Math.min(zone.height, safe.height); zone.x = Math.min(zone.x, safe.x + safe.width - zone.width); zone.y = Math.min(zone.y, safe.y + safe.height - zone.height) }
    return
  }
  if (constraint.kind === 'min-size' || constraint.kind === 'max-size') {
    const zone = byId.get(constraint.slotId)
    if (zone) { if (constraint.kind === 'min-size') { if (constraint.width !== undefined) zone.width = Math.max(zone.width, constraint.width); if (constraint.height !== undefined) zone.height = Math.max(zone.height, constraint.height) } else { if (constraint.width !== undefined) zone.width = Math.min(zone.width, constraint.width); if (constraint.height !== undefined) zone.height = Math.min(zone.height, constraint.height) } }
    return
  }
  if (constraint.kind === 'aspect-ratio') {
    const zone = byId.get(constraint.slotId)
    if (zone) { const centerX = zone.x + zone.width / 2; const centerY = zone.y + zone.height / 2; const current = zone.width / Math.max(zone.height, Number.EPSILON); if (current > constraint.ratio) zone.width = zone.height * constraint.ratio; else zone.height = zone.width / constraint.ratio; zone.x = centerX - zone.width / 2; zone.y = centerY - zone.height / 2 }
    return
  }
  if (constraint.kind === 'align') {
    const target = selected(constraint.slotIds)
    if (target.length < 2) return
    const value = constraint.axis === 'x' ? alignmentValue(target, constraint.mode, 'x') : alignmentValue(target, constraint.mode, 'y')
    for (const zone of target) if (constraint.axis === 'x') zone.x = value - (constraint.mode === 'end' ? zone.width : constraint.mode === 'center' ? zone.width / 2 : 0); else zone.y = value - (constraint.mode === 'end' ? zone.height : constraint.mode === 'center' ? zone.height / 2 : 0)
    return
  }
  if (constraint.kind === 'stack') {
    const target = selected(constraint.slotIds)
    let cursor = target.length ? (constraint.axis === 'horizontal' ? Math.min(...target.map((zone) => zone.x)) : Math.min(...target.map((zone) => zone.y))) : 0
    for (const zone of target) { if (constraint.axis === 'horizontal') { zone.x = cursor; cursor += zone.width + constraint.gap } else { zone.y = cursor; cursor += zone.height + constraint.gap } }
    return
  }
  if (constraint.kind === 'grid') {
    const target = selected(constraint.slotIds)
    if (target.length === 0) return
    const minX = Math.min(...target.map((zone) => zone.x)); const minY = Math.min(...target.map((zone) => zone.y)); const maxX = Math.max(...target.map((zone) => zone.x + zone.width)); const maxY = Math.max(...target.map((zone) => zone.y + zone.height)); const columns = Math.max(1, constraint.columns); const rows = Math.ceil(target.length / columns); const width = Math.max(0.001, (maxX - minX - constraint.gapX * (columns - 1)) / columns); const height = Math.max(0.001, (maxY - minY - constraint.gapY * (rows - 1)) / rows)
    target.forEach((zone, index) => { const column = index % columns; const row = Math.floor(index / columns); zone.x = minX + column * (width + constraint.gapX); zone.y = minY + row * (height + constraint.gapY); zone.width = width; zone.height = height })
    return
  }
  if (constraint.kind === 'gap') {
    const target = selected(constraint.slotIds).sort((left, right) => (constraint.axis === 'horizontal' ? left.x - right.x : left.y - right.y) || left.id.localeCompare(right.id))
    for (let index = 1; index < target.length; index += 1) { const previous = target[index - 1]; const current = target[index]; const previousEnd = constraint.axis === 'horizontal' ? previous.x + previous.width : previous.y + previous.height; if (constraint.axis === 'horizontal') current.x = Math.max(current.x, previousEnd + constraint.value); else current.y = Math.max(current.y, previousEnd + constraint.value) }
    return
  }
  if (constraint.kind === 'avoid-region') {
    const zone = byId.get(constraint.slotId)
    if (zone && intersectsZone(zone, constraint.region)) { zone.x += constraint.region.width; if (zone.x + zone.width > 1) zone.x = Math.max(0, constraint.region.x - zone.width); if (zone.y + zone.height > 1) zone.y = Math.max(0, constraint.region.y - zone.height) }
  }
  void zones
}

function alignmentValue(zones: LayoutZone[], mode: 'start' | 'center' | 'end', axis: 'x' | 'y'): number {
  if (mode === 'start') return Math.min(...zones.map((zone) => axis === 'x' ? zone.x : zone.y))
  if (mode === 'end') return Math.max(...zones.map((zone) => axis === 'x' ? zone.x + zone.width : zone.y + zone.height))
  return zones.reduce((sum, zone) => sum + (axis === 'x' ? zone.x + zone.width / 2 : zone.y + zone.height / 2), 0) / zones.length
}
function intersectsZone(left: LayoutZone, right: { x: number; y: number; width: number; height: number }): boolean { return left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y }
function clampZone(zone: LayoutZone): LayoutZone { const width = Math.min(1, Math.max(0.001, zone.width)); const height = Math.min(1, Math.max(0.001, zone.height)); return { ...zone, width, height, x: Math.min(1 - width, Math.max(0, zone.x)), y: Math.min(1 - height, Math.max(0, zone.y)) } }
