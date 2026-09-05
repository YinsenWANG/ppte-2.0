#!/usr/bin/env node

/**
 * PPTe 2.0 independent black-box acceptance gates.
 *
 * This file deliberately loads only package public entry points and the
 * fixtures owned by scripts/. It must not import the Contract Deck app or
 * reuse its fixtures/assertions as an oracle.
 */

import { createHash } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  IDS,
  addAlternateAsset,
  alternatePng,
  clone,
  makeDeliveryCorpusFixture,
  makeChartFixture,
  makeChartVariantsFixture,
  makeCoreFixture,
  makeExportFixture,
  makeLegacyBoundarySource,
  makeOverflowDocument,
  makeSlideIR,
  makeWidgetFixture,
  makeVideoWidgetFixture,
  pixelPng,
  richText,
  textContent,
} from './blackbox-fixtures.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GOLDENS = JSON.parse(readFileSync(join(ROOT, 'scripts', 'blackbox-goldens.json'), 'utf8'))

const BASE_GROUP_ORDER = [
  'core-basic',
  'agent-scope',
  'lock-undo',
  'host',
  'pages-notes-animation',
  'compiler-quality',
  'portable',
  'export',
  'recovery',
  'review-patch',
  'section-41',
]

const NEW_GROUP_ORDER = ['video-widget', 'pptx-chart', 'full-portable', 'group-rotate', 'legacy-import', 'mcp', 'delivery']
const GROUP_ORDER = [...BASE_GROUP_ORDER, ...NEW_GROUP_ORDER]

const GROUP_META = {
  'core-basic': {
    description: 'Audit-clean reference-core paths kept as regression guards.',
    findings: 'clean paths listed by the independent audit',
  },
  'agent-scope': {
    description: 'Agent scope, selection regeneration, provenance, fit, asset budget, and fact safety.',
    findings: '7, 8, 9, 10, 12, 13, 14',
  },
  'lock-undo': {
    description: 'Lock semantics and group-lock enforcement across undo.',
    findings: '5, 6',
  },
  host: {
    description: 'Product Host controls and browser-computed DU layout.',
    findings: '1, 2',
  },
  'pages-notes-animation': {
    description: 'Page/notes permissions and executable animation metadata.',
    findings: '3, 4',
  },
  'compiler-quality': {
    description: 'Compiler output quality and measured text-fit diagnostics.',
    findings: '11',
  },
  portable: {
    description: 'Offline portable viewer, Quick Fix, Light Edit, and local assets.',
    findings: '15, 16, 17, 18, 19',
  },
  export: {
    description: 'Faithful PDF, PNG, and semantic PPTX export.',
    findings: '20, 21, 22',
  },
  recovery: {
    description: 'Crash recovery, checkpoint history, CAS, and runtime profile replay.',
    findings: '23, 24, 25',
  },
  'review-patch': {
    description: 'Three-way review, patch integrity, literal payloads, and override debt.',
    findings: '26, 27, 28, 29, 30, 31',
  },
  'section-41': {
    description: '§41 A–J scenario completion gates.',
    findings: '§41 A–J',
  },
  'video-widget': {
    description: 'GA-C Video Widget registry, poster fallback, checkpoint, Portable downgrade, and export honesty.',
    findings: 'Video Widget',
  },
  'pptx-chart': {
    description: 'Semantic bar/line/pie charts exported as native PPTX chart parts with capability evidence.',
    findings: 'Native PPTX Chart',
  },
  'full-portable': {
    description: 'Full Portable file:// editor surface and save-new-project journey.',
    findings: 'Full Portable',
  },
  'group-rotate': {
    description: 'Explicit member transforms for Group Rotate with exact undo and Host/renderer parity.',
    findings: 'Group Rotate',
  },
  'legacy-import': {
    description: 'Slidev/Markdown legacy migration and GA-A/GA-B/GA-C boundary coverage.',
    findings: 'Legacy Import',
  },
  mcp: {
    description: 'stdio MCP protocol, Agent tool exposure, readonly filtering, and checkpoint persistence.',
    findings: 'Cross-agent MCP skill',
  },
  delivery: {
    description: 'MCP-owned editable delivery, file:// save/reopen/present, preview separation, and artifact budgets.',
    findings: 'Delivery layer P0/P1',
  },
}

const MILESTONE_GROUPS = {
  r1: ['core-basic', 'agent-scope', 'lock-undo'],
  r2: ['core-basic', 'agent-scope', 'lock-undo', 'host', 'pages-notes-animation', 'compiler-quality'],
  r3: ['core-basic', 'agent-scope', 'lock-undo', 'host', 'pages-notes-animation', 'compiler-quality', 'portable'],
  r4: ['core-basic', 'agent-scope', 'lock-undo', 'host', 'pages-notes-animation', 'compiler-quality', 'portable', 'export'],
  r5: ['core-basic', 'agent-scope', 'lock-undo', 'host', 'pages-notes-animation', 'compiler-quality', 'portable', 'export', 'recovery'],
  r6: ['core-basic', 'agent-scope', 'lock-undo', 'host', 'pages-notes-animation', 'compiler-quality', 'portable', 'export', 'recovery', 'review-patch'],
  'video-widget': [...BASE_GROUP_ORDER, 'video-widget'],
  'pptx-chart': [...BASE_GROUP_ORDER, 'video-widget', 'pptx-chart'],
  'full-portable': [...BASE_GROUP_ORDER, 'video-widget', 'pptx-chart', 'full-portable'],
  'group-rotate': [...BASE_GROUP_ORDER, 'video-widget', 'pptx-chart', 'full-portable', 'group-rotate'],
  'legacy-import': GROUP_ORDER.filter((group) => group !== 'delivery'),
  delivery: [...GROUP_ORDER],
  final: [...GROUP_ORDER],
  final3: [...GROUP_ORDER],
}

const CASE_SPECS = Object.fromEntries(GROUP_ORDER.map((group) => [group, []]))

function register(group, finding, title, authorization, expected, run) {
  CASE_SPECS[group].push({ id: `${group}:${CASE_SPECS[group].length + 1}`, finding, title, authorization, expected, run })
}

class GateFailure extends Error {
  constructor(message, observed = undefined, rawOutput = undefined) {
    super(message)
    this.name = 'GateFailure'
    this.observed = observed
    this.rawOutput = rawOutput ?? stringifyObserved(observed ?? message)
  }
}

class HarnessFailure extends Error {
  constructor(message, rawOutput = undefined) {
    super(message)
    this.name = 'HarnessFailure'
    this.rawOutput = rawOutput ?? message
  }
}

let buildPromise
let runtimePromise

async function ensureRuntime() {
  if (!buildPromise) {
    buildPromise = Promise.resolve().then(() => {
      const result = spawnSync('pnpm', ['build'], { cwd: ROOT, encoding: 'utf8' })
      if (result.error || result.status !== 0) {
        const raw = `${result.stdout ?? ''}${result.stderr ?? ''}`
        throw new HarnessFailure('The canonical package build failed before black-box execution.', raw || result.error?.message)
      }
    })
  }
  await buildPromise
  if (!runtimePromise) {
    const load = (relativePath) => import(pathToFileURL(join(ROOT, relativePath)).href)
    runtimePromise = Promise.all([
      load('dist/packages/canonical-json/src/index.js'),
      load('dist/packages/core/src/index.js'),
      load('dist/packages/agent-tools/src/index.js'),
      load('dist/packages/change-contract/src/index.js'),
      load('dist/packages/operations/src/index.js'),
      load('dist/packages/richtext-adapter/src/index.js'),
      load('dist/packages/renderer-react/src/index.js'),
      load('dist/packages/file-format/src/index.js'),
      load('dist/packages/recovery-journal/src/index.js'),
      load('dist/packages/design-compiler/src/index.js'),
      load('dist/packages/portable-runtime/src/index.js'),
      load('dist/apps/mcp/delivery.js'),
      load('dist/packages/exporter-pdf/src/index.js'),
      load('dist/packages/exporter-pptx/src/index.js'),
      load('dist/packages/reviewer/src/index.js'),
      load('dist/packages/patch-format/src/index.js'),
      load('dist/packages/validation/src/index.js'),
      load('dist/packages/facts/src/index.js'),
      load('dist/packages/archive/src/index.js'),
      load('dist/packages/widgets/src/index.js'),
      load('dist/packages/importer-legacy/src/index.js'),
    ]).then(([canonical, core, agent, change, operations, richtextAdapter, renderer, fileFormat, recovery, compiler, portable, delivery, pdf, pptx, reviewer, patch, validation, facts, archive, widgets, legacy]) => ({
      canonical,
      core,
      agent,
      change,
      operations,
      richtext: richtextAdapter,
      renderer,
      file: fileFormat,
      recovery,
      compiler,
      portable,
      delivery,
      pdf,
      pptx,
      reviewer,
      patch,
      validation,
      facts,
      archive,
      widgets,
      legacy,
    }))
  }
  return runtimePromise
}

function stringifyObserved(value) {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, (_key, child) => child instanceof Uint8Array ? `[Uint8Array ${child.length}]` : child, 2)
  } catch {
    return String(value)
  }
}

function expectGate(condition, message, observed = undefined) {
  if (!condition) throw new GateFailure(message, observed)
}

function failGate(message, observed = undefined, rawOutput = undefined) {
  throw new GateFailure(message, observed, rawOutput)
}

function expectEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new GateFailure(message, { expected, actual })
}

function expectIssueCode(result, code) {
  expectGate(result?.issues?.some((issue) => issue.code === code), `Expected issue ${code}.`, result?.issues ?? result)
}

function expectNoErrors(result, message = 'Expected a successful result.') {
  expectGate(result?.ok === true && !(result?.issues ?? []).some((issue) => issue.severity === 'error'), message, result)
}

function digest(bytes) {
  return `sha256-${createHash('sha256').update(bytes).digest('hex')}`
}

function textOf(document, elementId, slideId = IDS.slide) {
  return textContent(document.slides[slideId].elements[elementId])
}

function fixtureWithNewAsset() {
  const fixture = makeCoreFixture()
  const newBytes = alternatePng()
  addAlternateAsset(fixture.document, newBytes)
  return { ...fixture, newBytes }
}

function nativeChartFixture() {
  const fixture = makeChartVariantsFixture()
  delete fixture.document.facts
  for (const element of Object.values(fixture.document.slides[IDS.slide].elements)) delete element.semanticRefs
  return fixture
}

function textTransaction(rt, document, revision, value, options = {}) {
  const agent = new rt.agent.MockAgent()
  return agent.createTextReplaceTransaction(document, revision, options.slideId ?? IDS.slide, options.elementId ?? IDS.title, richText(value, options.prefix ?? `bb-${options.transactionId ?? 'text'}`), options.transactionId ?? `bb:text:${options.elementId ?? IDS.title}`)
}

function transaction({ id, baseRevision, actor = { type: 'human', id: 'blackbox' }, scope, contract, operations, reason = 'Independent black-box fixture transaction' }) {
  return {
    transactionId: id,
    baseRevision,
    actor,
    scope,
    changeContract: contract,
    reason,
    createdAt: '2026-09-03T00:00:00.000Z',
    validationLevel: 'L3',
    operations,
  }
}

function broadContract(allowedOperationKinds, options = {}) {
  return {
    allowedOperationKinds,
    ...(options.allowedElementIds ? { allowedElementIds: options.allowedElementIds } : {}),
    maxChangedSlides: options.maxChangedSlides ?? 1,
    maxChangedElements: options.maxChangedElements ?? 99,
    maxInsertedElements: options.maxInsertedElements ?? 99,
    maxDeletedElements: options.maxDeletedElements ?? 99,
    maxReplacedAssets: options.maxReplacedAssets ?? 99,
    maxChangedFacts: options.maxChangedFacts ?? 99,
    maxChangedSources: options.maxChangedSources ?? 99,
    maxChangedThemeTokens: options.maxChangedThemeTokens ?? 99,
    maxChangedStylePresets: options.maxChangedStylePresets ?? 99,
    ...(options.preserve ? { preserve: options.preserve } : {}),
    requireConfirmation: options.requireConfirmation ?? false,
    userIntentSummary: options.userIntentSummary ?? 'Independent black-box fixture intent.',
  }
}

function scope(kind, permissions, options = {}) {
  return {
    kind,
    permissions,
    ...(options.slideIds ? { slideIds: options.slideIds } : {}),
    ...(options.elementIds ? { elementIds: options.elementIds } : {}),
    ...(options.semanticKeys ? { semanticKeys: options.semanticKeys } : {}),
    allowInsert: options.allowInsert ?? false,
    allowDelete: options.allowDelete ?? false,
  }
}

async function withTempDirectory(callback) {
  const directory = mkdtempSync(join(tmpdir(), 'ppte-blackbox-'))
  try {
    return await callback(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function writeFixtureHtml(directory, filename, html) {
  const path = join(directory, filename)
  writeFileSync(path, `<!doctype html><meta charset="utf-8"><title>PPTe black-box fixture</title>${html}`)
  return path
}

async function withBrowser(htmlPath, callback) {
  let playwright
  try {
    playwright = await import('playwright')
  } catch (cause) {
    const raw = cause instanceof Error ? cause.message : String(cause)
    throw new GateFailure('Playwright is required for browser gates but could not be loaded.', { htmlPath }, raw)
  }
  let browser
  try {
    browser = await playwright.chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' })
    return await callback(page)
  } catch (cause) {
    if (cause instanceof GateFailure) throw cause
    const raw = cause instanceof Error ? cause.message : String(cause)
    throw new GateFailure('Chromium could not execute the file:// fixture.', { htmlPath }, raw)
  } finally {
    await browser?.close()
  }
}

let hostBuildPromise
async function ensureHost() {
  if (!hostBuildPromise) {
    hostBuildPromise = Promise.resolve().then(() => {
      const result = spawnSync('pnpm', ['host:build'], { cwd: ROOT, encoding: 'utf8' })
      if (result.error || result.status !== 0) {
        const raw = `${result.stdout ?? ''}${result.stderr ?? ''}`
        throw new HarnessFailure('The Product Host build failed before browser execution.', raw || result.error?.message)
      }
    })
  }
  await hostBuildPromise
}

async function withHostBrowser(callback) {
  await ensureHost()
  let playwright
  try {
    playwright = await import('playwright')
  } catch (cause) {
    const raw = cause instanceof Error ? cause.message : String(cause)
    throw new GateFailure('Playwright is required for Product Host gates but could not be loaded.', { host: join(ROOT, 'apps', 'host', 'dist', 'index.html') }, raw)
  }
  let browser
  try {
    browser = await playwright.chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
    const hostPath = join(ROOT, 'apps', 'host', 'dist', 'index.html')
    await page.goto(pathToFileURL(hostPath).href, { waitUntil: 'load' })
    await page.waitForSelector('[data-ppte-host]')
    return await callback(page)
  } catch (cause) {
    if (cause instanceof GateFailure) throw cause
    const raw = cause instanceof Error ? cause.message : String(cause)
    throw new GateFailure('Chromium could not execute the Product Host file:// journey.', { host: join(ROOT, 'apps', 'host', 'dist', 'index.html') }, raw)
  } finally {
    await browser?.close()
  }
}

async function runHostJourney(ctx, options = {}) {
  return withHostBrowser(async (page) => {
    const evidence = {}
    await page.locator('[data-ppte-action="new"]').click()
    evidence.created = await page.locator('[data-ppte-host]').getAttribute('data-ppte-slide-count')

    await page.locator('input[data-ppte-action="agent-source"]').setInputFiles({ name: 'quarterly-design.json', mimeType: 'application/json', buffer: readFileSync(join(ROOT, 'examples', 'quarterly-design.json')) })
    await page.locator('[data-ppte-action="generate"]').click()
    await page.waitForFunction(() => document.querySelector('[data-ppte-host]')?.getAttribute('data-ppte-slide-count') === '10')
    evidence.generatedSlides = Number(await page.locator('[data-ppte-host]').getAttribute('data-ppte-slide-count'))
    evidence.agentGenerated = await page.locator('[data-ppte-host]').getAttribute('data-ppte-agent-generated')

    const generatedTexts = await page.locator('[data-ppte-thumbnails] .ppte-thumbnail-surface').allTextContents()
    ctx.expectGate(generatedTexts.some(text => text.includes('128')) && generatedTexts.some(text => text.includes('99.95%')) && generatedTexts.some(text => text.includes('负责人')), 'Generated content must retain distinct source facts and action items, not duplicate the first slide.', { generatedTexts })
    const title = page.locator('[data-ppte-semantic-key="quarter-1.title"]').first()
    await title.dblclick()
    await title.fill('R7 真人路径标题')
    await title.blur()
    await page.waitForFunction(() => Number(document.querySelector('[data-ppte-host]')?.getAttribute('data-ppte-history-depth') ?? 0) >= 2)
    evidence.editedText = await page.locator('[data-ppte-semantic-key="quarter-1.title"]').first().innerText()

    await page.locator('input[data-ppte-action="import-image"]').setInputFiles({ name: 'hero.png', mimeType: 'image/png', buffer: Buffer.from(pixelPng()) })
    const image = page.locator('[data-ppte-element-id^="image_host_"]').first()
    await image.waitFor({ state: 'visible' })
    // Wait for the import transaction and its React-derived surface to settle
    // before measuring the pointer origin. Without this barrier a cold
    // Chromium run could measure the pre-commit frame and then drag a stale
    // screen point, even though the later Add page/history checks still ran.
    await page.waitForFunction(() => document.querySelector('[data-ppte-host]')?.getAttribute('data-ppte-history-depth') === '3')
    await page.waitForFunction(() => {
      const node = document.querySelector('[data-ppte-element-id^="image_host_"]')
      const rect = node?.getBoundingClientRect()
      return Boolean(rect && rect.width > 0 && rect.height > 0)
    })
    const beforeImage = await image.boundingBox()
    if (!beforeImage) throw new GateFailure('Host image import did not produce a measurable image surface.')
    const beforeImageFrame = await image.evaluate((node) => ({ left: node.style.left, top: node.style.top }))
    const imagePoint = { x: beforeImage.x + beforeImage.width / 2, y: beforeImage.y + beforeImage.height / 2 }
    await page.mouse.move(imagePoint.x, imagePoint.y)
    await page.mouse.down()
    await page.mouse.move(imagePoint.x + 36, imagePoint.y + 24, { steps: 5 })
    await page.mouse.up()
    await page.waitForFunction(() => document.querySelector('[data-ppte-host]')?.getAttribute('data-ppte-history-depth') === '4')
    const draggedImage = await page.waitForFunction((before) => {
      const node = document.querySelector('[data-ppte-element-id^="image_host_"]')
      if (!node) return false
      const rect = node.getBoundingClientRect()
      return (node instanceof HTMLElement) && rect.width > 0 && rect.height > 0 && (node.style.left !== before.left || node.style.top !== before.top)
    }, beforeImageFrame)
    // Keep the geometry assertion in the same browser evaluation as the
    // bounding-box read. React may replace the rendered innerHTML once the
    // uploaded asset URL settles; a separate Locator.boundingBox() can then
    // observe the detached old node even though the committed frame changed.
    evidence.imageDragged = Boolean(await draggedImage.jsonValue())

    await page.locator('[data-ppte-action="add-page"]').click()
    await page.waitForFunction(() => document.querySelector('[data-ppte-host]')?.getAttribute('data-ppte-slide-count') === '11')
    evidence.addedPage = Number(await page.locator('[data-ppte-host]').getAttribute('data-ppte-slide-count'))

    await page.locator('[data-ppte-action="present"]').click()
    await page.waitForFunction(() => document.querySelector('[data-ppte-host]')?.getAttribute('data-ppte-presenting') === 'true')
    evidence.presenterSlideBeforeNavigation = Number(await page.locator('[data-ppte-host]').getAttribute('data-ppte-presenter-slide'))
    await page.keyboard.press('ArrowLeft')
    evidence.presenting = await page.locator('[data-ppte-host]').getAttribute('data-ppte-presenting')
    evidence.presenterSlide = Number(await page.locator('[data-ppte-host]').getAttribute('data-ppte-presenter-slide'))

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-ppte-action="save"]').click(),
    ])
    const downloadPath = await download.path()
    if (!downloadPath) throw new GateFailure('Host Save did not produce a downloadable .ppte checkpoint.')
    evidence.savedFilename = download.suggestedFilename()

    await page.locator('input[data-ppte-action="open"]').setInputFiles(downloadPath)
    await page.waitForFunction(() => document.querySelector('[data-ppte-status]')?.textContent?.includes('已打开'))
    await page.waitForFunction(() => document.querySelector('[data-ppte-host]')?.getAttribute('data-ppte-slide-count') === '11')
    evidence.reopenedSlides = Number(await page.locator('[data-ppte-host]').getAttribute('data-ppte-slide-count'))
    evidence.reopenedHistory = Number(await page.locator('[data-ppte-host]').getAttribute('data-ppte-history-depth'))
    const undo = page.locator('[data-ppte-action="undo"]')
    evidence.undoEnabled = await undo.isEnabled()
    await undo.click()
    await page.waitForFunction(() => document.querySelector('[data-ppte-host]')?.getAttribute('data-ppte-slide-count') === '10')
    evidence.afterUndoSlides = Number(await page.locator('[data-ppte-host]').getAttribute('data-ppte-slide-count'))
    evidence.afterUndoHistory = Number(await page.locator('[data-ppte-host]').getAttribute('data-ppte-history-depth'))

    ctx.expectGate(evidence.created === '1', 'Host New did not create the initial document.', evidence)
    ctx.expectGate(evidence.generatedSlides === 10 && evidence.agentGenerated === 'true', 'Host Agent journey did not generate ten semantic pages.', evidence)
    ctx.expectGate(evidence.editedText === 'R7 真人路径标题', 'Double-click text editing did not commit the authored title.', evidence)
    ctx.expectGate(evidence.imageDragged === true, 'Pointer drag did not commit image geometry.', evidence)
    ctx.expectGate(evidence.addedPage === 11, 'Host Add page did not create a semantic page.', evidence)
    ctx.expectGate(evidence.presenting === 'true' && evidence.presenterSlideBeforeNavigation === 1 && evidence.presenterSlide === 0, 'Host Present control did not run the presenter state machine.', evidence)
    ctx.expectGate(evidence.reopenedSlides === 11 && evidence.reopenedHistory > 0 && evidence.undoEnabled && evidence.afterUndoSlides === 10 && evidence.afterUndoHistory === evidence.reopenedHistory - 1, 'Saved Host checkpoint did not restore an actionable Undo stack.', evidence)
    return evidence
  })
}

function runExternal(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', ...options })
  const raw = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (result.error || result.status !== 0) throw new GateFailure(`${command} ${args.join(' ')} failed.`, { status: result.status, signal: result.signal }, raw || result.error?.message)
  return { result, raw }
}

function runMcpBatch(checkpointPath, requests, args = []) {
  const result = spawnSync(process.execPath, [join(ROOT, 'dist', 'apps', 'mcp', 'index.js'), checkpointPath, ...args], {
    cwd: ROOT,
    input: `${requests.map((request) => JSON.stringify(request)).join('\n')}\n`,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  const raw = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (result.error || result.status !== 0) throw new GateFailure('PPTe MCP stdio server failed.', { status: result.status, signal: result.signal }, raw || result.error?.message)
  const lines = (result.stdout ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  try {
    return lines.map((line) => JSON.parse(line))
  } catch (cause) {
    throw new GateFailure('PPTe MCP stdio server emitted a non-JSON response.', { stdout: result.stdout, stderr: result.stderr }, cause instanceof Error ? cause.message : String(cause))
  }
}

function mcpToolResult(responses, id) {
  const response = responses.find((item) => item.id === id)
  if (!response) throw new GateFailure(`PPTe MCP response ${id} was not returned.`, responses)
  if (response.error) throw new GateFailure(`PPTe MCP JSON-RPC error: ${response.error.message}`, response)
  const text = response.result?.content?.find((item) => item.type === 'text')?.text
  if (typeof text !== 'string') throw new GateFailure('PPTe MCP tools/call returned no text content.', response)
  return JSON.parse(text)
}

function runPythonPptx(pptxPath) {
  const script = [
    'import json, sys',
    'from pptx import Presentation',
    'prs = Presentation(sys.argv[1])',
    'slides = list(prs.slides)',
    'paragraphs = []',
    'styled_runs = 0',
    'rotations = []',
    'for slide in slides:',
    '    for shape in slide.shapes:',
    '        if hasattr(shape, "text_frame"):',
    '            for paragraph in shape.text_frame.paragraphs:',
    '                paragraphs.append(paragraph.text)',
    '                for run in paragraph.runs:',
    '                    if run.font.bold or run.font.italic or run.font.underline or run.font.color.type is not None:',
    '                        styled_runs += 1',
    '        if hasattr(shape, "rotation"):',
    '            rotations.append(shape.rotation or 0)',
    'observed = {"slides": len(slides), "paragraphs": paragraphs, "styledRuns": styled_runs, "rotations": rotations}',
    'print(json.dumps(observed, ensure_ascii=False))',
    'if len(paragraphs) < 2 or styled_runs < 1 or not any(rotations):',
    '    raise SystemExit("PPTX_SEMANTIC_ASSERTION_FAILED: paragraphs/style/rotation were not preserved")',
  ].join('\n')
  const { raw } = runExternal('uv', ['run', '--with', 'python-pptx', 'python', '-c', script, pptxPath])
  // uv may write its dependency-install progress after the child process's
  // stdout. Parse the child's JSON evidence independently of that harness noise.
  const evidence = raw.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).map((line) => {
    try { return JSON.parse(line) } catch { return undefined }
  }).filter((value) => value && typeof value === 'object').at(-1)
  if (!evidence) throw new GateFailure('python-pptx did not return JSON evidence.', { raw })
  return evidence
}

function runPythonNativeChart(pptxPath) {
  const script = [
    'import json, sys',
    'from zipfile import ZipFile',
    'from pptx import Presentation',
    'prs = Presentation(sys.argv[1])',
    'chart_shapes = []',
    'categories = []',
    'values = []',
    'for slide in prs.slides:',
    '    for shape in slide.shapes:',
    '        if not getattr(shape, "has_chart", False):',
    '            continue',
    '        chart = shape.chart',
    '        chart_shapes.append(str(chart.chart_type))',
    '        for plot in chart.plots:',
    '            try:',
    '                categories.extend(str(category.label) for category in plot.categories)',
    '            except (AttributeError, ValueError):',
    '                pass',
    '            for series in plot.series:',
    '                values.extend(float(value) for value in series.values)',
    'with ZipFile(sys.argv[1]) as archive:',
    '    chart_parts = sorted(name for name in archive.namelist() if name.startswith("ppt/charts/chart") and name.endswith(".xml"))',
    'observed = {"nativeChartShapes": len(chart_shapes), "chartTypes": chart_shapes, "chartParts": chart_parts, "categories": categories, "values": values}',
    'print(json.dumps(observed, ensure_ascii=False))',
    'if len(chart_shapes) < 3 or len(chart_parts) < 3 or not {"Q1", "Q2"}.issubset(set(categories)) or not {42.0, 38.0}.issubset(set(values)):',
    '    raise SystemExit("PPTX_NATIVE_CHART_ASSERTION_FAILED: native chart parts/categories/values were not preserved")',
  ].join('\n')
  const args = ['run', '--with', 'python-pptx', 'python', '-c', script, pptxPath]
  const result = spawnSync('uv', args, { cwd: ROOT, encoding: 'utf8' })
  const raw = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const evidence = raw.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).map((line) => {
    try { return JSON.parse(line) } catch { return undefined }
  }).filter((value) => value && typeof value === 'object').at(-1)
  if (result.error || result.status !== 0) throw new GateFailure('python-pptx native chart assertion failed.', evidence ?? { status: result.status, signal: result.signal }, raw || result.error?.message)
  if (!evidence) throw new GateFailure('python-pptx native chart check did not return JSON evidence.', { raw })
  return evidence
}

function runPdftotext(pdfPath) {
  const result = spawnSync('pdftotext', [pdfPath, '-'], { cwd: ROOT, encoding: 'utf8' })
  if (!result.error && result.status === 0) return `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (result.error?.code !== 'ENOENT') {
    const raw = `${result.stdout ?? ''}${result.stderr ?? ''}`
    throw new GateFailure(`pdftotext ${pdfPath} - failed.`, { status: result.status, signal: result.signal }, raw || result.error?.message)
  }
  // Infrastructure fallback for hosts without Poppler. PyMuPDF uses the
  // same embedded PDF text map and keeps the gate's Unicode assertions intact;
  // a missing executable must not turn a valid export into an environment red.
  const fallback = spawnSync('python3', ['-c', [
    'import fitz, sys',
    'pdf = fitz.open(sys.argv[1])',
    'sys.stdout.write("".join(page.get_text() for page in pdf))',
  ].join('\n'), pdfPath], { cwd: ROOT, encoding: 'utf8' })
  if (!fallback.error && fallback.status === 0) return `${fallback.stdout ?? ''}${fallback.stderr ?? ''}`
  const raw = `${fallback.stdout ?? ''}${fallback.stderr ?? ''}`
  throw new GateFailure(`pdftotext ${pdfPath} - failed and the local text-extraction fallback was unavailable.`, { status: fallback.status, signal: fallback.signal }, raw || fallback.error?.message || result.error.message)
}

function readPng(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  expectEqual([...bytes.slice(0, 8)], signature, 'PNG signature is invalid.')
  const read32 = (offset) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset)
  let offset = 8
  let width
  let height
  let bitDepth
  let colorType
  const idat = []
  while (offset + 12 <= bytes.length) {
    const length = read32(offset)
    const type = new TextDecoder().decode(bytes.slice(offset + 4, offset + 8))
    const data = bytes.slice(offset + 8, offset + 8 + length)
    offset += length + 12
    if (type === 'IHDR') {
      width = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0)
      height = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4)
      bitDepth = data[8]
      colorType = data[9]
    }
    if (type === 'IDAT') idat.push(data)
    if (type === 'IEND') break
  }
  expectGate(width && height && bitDepth === 8 && colorType === 6, 'Only 8-bit RGBA PNG output is accepted by this gate.', { width, height, bitDepth, colorType })
  const raw = inflateSync(Buffer.concat(idat))
  const rowBytes = width * 4
  const pixels = new Uint8Array(width * height * 4)
  let rawOffset = 0
  let previous = new Uint8Array(rowBytes)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset++]
    const row = new Uint8Array(raw.slice(rawOffset, rawOffset + rowBytes))
    rawOffset += rowBytes
    for (let x = 0; x < row.length; x += 1) {
      const left = x >= 4 ? row[x - 4] : 0
      const up = previous[x] ?? 0
      const upperLeft = x >= 4 ? previous[x - 4] : 0
      if (filter === 1) row[x] = (row[x] + left) & 0xff
      else if (filter === 2) row[x] = (row[x] + up) & 0xff
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 0xff
      else if (filter === 4) row[x] = (row[x] + paeth(left, up, upperLeft)) & 0xff
      else if (filter !== 0) throw new GateFailure(`Unsupported PNG row filter ${filter}.`, { filter, y })
    }
    pixels.set(row, y * rowBytes)
    previous = row
  }
  return { width, height, pixels }
}

function paeth(left, up, upperLeft) {
  const p = left + up - upperLeft
  const pa = Math.abs(p - left)
  const pb = Math.abs(p - up)
  const pc = Math.abs(p - upperLeft)
  return pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft
}

function pixelAt(image, x, y) {
  const index = (y * image.width + x) * 4
  return [...image.pixels.slice(index, index + 4)]
}

function pixelStats(image) {
  const colors = new Set()
  let darkPixels = 0
  for (let index = 0; index < image.pixels.length; index += 4) {
    const color = [...image.pixels.slice(index, index + 4)]
    colors.add(color.join(','))
    if (color[3] > 0 && color[0] < 100 && color[1] < 100 && color[2] < 120) darkPixels += 1
  }
  return { uniqueColors: colors.size, darkPixels }
}

function assertGolden(image, golden) {
  expectEqual(image.width, golden.width, 'PNG golden width changed.')
  expectEqual(image.height, golden.height, 'PNG golden height changed.')
  for (const sample of golden.samples) expectEqual(pixelAt(image, sample.x, sample.y), sample.rgba, `PNG golden sample mismatch: ${sample.label}.`)
}

register('core-basic', 'clean-path:preview-pure', 'Preview is a pure function over a semantic snapshot.', 'Human/Agent may preview a standard text-only transaction without commit authority.', 'preview ok; document, revision, history, redo stack, and save state remain byte-identical', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document } = makeCoreFixture()
  const session = new rt.core.PpteSession(document)
  const before = JSON.stringify({ document: session.getDocument(), revision: session.getRevision(), history: session.getHistory(), redo: session.getRedoHistory(), saveState: session.getSaveState() })
  const result = session.preview(ctx.textTransaction(rt, session.getDocument(), session.getRevision(), '纯预览文本', { transactionId: 'bb-core-preview' }))
  ctx.expectNoErrors(result, 'A valid text-only preview must succeed.')
  const after = JSON.stringify({ document: session.getDocument(), revision: session.getRevision(), history: session.getHistory(), redo: session.getRedoHistory(), saveState: session.getSaveState() })
  ctx.expectEqual(after, before, 'Preview changed Session state.')
  return { proposedRevision: result.proposedRevision, stateUnchanged: after === before }
})

register('core-basic', 'clean-path:ime-no-submit', 'IME composition does not submit a transaction.', 'While composition is active, the editor may update private local text but must not reach Session.commit.', 'finish() returns no transaction while composing, and local composition remains local', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document } = makeCoreFixture()
  const editor = new rt.richtext.ImeTextEditSession(clone(document.slides[IDS.slide].elements[IDS.title]), IDS.slide)
  editor.beginComposition()
  editor.updateComposition(richText('拼音 composing', 'bb-ime-private'))
  const transactionWhileComposing = editor.finish('bb-ime-no-submit', 'sha256-' + '0'.repeat(64))
  ctx.expectEqual(transactionWhileComposing, undefined, 'IME composition submitted before compositionend.')
  ctx.expectEqual(textContent({ content: editor.getLocalContent() }), '拼音 composing', 'Private IME content was not retained locally.')
  return { composing: editor.isComposing(), submitted: transactionWhileComposing !== undefined }
})

register('core-basic', 'clean-path:ime-one-transaction', 'A completed IME edit becomes one semantic transaction.', 'Human editor commits after compositionend; the adapter owns the transaction boundary.', 'exactly one text.replaceContent operation commits and one history entry is created', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document } = makeCoreFixture()
  const session = new rt.core.PpteSession(document)
  const editor = new rt.richtext.ImeTextEditSession(clone(document.slides[IDS.slide].elements[IDS.title]), IDS.slide)
  editor.beginComposition()
  editor.updateComposition(richText('经营回顾（组合输入）', 'bb-ime-complete'))
  editor.endComposition()
  const edit = editor.finish('bb-ime-one-transaction', session.getRevision(), '2026-09-03T00:00:00.000Z')
  ctx.expectGate(Boolean(edit), 'Compositionend must produce a transaction.')
  ctx.expectEqual(edit.operations.map((operation) => operation.kind), ['text.replaceContent'], 'IME edit emitted more than one semantic operation.')
  const result = session.commit(edit)
  ctx.expectNoErrors(result, 'Completed IME transaction must commit.')
  ctx.expectEqual(session.getHistory().length, 1, 'Completed IME edit did not create exactly one history entry.')
  ctx.expectEqual(textOf(session.getDocument(), IDS.title), '经营回顾（组合输入）', 'Committed IME text is not exact.')
  return { operations: edit.operations.length, history: session.getHistory().length, text: textOf(session.getDocument(), IDS.title) }
})

register('core-basic', 'clean-path:session-undo-redo', 'Undo and redo are exact within one Session.', 'Human edits are committed in one Session; undo/redo must traverse that Session history.', 'content, geometry, and metadata commits undo and redo in exact reverse/forward order', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document } = makeCoreFixture()
  const session = new rt.core.PpteSession(document)
  const agent = new rt.agent.MockAgent()
  const snapshots = [clone(session.getDocument())]
  const first = session.commit(agent.createTextReplaceTransaction(session.getDocument(), session.getRevision(), IDS.slide, IDS.title, richText('第一版标题', 'bb-undo-1'), 'bb-undo-1'))
  ctx.expectNoErrors(first, 'First history entry must commit.')
  snapshots.push(clone(session.getDocument()))
  const second = session.commit(transaction({
    id: 'bb-undo-2',
    baseRevision: session.getRevision(),
    scope: scope('selection', ['geometry'], { elementIds: [IDS.image] }),
    contract: broadContract(['element.move'], { allowedElementIds: [IDS.image], maxChangedElements: 1, preserve: { content: 'preserve', data: 'preserve', style: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' } }),
    operations: [{ opId: 'bb-undo-2:move', kind: 'element.move', slideId: IDS.slide, elementId: IDS.image, x: 1180, y: 290 }],
  }))
  ctx.expectNoErrors(second, 'Second geometry history entry must commit.')
  snapshots.push(clone(session.getDocument()))
  const third = session.commit(transaction({
    id: 'bb-undo-3',
    baseRevision: session.getRevision(),
    scope: scope('document', ['structure']),
    contract: broadContract(['document.updateMetadata'], { maxChangedElements: 0 }),
    operations: [{ opId: 'bb-undo-3:metadata', kind: 'document.updateMetadata', patch: { title: '第三版元数据标题' } }],
  }))
  ctx.expectNoErrors(third, 'Third metadata history entry must commit.')
  snapshots.push(clone(session.getDocument()))
  const undoRevisions = []
  for (let index = 2; index >= 0; index -= 1) {
    const result = session.undo()
    ctx.expectNoErrors(result, `Undo ${index + 1} must succeed in the same Session.`)
    ctx.expectEqual(JSON.stringify(session.getDocument()), JSON.stringify(snapshots[index]), `Undo ${index + 1} did not restore the exact snapshot.`)
    ctx.expectEqual(session.getRevision(), rt.canonical.canonicalRevision(snapshots[index]), `Undo ${index + 1} revision is not the restored snapshot revision.`)
    undoRevisions.push(session.getRevision())
  }
  for (let index = 1; index <= 3; index += 1) {
    const result = session.redo()
    ctx.expectNoErrors(result, `Redo ${index} must succeed in the same Session.`)
    ctx.expectEqual(JSON.stringify(session.getDocument()), JSON.stringify(snapshots[index]), `Redo ${index} did not restore the exact committed snapshot.`)
  }
  return { undoRevisions, history: session.getHistory().length, redo: session.getRedoHistory().length }
})

register('core-basic', 'clean-path:checkpoint-atomic', 'Checkpoint replacement is atomic and old files remain readable.', 'A human save may fault before rename; readers must see either the old complete archive or the new complete archive.', 'fault before rename leaves the old checkpoint readable at its original revision', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  await ctx.withTempDirectory(async (directory) => {
    const { document, imageBytes } = makeCoreFixture()
    const target = join(directory, 'atomic.ppte')
    const initial = rt.file.writeCheckpoint(document, target, { clean: true, assetBytes: { [IDS.asset]: imageBytes }, timestamp: '2026-09-03T00:00:00.000Z' })
    let faultMessage
    try {
      const changed = clone(document)
      changed.metadata.title = '应该在下一次完整替换中出现'
      rt.file.writeCheckpoint(changed, target, { clean: true, assetBytes: { [IDS.asset]: imageBytes }, timestamp: '2026-09-03T00:00:01.000Z', fault: 'before-rename' })
    } catch (cause) {
      faultMessage = cause instanceof Error ? cause.message : String(cause)
    }
    ctx.expectGate(faultMessage?.includes('CHECKPOINT_FAULT'), 'Fault injection did not stop before rename.', faultMessage)
    const opened = rt.file.openCheckpoint(target)
    ctx.expectEqual(opened.manifest.contentRevision, initial.revision, 'Old checkpoint was not readable after failed replacement.')
    ctx.expectEqual(opened.document.metadata.title, document.metadata.title, 'Failed replacement exposed a partial/new checkpoint.')
    return { revision: opened.manifest.contentRevision, faultMessage }
  })
  return { atomic: true }
})

register('core-basic', 'clean-path:special-text-roundtrip', 'Special text round-trips byte-for-byte through the semantic file.', 'Human text may contain CJK, emoji, tags, ampersands, and literal script text; file serialization must preserve it exactly.', 'checkpoint reopen and derived HTML preserve the exact UTF-8 text while escaping markup', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  await ctx.withTempDirectory(async (directory) => {
    const { document, imageBytes } = makeCoreFixture()
    const value = '中文 😀 </script> & <tag> — byte round-trip'
    const session = new rt.core.PpteSession(document)
    const result = session.commit(ctx.textTransaction(rt, session.getDocument(), session.getRevision(), value, { transactionId: 'bb-special-text' }))
    ctx.expectNoErrors(result, 'Special text transaction must commit.')
    const target = join(directory, 'special.ppte')
    rt.file.writeCheckpoint(session.getDocument(), target, { clean: true, assetBytes: { [IDS.asset]: imageBytes }, timestamp: '2026-09-03T00:00:00.000Z' })
    const reopened = rt.file.openCheckpoint(target)
    ctx.expectEqual(textOf(reopened.document, IDS.title), value, 'Special text changed during checkpoint round-trip.')
    ctx.expectEqual([...new TextEncoder().encode(textOf(reopened.document, IDS.title))], [...new TextEncoder().encode(value)], 'UTF-8 bytes changed during round-trip.')
    const html = rt.renderer.renderSlideHtml(reopened.document, IDS.slide)
    ctx.expectGate(html.includes('&lt;/script&gt;') && !html.includes('</script>'), 'Derived HTML did not safely escape literal script text.', html)
    return { text: textOf(reopened.document, IDS.title), escaped: html.includes('&lt;/script&gt;') }
  })
  return { roundTrip: true }
})

register('core-basic', 'clean-path:agent-text-scope', 'The standard text-only Agent transaction enforces its Scope.', 'Agent receives a selection Scope for the title and may replace only that title text.', 'commit succeeds, title changes, and body/image/shape remain unchanged', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document } = makeCoreFixture()
  const session = new rt.core.PpteSession(document)
  const before = clone(session.getDocument())
  const result = session.commit(ctx.textTransaction(rt, session.getDocument(), session.getRevision(), 'Agent 只改标题', { transactionId: 'bb-agent-text-scope' }))
  ctx.expectNoErrors(result, 'Standard text-only Agent transaction must commit.')
  const after = session.getDocument()
  ctx.expectEqual(textOf(after, IDS.title), 'Agent 只改标题', 'Agent title edit was not applied.')
  ctx.expectEqual(after.slides[IDS.slide].elements[IDS.body], before.slides[IDS.slide].elements[IDS.body], 'Agent text Scope leaked into body.')
  ctx.expectEqual(after.slides[IDS.slide].elements[IDS.image], before.slides[IDS.slide].elements[IDS.image], 'Agent text Scope leaked into image.')
  ctx.expectEqual(after.slides[IDS.slide].elements[IDS.surface], before.slides[IDS.slide].elements[IDS.surface], 'Agent text Scope leaked into shape.')
  return { changedElement: IDS.title, bodyUnchanged: true, imageUnchanged: true, surfaceUnchanged: true }
})

register('agent-scope', '7', 'Generic slide.update cannot bypass a narrow Agent Scope.', 'Agent is authorized for title content only; a generic slide.update attempts to mutate the body.', 'preview rejects the body mutation with a scope/contract error', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document } = makeCoreFixture()
  const body = clone(document.slides[IDS.slide].elements[IDS.body])
  body.content = richText('越权写入的正文', 'bb-out-of-scope-body')
  const result = new rt.core.PpteSession(document).preview(ctx.transaction({
    id: 'bb-finding-7',
    baseRevision: rt.canonical.canonicalRevision(document),
    scope: ctx.scope('selection', ['structure'], { slideIds: [IDS.slide], elementIds: [IDS.title] }),
    contract: ctx.broadContract(['slide.update'], { maxChangedSlides: 1, maxChangedElements: 1 }),
    operations: [{ opId: 'bb-finding-7:update', kind: 'slide.update', slideId: IDS.slide, patch: { elements: { ...document.slides[IDS.slide].elements, [IDS.body]: body } } }],
  }))
  ctx.expectGate(result.ok === false, 'Generic slide.update bypassed the title-only Agent Scope.', result)
  return { ok: result.ok, issueCodes: result.issues.map((issue) => issue.code) }
})

register('agent-scope', '8', 'Selection regeneration changes the selected semantic object.', 'Agent selection contains only the title; regeneration must preserve body, image, and surface.', 'generated transaction targets the title and does not delete or replace non-selected elements', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document } = makeCoreFixture()
  const server = new rt.agent.AgentToolServer(new rt.core.PpteSession(document, { runtimeProfile: 'ga-b' }), {
    selection: { slideId: IDS.slide, elementIds: [IDS.title] },
  })
  const result = server.execute('regenerate_selection', { requireConfirmation: false, reason: 'Finding 8 selected-title regeneration' })
  ctx.expectGate(Boolean(result.transaction), 'Selection regeneration did not return a transaction.', result)
  const operations = result.transaction.operations
  const nonSelected = [IDS.surface, IDS.body, IDS.image]
  ctx.expectGate(!operations.some((operation) => nonSelected.includes(operation.elementId) || operation.kind === 'slide.setReadingOrder' && operation.readingOrder.some((id) => nonSelected.includes(id))), 'Selection regeneration touched a non-selected element.', operations)
  ctx.expectGate(operations.some((operation) => operation.elementId === IDS.title || operation.element?.semanticKey === 'title.main'), 'Selection regeneration did not target the selected title.', operations)
  return { ok: result.ok, operationKinds: operations.map((operation) => operation.kind), operationCount: operations.length }
})

register('agent-scope', '9', 'Regeneration carries edit policy and semantic references forward.', 'Agent regeneration is authorized to replace a slide but must retain title protection and body Fact/Source references.', 'replacement elements retain preserveOnRegenerate and semanticRefs from the source snapshot', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document } = makeCoreFixture()
  const server = new rt.agent.AgentToolServer(new rt.core.PpteSession(document, { runtimeProfile: 'ga-b' }))
  const result = server.execute('regenerate_slide', { slideId: IDS.slide, requireConfirmation: false, reason: 'Finding 9 provenance preservation' })
  ctx.expectGate(Boolean(result.transaction), 'Regeneration did not return a transaction.', result)
  const inserted = result.transaction.operations.filter((operation) => operation.kind === 'element.insert').map((operation) => operation.element)
  const title = inserted.find((element) => element.semanticKey === 'title.main')
  const body = inserted.find((element) => element.semanticKey === 'body.summary')
  ctx.expectGate(title?.editPolicy?.preserveOnRegenerate === true, 'Generated title lost preserveOnRegenerate policy.', inserted)
  ctx.expectGate(body?.semanticRefs?.factIds?.includes('revenue') && body?.semanticRefs?.sourceIds?.includes('source.report'), 'Generated body lost Fact/Source semantic references.', inserted)
  return { inserted: inserted.map((element) => ({ id: element.id, semanticKey: element.semanticKey, hasPolicy: Boolean(element.editPolicy), refs: element.semanticRefs ?? null })) }
})

register('agent-scope', '10', 'Regeneration consumes the caller-supplied Slide IR.', 'Agent supplies an explicit Slide IR with a cautious Chinese title; the compiler must use that request.', 'returned draft/transaction contains the supplied IR title rather than inferred current text', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document } = makeCoreFixture()
  const server = new rt.agent.AgentToolServer(new rt.core.PpteSession(document, { runtimeProfile: 'ga-b' }))
  const supplied = makeSlideIR()
  const result = server.execute('regenerate_slide', { slideId: IDS.slide, slideIR: supplied, requireConfirmation: false, reason: 'Finding 10 supplied IR' })
  const serialized = JSON.stringify({ data: result.data, transaction: result.transaction })
  ctx.expectGate(serialized.includes('谨慎表达的新标题'), 'Regeneration ignored the supplied Slide IR.', { result, supplied })
  return { suppliedTitleUsed: true, resultOk: result.ok }
})

register('agent-scope', '12', 'Text fit is measured against the actual fixed frame.', 'Agent may reduce the title font to the requested minimum, but the committed result must not retain TEXT_OVERFLOW.', 'fit transaction commits only when the measured result fits, with no overflow warning afterward', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const document = makeOverflowDocument()
  const session = new rt.core.PpteSession(document, { runtimeProfile: 'ga-b' })
  const result = session.commit(ctx.transaction({
    id: 'bb-finding-12',
    baseRevision: session.getRevision(),
    scope: ctx.scope('selection', ['style'], { slideIds: [IDS.slide], elementIds: [IDS.title] }),
    contract: ctx.broadContract(['text.fitByReducingFont'], { allowedElementIds: [IDS.title], maxChangedElements: 1, preserve: { content: 'preserve', geometry: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' } }),
    operations: [{ opId: 'bb-finding-12:fit', kind: 'text.fitByReducingFont', slideId: IDS.slide, elementId: IDS.title, minFontSize: 1, resolvedFontSize: 63 }],
  }))
  const remaining = rt.validation.validateRuntimeDocument(session.getDocument()).filter((issue) => issue.code === 'TEXT_OVERFLOW')
  ctx.expectGate(result.ok === true && remaining.length === 0 && !result.issues.some((issue) => issue.code === 'TEXT_OVERFLOW'), 'Fit committed while the measured text still overflowed.', { result, remaining })
  return { remainingOverflow: remaining.length, revision: session.getRevision() }
})

register('agent-scope', '13', 'Image replacement consumes the declared replacement budget.', 'Agent is authorized for the image but the transaction declares maxReplacedAssets=0.', 'preview rejects one semantic asset replacement as a mutation-budget violation', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document, imageBytes, newBytes } = ctx.fixtureWithNewAsset()
  const session = new rt.core.PpteSession(document, { runtimeProfile: 'ga-b' })
  const replacement = clone(document.slides[IDS.slide].elements[IDS.image])
  replacement.id = 'bb_image_replacement'
  replacement.assetId = IDS.assetNew
  replacement.provenance = { kind: 'generated', replacesElementId: IDS.image, sourceSemanticKey: replacement.semanticKey }
  const result = session.preview(ctx.transaction({
    id: 'bb-finding-13',
    baseRevision: session.getRevision(),
    scope: ctx.scope('selection', ['assets', 'structure'], { slideIds: [IDS.slide], elementIds: [IDS.image, replacement.id], allowInsert: true, allowDelete: true }),
    contract: ctx.broadContract(['element.delete', 'element.insert'], { allowedElementIds: [IDS.image, replacement.id], maxChangedElements: 1, maxInsertedElements: 1, maxDeletedElements: 1, maxReplacedAssets: 0, preserve: { content: 'preserve', geometry: 'preserve', style: 'preserve', semanticIdentity: 'allow-replacement', readingOrder: 'preserve', facts: 'preserve' } }),
    operations: [
      { opId: 'bb-finding-13:delete', kind: 'element.delete', slideId: IDS.slide, elementId: IDS.image },
      { opId: 'bb-finding-13:insert', kind: 'element.insert', slideId: IDS.slide, element: replacement, index: 3 },
    ],
  }))
  ctx.expectGate(result.ok === false && result.issues.some((issue) => issue.code === 'MUTATION_BUDGET_EXCEEDED'), 'Asset replacement escaped the declared replacement budget.', { result, bytes: { old: imageBytes.length, new: newBytes.length } })
  return { ok: result.ok, issueCodes: result.issues.map((issue) => issue.code) }
})

register('agent-scope', '14', 'Fact synchronization is safe when the prior display is absent.', 'Fact sync targets the body with a previous value that is not present; it must not overwrite unrelated runs.', 'transaction rejects or leaves the original display untouched when no safe prior-value match exists', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document } = makeChartFixture()
  const session = new rt.core.PpteSession(document, { runtimeProfile: 'ga-b' })
  const before = textOf(session.getDocument(), IDS.body)
  const result = session.commit(ctx.transaction({
    id: 'bb-finding-14',
    baseRevision: session.getRevision(),
    scope: ctx.scope('slide', ['facts', 'content'], { slideIds: [IDS.slide], elementIds: [IDS.body] }),
    contract: ctx.broadContract(['fact.syncReferences'], { allowedElementIds: [IDS.body], maxChangedElements: 1, maxChangedFacts: 0, preserve: { geometry: 'preserve', style: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' } }),
    operations: [{ opId: 'bb-finding-14:sync', kind: 'fact.syncReferences', factId: 'revenue', targetElementIds: [IDS.body], strategy: 'replace-display-value', previousValue: 999 }],
  }))
  const after = textOf(session.getDocument(), IDS.body)
  ctx.expectGate(result.ok === false || after === before, 'Fact sync overwrote the first run despite no matching prior display.', { result, before, after })
  return { ok: result.ok, before, after }
})

register('lock-undo', '5', 'Lock then immediate undo is legal and exact.', 'Human locks a title and immediately invokes Session.undo.', 'lock commit and inverse undo both succeed; title returns to its unlocked state', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document } = makeCoreFixture()
  const session = new rt.core.PpteSession(document, { runtimeProfile: 'ga-b' })
  const commit = session.commit(ctx.transaction({
    id: 'bb-finding-5',
    baseRevision: session.getRevision(),
    scope: ctx.scope('selection', ['structure'], { slideIds: [IDS.slide], elementIds: [IDS.title] }),
    contract: ctx.broadContract(['element.setLocked'], { allowedElementIds: [IDS.title], maxChangedElements: 1 }),
    operations: [{ opId: 'bb-finding-5:lock', kind: 'element.setLocked', slideId: IDS.slide, elementId: IDS.title, locked: true }],
  }))
  ctx.expectNoErrors(commit, 'Lock transaction must commit.')
  const undo = session.undo()
  ctx.expectNoErrors(undo, 'Immediate undo of a lock transaction must succeed.')
  ctx.expectGate(session.getDocument().slides[IDS.slide].elements[IDS.title].locked !== true, 'Undo left the title locked.', session.getDocument().slides[IDS.slide].elements[IDS.title])
  return { commit: commit.ok, undo: undo.ok, lockedAfterUndo: session.getDocument().slides[IDS.slide].elements[IDS.title].locked ?? false }
})

register('lock-undo', '6', 'A locked logical group cannot move through a member-only transaction.', 'Human requests group movement while the group itself is locked; all member geometry must remain unchanged.', 'preview rejects group.move with a lock/edit-policy issue', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document } = makeCoreFixture()
  document.slides[IDS.slide].groups = { bb_locked_group: { id: 'bb_locked_group', memberIds: [IDS.title, IDS.body], locked: true } }
  const session = new rt.core.PpteSession(document, { runtimeProfile: 'ga-b' })
  const result = session.preview(ctx.transaction({
    id: 'bb-finding-6',
    baseRevision: session.getRevision(),
    scope: ctx.scope('slide', ['geometry'], { slideIds: [IDS.slide], elementIds: [IDS.title, IDS.body] }),
    contract: ctx.broadContract(['group.move'], { allowedElementIds: [IDS.title, IDS.body], maxChangedElements: 2, preserve: { content: 'preserve', style: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' } }),
    operations: [{ opId: 'bb-finding-6:move', kind: 'group.move', slideId: IDS.slide, groupId: 'bb_locked_group', dx: 20, dy: 20 }],
  }))
  ctx.expectGate(result.ok === false && result.issues.some((issue) => issue.code === 'EDIT_POLICY_VIOLATION'), 'Locked group movement was accepted.', result)
  return { ok: result.ok, issueCodes: result.issues.map((issue) => issue.code) }
})

register('host', '1', 'A real Product Host exposes the first-user editing journey.', 'A new user opens a local document in Chromium and must be able to select/edit text, import an image, and save.', 'file:// Host exposes contenteditable text, file input, and a save control', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  await ctx.withTempDirectory(async (directory) => {
    const { document } = makeCoreFixture()
    const path = ctx.writeFixtureHtml(directory, 'host.html', rt.renderer.renderReferenceHostHtml(document, { includeDiagnostics: true }))
    await ctx.withBrowser(path, async (page) => {
      const controls = await page.evaluate(() => ({
        contenteditable: document.querySelectorAll('[contenteditable="true"]').length,
        fileInputs: document.querySelectorAll('input[type="file"]').length,
        save: document.querySelectorAll('[data-ppte-action="save"],button[aria-label*="ave" i],button').length,
      }))
      ctx.expectGate(controls.contenteditable > 0 && controls.fileInputs > 0 && controls.save > 0, 'Host is missing an editing/upload/save surface.', controls)
      return controls
    })
  })
  return { fileUrl: true }
})

register('host', '2', 'The browser computes valid slide-space layout.', 'A user opens the reference preview in Chromium; rendered geometry must be visible and proportional.', 'slide has nonzero computed size and title has nonzero position/font size derived from DU', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  await ctx.withTempDirectory(async (directory) => {
    const { document } = makeCoreFixture()
    const path = ctx.writeFixtureHtml(directory, 'computed-style.html', rt.renderer.renderSlideHtml(document, IDS.slide))
    const computed = await ctx.withBrowser(path, async (page) => page.evaluate(() => {
      const slide = document.querySelector('.ppte-slide')
    const title = document.querySelector('[data-ppte-element-id="bb_text_title"]')
      if (!slide || !title) return { missing: true }
      const slideStyle = getComputedStyle(slide)
      const titleStyle = getComputedStyle(title)
      const slideRect = slide.getBoundingClientRect()
      const titleRect = title.getBoundingClientRect()
      return { width: slideStyle.width, height: slideStyle.height, titleLeft: titleStyle.left, titleTop: titleStyle.top, titleFontSize: titleStyle.fontSize, slideRect: { width: slideRect.width, height: slideRect.height }, titleRect: { left: titleRect.left, top: titleRect.top, width: titleRect.width, height: titleRect.height } }
    }))
    ctx.expectGate(!computed.missing && Number.parseFloat(computed.height) > 0 && Number.parseFloat(computed.titleLeft) > 0 && Number.parseFloat(computed.titleTop) > 0 && Number.parseFloat(computed.titleFontSize) > 20, 'Browser computed styles do not represent the semantic DU layout.', computed)
    return computed
  })
  return { computed: true }
})

register('pages-notes-animation', '3', 'Notes updates use the notes permission.', 'Human/Agent receives only notes permission and updates speaker notes without structure authority.', 'notes transaction commits and changes only slide.notes', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document } = makeCoreFixture()
  const session = new rt.core.PpteSession(document, { runtimeProfile: 'ga-b' })
  const notes = { speaker: '发言备注', handout: '公开讲义' }
  const result = session.commit(ctx.transaction({
    id: 'bb-finding-3',
    baseRevision: session.getRevision(),
    scope: ctx.scope('slide', ['notes'], { slideIds: [IDS.slide] }),
    contract: ctx.broadContract(['slide.update'], { maxChangedElements: 0, maxChangedSlides: 1 }),
    operations: [{ opId: 'bb-finding-3:notes', kind: 'slide.update', slideId: IDS.slide, patch: { notes } }],
  }))
  ctx.expectNoErrors(result, 'Notes-only transaction must commit with notes permission.')
  ctx.expectEqual(session.getDocument().slides[IDS.slide].notes, notes, 'Notes-only transaction did not persist notes.')
  return { ok: result.ok, notes: session.getDocument().slides[IDS.slide].notes }
})

register('pages-notes-animation', '4', 'Transition and element animation metadata are executable renderer inputs.', 'Presenter/Portable renderer receives a fade transition and a stepped element animation.', 'derived HTML exposes transition and animation behavior markers, not only appearStep', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document } = makeCoreFixture()
  document.slides[IDS.slide].transition = { type: 'fade', durationMs: 250, direction: 'left' }
  document.slides[IDS.slide].elements[IDS.title].appearStep = 2
  document.slides[IDS.slide].elements[IDS.title].animation = { enter: { type: 'fade', durationMs: 180, easing: 'ease-out' } }
  const html = rt.renderer.renderSlideHtml(document, IDS.slide)
  ctx.expectGate(html.includes('data-ppte-transition') && html.includes('data-ppte-animation'), 'Renderer emitted no executable transition/animation markers.', html)
  return { hasTransitionMarker: html.includes('data-ppte-transition'), hasAnimationMarker: html.includes('data-ppte-animation'), hasAppearStep: html.includes('data-ppte-appear-step="2"') }
})

register('compiler-quality', '11', 'Compiler rejects AI input that produces key text overflow.', 'AI supplies a valid Slide IR with a deliberately long primary heading; built-in quality rule max-overflow is zero.', 'compileSlide returns a blocking quality issue before materialization', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document } = makeCoreFixture()
  const ir = makeSlideIR()
  ir.blocks[0].content = '这是一个必须由编译器在真实字体度量下拒绝的超长主标题'.repeat(8)
  const draft = rt.compiler.compileSlide(ir, { canvas: document.canvas, theme: document.theme })
  const qualityIssues = draft.validationIssues.filter((issue) => issue.severity === 'error' || issue.code === 'TEXT_OVERFLOW' || issue.code === 'QUALITY_OVERFLOW')
  ctx.expectGate(qualityIssues.length > 0, 'Compiler accepted a key text overflow with no quality issue.', { validationIssues: draft.validationIssues, elementDrafts: draft.elementDrafts })
  return { issueCodes: qualityIssues.map((issue) => issue.code), draftCount: draft.elementDrafts.length }
})

register('portable', '15', 'A generated Portable file is an editable offline surface.', 'User double-clicks a Quick Fix file through file:// and expects text editing, local image input, and save.', 'generated HTML contains an editing surface, file input, and save handler', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  await ctx.withTempDirectory(async (directory) => {
    const { document, imageBytes } = makeCoreFixture()
    const built = rt.portable.createPortableQuickFix(document, { assetBytes: { [IDS.asset]: imageBytes }, derivedAt: '2026-09-03T00:00:00.000Z' })
    ctx.expectGate(built.ok, 'Quick Fix fixture could not be built.', built)
    const path = join(directory, 'quick-fix.ppte.html')
    writeFileSync(path, built.html)
    await ctx.withBrowser(path, async (page) => {
      const controls = await page.evaluate(() => ({
        contenteditable: document.querySelectorAll('[contenteditable="true"]').length,
        fileInputs: document.querySelectorAll('input[type="file"]').length,
        save: document.querySelectorAll('[data-ppte-action="save"]').length,
      }))
      ctx.expectGate(controls.contenteditable > 0 && controls.fileInputs > 0 && controls.save > 0, 'Portable Quick Fix HTML has no editing/save controls.', controls)
      return controls
    })
  })
  return { fileUrl: true }
})

register('portable', '16', 'Portable Quick Fix imports a new local image asset.', 'User selects a new local PNG not present in the source Document; the runtime must validate bytes and atomically add/replace the asset.', 'replaceImage succeeds for a new assetId and advances the semantic revision', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document, imageBytes } = makeCoreFixture()
  const newBytes = alternatePng()
  const runtime = new rt.portable.PortableRuntime(document, { profile: 'quick-fix', assetBytes: { [IDS.asset]: imageBytes, [IDS.assetNew]: newBytes } })
  const before = runtime.getRevision()
  const result = runtime.replaceImage({ slideId: IDS.slide, elementId: IDS.image }, IDS.assetNew)
  ctx.expectGate(result.ok === true && result.revision !== before && runtime.getDocument().assets[IDS.assetNew] !== undefined && runtime.getDocument().slides[IDS.slide].elements[IDS.image].assetId === IDS.assetNew, 'Portable Quick Fix could not import and replace a new local image asset.', { result, before, after: runtime.getRevision(), issues: result.issues })
  return { before, after: runtime.getRevision(), assetId: runtime.getDocument().slides[IDS.slide].elements[IDS.image].assetId }
})

register('portable', '17', 'Portable save preserves the document’s minimum compatibility profile.', 'User edits or opens a GA-B Chart document in Quick Fix and chooses Save as New Project without knowing internal profile names.', 'default save succeeds for a Chart document and returns a checkpoint byte stream', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document, imageBytes } = makeChartFixture()
  const runtime = new rt.portable.PortableRuntime(document, { profile: 'quick-fix', assetBytes: { [IDS.asset]: imageBytes } })
  const saved = runtime.saveAsNewProject({ timestamp: '2026-09-03T00:00:00.000Z' })
  ctx.expectGate(saved.ok === true && saved.bytes instanceof Uint8Array && saved.bytes.length > 0, 'Portable Quick Fix default save rejected its own Chart document.', saved)
  return { ok: saved.ok, bytes: saved.bytes?.length ?? 0 }
})

register('portable', '18', 'Portable unit conversion is scoped to CSS serialization.', 'User opens a self-contained Portable Viewer and reads ordinary text and identifiers exactly as authored.', 'generated HTML has no ordinary-word corruption from DU conversion', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document, imageBytes } = makeCoreFixture()
  const built = rt.portable.createPortableViewer(document, { assetBytes: { [IDS.asset]: imageBytes }, derivedAt: '2026-09-03T00:00:00.000Z' })
  ctx.expectGate(built.ok, 'Portable Viewer fixture could not be built.', built)
  ctx.expectGate(!built.html.includes('Propxct') && !built.html.includes('epxcation') && built.html.includes('Product education module'), 'Portable conversion corrupted ordinary text.', { corruption: built.html.match(/Propxct|epxcation/g), hasOriginal: built.html.includes('Product education module') })
  return { originalTextPresent: built.html.includes('Product education module'), corruptedTextPresent: built.html.includes('Propxct') || built.html.includes('epxcation') }
})

register('portable', '19', 'Light Edit is a superset of Quick Fix editing.', 'User opens Light Edit and expects the Quick Fix text/image edits plus Light Edit geometry/chart tools.', 'Light Edit editText and replaceImage both commit through the portable operation boundary', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document, imageBytes } = makeCoreFixture()
  const runtime = new rt.portable.PortableRuntime(document, { profile: 'light-edit', assetBytes: { [IDS.asset]: imageBytes } })
  const textResult = runtime.editText({ slideId: IDS.slide, elementId: IDS.title }, 'Light Edit 文字')
  const imageResult = runtime.replaceImage({ slideId: IDS.slide, elementId: IDS.image }, IDS.asset)
  ctx.expectGate(textResult.ok === true && imageResult.ok === true, 'Light Edit did not expose the Quick Fix text/image editing surface.', { textResult, imageResult })
  return { text: textResult.ok, image: imageResult.ok }
})

register('export', '20', 'PDF preserves Chinese and emoji text.', 'User exports the semantic Document to PDF and inspects extracted text with pdftotext.', 'pdftotext output contains the authored Chinese title and second paragraph without replacement question marks', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  await ctx.withTempDirectory(async (directory) => {
    const { document } = makeExportFixture()
    const exported = rt.pdf.exportPdf(document, { includeNotes: true })
    ctx.expectGate(exported.ok, 'PDF exporter returned a structural failure for the export fixture.', exported)
    const path = join(directory, 'semantic.pdf')
    writeFileSync(path, exported.bytes)
    const extracted = ctx.runPdftotext(path)
    // pdftotext may segment a rotated baseline into multiple layout lines.
    // Ignore layout whitespace, but still require every authored code point in order.
    const normalized = extracted.replace(/\s+/gu, '')
    ctx.expectGate(normalized.includes('年度经营回顾') && normalized.includes('第二段：😀') && !normalized.includes('?'), 'PDF text extraction lost authored Unicode content.', { extracted, normalized })
    return { extracted }
  })
  return { pdftotext: true }
})

register('export', '21', 'PNG contains semantic text/image pixels and matches the pixel golden.', 'User exports a 32×18 preview and acceptance checks non-flat pixels, dark text pixels, and exact golden samples.', 'PNG is non-flat, contains dark text pixels, and matches blackbox-goldens.json', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document } = makeExportFixture()
  const exported = rt.pdf.exportPng(document, { slideId: IDS.slide, width: 32, height: 18 })
  ctx.expectGate(exported.ok, 'PNG exporter returned a structural failure for the export fixture.', exported)
  const image = ctx.readPng(exported.bytes)
  const stats = ctx.pixelStats(image)
  ctx.expectGate(stats.uniqueColors > 1 && stats.darkPixels > 0, 'PNG output is flat or contains no text-like dark pixels.', stats)
  ctx.assertGolden(image, GOLDENS['png-content-32x18'])
  return { stats, golden: 'png-content-32x18' }
})

register('export', '22', 'Semantic PPTX preserves paragraphs, run formatting, and rotation.', 'User exports a two-paragraph styled text box and opens it with Python python-pptx.', 'python-pptx observes both paragraphs, at least one styled run, and nonzero rotation', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  await ctx.withTempDirectory(async (directory) => {
    const { document, imageBytes } = makeExportFixture()
    const exported = rt.pptx.exportSemanticPptx(document, { assetBytes: { [IDS.asset]: imageBytes } })
    ctx.expectGate(exported.ok, 'Semantic PPTX exporter returned a structural failure.', exported)
    const path = join(directory, 'semantic.pptx')
    writeFileSync(path, exported.bytes)
    const observed = ctx.runPythonPptx(path)
    return observed
  })
  return { pythonPptx: true }
})

register('recovery', '23', 'Open automatically discovers and offers durable Journal recovery.', 'A separate child process commits three text transactions, is SIGKILLed, and the user reopens the old checkpoint.', 'ordinary open/recover path returns the committed Journal revision instead of silently showing the old checkpoint', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  await ctx.withTempDirectory(async (directory) => {
    const childPath = join(ROOT, 'scripts', 'blackbox-crash-child.mjs')
    const child = spawnSync(process.execPath, [childPath, directory], { cwd: ROOT, encoding: 'utf8' })
    const childRaw = `${child.stdout ?? ''}${child.stderr ?? ''}`
    ctx.expectGate(child.signal === 'SIGKILL', 'Crash fixture did not terminate through a real SIGKILL.', { status: child.status, signal: child.signal, childRaw })
    const state = JSON.parse(readFileSync(join(directory, 'child-state.json'), 'utf8'))
    ctx.expectEqual(state.journalRecords, 3, 'Crash fixture did not durably append three Journal records.')
    const opened = rt.file.openCheckpoint(state.checkpointPath)
    const journal = rt.recovery.readJournal(state.journalPath)
    const manualReplay = rt.recovery.replayJournal(opened.document, journal)
    if (opened.manifest.contentRevision !== state.committedRevision) ctx.failGate('Ordinary checkpoint open silently ignored the recoverable Journal tail.', { openedRevision: opened.manifest.contentRevision, committedRevision: state.committedRevision, journalRecords: journal.records.length, manualReplay: { applied: manualReplay.applied, revision: manualReplay.revision, issueCodes: manualReplay.issues.map((issue) => issue.code) } }, childRaw)
    return { openedRevision: opened.manifest.contentRevision, committedRevision: state.committedRevision, manualReplay: manualReplay.applied }
  })
  return { recovered: true }
})

register('recovery', '24', 'Checkpoint recent history restores a usable Session Undo stack.', 'User saves a modified checkpoint, reopens it, and immediately presses Undo.', 'reopened Session has the recent transaction history and undo restores the checkpoint base', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  await ctx.withTempDirectory(async (directory) => {
    const { document, imageBytes } = makeCoreFixture()
    const session = new rt.core.PpteSession(document, { runtimeProfile: 'ga-b' })
    const edit = session.commit(ctx.textTransaction(rt, session.getDocument(), session.getRevision(), '保存后可撤销', { transactionId: 'bb-finding-24' }))
    ctx.expectNoErrors(edit, 'History fixture transaction must commit.')
    const target = join(directory, 'history.ppte')
    rt.file.writeCheckpoint(session.getDocument(), target, { clean: false, recentTransactions: session.getHistory().map((entry) => entry.transaction), assetBytes: { [IDS.asset]: imageBytes }, timestamp: '2026-09-03T00:00:00.000Z' })
    const opened = rt.file.openCheckpoint(target)
    ctx.expectEqual(opened.recentTransactions.length, 1, 'Checkpoint did not contain the declared recent history.')
    const restored = new rt.core.PpteSession(opened.document, { runtimeProfile: 'ga-b' })
    const undo = restored.undo()
    ctx.expectNoErrors(undo, 'Reopened Session Undo stack is empty or unusable.')
    ctx.expectEqual(restored.getRevision(), rt.canonical.canonicalRevision(document), 'Undo after reopen did not restore the checkpoint base revision.')
    return { recentTransactions: opened.recentTransactions.length, undo: undo.ok }
  })
  return { historyRestored: true }
})

register('recovery', '25-CAS', 'Journal replay resolves newly imported asset bytes by hash.', 'Agent imports a new local image after the checkpoint; the durable Journal records its hash and replay has access to the bytes.', 'replay applies asset.upsert plus image replacement instead of reporting ASSET_MISSING', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  await ctx.withTempDirectory(async (directory) => {
    const { document } = makeCoreFixture()
    const newBytes = alternatePng()
    const afterSnapshot = clone(document)
    addAlternateAsset(afterSnapshot, newBytes)
    const asset = afterSnapshot.assets[IDS.assetNew]
    const baseRevision = rt.canonical.canonicalRevision(document)
    const tx = ctx.transaction({
      id: 'bb-finding-25-cas',
      baseRevision,
      scope: ctx.scope('document', ['assets'], { allowInsert: true }),
      contract: ctx.broadContract(['asset.upsert', 'image.replaceAsset'], { maxChangedElements: 1, maxInsertedElements: 0, maxReplacedAssets: 1, preserve: { content: 'preserve', geometry: 'preserve', style: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' } }),
      operations: [
        { opId: 'bb-finding-25-cas:asset', kind: 'asset.upsert', asset },
        { opId: 'bb-finding-25-cas:image', kind: 'image.replaceAsset', slideId: IDS.slide, elementId: IDS.image, assetId: IDS.assetNew, preserveCrop: true },
      ],
    })
    const applied = rt.operations.applyTransaction(document, tx, { runtimeProfile: 'ga-b' })
    const journalPath = join(directory, 'cas.journal')
    const journal = new rt.recovery.RecoveryJournal(journalPath, { journalVersion: '1', documentId: document.documentId, baseCheckpointRevision: baseRevision, sessionId: 'bb-cas-replay', createdAt: '2026-09-03T00:00:00.000Z' })
    journal.append(tx, rt.canonical.canonicalRevision(applied.document), [asset.hash])
    const replay = rt.recovery.replayJournal(document, journal.read())
    ctx.expectGate(replay.applied === 1 && replay.issues.every((issue) => issue.severity !== 'error'), 'Journal replay could not resolve a newly imported asset by hash.', { applied: replay.applied, issueCodes: replay.issues.map((issue) => issue.code), expectedHash: asset.hash })
    return { applied: replay.applied, revision: replay.revision }
  })
  return { casReplay: true }
})

register('recovery', '25-profile', 'Journal replay preserves the checkpoint runtime profile.', 'A GA-C Widget transaction is committed and later replayed; recovery must use GA-C operation semantics.', 'component.updateProps replays successfully without falling back to GA-B', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  await ctx.withTempDirectory(async (directory) => {
    const { document } = makeWidgetFixture()
    const baseRevision = rt.canonical.canonicalRevision(document)
    const tx = ctx.transaction({
      id: 'bb-finding-25-profile',
      baseRevision,
      scope: ctx.scope('document', ['content']),
      contract: ctx.broadContract(['component.updateProps'], { allowedElementIds: [IDS.widget], maxChangedElements: 1, preserve: { geometry: 'preserve', style: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' } }),
      operations: [{ opId: 'bb-finding-25-profile:props', kind: 'component.updateProps', slideId: IDS.slide, elementId: IDS.widget, patch: { code: 'return 43' } }],
    })
    const applied = rt.operations.applyTransaction(document, tx, { runtimeProfile: 'ga-c' })
    const journalPath = join(directory, 'profile.journal')
    const journal = new rt.recovery.RecoveryJournal(journalPath, { journalVersion: '1', documentId: document.documentId, baseCheckpointRevision: baseRevision, sessionId: 'bb-profile-replay', createdAt: '2026-09-03T00:00:00.000Z' })
    journal.append(tx, rt.canonical.canonicalRevision(applied.document))
    const replay = rt.recovery.replayJournal(document, journal.read())
    ctx.expectGate(replay.applied === 1 && replay.document.slides[IDS.slide].elements[IDS.widget].props.code === 'return 43', 'Journal replay used the wrong runtime profile for a Widget transaction.', { applied: replay.applied, issueCodes: replay.issues.map((issue) => issue.code) })
    return { applied: replay.applied, code: replay.document.slides[IDS.slide].elements[IDS.widget].props.code }
  })
  return { profileReplay: true }
})

register('mcp', 'stdio-smoke', 'The published MCP smoke journey uses a real child process.', 'A local GA-C example is checkpointed, opened through MCP, edited through preview→commit, and reopened.', 'scripts/mcp-smoke.mjs exits zero and reports protocol, readonly, and persistence evidence', async (ctx) => {
  await ctx.ensureRuntime()
  const { raw } = runExternal(process.execPath, [join(ROOT, 'scripts', 'mcp-smoke.mjs')])
  ctx.expectGate(raw.includes('MCP smoke OK:'), 'The MCP smoke script did not report a complete green journey.', raw)
  return { smoke: 'green' }
})

register('mcp', 'tools-list', 'MCP tools/list exposes the AgentToolServer contract with schemas.', 'A client initializes a PPTe server and asks for the tool catalog.', 'read tools, preview, commit, and every tool inputSchema are present', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  await ctx.withTempDirectory(async (directory) => {
    const { document, imageBytes } = makeCoreFixture()
    const target = join(directory, 'tools-list.ppte')
    rt.file.writeCheckpoint(document, target, { clean: true, assetBytes: { [IDS.asset]: imageBytes }, timestamp: '2026-09-04T00:00:00.000Z' })
    const responses = runMcpBatch(target, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'blackbox', version: '1' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ])
    const tools = responses.find((item) => item.id === 2)?.result?.tools ?? []
    const names = new Set(tools.map((tool) => tool.name))
    ctx.expectGate(names.has('inspect_document') && names.has('preview_transaction') && names.has('commit_transaction') && tools.every((tool) => tool.inputSchema?.type === 'object'), 'MCP tool catalog did not mirror the Agent contract or JSON Schema surface.', { names: [...names], tools })
    return { toolCount: tools.length, hasPreview: names.has('preview_transaction'), hasCommit: names.has('commit_transaction') }
  })
  return { protocol: true }
})

register('mcp', 'readonly-persistence', 'Readonly MCP sessions hide mutations while writable sessions persist one Operation.', 'A readonly client must not advertise commit/undo; a writable client previews and commits text.replaceContent, then a fresh process reads the result.', 'mutation filtering and same-path checkpoint persistence are both observable over stdio', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  await ctx.withTempDirectory(async (directory) => {
    const { document, imageBytes } = makeCoreFixture()
    const target = join(directory, 'readonly-and-write.ppte')
    rt.file.writeCheckpoint(document, target, { clean: true, assetBytes: { [IDS.asset]: imageBytes }, timestamp: '2026-09-04T00:00:00.000Z' })
    const readonlyResponses = runMcpBatch(target, [
      { jsonrpc: '2.0', id: 1, method: 'initialize' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'commit_transaction', arguments: {} } },
    ], ['--readonly'])
    const readonlyTools = readonlyResponses.find((item) => item.id === 2)?.result?.tools ?? []
    const readonlyNames = new Set(readonlyTools.map((tool) => tool.name))
    ctx.expectGate(!readonlyNames.has('commit_transaction') && !readonlyNames.has('undo_transaction') && readonlyResponses.find((item) => item.id === 3)?.error?.code === -32602, 'Readonly MCP exposed or accepted a mutation tool.', { readonlyTools, readonlyResponse: readonlyResponses.find((item) => item.id === 3) })

    const inspectionResponses = runMcpBatch(target, [
      { jsonrpc: '2.0', id: 1, method: 'initialize' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'inspect_document', arguments: {} } },
    ])
    const inspected = mcpToolResult(inspectionResponses, 2)
    const transaction = ctx.textTransaction(rt, document, inspected.data.revision, 'MCP black-box edited title', { transactionId: 'bb-mcp-text-replace' })
    const writeResponses = runMcpBatch(target, [
      { jsonrpc: '2.0', id: 1, method: 'initialize' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'preview_transaction', arguments: { transaction } } },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'commit_transaction', arguments: { transaction, confirmed: true } } },
    ])
    const preview = mcpToolResult(writeResponses, 2)
    const committed = mcpToolResult(writeResponses, 3)
    ctx.expectGate(preview.ok && committed.ok, 'MCP preview→commit did not accept text.replaceContent.', { preview, committed })

    const reopenedResponses = runMcpBatch(target, [
      { jsonrpc: '2.0', id: 1, method: 'initialize' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_element', arguments: { slideId: IDS.slide, elementId: IDS.title } } },
    ])
    const reopened = mcpToolResult(reopenedResponses, 2)
    const value = reopened.data?.content?.paragraphs?.[0]?.runs?.[0]?.text
    ctx.expectEqual(value, 'MCP black-box edited title', 'A fresh MCP process did not observe the committed text.', reopened)
    return { readonlyMutationAbsent: true, preview: preview.ok, commit: committed.ok, reopenedText: value }
  })
  return { persisted: true }
})

register('delivery', 'default-mcp-delivery', 'MCP exposes one explicit, default editable delivery contract.', 'A writable MCP client asks for delivery without a profile or output path; a readonly client asks for the same tool.', 'writable delivery returns editable HTML first plus the same-revision .ppte source, while readonly hides and rejects the file mutation', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  await ctx.withTempDirectory(async (directory) => {
    const { document, imageBytes } = makeCoreFixture()
    const target = join(directory, 'default-delivery.ppte')
    rt.file.writeCheckpoint(document, target, { clean: true, assetBytes: { [IDS.asset]: imageBytes }, timestamp: '2026-09-04T00:00:00.000Z' })
    const responses = runMcpBatch(target, [
      { jsonrpc: '2.0', id: 1, method: 'initialize' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'deliver_presentation', arguments: {} } },
    ])
    const tools = responses.find((item) => item.id === 2)?.result?.tools ?? []
    const deliveryTool = tools.find((tool) => tool.name === 'deliver_presentation')
    const delivered = mcpToolResult(responses, 3)
    const htmlPath = delivered.artifacts?.[0]?.path
    ctx.expectGate(deliveryTool && deliveryTool.inputSchema?.additionalProperties === false && !Object.prototype.hasOwnProperty.call(deliveryTool.inputSchema?.properties ?? {}, 'path'), 'MCP delivery schema exposed an arbitrary path or omitted the delivery tool.', { deliveryTool })
    ctx.expectGate(delivered.ok && delivered.effectiveProfile === 'full-portable' && delivered.artifacts?.[0]?.role === 'editable-browser-copy' && delivered.artifacts?.[1]?.role === 'source-project' && delivered.sourceRevision === delivered.artifacts[1].sourceRevision && typeof htmlPath === 'string' && existsSync(htmlPath), 'Default MCP delivery did not return the complete artifact contract.', delivered)
    const html = readFileSync(htmlPath, 'utf8')
    ctx.expectGate(!JSON.stringify(delivered).includes('<!doctype html>') && rt.portable.auditPortableBundle(html).ok && html.includes('data-ppte-deliverable="true"'), 'MCP delivery returned HTML body text or an unauditable artifact.', { delivered, audit: rt.portable.auditPortableBundle(html) })

    const readonly = runMcpBatch(target, [
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'deliver_presentation', arguments: {} } },
    ], ['--readonly'])
    const readonlyTools = readonly.find((item) => item.id === 1)?.result?.tools ?? []
    ctx.expectGate(!readonlyTools.some((tool) => tool.name === 'deliver_presentation') && readonly.find((item) => item.id === 2)?.error?.code === -32602, 'Readonly MCP exposed or accepted deliver_presentation.', { readonlyTools, response: readonly.find((item) => item.id === 2) })
    return { effectiveProfile: delivered.effectiveProfile, artifacts: delivered.artifacts.map((artifact) => artifact.role), sourceRevision: delivered.sourceRevision, htmlBytes: delivered.metrics?.bytes }
  })
  return { default: true }
})

register('delivery', 'file-url-edit-save-reopen-present', 'The primary editable artifact closes the receiver file:// loop.', 'A receiver has only the delivered HTML: open it, edit visible text, save the primary button, reopen the downloaded sibling, and navigate presentation pages.', 'the saved HTML remains a full-portable editable artifact with the edited text and the next page visible after reopen', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  await ctx.withTempDirectory(async (directory) => {
    const fixture = makeDeliveryCorpusFixture()
    const built = rt.portable.buildPortable(fixture.document, { profile: 'full-portable', assetBytes: fixture.assetBytes, derivedAt: '2026-09-04T00:00:00.000Z' })
    ctx.expectGate(built.ok, 'The deterministic delivery corpus could not build as full-portable.', built)
    const sourcePath = join(directory, 'receiver.ppte.html')
    const savedPath = join(directory, 'receiver.saved.editable.ppte.html')
    writeFileSync(sourcePath, built.html)
    const originalBytes = readFileSync(sourcePath)
    let savedRevision
    let savedFilename
    await ctx.withBrowser(sourcePath, async (page) => {
      const controls = await page.evaluate(() => ({
        editable: window.document.querySelectorAll('[contenteditable="true"]').length,
        primaryLabel: window.document.querySelector('button[data-ppte-action="save-portable"]')?.textContent,
        fullscreenLabel: window.document.querySelector('button[data-ppte-action="fullscreen"]')?.textContent,
      }))
      ctx.expectGate(controls.editable > 0 && controls.primaryLabel === '保存可编辑副本 (.ppte.html)' && controls.fullscreenLabel === '开始演示（全屏）', 'Delivered HTML did not expose the visible editable/presentation surface.', controls)
    const title = page.locator('[data-ppte-element-id^="bb_delivery_title_"]').first()
      await title.fill('季度复盘')
      await title.blur()
      await page.waitForFunction(() => (globalThis).PPTEPortable.getDocument().slides.bb_delivery_slide_01.elements.bb_delivery_title_01.content.paragraphs[0].runs[0].text === '季度复盘')
      savedRevision = await page.evaluate(() => (globalThis).PPTEPortable.getRevision())
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('button[data-ppte-action="save-portable"]').click(),
      ])
      savedFilename = download.suggestedFilename()
      await download.saveAs(savedPath)
    })
    ctx.expectGate(/\.editable\.ppte\.html$/.test(savedFilename ?? '') && JSON.stringify(readFileSync(sourcePath)) === JSON.stringify(originalBytes), 'Portable save did not produce a sibling editable filename or changed the original file.', { savedFilename, sourcePath })
    const savedHtml = readFileSync(savedPath, 'utf8')
    const savedPayload = rt.portable.decodePortable(savedHtml)
    ctx.expectGate(rt.portable.auditPortableBundle(savedHtml).ok && savedPayload.origin.profile === 'full-portable' && savedPayload.origin.sourceRevision === savedRevision, 'Downloaded HTML did not retain the editable origin/revision contract.', { origin: savedPayload.origin, savedRevision, audit: rt.portable.auditPortableBundle(savedHtml) })
    let reopenedState
    await ctx.withBrowser(savedPath, async (page) => {
      reopenedState = await page.evaluate(() => ({
        text: (globalThis).PPTEPortable.getDocument().slides.bb_delivery_slide_01.elements.bb_delivery_title_01.content.paragraphs[0].runs[0].text,
        editable: window.document.querySelector('[data-ppte-deliverable="true"]') !== null,
      }))
      await page.locator('button[data-ppte-action="next"]').click()
      await page.waitForFunction(() => Array.from(window.document.querySelectorAll('[data-ppte-slide-id]')).some((slide) => (slide).style.display === 'block' && slide.getAttribute('data-ppte-slide-id') === 'bb_delivery_slide_02'))
    })
    ctx.expectEqual(reopenedState, { text: '季度复盘', editable: true }, 'Reopened editable delivery did not preserve the visible text/editability.', reopenedState)
    return { sourceBytes: originalBytes.length, savedBytes: savedHtml.length, savedFilename, savedRevision, reopenedState, corpusResourceBytes: fixture.resourceBytes }
  })
  return { fileUrl: true }
})

register('delivery', 'preview-cannot-masquerade-as-delivery', 'Read-only previews carry no delivery authority.', 'A client requests render_slide and the renderer legacy wrapper; neither output may be mistaken for an editable delivery artifact.', 'render_slide has deliverable:false, renderer default is read-only, and neither output contains the Portable payload/positive delivery metadata', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document } = makeCoreFixture()
  const session = new rt.core.PpteSession(document)
  const rendered = new rt.agent.AgentToolServer(session).execute('render_slide', { slideId: IDS.slide })
  const fragment = rendered.data
  const surface = rt.renderer.renderDocumentHtml(document)
  const readonly = rt.renderer.renderReadOnlyPresentationHtml(document)
  const reference = rt.renderer.renderReferenceHostHtml(document)
  const observed = {
    tool: { kind: fragment?.kind, deliverable: fragment?.deliverable, hasContenteditable: fragment?.html?.includes('contenteditable="true"') },
    wrapper: { hasPayload: surface.includes('ppte-portable-payload'), hasContenteditable: surface.includes('contenteditable="true"'), hasPositiveDelivery: surface.includes('data-ppte-deliverable="true"') },
    readonlyHasContenteditable: readonly.includes('contenteditable="true"'),
    referenceHasHost: reference.includes('data-ppte-host'),
  }
  ctx.expectGate(rendered.ok && fragment?.kind === 'read-only-preview-fragment' && fragment?.deliverable === false && observed.tool.hasContenteditable === false && !observed.wrapper.hasPayload && !observed.wrapper.hasContenteditable && !observed.wrapper.hasPositiveDelivery && observed.readonlyHasContenteditable === false && observed.referenceHasHost, 'A preview output could still masquerade as a delivery artifact.', observed)
  return observed
})

register('delivery', 'artifact-and-runtime-budget', 'Delivery reports measured artifact and runtime budgets with explicit large-file behavior.', 'A fixed-seed ten-page corpus uses ten different valid noisy PNGs; tests observe all four profiles, reject an oversized artifact/runtime, and retry only with an explicit large-file flag.', 'resource/raw/runtime metrics are recorded, standard full-portable fits 20 MiB, large artifacts fail without HTML, and allowLargePortable retains full profile with a warning', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  await ctx.withTempDirectory(async (directory) => {
    const fixture = makeDeliveryCorpusFixture()
    const profiles = ['viewer', 'quick-fix', 'light-edit', 'full-portable']
    const measurements = profiles.map((profile) => {
      const result = rt.portable.buildPortable(fixture.document, { profile, assetBytes: fixture.assetBytes, derivedAt: '2026-09-04T00:00:00.000Z' })
      return { profile, ok: result.ok, bytes: result.bytes, runtimeBytes: result.runtimeBytes, runtimeGzipBytes: result.runtimeGzipBytes, resourceBytes: result.resourceBytes, budgetBytes: result.budgetBytes }
    })
    ctx.expectGate(measurements.every((item) => item.ok && item.resourceBytes === fixture.resourceBytes && item.runtimeGzipBytes <= item.budgetBytes) && measurements.find((item) => item.profile === 'full-portable').bytes <= 20_971_520, 'The fixed-seed delivery corpus did not meet its measured profile/runtime/raw contract.', { fixtureResourceBytes: fixture.resourceBytes, measurements })
    const sourcePath = join(directory, 'budget.ppte')
    rt.file.writeCheckpoint(fixture.document, sourcePath, { clean: true, assetBytes: fixture.assetBytes, timestamp: '2026-09-04T00:00:00.000Z' })
    const checkpoint = {
      write: (snapshot, target, _options, recentTransactions) => rt.file.writeCheckpoint(snapshot, target, { clean: false, assetBytes: fixture.assetBytes, recentTransactions: recentTransactions ?? [], timestamp: '2026-09-04T00:00:00.000Z' }),
    }
    const session = new rt.core.PpteSession(fixture.document, { checkpoint })
    const baseBuild = (document, options) => rt.portable.buildPortable(document, options)
    const large = rt.delivery.deliverPresentation(session, sourcePath, {}, { build: (document, options) => ({ ...baseBuild(document, options), bytes: 20_971_521 }) })
    ctx.expectGate(!large.ok && large.issues.some((issue) => issue.code === 'DELIVERY_ARTIFACT_LARGE') && !existsSync(join(directory, 'budget.editable.ppte.html')), 'Oversized raw artifact was written or silently downgraded.', large)
    const runtimeLarge = rt.delivery.deliverPresentation(session, sourcePath, {}, { build: (document, options) => ({ ...baseBuild(document, options), runtimeGzipBytes: 3_000_001 }) })
    ctx.expectGate(!runtimeLarge.ok && runtimeLarge.issues.some((issue) => issue.code === 'PORTABLE_BUDGET_EXCEEDED') && !existsSync(join(directory, 'budget.editable.ppte.html')), 'Runtime budget overflow was not a hard delivery failure.', runtimeLarge)
    const allowed = rt.delivery.deliverPresentation(session, sourcePath, { allowLargePortable: true }, { build: (document, options) => ({ ...baseBuild(document, options), bytes: 20_971_521 }) })
    ctx.expectGate(allowed.ok && allowed.effectiveProfile === 'full-portable' && allowed.warnings.length > 0 && existsSync(join(directory, 'budget.editable.ppte.html')), 'allowLargePortable did not explicitly retain full-portable delivery with a warning.', allowed)
    return { fixtureResourceBytes: fixture.resourceBytes, measurements, largeIssueCodes: large.issues.map((issue) => issue.code), runtimeIssueCodes: runtimeLarge.issues.map((issue) => issue.code), allowedWarning: allowed.warnings }
  })
  return { budget: true }
})

register('review-patch', '26', 'Delete-versus-local-edit is an explicit review conflict.', 'Base has a title, local edits it, and the revised copy deletes it; review must protect the local change.', 'comparison returns a conflict/ambiguous unit rather than a clean deleted status', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document: base } = makeCoreFixture()
  const local = clone(base)
  local.slides[IDS.slide].elements[IDS.title].content = richText('本地后来修改的标题', 'bb-local-title')
  const revised = clone(base)
  delete revised.slides[IDS.slide].elements[IDS.title]
  revised.slides[IDS.slide].rootOrder = revised.slides[IDS.slide].rootOrder.filter((id) => id !== IDS.title)
  revised.slides[IDS.slide].readingOrder = revised.slides[IDS.slide].readingOrder.filter((id) => id !== IDS.title)
  const comparison = rt.reviewer.compareDocuments(base, local, revised)
  const titleUnits = comparison.units.filter((unit) => unit.elementId === IDS.title)
  ctx.expectGate(titleUnits.some((unit) => unit.status === 'conflict' || unit.status === 'ambiguous') && comparison.conflicts.length > 0, 'Reviewer classified delete-vs-local-edit as a clean deletion.', { titleUnits, conflicts: comparison.conflicts })
  return { titleStatuses: titleUnits.map((unit) => unit.status), conflicts: comparison.conflicts.length }
})

register('review-patch', '27', 'Reviewer covers persistent slide and element domains.', 'Revised copy changes notes, transition, visual strategy, protected anchors, order, animation, opacity, tags, and description.', 'comparison emits review units for every changed persistent domain', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document: base } = makeCoreFixture()
  const revised = clone(base)
  const slide = revised.slides[IDS.slide]
  slide.notes = { speaker: '修订备注' }
  slide.transition = { type: 'fade', durationMs: 300 }
  slide.visualStrategy = 'structured'
  slide.protectedAnchors = [{ target: { kind: 'semantic', semanticKey: 'title.main' }, preserve: ['content'] }]
  slide.rootOrder = [IDS.surface, IDS.body, IDS.title, IDS.image]
  const title = slide.elements[IDS.title]
  title.appearStep = 2
  title.animation = { enter: { type: 'fade', durationMs: 180 } }
  title.opacity = 0.8
  title.tags = ['revised']
  title.description = '修订后的标题说明'
  const comparison = rt.reviewer.compareDocuments(base, base, revised)
  const unitText = JSON.stringify(comparison.units)
  const required = ['notes', 'transition', 'visualStrategy', 'protectedAnchors', 'rootOrder', 'appearStep', 'animation', 'opacity', 'tags', 'description']
  ctx.expectGate(required.every((field) => unitText.includes(field)), 'Reviewer omitted one or more persistent slide/element domains.', { required, units: comparison.units })
  return { required, unitCount: comparison.units.length }
})

register('review-patch', '27-style', 'Reviewer produces executable operations for paragraph and box style changes.', 'Revised copy changes a text element paragraph alignment; reviewer acceptance must not return a zero-operation style unit.', 'style unit has at least one typed operation', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document: base } = makeCoreFixture()
  const revised = clone(base)
  revised.slides[IDS.slide].elements[IDS.title].paragraphStyle = { align: 'center' }
  const comparison = rt.reviewer.compareDocuments(base, base, revised)
  const styleUnits = comparison.units.filter((unit) => unit.elementId === IDS.title && unit.field === 'style')
  ctx.expectGate(styleUnits.length > 0 && styleUnits.some((unit) => (unit.operations?.length ?? 0) > 0), 'Paragraph/box style change produced a non-executable review unit.', { styleUnits })
  return { styleUnits: styleUnits.map((unit) => ({ status: unit.status, operations: unit.operations?.length ?? 0 })) }
})

register('review-patch', '28-head', 'Patch validation checks the revised head revision.', 'Reviewer creates a patch and an intermediary tampers with manifest.headRevision before validation.', 'tampered headRevision is rejected before patch application', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document: base } = makeCoreFixture()
  const revised = clone(base)
  revised.slides[IDS.slide].elements[IDS.title].content = richText('修订版标题', 'bb-patch-head')
  const patch = new rt.reviewer.PpteReviewer().createPatch(base, revised)
  const tampered = clone(patch)
  tampered.manifest.headRevision = `sha256-${'0'.repeat(64)}`
  const validation = rt.patch.validatePatch(tampered)
  ctx.expectGate(validation.ok === false, 'Patch validation accepted a tampered headRevision.', validation)
  return { ok: validation.ok, issueCodes: validation.issues.map((issue) => issue.code) }
})

register('review-patch', '28-profile', 'Widget patch profile follows the document capability.', 'Reviewer creates a patch for a GA-C core/code Widget without an internal profile override.', 'patch manifest.compatibilityProfile is ppte-2.0-ga-c.1', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document: base } = makeWidgetFixture()
  const revised = clone(base)
  revised.slides[IDS.slide].elements[IDS.widget].props.code = 'return 43'
  const patch = new rt.reviewer.PpteReviewer().createPatch(base, revised)
  ctx.expectEqual(patch.manifest.compatibilityProfile, 'ppte-2.0-ga-c.1', 'Widget patch was labelled with a lower compatibility profile.')
  return { compatibilityProfile: patch.manifest.compatibilityProfile }
})

register('review-patch', '29-literal', 'Patch payloads allow literal script-like text as data.', 'Revised title contains the literal string </script>; patch encoding must preserve it as data.', 'encode/decode succeeds and decoded operation text equals the literal value', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document: base } = makeCoreFixture()
  const revised = clone(base)
  const value = 'Literal </script> 中文 😀'
  revised.slides[IDS.slide].elements[IDS.title].content = richText(value, 'bb-patch-literal')
  const patch = new rt.reviewer.PpteReviewer().createPatch(base, revised)
  const encoded = rt.patch.encodePatch(patch)
  const decoded = rt.patch.decodePatch(encoded)
  const operation = decoded.operations.find((item) => item.kind === 'text.replaceContent')
  ctx.expectEqual(operation.content.paragraphs[0].runs[0].text, value, 'Literal patch text changed after encode/decode.')
  return { bytes: encoded.length, text: operation.content.paragraphs[0].runs[0].text }
})

register('review-patch', '29-code', 'Patch payloads allow the controlled Widget code field.', 'Revised core/code Widget changes props.code; typed patch validation must allow the declared property.', 'encode/decode succeeds for a code Widget property update', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document: base } = makeWidgetFixture()
  const revised = clone(base)
  revised.slides[IDS.slide].elements[IDS.widget].props.code = 'return 43'
  const patch = new rt.reviewer.PpteReviewer().createPatch(base, revised)
  const encoded = rt.patch.encodePatch(patch)
  const decoded = rt.patch.decodePatch(encoded)
  ctx.expectGate(decoded.operations.some((item) => item.kind === 'component.updateProps' && item.patch.code === 'return 43'), 'Code Widget patch did not preserve props.code.', decoded)
  return { bytes: encoded.length, operationKinds: decoded.operations.map((item) => item.kind) }
})

register('review-patch', '30', 'Override debt counts supported new local style fields.', 'Key title adds a valid letterSpacing override absent from its current preset.', 'override report includes letterSpacing and a positive overriddenFields count', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document } = makeCoreFixture()
  document.slides[IDS.slide].elements[IDS.title].style.overrides = { letterSpacing: 7 }
  const report = rt.validation.computeOverrideDebt(document)
  ctx.expectGate(report.overriddenFields > 0 && report.entries.some((entry) => entry.elementId === IDS.title && entry.fields.includes('letterSpacing')), 'Override debt ignored a supported field missing from the preset.', report)
  return report
})

register('review-patch', '31', 'Release evidence is independently verifiable.', 'The GA-C label may not be certified by the same Contract Deck CLI/tests that implement the behavior.', 'legacy e2e:ga-c script no longer points directly to the Contract Deck self-check CLI', async () => {
  const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const script = packageJson.scripts?.['e2e:ga-c'] ?? ''
  expectGate(!script.includes('contract-deck'), 'GA-C release evidence still delegates to the self-certifying Contract Deck CLI.', { script })
  return { script }
})

register('section-41', '§41-A', 'Scenario A: AI new presentation starts in a real Host.', 'The existing Agent turns a source brief into Presentation IR; Host compiles that design into ten distinct editable slides retaining source facts.', 'Host imports genuine Agent-authored IR and renders ten distinct semantic slides retaining source facts in Chromium', async (ctx) => {
  return runHostJourney(ctx)
})

register('section-41', '§41-B', 'Scenario B: human small edit crosses the browser transaction boundary.', 'User double-clicks a text box, enters IME text, sees no intermediate commits, then saves and reopens.', 'Chromium exposes editable text and save/reopen controls for the file journey', async (ctx) => {
  return withHostBrowser(async (page) => {
    await page.locator('[data-ppte-action="new"]').click()
    const title = page.locator('[data-ppte-element-id="text_title"]').first()
    await title.dblclick()
    await title.dispatchEvent('compositionstart')
    await title.fill('B 场景输入法标题')
    const duringComposition = await page.locator('[data-ppte-host]').getAttribute('data-ppte-history-depth')
    ctx.expectEqual(duringComposition, '0', 'IME composition committed before compositionend.')
    await title.dispatchEvent('compositionend')
    await page.waitForFunction(() => document.querySelector('[data-ppte-host]')?.getAttribute('data-ppte-history-depth') === '1')
    const edited = await page.locator('[data-ppte-element-id="text_title"]').first().innerText()
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-ppte-action="save"]').click()])
    const downloadPath = await download.path()
    if (!downloadPath) throw new GateFailure('Scenario B save did not produce a checkpoint download.')
    await page.locator('input[data-ppte-action="open"]').setInputFiles(downloadPath)
    await page.waitForFunction(() => document.querySelector('[data-ppte-status]')?.textContent?.includes('已打开'))
    const undo = page.locator('[data-ppte-action="undo"]')
    const reopenedText = await page.locator('[data-ppte-element-id="text_title"]').first().innerText()
    const undoEnabled = await undo.isEnabled()
    await undo.click()
    await page.waitForFunction(() => document.querySelector('[data-ppte-host]')?.getAttribute('data-ppte-history-depth') === '0')
    const afterUndo = await page.locator('[data-ppte-element-id="text_title"]').first().innerText()
    const observed = { edited, reopenedText, undoEnabled, afterUndo, saveName: download.suggestedFilename() }
    ctx.expectGate(edited === 'B 场景输入法标题' && reopenedText === edited && undoEnabled && afterUndo === 'Untitled presentation', 'Scenario B save/reopen did not preserve and undo the IME edit.', observed)
    return observed
  })
})

register('section-41', '§41-C', 'Scenario C: Flat Group happy path remains exact.', 'Human creates a flat group, moves and resizes it, then undoes geometry without implicit text-style changes.', 'create/move/resize/undo all succeed and restore exact member frames', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document } = makeCoreFixture()
  const session = new rt.core.PpteSession(document, { runtimeProfile: 'ga-b' })
  const create = session.commit(ctx.transaction({
    id: 'bb-41-c-create',
    baseRevision: session.getRevision(),
    scope: ctx.scope('slide', ['structure'], { slideIds: [IDS.slide] }),
    contract: ctx.broadContract(['group.create'], { maxChangedElements: 2, preserve: { content: 'preserve', geometry: 'preserve', style: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' } }),
    operations: [{ opId: 'bb-41-c-create:group', kind: 'group.create', slideId: IDS.slide, group: { id: 'bb_41_c_group', memberIds: [IDS.body, IDS.image] } }],
  }))
  ctx.expectNoErrors(create, 'Flat Group creation failed.')
  const beforeMove = { body: clone(session.getDocument().slides[IDS.slide].elements[IDS.body].frame), image: clone(session.getDocument().slides[IDS.slide].elements[IDS.image].frame) }
  const move = session.commit(ctx.transaction({
    id: 'bb-41-c-move',
    baseRevision: session.getRevision(),
    scope: ctx.scope('slide', ['geometry'], { slideIds: [IDS.slide] }),
    contract: ctx.broadContract(['group.move'], { maxChangedElements: 2, preserve: { content: 'preserve', style: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' } }),
    operations: [{ opId: 'bb-41-c-move:group', kind: 'group.move', slideId: IDS.slide, groupId: 'bb_41_c_group', dx: 30, dy: 20 }],
  }))
  ctx.expectNoErrors(move, 'Flat Group move failed.')
  const beforeResize = { body: clone(session.getDocument().slides[IDS.slide].elements[IDS.body].frame), image: clone(session.getDocument().slides[IDS.slide].elements[IDS.image].frame) }
  const resize = session.commit(ctx.transaction({
    id: 'bb-41-c-resize',
    baseRevision: session.getRevision(),
    scope: ctx.scope('slide', ['geometry'], { slideIds: [IDS.slide] }),
    contract: ctx.broadContract(['group.resize'], { maxChangedElements: 2, preserve: { content: 'preserve', style: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' } }),
    operations: [{ opId: 'bb-41-c-resize:group', kind: 'group.resize', slideId: IDS.slide, groupId: 'bb_41_c_group', targetFrame: { x: 100, y: 100, width: 1500, height: 700 } }],
  }))
  ctx.expectNoErrors(resize, 'Flat Group resize failed.')
  ctx.expectNoErrors(session.undo(), 'Flat Group resize undo failed.')
  ctx.expectEqual({ body: session.getDocument().slides[IDS.slide].elements[IDS.body].frame, image: session.getDocument().slides[IDS.slide].elements[IDS.image].frame }, beforeResize, 'Flat Group resize undo was not exact.')
  ctx.expectNoErrors(session.undo(), 'Flat Group move undo failed.')
  ctx.expectEqual({ body: session.getDocument().slides[IDS.slide].elements[IDS.body].frame, image: session.getDocument().slides[IDS.slide].elements[IDS.image].frame }, beforeMove, 'Flat Group move undo was not exact.')
  return { create: create.ok, move: move.ok, resize: resize.ok, exactUndo: true }
})

register('section-41', '§41-D', 'Scenario D: Agent local edit rejects non-target mutation.', 'Agent is granted title-only scope but submits a generic operation that changes body content.', 'preview rejects the transaction before any non-target mutation can commit', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document } = makeCoreFixture()
  const body = clone(document.slides[IDS.slide].elements[IDS.body])
  body.content = richText('D 场景越权正文', 'bb-41-d')
  const result = new rt.core.PpteSession(document).preview(ctx.transaction({
    id: 'bb-41-d',
    baseRevision: rt.canonical.canonicalRevision(document),
    scope: ctx.scope('selection', ['structure'], { slideIds: [IDS.slide], elementIds: [IDS.title] }),
    contract: ctx.broadContract(['slide.update'], { maxChangedElements: 1 }),
    operations: [{ opId: 'bb-41-d:update', kind: 'slide.update', slideId: IDS.slide, patch: { elements: { ...document.slides[IDS.slide].elements, [IDS.body]: body } } }],
  }))
  ctx.expectGate(result.ok === false, 'Scenario D accepted a generic non-target mutation.', result)
  return { ok: result.ok, issueCodes: result.issues.map((issue) => issue.code) }
})

register('section-41', '§41-E', 'Scenario E: mixed-content reflow returns a reviewable Transaction.', 'Agent requests page reflow for title/body/chart/metric content and expects no object loss.', 'mixed-content layout returns a previewable geometry transaction', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document } = makeChartFixture()
  const server = new rt.agent.AgentToolServer(new rt.core.PpteSession(document, { runtimeProfile: 'ga-b' }))
  const result = server.execute('apply_layout_recipe', { slideId: IDS.slide, requireConfirmation: false, reason: '§41-E mixed content reflow' })
  ctx.expectGate(result.ok === true && Boolean(result.transaction), 'Scenario E could not produce a mixed-content reflow transaction.', result)
  return { ok: result.ok, operationCount: result.transaction?.operations.length ?? 0 }
})

register('section-41', '§41-F', 'Scenario F: visual redesign honors selection direction.', 'Agent selects the title for redesign; all non-selected objects must remain unchanged.', 'redesign transaction only replaces the selected semantic target', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document } = makeCoreFixture()
  const server = new rt.agent.AgentToolServer(new rt.core.PpteSession(document, { runtimeProfile: 'ga-b' }), { selection: { slideId: IDS.slide, elementIds: [IDS.title] } })
  const result = server.execute('regenerate_selection', { requireConfirmation: false })
  ctx.expectGate(Boolean(result.transaction) && result.transaction.operations.every((operation) => ![IDS.surface, IDS.body, IDS.image].includes(operation.elementId)), 'Scenario F redesign changed unselected objects.', result.transaction ?? result)
  return { ok: result.ok, operationCount: result.transaction?.operations.length ?? 0 }
})

register('section-41', '§41-G', 'Scenario G: crash/reopen restores durable work automatically.', 'A real child process is SIGKILLed after three durable commits; reopening the checkpoint must offer those commits.', 'reopen result revision equals the Journal tail revision', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  await ctx.withTempDirectory(async (directory) => {
    const child = spawnSync(process.execPath, [join(ROOT, 'scripts', 'blackbox-crash-child.mjs'), directory], { cwd: ROOT, encoding: 'utf8' })
    const raw = `${child.stdout ?? ''}${child.stderr ?? ''}`
    ctx.expectGate(child.signal === 'SIGKILL', 'Scenario G did not produce a real SIGKILL child.', { signal: child.signal, status: child.status, raw })
    const state = JSON.parse(readFileSync(join(directory, 'child-state.json'), 'utf8'))
    const opened = rt.file.openCheckpoint(state.checkpointPath)
    if (opened.manifest.contentRevision !== state.committedRevision) ctx.failGate('Scenario G reopened the old checkpoint without recovering the Journal tail.', { openedRevision: opened.manifest.contentRevision, committedRevision: state.committedRevision }, raw)
    return { revision: opened.manifest.contentRevision }
  })
  return { recovered: true }
})

register('section-41', '§41-H', 'Scenario H: Portable Quick Fix edits and saves from file://.', 'User double-clicks a generated Quick Fix file, edits text/image, then saves a new project.', 'file:// artifact includes the complete editing and save surface', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  await ctx.withTempDirectory(async (directory) => {
    const { document, imageBytes } = makeCoreFixture()
    const built = rt.portable.createPortableQuickFix(document, { assetBytes: { [IDS.asset]: imageBytes } })
    ctx.expectGate(built.ok, 'Scenario H Quick Fix artifact could not be built.', built)
    const path = join(directory, 'scenario-h.ppte.html')
    writeFileSync(path, built.html)
    await ctx.withBrowser(path, async (page) => {
      const controls = await page.evaluate(() => ({ editable: document.querySelectorAll('[contenteditable="true"]').length, save: document.querySelectorAll('[data-ppte-action="save"]').length }))
      ctx.expectGate(controls.editable > 0 && controls.save > 0, 'Scenario H generated file is read-only.', controls)
      return controls
    })
  })
  return { portableEdit: true }
})

register('section-41', '§41-I', 'Scenario I: revised-copy deletion is reviewable.', 'Local copy edits a title while revised copy deletes it; user must receive a conflict choice.', 'review UI receives a nonzero conflict set', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document: base } = makeCoreFixture()
  const local = clone(base)
  local.slides[IDS.slide].elements[IDS.title].content = richText('I 本地内容', 'bb-41-i-local')
  const revised = clone(base)
  delete revised.slides[IDS.slide].elements[IDS.title]
  revised.slides[IDS.slide].rootOrder = revised.slides[IDS.slide].rootOrder.filter((id) => id !== IDS.title)
  revised.slides[IDS.slide].readingOrder = revised.slides[IDS.slide].readingOrder.filter((id) => id !== IDS.title)
  const comparison = rt.reviewer.compareDocuments(base, local, revised)
  ctx.expectGate(comparison.conflicts.length > 0, 'Scenario I presented a deletion as a conflict-free acceptance.', comparison)
  return { conflicts: comparison.conflicts.length }
})

register('section-41', '§41-J', 'Scenario J: export is visually and semantically faithful.', 'User exports the styled Unicode slide and validates PDF/PNG/PPTX content rather than just file signatures.', 'exported PDF text, PNG pixels, and PPTX properties all pass their independent checks', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document } = makeExportFixture()
  const png = rt.pdf.exportPng(document, { slideId: IDS.slide, width: 32, height: 18 })
  const image = ctx.readPng(png.bytes)
  const stats = ctx.pixelStats(image)
  ctx.expectGate(stats.uniqueColors > 1 && stats.darkPixels > 0, 'Scenario J PNG is flat or missing text pixels.', stats)
  ctx.assertGolden(image, GOLDENS['png-content-32x18'])
  return { png: stats, pdfAndPptx: 'validated by the export group' }
})

register('video-widget', 'GA-C-video-registry', 'GA-C Video Widget is resolved through the controlled registry.', 'A GA-C document contains a Video Widget with a local poster asset; the host must resolve its controlled definition and expose a poster-backed static fallback.', 'registry validation succeeds; rendered widget contains a video surface and a poster/fallback path', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document } = makeVideoWidgetFixture()
  const element = document.slides[IDS.slide].elements[IDS.videoWidget]
  const registry = rt.widgets.createBuiltinWidgetRegistry()
  const validation = rt.widgets.validateWidgetElement(element, registry)
  const rendered = rt.widgets.renderWidgetHtml(element, registry)
  const observed = {
    registered: Boolean(validation.definition),
    valid: validation.ok,
    exportPolicy: validation.definition?.exportPolicy,
    hasVideo: /<video\b/i.test(rendered),
    hasPosterOrFallback: /poster|fallback|<img\b/i.test(rendered),
    rendered,
  }
  ctx.expectGate(observed.valid && observed.registered && observed.exportPolicy === 'static-fallback' && observed.hasVideo && observed.hasPosterOrFallback, 'GA-C Video Widget was not resolved to a controlled poster-capable definition.', observed)
  return { ...observed, rendered: undefined }
})

register('video-widget', 'GA-C-video-roundtrip', 'Video Widget checkpoint round-trip retains the downgrade contract.', 'A user saves and reopens a GA-C Video Widget project, then opens its Light Edit derivative; semantic props/fallback must survive and the derivative must report an actionable static downgrade.', 'checkpoint round-trip preserves Video Widget props/fallback; Light Edit reports static status, reason, recovery, and degraded=true', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document, imageBytes } = makeVideoWidgetFixture()
  const bytes = rt.file.buildCheckpointBytes(document, {
    assetBytes: { [IDS.asset]: imageBytes },
    compatibilityProfile: 'ppte-2.0-ga-c.1',
    timestamp: '2026-09-04T00:00:00.000Z',
  })
  const opened = rt.file.openCheckpointBytes(bytes)
  const reopened = opened.document.slides[IDS.slide].elements[IDS.videoWidget]
  const built = rt.portable.createPortableLightEdit(document, { assetBytes: { [IDS.asset]: imageBytes } })
  const item = built.capabilityReport?.items.find((candidate) => candidate.elementId === IDS.videoWidget)
  const roundTrip = reopened?.type === 'component'
    && reopened.componentType === 'core/video'
    && reopened.props.source === 'media/quarterly-review.mp4'
    && reopened.props.posterAssetId === IDS.asset
    && reopened.fallback.kind === 'asset'
    && reopened.fallback.assetId === IDS.asset
  const observed = {
    roundTrip,
    portableOk: built.ok,
    status: item?.status,
    reason: item?.reason,
    recovery: item?.recovery,
    degraded: built.capabilityReport?.degraded,
  }
  ctx.expectGate(roundTrip && built.ok && item?.status === 'static' && Boolean(item.reason) && Boolean(item.recovery) && built.capabilityReport?.degraded === true, 'Video Widget Light Edit did not expose an actionable static downgrade after checkpoint-compatible round-trip.', observed)
  return observed
})

register('video-widget', 'GA-C-video-export', 'PDF and PNG export a Video poster or report honest degradation.', 'A user exports a GA-C Video Widget with its local poster bytes; each raster export must either contain the poster-capable path or explicitly report the degraded capability.', 'both PDF and PNG are non-empty and each has poster evidence or an element-scoped EXPORT_DEGRADED report', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document, imageBytes } = makeVideoWidgetFixture()
  const assetBytes = { [IDS.asset]: imageBytes }
  const outputs = [
    rt.pdf.exportPdf(document, { assetBytes }),
    rt.pdf.exportPng(document, { slideId: IDS.slide, width: 192, height: 108, assetBytes }),
  ]
  const observed = outputs.map((output) => {
    const item = output.capabilityReport.items.find((candidate) => candidate.elementId === IDS.videoWidget)
    const degraded = output.degraded && output.issues.some((issue) => issue.code === 'EXPORT_DEGRADED' && issue.elementId === IDS.videoWidget)
    const posterPath = output.ok && ['native', 'static'].includes(item?.status)
    return { format: output.format, ok: output.ok, bytes: output.bytes.length, status: item?.status, posterPath, degraded }
  })
  ctx.expectGate(observed.every((output) => output.bytes > 0 && (output.posterPath || output.degraded)), 'Video Widget PDF/PNG output was neither poster-backed nor honestly marked degraded.', observed)
  return observed
})

register('pptx-chart', 'native-chart-parts', 'Semantic bar/line/pie charts become native PPTX chart parts.', 'A user exports semantic Bar, Line, and Pie Chart elements; Python python-pptx must observe native chart shapes, chart parts, categories Q1/Q2, and values 42/38.', 'python-pptx reports at least three native chart shapes/parts and preserves the fixture categories and values', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document, imageBytes } = nativeChartFixture()
  const exported = rt.pptx.exportSemanticPptx(document, { assetBytes: { [IDS.asset]: imageBytes } })
  const exportObserved = { ok: exported.ok, bytes: exported.bytes.length, degraded: exported.degraded, issueCodes: exported.issues.map((issue) => issue.code) }
  ctx.expectGate(exported.ok && exported.bytes.length > 0, 'Semantic PPTX chart fixture could not be exported for native-chart inspection.', exportObserved)
  return ctx.withTempDirectory(async (directory) => {
    const path = join(directory, 'native-charts.pptx')
    writeFileSync(path, exported.bytes)
    return ctx.runPythonNativeChart(path)
  })
})

register('pptx-chart', 'native-chart-capability', 'PPTX capability evidence identifies native charts.', 'The semantic PPTX export advertises its Chart mapping explicitly so a consumer can distinguish a native chart from an SVG picture.', 'capability report includes native-chart=true for every exported semantic Chart', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document, imageBytes } = nativeChartFixture()
  const exported = rt.pptx.exportSemanticPptx(document, { assetBytes: { [IDS.asset]: imageBytes } })
  const chartItems = exported.capabilityReport.items.filter((item) => item.type === 'chart')
  const native = chartItems.length === 3 && chartItems.every((item) => item.nativeChart === true || item['native-chart'] === true)
    || exported.capabilityReport.nativeChart === true
    || exported.capabilityReport['native-chart'] === true
  const observed = { native, reportOk: exported.capabilityReport.ok, reportDegraded: exported.capabilityReport.degraded, chartItems: chartItems.map((item) => ({ id: item.elementId, status: item.status, nativeChart: item.nativeChart, nativeChartDashed: item['native-chart'] })), issueCodes: exported.issues.map((issue) => issue.code) }
  ctx.expectGate(native, 'Semantic PPTX capability report did not declare native-chart=true.', observed)
  return { native, chartCount: chartItems.length }
})

register('full-portable', 'full-portable-bundle', 'full-portable packages the complete editor API.', 'A user chooses profile full-portable and expects multi-selection, Move/Scale/Rotate, Crop, Chart data, undo/redo, and Save as New Project in one self-contained artifact.', 'bundle audit passes for full-portable and the embedded API exposes every full-editor method', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document, imageBytes } = makeChartFixture()
  const built = rt.portable.buildPortable(document, { profile: 'full-portable', assetBytes: { [IDS.asset]: imageBytes } })
  const audit = rt.portable.auditPortableBundle(built.html)
  const requiredMethods = ['select', 'selectMany', 'moveElement', 'resizeElement', 'scaleElement', 'rotateElement', 'cropImage', 'updateChartData', 'undo', 'redo', 'saveAsNewProject']
  const missingMethods = requiredMethods.filter((method) => !built.html.includes(method))
  const observed = { built: built.ok, profile: built.origin?.profile, audit: audit.ok, auditIssueCodes: audit.issues.map((issue) => issue.code), missingMethods }
  ctx.expectGate(built.ok && built.origin?.profile === 'full-portable' && audit.ok && missingMethods.length === 0, 'full-portable bundle is missing the complete editor contract or is rejected by its own audit.', observed)
  return observed
})

register('full-portable', 'full-portable-file-url', 'full-portable executes the complete file:// journey.', 'A user opens a full-portable file locally, invokes its API, and saves a new project; the browser must expose the full method surface.', 'file:// exposes full-portable profile, all required methods, and a successful saveAsNewProject result', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document, imageBytes } = makeChartFixture()
  const built = rt.portable.buildPortable(document, { profile: 'full-portable', assetBytes: { [IDS.asset]: imageBytes } })
  return ctx.withTempDirectory(async (directory) => {
    const path = join(directory, 'full-portable.ppte.html')
    writeFileSync(path, built.html)
    return ctx.withBrowser(path, async (page) => {
      await page.waitForFunction(() => Boolean(globalThis.PPTEPortable))
      const observed = await page.evaluate(() => {
        const api = globalThis.PPTEPortable
        const required = ['select', 'selectMany', 'moveElement', 'resizeElement', 'scaleElement', 'rotateElement', 'cropImage', 'updateChartData', 'undo', 'redo', 'saveAsNewProject']
        const missing = required.filter((method) => typeof api?.[method] !== 'function')
        let saved
        try { saved = api?.saveAsNewProject?.() } catch (error) { saved = { ok: false, error: String(error) } }
        return { profile: api?.origin?.profile, missing, saveOk: saved?.ok === true, saveBytes: saved?.bytes?.length ?? 0 }
      })
      ctx.expectGate(observed.profile === 'full-portable' && observed.missing.length === 0 && observed.saveOk && observed.saveBytes > 0, 'full-portable file:// API did not complete the full editor/save journey.', observed)
      return observed
    })
  })
})

register('group-rotate', 'explicit-member-rotate', 'Group Rotate commits explicit member transforms and exact undo.', 'A human rotates a flat group containing three elements by 90 degrees; the operation must change each member frame/rotation, keep the group flat, and undo byte-exactly.', 'group.rotate commits; all three members receive explicit frame/rotation changes; group has no coordinate-system fields; undo restores the source snapshot', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { document } = makeCoreFixture()
  const slide = document.slides[IDS.slide]
  const groupId = 'bb_group_rotate'
  const memberIds = [IDS.title, IDS.body, IDS.image]
  slide.groups[groupId] = { id: groupId, semanticKey: 'group.rotate.fixture', memberIds: [...memberIds] }
  const before = clone(document)
  const session = new rt.core.PpteSession(document, { runtimeProfile: 'ga-b' })
  const committed = session.commit(ctx.transaction({
    id: 'bb-group-rotate',
    baseRevision: session.getRevision(),
    scope: ctx.scope('selection', ['geometry'], { slideIds: [IDS.slide], elementIds: memberIds }),
    contract: ctx.broadContract(['group.rotate'], { allowedElementIds: memberIds, maxChangedElements: memberIds.length, preserve: { content: 'preserve', data: 'preserve', style: 'preserve', asset: 'preserve', semanticIdentity: 'preserve', readingOrder: 'preserve', facts: 'preserve' } }),
    operations: [{ opId: 'bb-group-rotate:operation', kind: 'group.rotate', slideId: IDS.slide, groupId, rotationDeg: 90 }],
  }))
  ctx.expectGate(committed.ok === true, 'Group Rotate was not accepted as a semantic transaction.', committed)
  const after = session.getDocument()
  const afterSlide = after.slides[IDS.slide]
  const afterGroup = afterSlide.groups[groupId]
  const changedMembers = memberIds.every((elementId) => {
    const original = before.slides[IDS.slide].elements[elementId]
    const current = afterSlide.elements[elementId]
    return JSON.stringify(original.frame) !== JSON.stringify(current.frame) && (current.rotationDeg ?? 0) !== (original.rotationDeg ?? 0)
  })
  const forbiddenGroupFields = ['frame', 'rotationDeg', 'transform', 'coordinateSystem']
  const flatGroup = afterGroup && forbiddenGroupFields.every((field) => !Object.prototype.hasOwnProperty.call(afterGroup, field))
  const rendered = rt.renderer.renderSlideHtml(after, IDS.slide)
  const rendererMembers = memberIds.every((elementId) => {
    const rotation = afterSlide.elements[elementId].rotationDeg ?? 0
    return rendered.includes(`data-ppte-element-id="${elementId}"`) && rendered.includes(`transform:rotate(${rotation}deg)`)
  })
  const undo = session.undo()
  const exactUndo = undo.ok && JSON.stringify(session.getDocument()) === JSON.stringify(before)
  let hostMembers = []
  await ctx.withTempDirectory(async (directory) => {
    const path = ctx.writeFixtureHtml(directory, 'group-rotate.html', rt.renderer.renderReadOnlyPresentationHtml(after))
    await ctx.withBrowser(path, async (page) => {
      hostMembers = await page.evaluate((ids) => ids.map((id) => {
        const node = document.querySelector(`[data-ppte-element-id="${id}"]`)
        return { id, transform: node?.style.transform ?? '', frame: node ? { left: node.style.left, top: node.style.top } : undefined }
      }), memberIds)
    })
  })
  const hostConsistent = hostMembers.length === memberIds.length && hostMembers.every((item) => {
    const element = afterSlide.elements[item.id]
    return item.transform === `rotate(${element.rotationDeg ?? 0}deg)`
      && Math.abs(Number.parseFloat(item.frame.left) - element.frame.x) < 0.01
      && Math.abs(Number.parseFloat(item.frame.top) - element.frame.y) < 0.01
  })
  const observed = { committed: committed.ok, changedMembers, flatGroup, rendererMembers, hostConsistent, hostMembers, exactUndo, operationIssues: committed.issues }
  ctx.expectGate(changedMembers && flatGroup && rendererMembers && hostConsistent && exactUndo, 'Group Rotate did not produce explicit member transforms with renderer/Host parity and exact undo.', observed)
  return observed
})

register('legacy-import', 'slidev-markdown-source', 'Slidev and Markdown files migrate into semantic documents.', 'A user opens old Slidev and Markdown source files; import must parse them into semantic slides without treating raw markup as a document source.', 'both legacy text formats produce a non-empty semantic document with sourceFormat and migration evidence', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const sources = {
    slidev: '---\ntitle: Quarterly Review\n---\n# 年度经营回顾\n\nRevenue was **42%**.',
    markdown: '# 年度经营回顾\n\n- Revenue: 42%\n- Target: 50%',
  }
  const observed = Object.entries(sources).map(([sourceFormat, source]) => {
    const result = rt.legacy.migrateLegacyDocument(source, { sourceFormat, targetProfile: 'ppte-2.0-ga-c.1', targetDocumentId: `legacy-${sourceFormat}` })
    return { sourceFormat, ok: result.ok, slides: result.document.slideOrder.length, metadataFormat: result.document.metadata.sourceFormat, disposition: result.report.disposition, issueCodes: result.report.issues.map((issue) => issue.code) }
  })
  ctx.expectGate(observed.every((item) => item.ok && item.slides > 0 && item.metadataFormat === item.sourceFormat && item.disposition === 'migrate'), 'Legacy Slidev/Markdown text was not imported into a semantic document.', observed)
  return observed
})

register('legacy-import', 'legacy-profile-boundaries', 'Legacy migration preserves GA-C boundaries and honest fallbacks.', 'A legacy Slidev semantic snapshot contains Area/Donut charts, Poster artwork, and a Widget; GA-C retains them while GA-B downgrades unsupported content with migration issues.', 'GA-C retains Area/Donut, Poster artwork, and Widget static fallback; GA-B retains safe semantics, drops unsupported objects, and reports each downgrade', async (ctx) => {
  const rt = await ctx.ensureRuntime()
  const { source, imageBytes } = makeLegacyBoundarySource()
  const options = { sourceFormat: 'slidev', assetBytes: { [IDS.asset]: imageBytes } }
  const gaC = rt.legacy.migrateLegacyDocument(source, { ...options, targetProfile: 'ppte-2.0-ga-c.1', targetDocumentId: 'legacy-ga-c' })
  const gaB = rt.legacy.migrateLegacyDocument(source, { ...options, targetProfile: 'ppte-2.0-ga-b.1', targetDocumentId: 'legacy-ga-b' })
  const gaCSlide = gaC.document.slides[gaC.document.slideOrder[0]]
  const gaBSlide = gaB.document.slides[gaB.document.slideOrder[0]]
  const gaCElements = Object.values(gaCSlide?.elements ?? {})
  const gaBElements = Object.values(gaBSlide?.elements ?? {})
  const gaCCharts = gaCElements.filter((element) => element.type === 'chart').map((element) => element.chartType)
  const gaBCharts = gaBElements.filter((element) => element.type === 'chart').map((element) => element.chartType)
  const gaCWidget = gaCElements.find((element) => element.type === 'component' && element.semanticKey === 'legacy.widget')
  const staticFallback = gaCWidget?.type === 'component' && rt.widgets.renderWidgetHtml(gaCWidget).includes('data-ppte-widget-fallback="true"')
  const gaCArtwork = gaCElements.find((element) => element.type === 'image' && element.role === 'artwork')
  const gaBIssueCodes = gaB.report.issues.map((issue) => issue.code)
  const observed = {
    gaC: { ok: gaC.ok, charts: gaCCharts, poster: gaCSlide?.visualStrategy, artwork: gaCArtwork?.type, widget: gaCWidget?.type, staticFallback },
    gaB: { ok: gaB.ok, charts: gaBCharts, visualStrategy: gaBSlide?.visualStrategy, widget: gaBElements.some((element) => element.type === 'component'), issueCodes: gaBIssueCodes },
  }
  ctx.expectGate(gaC.ok && gaCCharts.includes('area') && gaCCharts.includes('donut') && gaCSlide?.visualStrategy === 'poster' && gaCArtwork?.type === 'image' && staticFallback && gaB.ok && !gaBCharts.includes('area') && !gaBCharts.includes('donut') && gaBSlide?.visualStrategy === 'structured' && !observed.gaB.widget && gaBIssueCodes.includes('MIGRATION_UNSUPPORTED_ELEMENT') && gaBIssueCodes.includes('MIGRATION_UNSUPPORTED_VISUAL_STRATEGY'), 'Legacy migration did not honor the GA-C/GA-B Area, Donut, Poster, and Widget fallback boundaries.', observed)
  return observed
})

function summarizeCase(spec, status, extra = {}) {
  return {
    id: spec.id,
    finding: spec.finding,
    title: spec.title,
    authorization: spec.authorization,
    expected: spec.expected,
    status,
    ...extra,
  }
}

async function runGroup(group) {
  const specs = CASE_SPECS[group] ?? []
  const cases = []
  for (const spec of specs) {
    try {
      const observed = await spec.run({ ensureRuntime, withTempDirectory, writeFixtureHtml, withBrowser, runPythonPptx, runPythonNativeChart, runPdftotext, readPng, pixelStats, assertGolden, digest, textTransaction, transaction, broadContract, scope, expectGate, failGate, expectEqual, expectIssueCode, expectNoErrors, fixtureWithNewAsset })
      cases.push(summarizeCase(spec, 'green', { observed: observed ?? null }))
    } catch (cause) {
      const rawOutput = cause?.rawOutput ?? (cause instanceof Error ? cause.message : String(cause))
      cases.push(summarizeCase(spec, 'red', {
        message: cause instanceof Error ? cause.message : String(cause),
        rawOutput,
        ...(cause?.observed === undefined ? {} : { observed: cause.observed }),
      }))
    }
  }
  const green = cases.filter((item) => item.status === 'green').length
  const red = cases.length - green
  return { group, ...GROUP_META[group], green, red, status: red === 0 ? 'green' : 'red', cases }
}

async function runGroups(groups) {
  const summaries = []
  for (const group of groups) summaries.push(await runGroup(group))
  return summaries
}

function listOutput() {
  return {
    groups: GROUP_ORDER.map((group) => ({ group, ...GROUP_META[group], cases: CASE_SPECS[group].map(({ id, finding, title, authorization, expected }) => ({ id, finding, title, authorization, expected })) })),
    milestones: MILESTONE_GROUPS,
    infrastructure: ['Playwright chromium headless + file:// + tmp', 'real child-process SIGKILL', 'uv run --with python-pptx', 'python-pptx native chart part/category/value assertion', 'pdftotext Chinese assertion', 'PNG pixel statistics and golden samples'],
  }
}

function parseArgs(argv) {
  let options = { mode: 'report' }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--list') options = { mode: 'list' }
    else if (argument === '--report') options = { mode: 'report' }
    else if (argument === '--group') options = { mode: 'group', group: argv[++index] }
    else if (argument === '--milestone') options = { mode: 'milestone', milestone: argv[++index] }
    else if (argument === '--expect-red') options = { mode: 'expect-red', groups: (argv[++index] ?? '').split(',').filter(Boolean) }
    else throw new HarnessFailure(`Unknown argument ${argument}.`)
  }
  return options
}

function validateSelection(options) {
  if (options.mode === 'group') {
    if (!GROUP_ORDER.includes(options.group)) throw new HarnessFailure(`Unknown group ${options.group}.`)
    return [options.group]
  }
  if (options.mode === 'milestone') {
    if (!MILESTONE_GROUPS[options.milestone]) throw new HarnessFailure(`Unknown milestone ${options.milestone}.`)
    return MILESTONE_GROUPS[options.milestone]
  }
  if (options.mode === 'expect-red') {
    const unknown = options.groups.filter((group) => !GROUP_ORDER.includes(group))
    if (unknown.length) throw new HarnessFailure(`Unknown expected-red group(s): ${unknown.join(',')}.`)
    return [...new Set(['core-basic', ...options.groups])]
  }
  return GROUP_ORDER
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.mode === 'list') {
    process.stdout.write(`${JSON.stringify(listOutput(), null, 2)}\n`)
    return 0
  }
  const selected = validateSelection(options)
  const summaries = await runGroups(selected)
  const report = { mode: options.mode, selectedGroups: selected, groups: summaries, green: summaries.reduce((sum, item) => sum + item.green, 0), red: summaries.reduce((sum, item) => sum + item.red, 0) }
  if (options.mode === 'expect-red') {
    const core = summaries.find((item) => item.group === 'core-basic')
    const expectedRed = options.groups.map((group) => summaries.find((item) => item.group === group)).every((item) => item.red > 0)
    report.expectRed = { groups: options.groups, allHaveRed: expectedRed, coreBasicAllGreen: core?.red === 0 }
    report.ok = expectedRed && core?.red === 0
  } else report.ok = report.red === 0
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return report.ok ? 0 : 1
}

try {
  process.exitCode = await main()
} catch (cause) {
  const raw = cause?.rawOutput ?? (cause instanceof Error ? cause.message : String(cause))
  process.stderr.write(`${raw}\n`)
  process.exitCode = 2
}
