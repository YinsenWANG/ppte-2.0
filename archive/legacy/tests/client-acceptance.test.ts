import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canonicalHash, sha256HexBytes } from '../packages/canonical-json/src/index.js'
import { evaluateClientAcceptance, type ClientMatrix, type ClientSubmission } from '../packages/capability/src/index.js'
import { buildPortable, decodePortable } from '../packages/portable-runtime/src/index.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'

const matrix: ClientMatrix = JSON.parse(readFileSync('docs/evolution/quality/client-matrix.json', 'utf8'))
const fixture = makeContractDocument()
const built = buildPortable(fixture.document, { profile: 'full-portable', assetBytes: { asset_pixel: fixture.imageBytes } })
assert.equal(built.ok, true)
const identity = decodePortable(built.html).artifactIdentity!
// Synthetic evidence exercises the validator only; it is never submitted as client acceptance.
const files = new Map([['input.html', new TextEncoder().encode(built.html)], ['edited.pptx', new TextEncoder().encode('synthetic changed file')], ['visual.png', new Uint8Array([1, 2, 3])]])
const artifact = (path: string) => ({ path, sha256: sha256HexBytes(files.get(path)!) })
const verify = (file: { path: string; sha256: string }) => files.has(file.path) && sha256HexBytes(files.get(file.path)!) === file.sha256
function submission(): ClientSubmission {
  return { version: 'q01-client-evidence-v1', matrixDigest: canonicalHash(matrix), artifactIdentity: structuredClone(identity), observations: matrix.clients.flatMap(c => c.entries.flatMap(entry => c.checks.map(check => ({
    clientId: c.id, entry, check, status: 'pass' as const, method: 'actual-client' as const, application: c.application,
    version: 'synthetic-unit-test', os: 'synthetic', device: 'synthetic', executedBy: 'unit-test (not human evidence)', executedAt: '2026-09-06T00:00:00Z',
    artifactIdentity: structuredClone(identity), input: artifact('input.html'), evidence: [artifact('edited.pptx'), artifact('visual.png')],
    scenario: 'validator contract', operations: ['synthetic action'], expected: 'contract accepts complete record', actual: 'synthetic record', revision: identity.components.document, historyDigest: identity.components.history,
  })))) }
}

test('Q01 A17: required real Safari and other targets cannot be satisfied by WebKit automation', () => {
  assert.ok(matrix.clients.some(c => c.application === 'Safari' && c.required))
  assert.ok(matrix.clients.some(c => c.application === 'Google Chrome' && c.required))
  const s = submission()
  assert.equal(evaluateClientAcceptance(matrix, s, identity, verify).status, 'pass')
  for (const o of s.observations.filter(o => o.clientId === 'safari')) o.method = 'playwright-webkit'
  const result = evaluateClientAcceptance(matrix, s, identity, verify)
  assert.equal(result.status, 'blocked')
  assert.ok(result.rows.filter(r => r.clientId === 'safari').every(r => r.status === 'unverified'))
})

test('Q01 A17: Office open/edit/resave, each native object and visual are independent requirements', () => {
  for (const check of ['open', 'edit', 'resave', 'native-text', 'native-shape', 'native-image', 'native-chart', 'native-table', 'text-order', 'visual']) {
    const s = submission()
    s.observations = s.observations.filter(o => !(o.clientId === 'libreoffice' && o.check === check))
    assert.equal(evaluateClientAcceptance(matrix, s, identity, verify).status, 'blocked', check)
  }
  const s = submission()
  s.observations.filter(o => o.clientId === 'libreoffice').forEach(o => { o.method = 'package-inspection' })
  assert.equal(evaluateClientAcceptance(matrix, s, identity, verify).status, 'blocked')
  const sameFile = submission()
  sameFile.observations.find(o => o.check === 'resave')!.evidence = [artifact('input.html')]
  assert.equal(evaluateClientAcceptance(matrix, sameFile, identity, verify).status, 'blocked')
  const noVisual = submission()
  noVisual.observations.find(o => o.check === 'visual')!.evidence = [artifact('edited.pptx')]
  assert.equal(evaluateClientAcceptance(matrix, noVisual, identity, verify).status, 'blocked')
})

test('Q01 A17: every ArtifactIdentity component invalidates old client reports', () => {
  for (const key of Object.keys(identity.components) as (keyof typeof identity.components)[]) {
    const changed = structuredClone(identity)
    changed.components[key] = canonicalHash({ changed: key })
    changed.digest = canonicalHash({ version: 1, components: changed.components })
    assert.ok(evaluateClientAcceptance(matrix, submission(), changed, verify).blockers.includes('stale-artifact-identity'), key)
  }
  const invalid = structuredClone(identity)
  invalid.components.runtime = 'forged'
  assert.equal(evaluateClientAcceptance(matrix, submission(), invalid, verify).status, 'blocked')
  const s = submission()
  s.observations[0]!.artifactIdentity.components.history = canonicalHash('old history')
  assert.equal(evaluateClientAcceptance(matrix, s, identity, verify).status, 'blocked')
})

test('Q01 A17/A21: unverified, missing, failed, duplicate and unverifiable evidence never pass', () => {
  for (const status of ['unverified', 'not-run', 'not-applicable', 'blocked', 'fail'] as const) {
    const s = submission(); s.observations[0]!.status = status
    assert.equal(evaluateClientAcceptance(matrix, s, identity, verify).status, 'blocked', status)
  }
  assert.equal(evaluateClientAcceptance(matrix, submission(), identity).status, 'blocked')
  assert.equal(evaluateClientAcceptance(matrix, submission(), identity, () => { throw Error('missing') }).status, 'blocked')
  const duplicate = submission(); duplicate.observations.push(duplicate.observations[0]!)
  assert.equal(evaluateClientAcceptance(matrix, duplicate, identity, verify).status, 'blocked')
  const corrupt = submission(); corrupt.observations[0]!.input.sha256 = canonicalHash('bad bytes')
  assert.equal(evaluateClientAcceptance(matrix, corrupt, identity, verify).status, 'blocked')
  const empty = submission(); empty.observations = []
  assert.equal(evaluateClientAcceptance(matrix, empty, identity, verify).rows.filter(r => r.status === 'pass').length, 0)
})

test('Q01 A17: changed matrix, incomplete protocol and undeclared clients block acceptance', () => {
  const changed = structuredClone(matrix); changed.clients[0]!.checks = ['open']
  const result = evaluateClientAcceptance(changed, submission(), identity, verify)
  assert.ok(result.blockers.includes('stale-matrix'))
  assert.ok(result.blockers.some(b => b.endsWith('incomplete-protocol')))
  const s = submission(); s.observations[0]!.clientId = 'undeclared-keynote'
  assert.ok(evaluateClientAcceptance(matrix, s, identity, verify).blockers.includes('unknown-observation'))
})

test('Q01 A19/A21: published matrix retains unverified manual release scope and executable journey references', () => {
  const declared = JSON.parse(readFileSync('docs/evolution/quality/client-matrix.json', 'utf8'))
  assert.equal(declared.status, 'unverified')
  assert.deepEqual(declared.observations, [])
  assert.ok(declared.releaseBlockers.length >= 2)
  assert.equal(declared.publication.githubPush, 'not-run')
  assert.equal(declared.publication.npmPublish, 'not-run')
  for (const path of declared.automatedJourneys) assert.match(readFileSync(path, 'utf8'), /test\(/)
})
