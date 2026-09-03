import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalRevision, cloneJson } from '../packages/canonical-json/src/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { applyOperation } from '../packages/operations/src/index.js'
import { AgentToolServer } from '../packages/agent-tools/src/index.js'
import { compileSlide } from '../packages/design-compiler/src/index.js'
import { validateTextOverflow } from '../packages/validation/src/index.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import type { Element, PpteDocument, SlideIR, TextElement, Transaction } from '../packages/schema/src/index.js'

function richText(value: string, prefix: string) {
  return { paragraphs: [{ id: `${prefix}-paragraph`, runs: [{ id: `${prefix}-run`, text: value }] }] }
}

function baseTransaction(session: PpteSession, transactionId: string, scope: Transaction['scope'], changeContract: Transaction['changeContract'], operations: Transaction['operations']): Transaction {
  return { transactionId, baseRevision: session.getRevision(), actor: { type: 'human', id: 'r1-test' }, scope, changeContract, reason: transactionId, createdAt: '2026-09-03T00:00:00.000Z', validationLevel: 'L3', operations }
}

function broadContract(allowedOperationKinds: Transaction['changeContract']['allowedOperationKinds'], extra: Partial<Transaction['changeContract']> = {}): Transaction['changeContract'] {
  return { allowedOperationKinds, maxChangedSlides: 1, maxChangedElements: 10, maxInsertedElements: 10, maxDeletedElements: 10, maxReplacedAssets: 10, maxChangedFacts: 10, maxChangedSources: 10, maxChangedThemeTokens: 10, maxChangedStylePresets: 10, ...extra }
}

function selectionScope(permissions: Transaction['scope']['permissions'], elementIds: string[], allowInsert = false, allowDelete = false): Transaction['scope'] {
  return { kind: 'selection', slideIds: ['slide_main'], elementIds, permissions, allowInsert, allowDelete }
}

function textOf(element: Element): string {
  return element.type === 'text' ? element.content.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n') : ''
}

test('R1 finding 7: slide metadata updates are typed, reversible, and stale revisions conflict', () => {
  const { document } = makeContractDocument()
  const session = new PpteSession(document)
  const transaction = baseTransaction(session, 'r1-slide-metadata', selectionScope(['structure'], ['text_title']), broadContract(['slide.update'], { maxChangedElements: 0 }), [{ opId: 'r1-slide-metadata:op', kind: 'slide.update', slideId: 'slide_main', patch: { name: 'Renamed for R1' } }])
  const committed = session.commit(transaction)
  assert.equal(committed.ok, true)
  assert.equal(session.getDocument().slides.slide_main.name, 'Renamed for R1')
  assert.equal(session.undo().ok, true)
  assert.equal(session.getDocument().slides.slide_main.name, 'Vertical Slice')

  const stale = session.preview({ ...transaction, transactionId: 'r1-slide-metadata-stale', baseRevision: 'sha256-stale' })
  assert.ok(stale.issues.some((issue) => issue.code === 'REVISION_CONFLICT'))
  const unsafe = session.preview({ ...transaction, transactionId: 'r1-slide-elements-unsafe', baseRevision: session.getRevision(), operations: [{ opId: 'unsafe', kind: 'slide.update', slideId: 'slide_main', patch: { elements: {} } }] })
  assert.ok(unsafe.issues.some((issue) => issue.code === 'SLIDE_UPDATE_FIELD_NOT_ALLOWED'))
})

test('R1 finding 8: selected regeneration replaces only the selection; redesign_others is explicit and reversible', () => {
  const { document } = makeContractDocument()
  const session = new PpteSession(document)
  const server = new AgentToolServer(session, { selection: { slideId: 'slide_main', elementIds: ['text_title'] } })
  const before = cloneJson(session.getDocument())
  const selected = server.execute('regenerate_selection', { requireConfirmation: false })
  assert.equal(selected.ok, true)
  assert.ok(selected.transaction)
  assert.deepEqual(selected.transaction.operations.map((operation) => operation.kind), ['element.delete', 'element.insert'])
  assert.equal(selected.transaction.operations.some((operation) => 'elementId' in operation && ['shape_surface', 'text_body', 'image_hero'].includes(operation.elementId)), false)
  const committed = server.execute('commit_transaction', { transaction: selected.transaction, confirmed: true })
  assert.equal(committed.ok, true)
  const after = session.getDocument()
  assert.deepEqual(after.slides.slide_main.elements.text_body, before.slides.slide_main.elements.text_body)
  assert.deepEqual(after.slides.slide_main.elements.image_hero, before.slides.slide_main.elements.image_hero)
  assert.equal(session.undo().ok, true)
  assert.equal(canonicalRevision(session.getDocument()), canonicalRevision(before))

  const redesignSession = new PpteSession(document)
  const redesignServer = new AgentToolServer(redesignSession, { selection: { slideId: 'slide_main', elementIds: ['text_title'] } })
  const redesign = redesignServer.execute('redesign_others', { requireConfirmation: false })
  assert.equal(redesign.ok, true)
  assert.ok(redesign.transaction)
  assert.equal(redesign.transaction.operations.some((operation) => operation.kind === 'element.delete' && operation.elementId === 'text_title'), false)
})

test('R1 finding 9: regeneration inherits policy, references, and local properties; RichText ids do not fake anchor conflicts', () => {
  const { document } = makeContractDocument()
  const title = document.slides.slide_main.elements.text_title as TextElement
  title.rotationDeg = 11
  title.opacity = 0.72
  title.style.overrides = { letterSpacing: 2 }
  title.paragraphStyle = { align: 'center' }
  document.slides.slide_main.protectedAnchors = [{ target: { kind: 'element', elementId: title.id }, preserve: ['content'] }]
  const server = new AgentToolServer(new PpteSession(document))
  const regenerated = server.execute('regenerate_slide', { slideId: 'slide_main', requireConfirmation: false })
  assert.equal(regenerated.ok, true)
  const titleInsert = regenerated.transaction?.operations.find((operation): operation is Extract<Transaction['operations'][number], { kind: 'element.insert' }> => operation.kind === 'element.insert' && operation.element.semanticKey === 'title.main')
  assert.ok(titleInsert && titleInsert.kind === 'element.insert')
  assert.equal(titleInsert.element.editPolicy?.preserveOnRegenerate, true)
  assert.equal(titleInsert.element.rotationDeg, 11)
  assert.equal(titleInsert.element.opacity, 0.72)
  const generatedTitle = titleInsert.element as TextElement
  assert.deepEqual(generatedTitle.style.overrides, { letterSpacing: 2 })
  assert.deepEqual(generatedTitle.paragraphStyle, { align: 'center' })

  const { document: anchorDocument } = makeContractDocument()
  const anchorTitle = anchorDocument.slides.slide_main.elements.text_title as TextElement
  anchorDocument.slides.slide_main.protectedAnchors = [{ target: { kind: 'element', elementId: anchorTitle.id }, preserve: ['content'] }]
  const anchorSession = new PpteSession(anchorDocument)
  const sameText = baseTransaction(anchorSession, 'r1-anchor-same-text', selectionScope(['content'], [anchorTitle.id]), broadContract(['text.replaceContent'], { allowedElementIds: [anchorTitle.id], maxChangedElements: 1, preserve: { content: 'preserve' } }), [{ opId: 'anchor-same-text', kind: 'text.replaceContent', slideId: 'slide_main', elementId: anchorTitle.id, content: richText('Annual operating review', 'new-node-identity') }])
  assert.equal(anchorSession.preview(sameText).ok, true)
  assert.equal(anchorSession.commit(sameText).ok, true)
  const conflicting = baseTransaction(anchorSession, 'r1-anchor-conflict', selectionScope(['content'], [anchorTitle.id]), broadContract(['text.replaceContent'], { allowedElementIds: [anchorTitle.id], maxChangedElements: 1, preserve: { content: 'preserve' } }), [{ opId: 'anchor-conflict', kind: 'text.replaceContent', slideId: 'slide_main', elementId: anchorTitle.id, content: richText('Changed anchor content', 'conflict') }])
  assert.ok(anchorSession.preview(conflicting).issues.some((issue) => issue.code === 'PROTECTED_ANCHOR_VIOLATION'))
})

test('R1 finding 10: supplied Agent IR is validated and mixed GA-B/GA-C blocks receive Recipe slots', () => {
  const { document } = makeContractDocument()
  document.theme.presets.chart['chart.default'] = { palette: [{ kind: 'value', value: '#2563EB' }], axisColor: { kind: 'value', value: '#64748B' }, labelColor: { kind: 'value', value: '#334155' }, gridColor: { kind: 'value', value: '#CBD5E1' }, lineWidth: 2, cornerRadius: 3 }
  const mixed: SlideIR = {
    irVersion: '1.0', slideKey: 'mixed', purpose: 'statement', message: 'Mixed GA-B/GA-C slide', visualStrategy: 'hybrid', density: 'medium',
    blocks: [
      { key: 'title', kind: 'heading', content: 'Agent supplied title', semanticKey: 'title.main', importance: 'primary' },
      { key: 'body', kind: 'paragraph', content: 'Narrative', semanticKey: 'body.summary', importance: 'supporting' },
      { key: 'metric', kind: 'metric', content: { label: 'Revenue', value: 42, unit: '%' }, semanticKey: 'metric.revenue', importance: 'secondary' },
      { key: 'chart', kind: 'chart', content: { chartType: 'bar', data: { columns: [{ id: 'period', label: 'Period', type: 'string' }, { id: 'value', label: 'Value', type: 'number' }], rows: [{ id: 'q1', values: { period: 'Q1', value: 42 } }] }, encoding: { categoryField: 'period', valueFields: ['value'] } }, semanticKey: 'chart.revenue', importance: 'secondary' },
      { key: 'image', kind: 'image', content: { assetId: 'asset_pixel' }, semanticKey: 'image.hero', importance: 'secondary' },
    ],
  }
  const draft = compileSlide(mixed, { canvas: document.canvas, theme: document.theme })
  assert.equal(draft.validationIssues.some((issue) => issue.code === 'RECIPE_SLOT_UNAVAILABLE'), false)
  assert.equal(draft.elementDrafts.some((element) => element.semanticKey === 'chart.revenue'), true)
  const server = new AgentToolServer(new PpteSession(document, { runtimeProfile: 'ga-c' }))
  const result = server.execute('regenerate_slide', { slideId: 'slide_main', slideIR: mixed, requireConfirmation: false })
  assert.equal(result.ok, true)
  assert.ok(JSON.stringify(result).includes('Agent supplied title'))

  const invalid = server.execute('regenerate_slide', { slideId: 'slide_main', slideIR: { ...mixed, blocks: [] }, requireConfirmation: false })
  assert.equal(invalid.ok, false)
  assert.ok(invalid.issues.some((issue) => issue.code === 'SLIDE_IR_INVALID'))
})

test('R1 finding 12: measured Fit succeeds, inverse restores overflow, and Commit returns preview warnings', () => {
  const { document } = makeContractDocument()
  const title = document.slides.slide_main.elements.text_title as TextElement
  title.frame = { x: 160, y: 120, width: 180, height: 24 }
  title.content = richText('这是一个需要真正测量并消除溢出的超长标题文本', 'overflow')
  const session = new PpteSession(document)
  const fit = baseTransaction(session, 'r1-fit', selectionScope(['style'], [title.id]), broadContract(['text.fitByReducingFont'], { allowedElementIds: [title.id], maxChangedElements: 1, preserve: { content: 'preserve', geometry: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' } }), [{ opId: 'fit', kind: 'text.fitByReducingFont', slideId: 'slide_main', elementId: title.id, minFontSize: 1, resolvedFontSize: 63 }])
  const before = cloneJson(session.getDocument())
  const committed = session.commit(fit)
  assert.equal(committed.ok, true)
  assert.equal(validateTextOverflow(session.getDocument(), 'slide_main', session.getDocument().slides.slide_main.elements[title.id] as TextElement).length, 0)
  assert.ok(session.undo().ok)
  assert.equal(canonicalRevision(session.getDocument()), canonicalRevision(before))
  const impossible = session.preview({ ...fit, transactionId: 'r1-fit-impossible', baseRevision: session.getRevision(), operations: [{ opId: 'fit-impossible', kind: 'text.fitByReducingFont', slideId: 'slide_main', elementId: title.id, minFontSize: 63, resolvedFontSize: 63 }] })
  assert.ok(impossible.issues.some((issue) => issue.code === 'TEXT_FIT_UNRESOLVED'))

  const warningDocument = makeContractDocument().document
  const warningTitle = warningDocument.slides.slide_main.elements.text_title as TextElement
  warningTitle.frame = { x: 160, y: 120, width: 180, height: 24 }
  const warningSession = new PpteSession(warningDocument)
  const warningTransaction = baseTransaction(warningSession, 'r1-warning', selectionScope(['content'], [warningTitle.id]), broadContract(['text.replaceContent'], { allowedElementIds: [warningTitle.id], maxChangedElements: 1, preserve: { geometry: 'preserve', style: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' } }), [{ opId: 'warning', kind: 'text.replaceContent', slideId: 'slide_main', elementId: warningTitle.id, content: richText('这是一个会产生预览警告的超长标题文本', 'warning') }])
  const warningCommit = warningSession.commit(warningTransaction)
  assert.equal(warningCommit.ok, true)
  assert.ok(warningCommit.issues.some((issue) => issue.code === 'TEXT_OVERFLOW' && issue.severity === 'warning'))
})

test('R1 finding 13: semantic image replacement consumes asset budget and reverses exactly', () => {
  const { document } = makeContractDocument()
  document.assets.asset_second = { ...cloneJson(document.assets.asset_pixel), id: 'asset_second', path: 'assets/second.png' }
  const oldImage = cloneJson(document.slides.slide_main.elements.image_hero) as Extract<Element, { type: 'image' }>
  const replacement = cloneJson(oldImage)
  replacement.id = 'image_hero_replacement'
  replacement.assetId = 'asset_second'
  replacement.provenance = { kind: 'generated', replacesElementId: oldImage.id, sourceSemanticKey: replacement.semanticKey }
  const session = new PpteSession(document)
  const transaction = baseTransaction(session, 'r1-asset-replacement', selectionScope(['assets', 'structure'], [oldImage.id, replacement.id], true, true), broadContract(['element.delete', 'element.insert'], { allowedElementIds: [oldImage.id, replacement.id], maxChangedElements: 1, maxInsertedElements: 1, maxDeletedElements: 1, maxReplacedAssets: 1, preserve: { content: 'preserve', geometry: 'preserve', style: 'preserve', semanticIdentity: 'allow-replacement', readingOrder: 'preserve', facts: 'preserve' } }), [{ opId: 'delete-image', kind: 'element.delete', slideId: 'slide_main', elementId: oldImage.id }, { opId: 'insert-image', kind: 'element.insert', slideId: 'slide_main', element: replacement, index: 3, readingOrderIndex: 2 }])
  const before = cloneJson(session.getDocument())
  assert.equal(session.commit(transaction).ok, true)
  assert.equal(session.getDocument().slides.slide_main.elements[replacement.id].type, 'image')
  assert.equal(session.undo().ok, true)
  assert.equal(canonicalRevision(session.getDocument()), canonicalRevision(before))

  const blocked = session.preview({ ...transaction, transactionId: 'r1-asset-budget-blocked', baseRevision: session.getRevision(), changeContract: { ...transaction.changeContract, maxReplacedAssets: 0 } })
  assert.ok(blocked.issues.some((issue) => issue.code === 'MUTATION_BUDGET_EXCEEDED'))
  const noLineage = cloneJson(replacement)
  delete noLineage.provenance
  const conflict = session.preview({ ...transaction, transactionId: 'r1-asset-lineage-conflict', baseRevision: session.getRevision(), operations: [{ opId: 'delete-image-conflict', kind: 'element.delete', slideId: 'slide_main', elementId: oldImage.id }, { opId: 'insert-image-conflict', kind: 'element.insert', slideId: 'slide_main', element: noLineage, index: 3 }] })
  assert.ok(conflict.issues.some((issue) => issue.code === 'CHANGE_INVARIANT_VIOLATION' || issue.code === 'SEMANTIC_LINEAGE_AMBIGUOUS'))
})

test('R1 finding 14: Fact sync requires a unique prior display and is reversible', () => {
  const { document } = makeContractDocument()
  const body = document.slides.slide_main.elements.text_body as TextElement
  body.content = richText('Revenue was 41% last year; target is 50%.', 'fact-body')
  const session = new PpteSession(document)
  const operation = { opId: 'fact-sync', kind: 'fact.syncReferences' as const, factId: 'revenue', targetElementIds: [body.id], strategy: 'replace-display-value' as const, previousValue: 41 }
  const transaction = baseTransaction(session, 'r1-fact-sync', selectionScope(['facts', 'content'], [body.id]), broadContract(['fact.syncReferences'], { allowedElementIds: [body.id], maxChangedElements: 1, maxChangedFacts: 0, preserve: { facts: 'preserve', geometry: 'preserve', style: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve' } }), [operation])
  const before = textOf(session.getDocument().slides.slide_main.elements[body.id])
  assert.equal(session.commit(transaction).ok, true)
  assert.equal(textOf(session.getDocument().slides.slide_main.elements[body.id]), 'Revenue was 42% last year; target is 50%.')
  assert.equal(session.undo().ok, true)
  assert.equal(textOf(session.getDocument().slides.slide_main.elements[body.id]), before)

  const conflict = session.preview({ ...transaction, transactionId: 'r1-fact-conflict', baseRevision: session.getRevision(), operations: [{ ...operation, opId: 'fact-sync-conflict', previousValue: 999 }] })
  assert.equal(conflict.ok, false)
  assert.ok(conflict.issues.some((issue) => issue.code === 'FACT_SYNC_CONFLICT'))
  assert.equal(textOf(session.getDocument().slides.slide_main.elements[body.id]), before)
})

test('R1 findings 5 and 6: lock inverse is controlled while locked element/group edits conflict', () => {
  const { document } = makeContractDocument()
  const session = new PpteSession(document)
  const title = document.slides.slide_main.elements.text_title as TextElement
  const lock = baseTransaction(session, 'r1-lock', selectionScope(['structure'], [title.id]), broadContract(['element.setLocked'], { allowedElementIds: [title.id], maxChangedElements: 1 }), [{ opId: 'lock', kind: 'element.setLocked', slideId: 'slide_main', elementId: title.id, locked: true }])
  assert.equal(session.commit(lock).ok, true)
  assert.equal(session.undo().ok, true)
  assert.notEqual(session.getDocument().slides.slide_main.elements[title.id].locked, true)

  const lockedSession = new PpteSession(makeContractDocument().document)
  const lockedTitle = lockedSession.getDocument().slides.slide_main.elements.text_title as TextElement
  const makeLocked = baseTransaction(lockedSession, 'r1-lock-title', selectionScope(['structure'], [lockedTitle.id]), broadContract(['element.setLocked'], { allowedElementIds: [lockedTitle.id], maxChangedElements: 1 }), [{ opId: 'lock-title', kind: 'element.setLocked', slideId: 'slide_main', elementId: lockedTitle.id, locked: true }])
  assert.equal(lockedSession.commit(makeLocked).ok, true)
  const forbidden = baseTransaction(lockedSession, 'r1-locked-edit', selectionScope(['content'], [lockedTitle.id]), broadContract(['text.replaceContent'], { allowedElementIds: [lockedTitle.id], maxChangedElements: 1 }), [{ opId: 'locked-edit', kind: 'text.replaceContent', slideId: 'slide_main', elementId: lockedTitle.id, content: richText('must not edit', 'locked') }])
  assert.ok(lockedSession.preview(forbidden).issues.some((issue) => issue.code === 'EDIT_POLICY_VIOLATION'))

  const groupDocument = makeContractDocument().document
  groupDocument.slides.slide_main.groups = { locked: { id: 'locked', memberIds: ['text_title', 'text_body'], locked: true } }
  const groupSession = new PpteSession(groupDocument)
  const groupMove = baseTransaction(groupSession, 'r1-locked-group', { kind: 'slide', slideIds: ['slide_main'], elementIds: ['text_title', 'text_body'], permissions: ['geometry'], allowInsert: false, allowDelete: false }, broadContract(['group.move'], { allowedElementIds: ['text_title', 'text_body'], maxChangedElements: 2 }), [{ opId: 'group-move', kind: 'group.move', slideId: 'slide_main', groupId: 'locked', dx: 10, dy: 10 }])
  assert.ok(groupSession.preview(groupMove).issues.some((issue) => issue.code === 'EDIT_POLICY_VIOLATION'))

  const unlockedDocument = makeContractDocument().document
  unlockedDocument.slides.slide_main.groups = { movable: { id: 'movable', memberIds: ['text_title', 'text_body'] } }
  const unlockedSession = new PpteSession(unlockedDocument)
  const movable = baseTransaction(unlockedSession, 'r1-group-move', { kind: 'slide', slideIds: ['slide_main'], elementIds: ['text_title', 'text_body'], permissions: ['geometry'], allowInsert: false, allowDelete: false }, broadContract(['group.move'], { allowedElementIds: ['text_title', 'text_body'], maxChangedElements: 2, preserve: { content: 'preserve', style: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' } }), [{ opId: 'group-move-ok', kind: 'group.move', slideId: 'slide_main', groupId: 'movable', dx: 10, dy: 10 }])
  const groupBefore = cloneJson(unlockedSession.getDocument())
  assert.equal(unlockedSession.commit(movable).ok, true)
  assert.equal(unlockedSession.undo().ok, true)
  assert.equal(canonicalRevision(unlockedSession.getDocument()), canonicalRevision(groupBefore))
})

test('R1 support: selection replacement keeps reading order without a broad slide.setReadingOrder', () => {
  const { document } = makeContractDocument()
  const title = document.slides.slide_main.elements.text_title as TextElement
  const replacement = cloneJson(title)
  replacement.id = 'text_title_r1'
  replacement.content = richText('Replacement', 'replacement')
  replacement.provenance = { kind: 'agent', replacesElementId: title.id, sourceSemanticKey: title.semanticKey }
  const applied = applyOperation(document, { opId: 'r1-delete', kind: 'element.delete', slideId: 'slide_main', elementId: title.id })
  const inserted = applyOperation(applied.document, { opId: 'r1-insert', kind: 'element.insert', slideId: 'slide_main', element: replacement, index: 1, readingOrderIndex: 0 })
  assert.deepEqual(inserted.document.slides.slide_main.readingOrder, ['text_title_r1', 'text_body', 'image_hero'])
  let restored = inserted.document
  for (const inverse of inserted.inverse) restored = applyOperation(restored, inverse).document
  for (const inverse of applied.inverse) restored = applyOperation(restored, inverse).document
  assert.equal(canonicalRevision(restored), canonicalRevision(document))
})
