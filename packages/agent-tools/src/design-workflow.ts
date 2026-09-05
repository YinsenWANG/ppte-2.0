import { canonicalHash } from '../../canonical-json/src/index.js'
import { authoringProject, buildAuthoringTransaction, createEmptyDocument, type AuthoringInput } from '../../authoring/src/index.js'
import { RecipeRegistry, DESIGN_STYLES, designPackManifest, designPackRecipeSpecs, designPackTheme, type DesignStyle } from '../../layout-recipes/src/index.js'
import { planDeckLayout } from '../../design-compiler/src/deck-planning.js'
import { recipeReference, type DesignPlan } from '../../design-system/src/index.js'
import type { PpteDocument } from '../../schema/src/index.js'

function styleId(value: unknown): DesignStyle {
  if (!DESIGN_STYLES.includes(value as DesignStyle)) throw new Error('DESIGN_STYLE_UNKNOWN: choose a style from design list.')
  return value as DesignStyle
}
/** Small summaries only; full recipe bodies are returned exclusively by inspect. */
export function listDesignStyles(query = '', limit = 3) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 3) throw new Error('DESIGN_LIMIT_INVALID: limit must be 1..3.')
  const index = DESIGN_STYLES.map(id => {
    const { version, description, suitableFor, unsuitableFor } = designPackManifest(id)
    return { id, version, description, suitableFor, unsuitableFor }
  })
  return { ok: true, index, candidates: index.filter(s => JSON.stringify(s).toLowerCase().includes(query.toLowerCase())).slice(0, limit) }
}
export function inspectDesignStyle(id: unknown) {
  const style = styleId(id), pack = designPackManifest(style)
  return { ok: true, pack, design: { rationale: pack.description, rules: pack.rules, unsuitableFor: pack.unsuitableFor }, recipes: designPackRecipeSpecs(style) }
}
export interface DesignWorkflowInput {
  input: AuthoringInput
  style: DesignStyle
  usage: 'present' | 'read'
  stage: 'representatives' | 'deck'
  representativeKeys: { cover: string; body: string; data: string }
  seed?: string
}
/** New-project proposal. Existing human-edited decks use the protected layout tools. */
export async function planDesignWorkflow(document: PpteDocument, args: DesignWorkflowInput) {
  if (!args || typeof args !== 'object' || Object.keys(args).some(k => !['input','style','usage','stage','representativeKeys','seed'].includes(k)) || args.seed !== undefined && typeof args.seed !== 'string') throw new Error('DESIGN_ARGUMENT_INVALID: use the design plan JSON schema.')
  const style = styleId(args.style), project = structuredClone(authoringProject(args.input))
  if (!['present', 'read'].includes(args.usage) || !['representatives', 'deck'].includes(args.stage)) throw new Error('DESIGN_ARGUMENT_INVALID: usage and stage are required.')
  const pristine = createEmptyDocument(document.metadata.title)
  const content = (d: PpteDocument) => ({ ...d, documentId: '', metadata: { ...d.metadata, createdAt: '' } })
  if (document.slideOrder.length && canonicalHash(content(document)) !== canonicalHash(content(pristine))) throw new Error('DESIGN_EXISTING_CONTENT: use scoped apply_layout_recipe for existing slides; full authoring does not replace human edits.')
  const keys = args.representativeKeys
  if (!keys || new Set(Object.values(keys)).size !== 3 || !['cover','body','data'].every(k => typeof keys[k as keyof typeof keys] === 'string')) throw new Error('DESIGN_REPRESENTATIVES_INVALID: provide distinct cover/body/data slide keys from the material.')
  const pages = project.presentation?.slides
  const find = (key: string) => pages?.find(s => s.slideKey === key)
  if (find(keys.cover)?.purpose !== 'cover' || !find(keys.body) || !['metrics','chart','comparison','table'].includes(find(keys.data)?.purpose ?? '')) throw new Error('DESIGN_REPRESENTATIVES_INVALID: representative pages must exist and cover must be cover, data must be metrics/chart/comparison/table.')
  const sourceDigest = canonicalHash(project)
  if (args.stage === 'representatives') {
    project.presentation.slides = pages.filter(s => Object.values(keys).includes(s.slideKey))
    project.presentation.narrative = project.presentation.narrative.map(n => ({ ...n, slideKeys: n.slideKeys.filter(k => Object.values(keys).includes(k)) })).filter(n => n.slideKeys.length)
  }
  project.theme ??= designPackTheme(style, document.canvas.height)
  const recipes = new RecipeRegistry(designPackRecipeSpecs(style))
  const context = { canvas: document.canvas, theme: project.theme, recipes, seed: args.seed ?? 'native-skill-1' }
  const planned = await planDeckLayout(project.presentation, context)
  const report = { ...planned.report, sourceDigest, stage: args.stage, representativeKeys: keys, officeStatus: 'unverified', maxRepairRounds: 2 }
  if (planned.report.status !== 'complete') return { ok: false, report }
  project.presentation.slides.forEach((s, i) => { s.layoutIntent = { balance: 'balanced', ...s.layoutIntent, preferredRecipeIds: [planned.slideDrafts[i].provenance.recipeId!] } })
  const plan: DesignPlan = { contractVersion: '1', presentation: project.presentation, styleRef: { id: style, version: designPackManifest(style).version, digest: designPackManifest(style).digest }, usage: args.usage, seed: context.seed, selections: planned.slideDrafts.map(d => ({ slideKey: d.slideKey, recipeRef: recipeReference(recipes.get(d.provenance.recipeId!, d.provenance.recipeVersion)!), reason: 'bounded-deck-planning; hard constraints pass', contentBudget: d.elementDrafts.length })) }
  const transaction = buildAuthoringTransaction(document, project, context)
  const resources = { assets: project.assetBytes ?? {}, fonts: project.fontBytes ?? {} }
  return { ok: true, plan, report, transaction, resources }
}
