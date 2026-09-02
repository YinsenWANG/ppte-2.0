import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { canonicalRevision, sha256HexBytes } from '../../packages/canonical-json/src/index.js'
import { PpteSession } from '../../packages/core/src/index.js'
import { MockAgent } from '../../packages/agent-tools/src/index.js'
import { ImeTextEditSession, beginDrag, endDrag, updateDrag } from '../../packages/editor-react/src/index.js'
import { renderSlideHtml } from '../../packages/renderer-react/src/index.js'
import { RecoveryJournal, readJournal, replayJournal } from '../../packages/recovery-journal/src/index.js'
import { openCheckpoint, writeCheckpoint, type CheckpointWriteOptions } from '../../packages/file-format/src/index.js'
import type { CheckpointAdapter } from '../../packages/core/src/index.js'
import type { Asset, FontAsset, PpteDocument, RichTextDocument, ShapeElement, TextElement } from '../../packages/schema/src/index.js'

const SLIDE_ID = 'slide_main'
const TITLE_ID = 'text_title'
const BODY_ID = 'text_body'
const IMAGE_ID = 'image_hero'
const SHAPE_ID = 'shape_surface'
const IMAGE_ASSET_ID = 'asset_pixel'

export function makeContractDocument(imageBytes = pixelPng()): { document: PpteDocument; imageBytes: Uint8Array } {
  const image: Asset = {
    id: IMAGE_ASSET_ID,
    hash: sha256HexBytes(imageBytes),
    mimeType: 'image/png',
    byteLength: imageBytes.length,
    path: 'assets/pixel.png',
    width: 1,
    height: 1,
    source: { kind: 'generated', importedAt: '2026-09-02T00:00:00.000Z' },
    altText: 'A contract-deck image',
  }
  const title: TextElement = {
    id: TITLE_ID,
    type: 'text',
    semanticKey: 'title.main',
    role: 'title',
    frame: { x: 160, y: 130, width: 820, height: 130 },
    content: text('Annual operating review', 'title-p'),
    style: { styleRef: 'text.title.primary' },
    overflowPolicy: 'warn',
    editPolicy: { mode: 'full', agentEditable: true, preserveOnRegenerate: true },
  }
  const body: TextElement = {
    id: BODY_ID,
    type: 'text',
    semanticKey: 'body.summary',
    role: 'body',
    frame: { x: 160, y: 330, width: 780, height: 260 },
    content: text('Text, image, and shape use one semantic document.', 'body-p'),
    style: { styleRef: 'text.body' },
    overflowPolicy: 'warn',
  }
  const surface: ShapeElement = {
    id: SHAPE_ID,
    type: 'shape',
    role: 'background',
    frame: { x: 80, y: 70, width: 1760, height: 940 },
    shape: 'rounded-rectangle',
    style: { styleRef: 'shape.surface' },
  }
  const document: PpteDocument = {
    schemaVersion: '2.0.0',
    documentId: 'doc_contract_deck_01',
    locale: 'en-US',
    metadata: { title: 'PPTe Contract Deck', source: 'native', createdAt: '2026-09-02T00:00:00.000Z' },
    canvas: { width: 1920, height: 1080, unit: 'du', aspectRatio: '16:9', defaultBackground: { kind: 'solid', color: { kind: 'value', value: '#F7F8FA' } } },
    theme: {
      id: 'theme_contract',
      name: 'Contract Theme',
      tokens: {
        colors: { 'color.background': '#F7F8FA', 'color.text.primary': '#172033', 'color.text.muted': '#5B667A', 'color.accent': '#3B82F6', 'color.surface': '#FFFFFF' },
        fontFamilies: { 'font.heading': 'Inter', 'font.body': 'Inter' },
        fontSizes: { 'fontSize.title': 64, 'fontSize.body': 28 },
        spacing: {},
        radii: {},
        shadows: {},
      },
      presets: {
        text: {
          'text.title.primary': { fontFamily: { kind: 'token', token: 'font.heading' }, fontSize: 64, fontWeight: 700, color: { kind: 'token', token: 'color.text.primary' }, lineHeight: 1.15 },
          'text.body': { fontFamily: { kind: 'token', token: 'font.body' }, fontSize: 28, fontWeight: 400, color: { kind: 'token', token: 'color.text.muted' }, lineHeight: 1.35 },
        },
        shape: { 'shape.surface': { fill: { kind: 'solid', color: { kind: 'token', token: 'color.surface' } }, radius: 28 } },
        image: {},
        chart: {},
      },
    },
    slideOrder: [SLIDE_ID],
    slides: {
      [SLIDE_ID]: {
        id: SLIDE_ID,
        name: 'Vertical Slice',
        rootOrder: [SHAPE_ID, TITLE_ID, BODY_ID, IMAGE_ID],
        readingOrder: [TITLE_ID, BODY_ID, IMAGE_ID],
        elements: {
          [SHAPE_ID]: surface,
          [TITLE_ID]: title,
          [BODY_ID]: body,
          [IMAGE_ID]: { id: IMAGE_ID, type: 'image', semanticKey: 'image.hero', role: 'image', frame: { x: 1120, y: 250, width: 560, height: 430 }, assetId: IMAGE_ASSET_ID, fit: 'fill', altText: 'A contract-deck image' },
        },
        groups: {},
        visualStrategy: 'structured',
      },
    },
    assets: { [IMAGE_ASSET_ID]: image },
    fonts: {
      font_system_inter: { id: 'font_system_inter', family: 'Inter', style: 'normal', weight: 400, source: 'system', editableSafe: true },
    },
  }
  return { document, imageBytes }
}

export function runVerticalSlice(): Record<string, unknown> {
  const root = mkdtempSync(join(tmpdir(), 'ppte-contract-deck-'))
  const checkpointPath = join(root, 'deck.ppte')
  const journalPath = join(root, 'recovery.journal')
  const { document, imageBytes } = makeContractDocument()
  const initialRevision = canonicalRevision(document)
  const journal = new RecoveryJournal(journalPath, { journalVersion: '1', documentId: document.documentId, baseCheckpointRevision: initialRevision, sessionId: 'contract-deck-session', createdAt: '2026-09-02T00:00:00.000Z' })
  const checkpoint: CheckpointAdapter<string, CheckpointWriteOptions> = {
    write: (snapshot, target, options) => writeCheckpoint(snapshot, target, options),
    clearRecovery: () => journal.clear(),
  }
  const session = new PpteSession(document, { journal, checkpoint })
  assert(session.checkpoint(checkpointPath, { timestamp: '2026-09-02T00:00:00.000Z', assetBytes: { [IMAGE_ASSET_ID]: imageBytes } }).ok, 'initial checkpoint')
  const rendered = renderSlideHtml(session.getDocument(), SLIDE_ID)
  assert(rendered.includes('data-ppte-type="text"'), 'Text renderer')
  assert(rendered.includes('data-ppte-type="image"'), 'Image renderer')
  assert(rendered.includes('data-ppte-type="shape"'), 'Shape renderer')

  const dragStart = beginDrag(session.getDocument(), session.getRevision(), SLIDE_ID, IMAGE_ID, { x: 1200, y: 300 })
  const transient = updateDrag(dragStart, { x: 1260, y: 345 })
  assert(session.getRevision() === initialRevision, 'drag transient does not change revision')
  const moveTransaction = endDrag(transient, 'human:move-image', '2026-09-02T00:01:00.000Z')
  assert(Boolean(moveTransaction), 'drag creates one transaction on pointer-up')
  const moved = session.commit(moveTransaction!)
  assert(moved.ok && moved.diff?.mutationSummary.changedElements === 1, 'image move committed through Operation Engine')
  assert(session.getDocument().slides[SLIDE_ID].elements[IMAGE_ID].frame.x === 1180, 'image moved by transient delta')

  const titleBeforeIme = session.getDocument().slides[SLIDE_ID].elements[TITLE_ID] as TextElement
  const ime = new ImeTextEditSession(titleBeforeIme, SLIDE_ID)
  ime.beginComposition()
  ime.updateComposition(text('Annual operating review — draft', 'title-ime'))
  assert(ime.finish('human:ime-too-early', session.getRevision()) === undefined, 'IME composition never commits')
  ime.endComposition()
  const imeTransaction = ime.finish('human:ime', session.getRevision(), '2026-09-02T00:02:00.000Z')
  assert(Boolean(imeTransaction), 'IME commits once after composition')
  assert(session.commit(imeTransaction!).ok, 'IME commit')

  const agent = new MockAgent()
  const agentDocument = session.getDocument()
  const agentRevision = session.getRevision()
  const attempted = agent.createOutOfScopeTextTransaction(agentDocument, agentRevision, SLIDE_ID, TITLE_ID, BODY_ID, text('A cautious operating review', 'agent-bad'))
  const blocked = session.preview(attempted)
  assert(!blocked.ok && blocked.issues.some((issue) => issue.code === 'SCOPE_VIOLATION'), 'Change Contract blocks second object')
  const valid = agent.createTextReplaceTransaction(agentDocument, agentRevision, SLIDE_ID, TITLE_ID, text('A cautious operating review', 'agent-good'), 'agent:text-title')
  const agentPreview = agent.previewTextReplace(session, valid)
  assert(agentPreview.ok && agentPreview.diff?.mutationSummary.changedElements === 1, 'Agent preview has one changed element')
  const agentCommit = agent.commitTextReplace(session, valid)
  assert(agentCommit.ok && agentCommit.diff?.changedPaths.some((path) => path.includes('/content')), 'Agent commit uses structural diff')
  const afterAgentRevision = session.getRevision()
  assert(session.undo().ok, 'Undo is a new operation-engine transaction')
  assert(session.redo().ok, 'Redo restores the same semantic edit')
  assert(session.getRevision() === afterAgentRevision, 'Redo restores committed revision')

  const failedCheckpoint = session.checkpoint(checkpointPath, { timestamp: '2026-09-02T00:03:00.000Z', assetBytes: { [IMAGE_ASSET_ID]: imageBytes }, fault: 'before-rename' })
  assert(!failedCheckpoint.ok, 'fault-injected checkpoint reports failure')
  const original = openCheckpoint(checkpointPath)
  assert(canonicalRevision(original.document) === initialRevision, 'atomic checkpoint keeps original file readable')
  const journalState = readJournal(journalPath)
  assert(journalState.records.length >= 5, 'journal contains successful commits including undo/redo')
  const recovered = replayJournal(original.document, journalState)
  assert(recovered.issues.filter((issue) => issue.severity === 'error').length === 0, 'journal replay has no errors')
  assert(recovered.revision === session.getRevision(), 'journal recovery reaches current committed snapshot')

  const finalCheckpoint = session.checkpoint(checkpointPath, { timestamp: '2026-09-02T00:04:00.000Z', assetBytes: { [IMAGE_ASSET_ID]: imageBytes } })
  assert(finalCheckpoint.ok, 'final checkpoint')
  assert(readJournal(journalPath).records.length === 0, 'successful checkpoint clears recovery journal')
  const reopened = openCheckpoint(checkpointPath)
  assert(canonicalRevision(reopened.document) === session.getRevision(), 'reopen canonical hash matches')
  assert(canonicalRevision(reopened.document) === canonicalRevision(session.getDocument()), 'document round trip is canonical-hash equal')

  return {
    status: 'ok',
    renderedTypes: ['text', 'image', 'shape'],
    initialRevision,
    finalRevision: session.getRevision(),
    blockedIssue: blocked.issues.find((issue) => issue.code === 'SCOPE_VIOLATION')?.code,
    journalRecoveredTransactions: recovered.applied,
    checkpointRoundTrip: true,
    unsupportedScope: ['Chart', 'Widget', 'Poster', 'PPTX', 'Patch', 'nested Group', 'Run-level font/size', 'complete Portable editor'],
  }
}

function text(value: string, paragraphId: string): RichTextDocument {
  return { paragraphs: [{ id: paragraphId, runs: [{ id: `${paragraphId}-run`, text: value }] }] }
}
function pixelPng(): Uint8Array {
  return Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130])
}
function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`VERTICAL_SLICE_FAILED: ${label}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--e2e')) {
  try {
    process.stdout.write(`${JSON.stringify(runVerticalSlice())}\n`)
  } catch (cause) {
    process.stderr.write(`${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`)
    process.exitCode = 1
  }
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const artifactDirectory = resolve('artifacts')
  mkdirSync(artifactDirectory, { recursive: true })
  const artifact = join(artifactDirectory, 'contract-deck.html')
  const { document } = makeContractDocument()
  writeFileSync(artifact, `<!doctype html><meta charset="utf-8"><title>${document.metadata.title}</title>${renderSlideHtml(document, SLIDE_ID)}`)
  process.stdout.write(`Contract Deck rendered Text/Image/Shape to ${artifact}\n`)
}
