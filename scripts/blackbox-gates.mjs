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
  makeChartFixture,
  makeCoreFixture,
  makeExportFixture,
  makeOverflowDocument,
  makeSlideIR,
  makeWidgetFixture,
  pixelPng,
  richText,
  textContent,
} from './blackbox-fixtures.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GOLDENS = JSON.parse(readFileSync(join(ROOT, 'scripts', 'blackbox-goldens.json'), 'utf8'))

const GROUP_ORDER = [
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
}

const MILESTONE_GROUPS = {
  r1: ['core-basic', 'agent-scope', 'lock-undo'],
  r2: ['core-basic', 'agent-scope', 'lock-undo', 'host', 'pages-notes-animation', 'compiler-quality'],
  r3: ['core-basic', 'agent-scope', 'lock-undo', 'host', 'pages-notes-animation', 'compiler-quality', 'portable'],
  r4: ['core-basic', 'agent-scope', 'lock-undo', 'host', 'pages-notes-animation', 'compiler-quality', 'portable', 'export'],
  r5: ['core-basic', 'agent-scope', 'lock-undo', 'host', 'pages-notes-animation', 'compiler-quality', 'portable', 'export', 'recovery'],
  r6: ['core-basic', 'agent-scope', 'lock-undo', 'host', 'pages-notes-animation', 'compiler-quality', 'portable', 'export', 'recovery', 'review-patch'],
  final: [...GROUP_ORDER],
}

const CASE_SPECS = Object.fromEntries(GROUP_ORDER.map((group) => [group, []]))

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
      load('dist/packages/exporter-pdf/src/index.js'),
      load('dist/packages/exporter-pptx/src/index.js'),
      load('dist/packages/reviewer/src/index.js'),
      load('dist/packages/patch-format/src/index.js'),
      load('dist/packages/validation/src/index.js'),
      load('dist/packages/facts/src/index.js'),
    ]).then(([canonical, core, agent, change, operations, richtextAdapter, renderer, fileFormat, recovery, compiler, portable, pdf, pptx, reviewer, patch, validation, facts]) => ({
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
      pdf,
      pptx,
      reviewer,
      patch,
      validation,
      facts,
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

function runExternal(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', ...options })
  const raw = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (result.error || result.status !== 0) throw new GateFailure(`${command} ${args.join(' ')} failed.`, { status: result.status, signal: result.signal }, raw || result.error?.message)
  return { result, raw }
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
  const line = raw.split('\n').map((item) => item.trim()).filter(Boolean).at(-1) ?? '{}'
  try { return JSON.parse(line) } catch (cause) { throw new GateFailure('python-pptx did not return JSON evidence.', { raw }, cause instanceof Error ? cause.message : String(cause)) }
}

function runPdftotext(pdfPath) {
  const { raw } = runExternal('pdftotext', [pdfPath, '-'])
  return raw
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
      const observed = await spec.run({ ensureRuntime, withTempDirectory, writeFixtureHtml, withBrowser, runPythonPptx, runPdftotext, readPng, pixelStats, assertGolden, digest, textTransaction, transaction, broadContract, scope, expectGate, expectEqual, expectIssueCode, expectNoErrors, fixtureWithNewAsset })
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
    infrastructure: ['Playwright chromium headless + file:// + tmp', 'real child-process SIGKILL', 'uv run --with python-pptx', 'pdftotext Chinese assertion', 'PNG pixel statistics and golden samples'],
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
