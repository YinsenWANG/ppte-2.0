import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { PpteSession } from '../packages/core/src/index.js'
import { writeCheckpoint } from '../packages/file-format/src/index.js'
import { auditPortableBundle, buildPortable, computeArtifactIdentity, decodePortable, type PortablePayload, configurePortableScript } from '../packages/portable-runtime/src/index.js'
import { deliverPresentation, editableSiblingPath } from '../packages/node-runtime/src/delivery.js'
import { PPTE_APP_VERSION } from '../packages/schema/src/version.js'

import { portableBrowserScript } from '../packages/portable-runtime/src/browser-bundle.js'
import { openFileSession } from '../packages/node-runtime/src/index.js'

test('identity binds actual runtime and history while ignoring build timestamp', () => {
  const { document, imageBytes } = makeContractDocument()
  const options = { profile: 'full-portable' as const, assetBytes: { asset_pixel: imageBytes } }
  const first = buildPortable(document, { ...options, derivedAt: '2026-09-05T00:00:00Z' })
  const second = buildPortable(document, { ...options, derivedAt: '2026-09-06T00:00:00Z' })
  assert.equal(first.ok, true)
  const identity = decodePortable(first.html).artifactIdentity!
  assert.equal(identity.digest, decodePortable(second.html).artifactIdentity!.digest)
  assert.equal(auditPortableBundle(first.html).ok, true)
  const altered = first.html.replace('<script id="ppte-runtime">', '<script id="ppte-runtime">/* modified executable */')
  assert.equal(auditPortableBundle(altered).ok, false)
  try {
    configurePortableScript(portableBrowserScript + '\n/* next runtime build */')
    const next = buildPortable(document, options)
    assert.equal(next.ok, true)
    assert.notEqual(identity.digest, decodePortable(next.html).artifactIdentity!.digest)
  } finally { configurePortableScript(portableBrowserScript) }
})

test('same-document old runtime cannot be reused; versioned delivery preserves both artifacts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ppte-artifact-identity-'))
  try {
    const { document, imageBytes } = makeContractDocument()
    const path = join(directory, 'deck.ppte')
    writeCheckpoint(document, path, { assetBytes: { asset_pixel: imageBytes } })
    const { session } = openFileSession(path)
    const first = deliverPresentation(session, path)
    assert.equal(first.ok, true)
    const originalPath = first.artifacts[0]!.path
    const original = readFileSync(originalPath)
    configurePortableScript(portableBrowserScript + '\n/* upgraded runtime */')
    assert.equal(deliverPresentation(session, path).ok, false)
    const next = deliverPresentation(session, path, { collisionPolicy: 'versioned-copy' })
    assert.equal(next.ok, true, JSON.stringify(next.issues))
    assert.notEqual(next.artifacts[0]!.path, originalPath)
    assert.deepEqual(readFileSync(originalPath), original)
    assert.equal(deliverPresentation(session, path, { collisionPolicy: 'versioned-copy' }).artifacts[0]!.path, next.artifacts[0]!.path)
    assert.equal(deliverPresentation(session, path, { collisionPolicy: 'versioned-copy', replaceExisting: true, confirmed: true }).ok, false)
    const upgraded = readFileSync(next.artifacts[0]!.path, 'utf8')
    writeFileSync(next.artifacts[0]!.path, upgraded.replace('ppte-toolbar', 'modified-toolbar'))
    const collision = deliverPresentation(session, path, { collisionPolicy: 'versioned-copy' })
    assert.equal(collision.ok, true)
    assert.notEqual(collision.artifacts[0]!.path, next.artifacts[0]!.path)
  } finally { configurePortableScript(portableBrowserScript); rmSync(directory, { recursive: true, force: true }) }
})

test('redo-only history changes artifact identity without changing the document revision', async () => {
  const { PpteSession } = await import('../packages/core/src/index.js')
  const { MockAgent } = await import('../packages/agent-tools/src/index.js')
  const { document, imageBytes } = makeContractDocument()
  const session = new PpteSession(document)
  const transaction = new MockAgent().createTextReplaceTransaction(document, session.getRevision(), 'slide_main', 'text_body', { paragraphs: [{ id: 'p', runs: [{ id: 'r', text: 'Temporary edit' }] }] }, 'temporary')
  assert.equal(session.commit(transaction).ok, true)
  assert.equal(session.undo().ok, true)
  const options = { profile: 'full-portable' as const, assetBytes: { asset_pixel: imageBytes } }
  const clean = decodePortable(buildPortable(document, options).html)
  const redo = decodePortable(buildPortable(session.getDocument(), { ...options, redoHistory: [...session.getRedoHistory()] }).html)
  assert.equal(clean.origin.sourceRevision, redo.origin.sourceRevision)
  assert.notEqual(clean.artifactIdentity!.components.history, redo.artifactIdentity!.components.history)
  assert.notEqual(clean.artifactIdentity!.digest, redo.artifactIdentity!.digest)
})

const fixture = makeContractDocument()
const built = buildPortable(fixture.document, { profile: 'full-portable', assetBytes: { asset_pixel: fixture.imageBytes } })
assert.equal(built.ok, true)
const original = decodePortable(built.html)
function embed(payload: PortablePayload, html = built.html): string {
  return html.replace(/(<script id="ppte-portable-payload" type="application\/json">)[\s\S]*?(<\/script>)/, (_, start, end) => start + JSON.stringify(payload).replace(/</g, '\\u003c') + end)
}
function seal(payload: PortablePayload, html = built.html): string {
  if (payload.buildManifest) payload.buildManifest.runtimeBuildId = computeArtifactIdentity(payload, html).components.runtime
  payload.artifactIdentity = computeArtifactIdentity(payload, html)
  return embed(payload, html)
}

test('A05 identity binds every actual component and excludes generation time', () => {
  const identity = original.artifactIdentity!
  assert.equal(auditPortableBundle(built.html).ok, true)
  assert.deepEqual(Object.keys(identity.components).sort(), ['document', 'runtime', 'renderer', 'shell', 'resources', 'fonts', 'history', 'capabilities', 'compatibility', 'configuration'].sort())
  const mutations: Array<[keyof typeof identity.components, (payload: PortablePayload) => void]> = [
    ['document', p => { p.document.locale += ' changed' }],
    ['resources', p => { p.assets.asset_pixel = 'AA==' }],
    ['fonts', p => { p.fontPolicyVersion = '2' }],
    ['fonts', p => { p.fonts.test = 'AA==' }],
    ['fonts', p => { const font = Object.values(p.document.fonts)[0]!; font.family += ' changed' }],
    ['history', p => { p.recentTransactions = [{ transactionId: 'undo' } as any] }],
    ['history', p => { p.redoHistory = [{ transaction: { transactionId: 'redo' } } as any] }],
    ['capabilities', p => { p.capabilityReport.ok = !p.capabilityReport.ok }],
    ['compatibility', p => { (p.compatibilityDescriptor as any).description = 'changed descriptor' }],
    ['configuration', p => { p.exportOptions = { quality: 2 } }],
    ['configuration', p => { p.origin.profile = 'viewer' }],
  ]
  for (const [component, mutate] of mutations) {
    const payload = structuredClone(original); mutate(payload)
    const changed = computeArtifactIdentity(payload, built.html)
    assert.notEqual(changed.components[component], identity.components[component], component)
    assert.notEqual(changed.digest, identity.digest)
    assert.equal(auditPortableBundle(embed(payload)).ok, false, component)
  }
  for (const [component, html] of [
    ['runtime', built.html.replace('<script id="ppte-runtime">', '<script id="ppte-runtime">/* upgrade */')],
    ['renderer', built.html.replace('<div class="ppte-canvas"', '<div title="renderer change" class="ppte-canvas"')],
    ['shell', built.html.replace('background:#111827', 'background:#111828')],
    ['shell', built.html.replace("default-src 'none'", "default-src 'self'")],
  ] as const) {
    assert.notEqual(computeArtifactIdentity(original, html).components[component], identity.components[component])
    assert.equal(auditPortableBundle(html).ok, false)
  }
  const timed = structuredClone(original); timed.origin.derivedAt = '2026-09-06T12:00:00Z'
  assert.equal(computeArtifactIdentity(timed, embed(timed)).digest, identity.digest)
})

test('A05 audit checks resource declarations even when identity is recomputed', () => {
  const payload = structuredClone(original); payload.assets.asset_pixel = 'AA=='
  assert.equal(auditPortableBundle(seal(payload)).issues.some(i => i.code === 'ASSET_HASH_MISMATCH'), true)
  const descriptor = structuredClone(original); (descriptor.compatibilityDescriptor as any).description = 'unregistered'
  assert.equal(auditPortableBundle(seal(descriptor)).issues.some(i => i.code === 'PORTABLE_CAPABILITY_MISMATCH'), true)
  const missing = structuredClone(original); delete missing.artifactIdentity
  assert.equal(auditPortableBundle(embed(missing)).issues.some(i => i.code === 'ARTIFACT_IDENTITY_MISSING'), true)
  const manifest = structuredClone(original); manifest.buildManifest!.runtimeBuildId = 'forged'
  assert.equal(auditPortableBundle(embed(manifest)).issues.some(i => i.code === 'ARTIFACT_BUILD_MISMATCH'), true)
})

function workspace(run: (directory: string, source: string, session: PpteSession) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'ppte-c04-'))
  try {
    const source = join(directory, '报告.ppte')
    const session = new PpteSession(fixture.document, { checkpoint: { write: (document, path: string, options: any, transactions) => writeCheckpoint(document, path, { ...options, assetBytes: { asset_pixel: fixture.imageBytes }, recentTransactions: transactions ? [...transactions] : [] }) } })
    run(directory, source, session)
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

test('A05 old API errors on stale identity while explicit new flow creates and reuses real copy', () => workspace((directory, source, session) => {
  const target = editableSiblingPath(source)
  const legacy = structuredClone(original); delete legacy.artifactIdentity; delete legacy.buildManifest
  writeFileSync(target, embed(legacy))
  const old = readFileSync(target)
  assert.equal(deliverPresentation(session, source).issues[0]?.code, 'DELIVERY_TARGET_EXISTS')
  const result = deliverPresentation(session, source, { collisionPolicy: 'versioned-copy' })
  assert.equal(result.ok, true)
  assert.equal(dirname(result.artifacts[0]!.path), directory)
  assert.notEqual(result.artifacts[0]!.path, target)
  assert.deepEqual(readFileSync(target), old)
  const bytes = readFileSync(result.artifacts[0]!.path)
  const repeated = deliverPresentation(session, source, { collisionPolicy: 'versioned-copy' })
  assert.equal(repeated.artifacts[0]!.path, result.artifacts[0]!.path)
  assert.deepEqual(readFileSync(repeated.artifacts[0]!.path), bytes)
}))

test('A05 short digest collisions and dangling symlinks create fresh sibling without clobber', () => workspace((directory, source, session) => {
  const target = editableSiblingPath(source)
  writeFileSync(target, 'occupied')
  const first = deliverPresentation(session, source, { collisionPolicy: 'versioned-copy' })
  assert.equal(first.ok, true)
  const short = first.artifacts[0]!.path
  writeFileSync(short, 'short collision')
  symlinkSync(join(directory, 'missing'), short.replace('.editable.ppte.html', '-2.editable.ppte.html'))
  const result = deliverPresentation(session, source, { collisionPolicy: 'versioned-copy' })
  assert.equal(result.ok, true)
  assert.equal(result.artifacts[0]!.path, short.replace('.editable.ppte.html', '-3.editable.ppte.html'))
  assert.equal(readFileSync(short, 'utf8'), 'short collision')
  assert.equal(readFileSync(target, 'utf8'), 'occupied')
  assert.equal(auditPortableBundle(readFileSync(result.artifacts[0]!.path, 'utf8')).ok, true)
  assert.equal(readdirSync(directory).some(name => name.endsWith('.tmp')), false)
}))

test('A05 conflicting legacy flags reject and confirmed replacement retains recoverable exact bytes', () => workspace((directory, source, session) => {
  for (const request of [
    { replaceExisting: true, collisionPolicy: 'error' as const, confirmed: true },
    { replaceExisting: true, collisionPolicy: 'versioned-copy' as const },
    { replaceExisting: false, collisionPolicy: 'replace' as const, confirmed: true },
  ]) assert.equal(deliverPresentation(session, source, request).issues[0]?.code, 'DELIVERY_POLICY_CONFLICT')
  assert.equal(deliverPresentation(session, source, { collisionPolicy: 'replace' }).issues[0]?.code, 'DELIVERY_CONFIRMATION_REQUIRED')
  const target = editableSiblingPath(source); writeFileSync(target, 'recover me')
  const result = deliverPresentation(session, source, { collisionPolicy: 'replace', confirmed: true })
  assert.equal(result.ok, true)
  assert.equal(readFileSync(target + '.previous', 'utf8'), 'recover me')
  assert.equal(auditPortableBundle(readFileSync(target, 'utf8')).ok, true)
  assert.equal(readdirSync(directory).some(name => name.endsWith('.tmp')), false)
}))

test('A19 root version, CLI, Portable and byte-derived build manifest agree; old profiles remain', () => {
  const root = JSON.parse(readFileSync('package.json', 'utf8'))
  const manifest = JSON.parse(readFileSync('artifacts/build-manifest.json', 'utf8'))
  assert.equal(PPTE_APP_VERSION, root.version)
  assert.equal(JSON.parse(execFileSync(process.execPath, ['dist/apps/cli/index.js', '--version'], { encoding: 'utf8' })).version, root.version)
  assert.equal(original.origin.runtimeVersion, root.version)
  assert.equal(original.buildVersion, root.version)
  assert.deepEqual(original.buildManifest, manifest)
  for (const profile of ['viewer', 'quick-fix', 'light-edit', 'full-portable'] as const) {
    const result = buildPortable(fixture.document, { profile, assetBytes: { asset_pixel: fixture.imageBytes } })
    assert.equal(result.ok, true); assert.equal(auditPortableBundle(result.html).ok, true)
    assert.equal(decodePortable(result.html).origin.profile, profile)
  }
})

test('A05 atomic publication retries a writer arriving after target preflight', () => workspace((directory, source, session) => {
  const target = editableSiblingPath(source)
  const result = deliverPresentation(session, source, { collisionPolicy: 'versioned-copy' }, {
    beforePublish: path => writeFileSync(path, 'concurrent writer', { flag: 'wx' }),
  })
  assert.equal(result.ok, true)
  assert.notEqual(result.artifacts[0]!.path, target)
  assert.equal(readFileSync(target, 'utf8'), 'concurrent writer')
  assert.equal(auditPortableBundle(readFileSync(result.artifacts[0]!.path, 'utf8')).ok, true)
  assert.equal(readdirSync(directory).some(name => name.endsWith('.tmp')), false)
}))

test('A19 staged distributable carries root version and exact build manifest', () => {
  execFileSync('pnpm', ['host:build'], { stdio: 'pipe' })
  execFileSync(process.execPath, ['scripts/stage-package.mjs'], { stdio: 'pipe' })
  const staged = JSON.parse(readFileSync('artifacts/npm-package/package.json', 'utf8'))
  assert.equal(staged.version, PPTE_APP_VERSION)
  assert.deepEqual(readFileSync('artifacts/npm-package/build-manifest.json'), readFileSync('artifacts/build-manifest.json'))
  const version = JSON.parse(execFileSync(process.execPath, ['artifacts/npm-package/dist/apps/cli/index.js', '--version'], { encoding: 'utf8' }))
  assert.equal(version.version, staged.version)
  assert.equal(built.html.includes(`name="ppte-application-version" content="${staged.version}"`), true)
})

test('A05 embedded font bytes are audited independently of a recomputed identity', () => {
  const payload = structuredClone(original)
  const font = Object.values(payload.document.fonts)[0]!
  font.source = 'embedded'
  font.hash = 'sha256:' + '0'.repeat(64)
  payload.fonts[font.id] = 'AA=='
  const report = auditPortableBundle(seal(payload))
  assert.equal(report.ok, false)
  assert.equal(report.issues.some(issue => issue.code === 'FONT_HASH_MISMATCH'), true)
})
