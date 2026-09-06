import test from 'node:test'
import assert from 'node:assert/strict'
import { cloneJson } from '../packages/canonical-json/src/index.js'
import { styleOnlyContract } from '../packages/change-contract/src/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { AgentToolServer, AGENT_TOOL_NAMES, MockAgent } from '../packages/agent-tools/src/index.js'
import { buildInitializationTransaction, compileSlide, validateArtworkPlacement } from '../packages/design-compiler/src/index.js'
import { recipeCoverage, RecipeRegistry } from '../packages/layout-recipes/src/index.js'
import { expandMacro } from '../packages/macros/src/index.js'
import { renderSlideHtml, renderTargetedVisualDiff } from '../packages/renderer-react/src/index.js'
import { isPresentationIR, isRecipeSpec, isSlideIR, validateSlideIR } from '../packages/schema/src/index.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import type { PpteDocument, RecipeSpec, SlideIR, TextElement, Transaction } from '../packages/schema/src/index.js'

function statementIR(): SlideIR {
  return {
    irVersion: '1.0',
    slideKey: 'statement-1',
    purpose: 'statement',
    message: 'One clear message with a bounded layout.',
    visualStrategy: 'structured',
    density: 'low',
    blocks: [
      { key: 'title', kind: 'heading', content: 'A clear title', semanticKey: 'title.main', importance: 'primary', editabilityTarget: 'full' },
      { key: 'body', kind: 'paragraph', content: 'A concise supporting sentence.', semanticKey: 'body.main', importance: 'supporting', editabilityTarget: 'full' },
    ],
    layoutIntent: { balance: 'text-led', hierarchy: 'single-focus', whitespace: 'generous' },
  }
}

test('Slide IR, Presentation IR, Recipe, deterministic compiler, and Macro contracts are bounded', () => {
  const ir = statementIR()
  assert.equal(isSlideIR(ir), true)
  assert.equal(isPresentationIR({ irVersion: '1.0', title: 'Review', narrative: [{ key: 'opening', title: 'Opening', slideKeys: [ir.slideKey] }], slides: [ir] }), true)
  assert.equal(isSlideIR({ ...ir, code: 'untrusted' }), false)
  assert.ok(validateSlideIR({ ...ir, blocks: [{ ...ir.blocks[0], key: 'title' }, { ...ir.blocks[1], key: 'title' }] }).some((issue) => issue.code === 'SLIDE_IR_INVALID'))

  const { document } = makeContractDocument()
  const first = compileSlide(ir, { canvas: document.canvas, theme: document.theme })
  const second = compileSlide(cloneJson(ir), { canvas: document.canvas, theme: document.theme })
  assert.deepEqual(first, second)
  assert.equal(first.validationIssues.some((issue) => issue.severity === 'error'), false)
  assert.ok(first.elementDrafts.every((draft) => !('operations' in draft)))

  const registry = new RecipeRegistry()
  const coverage = recipeCoverage(registry)
  assert.ok(coverage.declarative >= 10)
  assert.ok(coverage.ratio >= 0.8)
  const recipe = registry.get('statement.focus') as RecipeSpec
  assert.equal(isRecipeSpec(recipe), true)
  assert.throws(() => registry.registerControlled({ spec: recipe, trusted: false, compile: () => [] } as never), /CONTROLLED_RECIPE_UNTRUSTED/)
  const controlledRegistry = new RecipeRegistry([])
  const controlledSpec: RecipeSpec = { id: 'special.page', version: '1.0.0', supports: ['custom'], slots: [{ key: 'content', accepts: ['heading'] }], zones: [{ id: 'content', x: 0.1, y: 0.1, width: 0.8, height: 0.8 }], constraints: [] }
  let controlledCalled = false
  controlledRegistry.registerControlled({ spec: controlledSpec, trusted: true, compile: () => { controlledCalled = true; return [{ draftId: 'controlled:title', kind: 'text', semanticKey: 'title.main', role: 'title', frame: { x: 10, y: 10, width: 100, height: 40 }, data: { content: { paragraphs: [{ id: 'p', runs: [{ id: 'r', text: 'Controlled' }] }] } } }] } })
  const controlledDraft = compileSlide({ ...statementIR(), purpose: 'custom' }, { canvas: document.canvas, theme: document.theme, recipes: controlledRegistry })
  assert.equal(controlledCalled, true)
  assert.equal(controlledDraft.elementDrafts.length, 1)
  assert.equal(controlledDraft.validationIssues.some((issue) => issue.severity === 'error'), false)

  const expansion = expandMacro('metric-card', { key: 'revenue', label: 'Revenue', value: 42, unit: '%' }, { slideKey: 'statement-1', canvas: document.canvas })
  assert.equal(expansion.validationIssues.some((issue) => issue.severity === 'error'), false)
  assert.ok(expansion.elementDrafts.length >= 3)
  assert.ok(!('operations' in expansion))
  assert.throws(() => expandMacro('metric-card', { key: 'missing-value' }, { slideKey: 'statement-1', canvas: document.canvas }), /MACRO_INPUT_INVALID/)

  const initialization = buildInitializationTransaction(first, 'compiled-slide', document.canvas, { transactionId: 'compile-init', baseRevision: 'sha256-base' })
  assert.equal(initialization.operations[0].kind, 'slide.insert')
})

test('Agent query, preview, commit, confirmation, scope, and actual mutation budgets share Session', () => {
  const { document } = makeContractDocument()
  const session = new PpteSession(document)
  const server = new AgentToolServer(session)
  for (const name of AGENT_TOOL_NAMES) assert.equal(typeof server.execute, 'function', name)
  assert.equal(server.execute('inspect_document').ok, true)
  assert.equal(server.execute<Array<{ id: string }>>('list_slides').data?.length, 1)
  const agent = new MockAgent()
  const transaction = agent.createTextReplaceTransaction(session.getDocument(), session.getRevision(), 'slide_main', 'text_title', { paragraphs: [{ id: 'p-agent', runs: [{ id: 'r-agent', text: 'Updated' }] }] }, 'agent-contract')
  const preview = server.execute('preview_transaction', { transaction })
  assert.equal(preview.ok, true)
  assert.equal(preview.mutationBudget?.changedElements, 1)
  const commit = server.execute('commit_transaction', { transaction })
  assert.equal(commit.ok, true)
  assert.notEqual(session.getRevision(), transaction.baseRevision)
  assert.equal((session.getDocument().slides.slide_main.elements.text_title as TextElement).content.paragraphs[0].runs[0].text, 'Updated')

  const restricted = new AgentToolServer(new PpteSession(makeContractDocument().document), { grantedScope: { kind: 'selection', slideIds: ['slide_main'], elementIds: ['text_title'], permissions: ['content'], allowInsert: false, allowDelete: false } })
  const restrictedSlide = restricted.execute<Partial<{ elements: Record<string, unknown> }>>('get_slide', { slideId: 'slide_main' })
  assert.deepEqual(Object.keys(restrictedSlide.data?.elements ?? {}), ['text_title'])
  assert.equal(restricted.execute('get_element', { slideId: 'slide_main', elementId: 'text_body' }).ok, false)
  const outOfScope = agent.createOutOfScopeTextTransaction(restricted.session.getDocument(), restricted.session.getRevision(), 'slide_main', 'text_title', 'text_body', { paragraphs: [{ id: 'p-bad', runs: [{ id: 'r-bad', text: 'Nope' }] }] }, 'agent-out')
  const blocked = restricted.execute('preview_transaction', { transaction: outOfScope })
  assert.equal(blocked.ok, false)
  assert.ok(blocked.issues.some((issue) => issue.code === 'SCOPE_VIOLATION'))
  const permissionEscalation = { ...outOfScope, transactionId: 'agent-permission-escalation', scope: { ...outOfScope.scope, permissions: ['content', 'theme'] as const } }
  const escalationBlocked = restricted.execute('preview_transaction', { transaction: permissionEscalation })
  assert.equal(escalationBlocked.ok, false)
  assert.ok(escalationBlocked.issues.some((issue) => issue.code === 'SCOPE_VIOLATION'))
  const kindEscalation = { ...outOfScope, transactionId: 'agent-kind-escalation', scope: { ...outOfScope.scope, kind: 'slide' as const, elementIds: undefined } }
  const kindBlocked = restricted.execute('preview_transaction', { transaction: kindEscalation })
  assert.equal(kindBlocked.ok, false)
  assert.ok(kindBlocked.issues.some((issue) => issue.code === 'SCOPE_VIOLATION'))

  const budgetSession = new PpteSession(makeContractDocument().document)
  const budgetServer = new AgentToolServer(budgetSession)
  const budgetTransaction: Transaction = {
    transactionId: 'theme-budget',
    baseRevision: budgetSession.getRevision(),
    actor: { type: 'agent', id: 'budget-test' },
    scope: { kind: 'document', permissions: ['theme'], allowInsert: false, allowDelete: false },
    changeContract: { allowedOperationKinds: ['theme.setToken'], maxChangedSlides: 0, maxChangedElements: 0, maxInsertedElements: 0, maxDeletedElements: 0, maxReplacedAssets: 0, maxChangedFacts: 0, maxChangedSources: 0, maxChangedThemeTokens: 0, maxChangedStylePresets: 0 },
    createdAt: '2026-09-03T00:00:00.000Z',
    operations: [{ opId: 'theme-budget-op', kind: 'theme.setToken', category: 'colors', token: 'color.accent', value: '#FF0000' }],
  }
  const budget = budgetServer.execute('preview_transaction', { transaction: budgetTransaction })
  assert.equal(budget.ok, false)
  assert.ok(budget.issues.some((issue) => issue.code === 'MUTATION_BUDGET_EXCEEDED'))

  const styleDocument = makeContractDocument().document
  const styleSession = new PpteSession(styleDocument)
  const stylePreset = cloneJson(styleDocument.theme.presets.text['text.body'])
  assert.ok(stylePreset)
  const styleTransaction: Transaction = {
    transactionId: 'style-preset-template',
    baseRevision: styleSession.getRevision(),
    actor: { type: 'human', id: 'style-test' },
    scope: { kind: 'document', permissions: ['theme'], allowInsert: false, allowDelete: false },
    changeContract: styleOnlyContract([]),
    createdAt: '2026-09-03T00:00:00.000Z',
    operations: [{ opId: 'style-preset-template-op', kind: 'theme.updatePreset', category: 'text', presetId: 'text.body', value: { ...stylePreset, fontSize: 30 } }],
  }
  assert.equal(styleSession.preview(styleTransaction).ok, true)
})

test('regeneration and layout tools preview only; artwork metadata is rendered and checked', () => {
  const base = makeContractDocument().document
  const session = new PpteSession(base)
  const server = new AgentToolServer(session)
  const before = session.getRevision()
  const generated = server.execute('regenerate_slide', { slideId: 'slide_main' })
  assert.equal(generated.ok, true)
  assert.ok(generated.transaction)
  assert.equal(session.getRevision(), before)
  assert.equal(generated.transaction?.changeContract.requireConfirmation, true)
  const declined = server.execute('commit_transaction', { transaction: generated.transaction })
  assert.equal(declined.ok, false)
  assert.ok(declined.issues.some((issue) => issue.code === 'CONFIRMATION_REQUIRED'))
  const selectionSession = new PpteSession(cloneJson(base))
  const selectionServer = new AgentToolServer(selectionSession, { selection: { slideId: 'slide_main', elementIds: ['text_title'] } })
  const selectedRegeneration = selectionServer.execute('regenerate_selection')
  assert.equal(selectedRegeneration.ok, true)
  assert.ok(selectedRegeneration.transaction)
  const selectedOperations = selectedRegeneration.transaction?.operations ?? []
  const nonTargetIds = new Set(['shape_surface', 'text_body', 'image_hero'])
  assert.equal(selectedOperations.some((operation) => {
    if ('elementId' in operation) return nonTargetIds.has(operation.elementId)
    if (operation.kind === 'element.insert') return nonTargetIds.has(operation.element.id)
    if (operation.kind === 'slide.setReadingOrder') return operation.readingOrder?.some((elementId) => nonTargetIds.has(elementId)) === true
    return false
  }), false)
  assert.equal(selectedOperations.some((operation) => operation.kind === 'element.delete' && operation.elementId === 'text_title' || operation.kind === 'element.insert' && operation.element.semanticKey === 'title.main'), true)

  const hybrid = cloneJson(base) as PpteDocument
  hybrid.slides.slide_main.visualStrategy = 'hybrid'
  const image = hybrid.slides.slide_main.elements.image_hero
  assert.equal(image.type, 'image')
  if (image.type === 'image') {
    image.role = 'artwork'
    hybrid.assets[image.assetId].artwork = {
      safeTextRegions: [{ x: 0, y: 0, width: 1, height: 1 }],
      avoidTextRegions: [{ x: 0.95, y: 0, width: 0.05, height: 0.05 }],
      dominantPalette: ['#112233'],
      focalPoint: { x: 0.5, y: 0.5 },
    }
  }
  const safety = validateArtworkPlacement(hybrid, 'slide_main')
  assert.equal(safety.ok, true)
  const incompleteHybrid = cloneJson(hybrid)
  delete incompleteHybrid.assets.asset_pixel.artwork?.focalPoint
  const incompleteSafety = validateArtworkPlacement(incompleteHybrid, 'slide_main')
  assert.equal(incompleteSafety.ok, false)
  assert.ok(incompleteSafety.issues.some((issue) => issue.code === 'ARTWORK_FOCAL_POINT_MISSING'))
  const html = renderSlideHtml(hybrid, 'slide_main')
  assert.match(html, /data-ppte-visual-strategy="hybrid"/)
  assert.match(html, /data-ppte-artwork="true"/)
  assert.match(html, /data-ppte-safe-text-regions=/)
  const revised = cloneJson(base)
  const revisedBody = revised.slides.slide_main.elements.text_body
  assert.equal(revisedBody.type, 'text')
  if (revisedBody.type === 'text') revisedBody.content = { paragraphs: [{ id: 'visual-p', runs: [{ id: 'visual-r', text: 'Changed visual surface' }] }] }
  const visualDiff = renderTargetedVisualDiff(base, revised, 'slide_main', { elementIds: ['text_title'] })
  assert.equal(visualDiff.changed, true)
  assert.deepEqual(visualDiff.targetChangedElementIds, [])
  assert.deepEqual(visualDiff.nonTargetChangedElementIds, ['text_body'])
})
