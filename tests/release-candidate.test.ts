import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { releaseBlockers, releaseDigest, retainReleaseInputs, verifyReleaseRetention, validateReleaseActions, requiredRetainedRoles, type ReleaseTasks } from '../packages/node-runtime/src/release.js'
import { readStoredZip } from '../packages/archive/src/index.js'
import { buildCheckpointBytes, openCheckpointBytes } from '../packages/file-format/src/index.js'
import { TABLE_PROFILE } from '../packages/compatibility/src/index.js'
import { decodePortable, auditPortableBundle } from '../packages/portable-runtime/src/index.js'

const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const repo = process.cwd()
function run(command: string, args: string[], cwd = repo, env = process.env) {
  const r = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024 })
  assert.equal(r.status, 0, `${command} ${args.join(' ')}\n${r.error ?? ''}\n${r.stderr}\n${r.stdout}`)
  return r.stdout
}

test('Q02 criterion 1: stage gate rejects incomplete, missing and unevidenced tasks and unresolved client blockers', () => {
  const tasks: ReleaseTasks = { releaseGates: { G0: ['C06'], G4: ['Q01', 'Q02'] }, tasks: ['C06', 'Q01'].map(id => ({ id, status: 'done', evidence: [{ commit: 'a'.repeat(40), tests: ['tests/synthetic-contract.test.ts'] }] })) }
  const client = { status: 'pass', releaseBlockers: [] }
  assert.deepEqual(releaseBlockers(tasks, client), []) // Structural fixture, not real acceptance.
  const historical = structuredClone(tasks)
  historical.tasks[0]!.evidence = ['commit:' + 'b'.repeat(40), 'tests/synthetic-contract.test.ts']
  historical.tasks[1]!.evidence = [{ commit: 'c'.repeat(40), testFiles: ['tests/synthetic-contract.test.ts'] }]
  assert.deepEqual(releaseBlockers(historical, client), [])
  for (const status of ['planned', 'partial', 'blocked', 'unverified', 'deferred']) {
    const changed = structuredClone(tasks); changed.tasks[0]!.status = status
    assert.deepEqual(releaseBlockers(changed, client), [`C06: ${status}`])
  }
  const absent = structuredClone(tasks); absent.tasks.pop()
  assert.match(releaseBlockers(absent, client).join(), /Q01: missing/)
  const unevidenced = structuredClone(tasks); unevidenced.tasks[0]!.evidence = []
  assert.match(releaseBlockers(unevidenced, client).join(), /missing commit\/test evidence/)
  assert.equal(releaseBlockers(tasks, { status: 'unverified', releaseBlockers: ['A21 panel absent'] }).length, 2)
  const current = releaseBlockers(json('docs/evolution/TASKS.json'), json('docs/evolution/quality/client-matrix.json'))
  const manifest = json('docs/evolution/quality/release-manifest.json')
  assert.deepEqual(manifest.stageBlockers, current)
  if (current.length) assert.notEqual(manifest.status, 'ready')
})

test('Q02 criterion 2: retention fails closed on missing inputs, collisions, tampering and unsafe paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'q02-retention-'))
  try {
    const source = join(dir, 'bytes'); writeFileSync(source, 'synthetic evidence bytes')
    const inputs = requiredRetainedRoles.map(role => ({ role, path: source }))
    assert.throws(() => retainReleaseInputs(join(dir, 'missing'), inputs.slice(1)), /missing/)
    assert.equal(existsSync(join(dir, 'missing')), false)
    assert.throws(() => retainReleaseInputs(join(dir, 'unsafe'), [...inputs, { role: '../escape', path: source }]), /unsafe/)
    const destination = join(dir, 'vault')
    const receipt = retainReleaseInputs(destination, inputs)
    verifyReleaseRetention(destination, receipt)
    assert.equal(existsSync(join(destination, 'INCOMPLETE')), false)
    writeFileSync(join(destination, 'INCOMPLETE'), 'interrupted retention')
    assert.throws(() => verifyReleaseRetention(destination, receipt), /incomplete retention/)
    rmSync(join(destination, 'INCOMPLETE'))
    assert.throws(() => retainReleaseInputs(destination, inputs), /EEXIST/)
    const forged = structuredClone(receipt); forged.files[0]!.file = '../bytes'
    assert.throws(() => verifyReleaseRetention(destination, forged), /unsafe/)
    writeFileSync(join(destination, 'source.retained'), 'corrupt')
    assert.throws(() => verifyReleaseRetention(destination, receipt), /digest mismatch/)
    assert.equal(readFileSync(source, 'utf8'), 'synthetic evidence bytes')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('Q02 criterion 3: all four independent action records require explicit scope and evidence for pass', () => {
  const actions = json('docs/evolution/quality/release-manifest.json').actions
  validateReleaseActions(actions)
  for (const key of ['git', 'npm', 'localInstall', 'htmlUpgrade']) {
    const missing = structuredClone(actions); delete missing[key]
    assert.throws(() => validateReleaseActions(missing), /all four/)
    const fake = structuredClone(actions); fake[key] = { status: 'pass', scope: 'fixture', evidence: [] }
    assert.throws(() => validateReleaseActions(fake), /pass requires evidence/)
  }
  assert.equal(actions.git.status, 'not-run')
  assert.equal(actions.npm.status, 'not-run')
  assert.match(actions.localInstall.scope, /temporary/)
  assert.match(actions.htmlUpgrade.scope, /synthetic/)
})

test('Q02 criteria 1/2/3 A03/A04/A05/A19: reproducible tarball, real old-runtime rollback and retained versioned HTML upgrade', () => {
  const dir = mkdtempSync(join(tmpdir(), 'q02-drill-'))
  const output = process.env.Q02_OUTPUT ? resolve(process.env.Q02_OUTPUT) : join(dir, 'retained')
  const stage = join(dir, 'stage'); const host = join(dir, 'host')
  const oldFixture = resolve('tests/fixtures/evolution/q02/old-runtime.tgz')
  const provenance = json('tests/fixtures/evolution/q02/provenance.json')
  const oldReport = resolve('tests/fixtures/evolution/q02/old-report.json')
  const build = json('artifacts/build-manifest.json')
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: join(dir, 'home'), PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' }
  mkdirSync(env.HOME!)
  const offline = join(dir, 'offline.cjs')
  writeFileSync(offline, `const deny=()=>{throw Error('Q02_NETWORK_DISABLED')};for(const [name,keys] of [['net',['connect','createConnection']],['tls',['connect']],['http',['request','get']],['https',['request','get']],['dns',['lookup','resolve']]]){for(const k of keys)require(name)[k]=deny;}require('net').Socket.prototype.connect=deny;globalThis.fetch=deny;`)
  const offlineEnv = { ...env, NODE_OPTIONS: `--require=${offline}` }
  function install(tarball: string, name: string) {
    const target = join(dir, name); mkdirSync(target)
    writeFileSync(join(target, 'package.json'), '{"private":true}')
    run('npm', ['install', '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund', '--cache', join(dir, 'cache'), tarball], target, env)
    return { target, bin: join(target, 'node_modules/.bin/ppte'), pkg: join(target, 'node_modules/ppte-cli') }
  }
  function cli(installation: ReturnType<typeof install>, ...args: string[]) { return JSON.parse(run(installation.bin, args, installation.target, offlineEnv)) }
  try {
    assert.equal(releaseDigest(oldFixture), provenance.sha256)
    assert.equal(json(oldReport).actions.candidateTarball.sha256, provenance.sha256)
    run('pnpm', ['host:build', '--outDir', host])
    run(process.execPath, ['scripts/stage-package.mjs', stage, host])
    const archives: string[] = []
    for (const name of ['pack-a', 'pack-b']) {
      const target = join(dir, name); mkdirSync(target)
      run('npm', ['pack', stage, '--pack-destination', target, '--json'])
      const files = readdirSync(target).filter(f => f.endsWith('.tgz')); assert.equal(files.length, 1)
      archives.push(join(target, files[0]!))
    }
    assert.equal(releaseDigest(archives[0]!), releaseDigest(archives[1]!))
    const candidate = install(archives[0]!, 'candidate')
    const old = install(oldFixture, 'old')
    assert.deepEqual(json(join(candidate.pkg, 'build-manifest.json')), build)
    assert.equal(json(join(old.pkg, 'build-manifest.json')).runtimeBuildId, provenance.runtimeBuildId)
    assert.notEqual(build.runtimeBuildId, provenance.runtimeBuildId)
    const policy = json(join(candidate.pkg, 'release-policy.json'))
    assert.equal(policy.automaticDowngrade, false)
    assert.deepEqual(policy.buildManifest, build)
    assert.equal(policy.profiles.some((p: any) => p.id === TABLE_PROFILE.id), true)
    assert.equal(existsSync(join(candidate.pkg, policy.migrationNotes)), true)
    const denied = spawnSync(process.execPath, ['-e', "require('https').get('https://example.invalid')"], { env: offlineEnv, encoding: 'utf8' })
    assert.notEqual(denied.status, 0); assert.match(denied.stderr, /Q02_NETWORK_DISABLED/)
    const skill = join(dir, 'skill')
    assert.equal(cli(candidate, 'skill-install', '--out', skill).ok, true)
    assert.equal(releaseDigest(join(skill, 'SKILL.md')), releaseDigest(join(stage, 'skills/ppte/SKILL.md')))
    const skillHash = releaseDigest(join(skill, 'SKILL.md'))
    const conflict = spawnSync(candidate.bin, ['skill-install', '--out', skill], { env: offlineEnv, encoding: 'utf8' })
    assert.equal(conflict.status, 1); assert.match(conflict.stdout, /OUTPUT_EXISTS/)
    assert.equal(releaseDigest(join(skill, 'SKILL.md')), skillHash)
    const original = join(dir, 'original.ppte')
    cpSync('tests/fixtures/evolution/legacy-profile.ppte', original)
    const originalHash = releaseDigest(original)
    const originalManifest = JSON.parse(new TextDecoder().decode(readStoredZip(readFileSync(original)).get('manifest.json')!))
    const profilePath = join(dir, 'original-profile.json'); writeFileSync(profilePath, JSON.stringify(originalManifest, null, 2))
    const before = cli(old, 'inspect', original)
    assert.equal(before.ok, true)
    const working = join(dir, 'working.ppte'); cpSync(original, working)
    const legacy = cli(old, 'deliver', working)
    assert.equal(legacy.ok, true)
    const legacyHtml = legacy.artifacts.find((a: any) => a.primary).path
    const oldHtmlHash = releaseDigest(legacyHtml)
    const upgraded = cli(candidate, 'deliver', working)
    assert.equal(upgraded.ok, true)
    const upgradedHtml = upgraded.artifacts.find((a: any) => a.primary).path
    assert.notEqual(upgradedHtml, legacyHtml)
    assert.equal(releaseDigest(legacyHtml), oldHtmlHash)
    assert.equal(auditPortableBundle(readFileSync(upgradedHtml, 'utf8')).ok, true)
    const payload = decodePortable(readFileSync(upgradedHtml, 'utf8'))
    assert.deepEqual(payload.buildManifest, build)
    assert.equal(cli(candidate, 'deliver', working).artifacts.find((a: any) => a.primary).path, upgradedHtml)
    // Produce a new-profile checkpoint via the format writer, never relabel bytes.
    const newProject = join(dir, 'new-profile.ppte')
    writeFileSync(newProject, buildCheckpointBytes(openCheckpointBytes(readFileSync(original)).document, { compatibilityProfile: TABLE_PROFILE.id }))
    const newHash = releaseDigest(newProject)
    assert.equal(cli(candidate, 'inspect', newProject).ok, true)
    const rejected = spawnSync(old.bin, ['inspect', newProject], { cwd: old.target, env: offlineEnv, encoding: 'utf8' })
    assert.equal(rejected.status, 1)
    assert.deepEqual(JSON.parse(rejected.stdout).issues, [{ code: 'CHECKPOINT_FAILED', message: 'CHECKPOINT_FAILED: unsupported manifest format or schema version', severity: 'error' }])
    assert.equal(releaseDigest(newProject), newHash)
    const restored = join(dir, 'rollback.ppte'); cpSync(original, restored)
    assert.equal(cli(old, 'inspect', restored).revision, before.revision)
    assert.equal(releaseDigest(original), originalHash)
    assert.equal(releaseDigest(restored), originalHash)
    const report = {
      task: 'Q02', status: 'pass', releaseAcceptance: 'blocked', environment: { node: process.version, platform: process.platform, arch: process.arch },
      buildManifest: build, oldBuildManifest: json(join(old.pkg, 'build-manifest.json')),
      candidateSha256: releaseDigest(archives[0]!), reproduciblePack: true,
      offline: 'Node network APIs blocked after installation; negative probe passed; no model keys or MCP',
      source: { sha256: originalHash, revision: before.revision, profile: originalManifest.compatibilityProfile },
      rollback: { status: 'pass', automaticDowngrade: false, restoredRevision: before.revision, rejectedProfile: TABLE_PROFILE.id, rejectedSourceSha256: newHash, diagnostic: JSON.parse(rejected.stdout) },
      html: { status: 'pass', oldSha256: oldHtmlHash, newSha256: releaseDigest(upgradedHtml), artifactIdentity: payload.artifactIdentity, distinctPath: true },
      actions: {
        git: { status: 'not-run', scope: 'push/tag prohibited by task; local commit recorded separately', evidence: [] },
        npm: { status: 'not-run', scope: 'publication blocked by release acceptance', evidence: [] },
        localInstall: { status: 'pass', scope: 'temporary isolated old/candidate npm and native Skill installation; persistent user installation not-run', evidence: ['receipt.json'] },
        htmlUpgrade: { status: 'pass', scope: 'synthetic legacy-profile fixture, explicit versioned copy; user HTML upgrade not-run', evidence: ['receipt.json'] },
      },
    }
    validateReleaseActions(report.actions as any)
    const reportPath = join(dir, 'drill.json'); writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
    const receipt = retainReleaseInputs(output, [
      { role: 'source', path: original }, { role: 'sourceProfile', path: profilePath },
      { role: 'oldTarball', path: oldFixture }, { role: 'oldBuild', path: join(old.pkg, 'build-manifest.json') }, { role: 'oldReport', path: oldReport },
      { role: 'candidateTarball', path: archives[0]! }, { role: 'candidateBuild', path: join(candidate.pkg, 'build-manifest.json') }, { role: 'candidateReport', path: reportPath },
      { role: 'oldHtml', path: legacyHtml }, { role: 'upgradedHtml', path: upgradedHtml }, { role: 'newProfileProject', path: newProject }, { role: 'rollbackProject', path: restored },
    ])
    verifyReleaseRetention(output, receipt)
    assert.equal(receipt.files.find(f => f.role === 'source')!.sha256, originalHash)
    // The retained tarball is the actual installed and tested candidate, not a later rebuild.
    assert.equal(receipt.files.find(f => f.role === 'candidateTarball')!.sha256, report.candidateSha256)
    assert.equal(releaseDigest(oldFixture), provenance.sha256)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('Q02 criterion 1: release check exits blocked and detects changed build and corrupt retained evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'q02-gate-'))
  try {
    mkdirSync(join(dir, 'docs/evolution/quality'), { recursive: true })
    mkdirSync(join(dir, 'artifacts'))
    cpSync('docs/evolution/TASKS.json', join(dir, 'docs/evolution/TASKS.json'))
    cpSync('docs/evolution/quality/client-matrix.json', join(dir, 'docs/evolution/quality/client-matrix.json'))
    const manifest = json('docs/evolution/quality/release-manifest.json')
    manifest.evidenceFiles = [{ path: 'evidence.json', sha256: '0'.repeat(64) }]
    writeFileSync(join(dir, 'evidence.json'), '{}')
    writeFileSync(join(dir, 'docs/evolution/quality/release-manifest.json'), JSON.stringify(manifest))
    writeFileSync(join(dir, 'artifacts/build-manifest.json'), JSON.stringify({ ...manifest.buildManifest, runtimeBuildId: 'changed' }))
    const result = spawnSync(process.execPath, [resolve('scripts/release-check.mjs')], { cwd: dir, encoding: 'utf8' })
    assert.equal(result.status, 1)
    const report = JSON.parse(result.stdout)
    assert.equal(report.ok, false)
    assert.equal(report.blockers.includes('Stale evidence: evidence.json'), true)
    assert.equal(report.blockers.includes('Candidate build identity differs from current build'), true)
    assert.deepEqual(report.actions, manifest.actions)
    for (const blocker of releaseBlockers(json('docs/evolution/TASKS.json'), json('docs/evolution/quality/client-matrix.json'))) assert.equal(report.blockers.includes(blocker), true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
