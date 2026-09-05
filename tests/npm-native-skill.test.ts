import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { decodePortable, auditPortableBundle } from '../packages/portable-runtime/src/index.js'

const repo = process.cwd()
const dir = mkdtempSync(join(tmpdir(), 'ppte-c06-'))
const install = join(dir, 'consumer')
const stage = join(dir, 'package')
const host = join(dir, 'host')
const skill = join(dir, 'skills/ppte')
const manifest = JSON.parse(readFileSync('artifacts/build-manifest.json', 'utf8'))
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const report: any = { task: 'C06', buildManifest: manifest, environment: { node: process.version, platform: process.platform, arch: process.arch }, executor: 'node --test dist/tests/npm-native-skill.test.js', actions: { gitPush: { status: 'not-run' }, npmPublish: { status: 'not-run' } } }
function run(command: string, args: string[], cwd = repo, env = process.env) {
  const r = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 })
  assert.equal(r.status, 0, `${command} ${args.join(' ')}\n${r.error ?? ''}\n${r.stderr}\n${r.stdout}`)
  return r.stdout
}
// Use a credential-free HOME and block Node's network APIs after installation.
const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: join(dir, 'home'), TMPDIR: dir, NODE_OPTIONS: `--require=${join(dir, 'offline.cjs')}`, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' }
function cli(...args: string[]) { return JSON.parse(run(join(install, 'node_modules/.bin/ppte'), args, install, env)) }
function tree(path: string, prefix = ''): Record<string, string> {
  return Object.fromEntries(readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? Object.entries(tree(join(path, entry.name), prefix + entry.name + '/')) : [[prefix + entry.name, sha(join(path, entry.name))]]))
}
before(() => {
  mkdirSync(install); mkdirSync(env.HOME!); mkdirSync(join(dir, 'skills'))
  writeFileSync(join(dir, 'offline.cjs'), `const deny=()=>{throw new Error('C06_NETWORK_DISABLED')}; for(const [name,keys] of [['net',['connect','createConnection']],['tls',['connect']],['http',['request','get']],['https',['request','get']],['dns',['lookup','resolve']]]){const m=require(name);for(const k of keys)m[k]=deny;} require('net').Socket.prototype.connect=deny; globalThis.fetch=deny;`)
  run('pnpm', ['host:build', '--outDir', host])
  run(process.execPath, ['scripts/stage-package.mjs', stage, host])
  const packed = JSON.parse(run('npm', ['pack', stage, '--pack-destination', dir, '--json']))[0]
  const tarball = join(dir, packed.filename)
  writeFileSync(join(install, 'package.json'), '{"private":true}')
  run('npm', ['install', '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund', '--cache', join(dir, 'npm-cache'), tarball], install, { PATH: process.env.PATH, HOME: env.HOME, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' })
  const installed = join(install, 'node_modules/ppte-cli')
  assert.deepEqual(tree(join(installed, 'dist')), tree(join(stage, 'dist')))
  assert.deepEqual(JSON.parse(readFileSync(join(installed, 'build-manifest.json'), 'utf8')), manifest)
  assert.equal(existsSync(join(install, 'node_modules/playwright')), false)
  assert.equal(cli('--version').version, manifest.applicationVersion)
  report.packageFiles = tree(installed)
  report.actions.candidateTarball = { status: 'pass', filename: packed.filename, sha256: sha(tarball), bytes: readFileSync(tarball).length }
  if (process.env.C06_OUTPUT) {
    mkdirSync(resolve(process.env.C06_OUTPUT), { recursive: true })
    cpSync(tarball, join(resolve(process.env.C06_OUTPUT), packed.filename))
  }
})
after(() => {
  if (process.env.C06_OUTPUT) writeFileSync(join(resolve(process.env.C06_OUTPUT), 'candidate-report.json'), JSON.stringify(report, null, 2) + '\n')
  rmSync(dir, { recursive: true, force: true })
})

test('C06 A19: clean tarball native Skill compiles, previews, commits, reopens, undoes/redoes and delivers offline without MCP or model keys', () => {
  const denied = spawnSync(process.execPath, ['-e', "require('https').get('https://example.invalid')"], { cwd: install, env, encoding: 'utf8' })
  assert.notEqual(denied.status, 0); assert.match(denied.stderr, /C06_NETWORK_DISABLED/)
  assert.equal(cli('skill-install', '--out', skill).ok, true)
  assert.deepEqual(tree(skill), tree(join(stage, 'skills/ppte')))
  const instructions = readFileSync(join(skill, 'SKILL.md'), 'utf8')
  assert.match(instructions, /Do not start an MCP server/)
  const project = join(install, '季度.ppte')
  const compiled = cli('compile', join(install, 'node_modules/ppte-cli/examples/quarterly-design.json'), '--out', project)
  assert.equal(compiled.ok, true); assert.equal(compiled.slides, 10)
  const query = join(install, 'query.json'); writeFileSync(query, JSON.stringify({ role: 'title' }))
  const target = cli('tool', project, 'query_elements', '--args', query).data[0]
  // Execute the actual installed Skill's transaction example, replacing its placeholders.
  const example = readFileSync(join(skill, 'references/editing.md'), 'utf8').match(/```json\n([\s\S]*?)\n```/)![1]!
  const tx = JSON.parse(example.replaceAll('REPLACE_WITH_CURRENT_REVISION', compiled.revision).replaceAll('SLIDE_ID', target.slideId).replaceAll('TITLE_ID', target.element.id).replaceAll('REPLACE_WITH_CURRENT_ISO_TIMESTAMP', new Date().toISOString()))
  const txPath = join(install, 'edit.json'); writeFileSync(txPath, JSON.stringify(tx))
  const receipt = join(install, 'review.json')
  const preview = cli('preview', project, '--transaction', txPath, '--out', receipt)
  assert.equal(preview.ok, true); assert.equal(cli('inspect', project).revision, compiled.revision)
  assert.equal(cli('commit', project, '--preview', receipt).ok, true)
  assert.equal(cli('inspect', project).revision, preview.proposedRevision)
  assert.equal(cli('undo', project, '--expect-revision', preview.proposedRevision).ok, true)
  assert.equal(cli('inspect', project).revision, compiled.revision)
  assert.equal(cli('redo', project, '--expect-revision', compiled.revision).ok, true)
  const delivered = cli('deliver', project)
  assert.equal(delivered.ok, true)
  const primary = delivered.artifacts.find((a: any) => a.primary)
  assert.match(primary.path, /\.editable\.ppte\.html$/)
  const html = readFileSync(primary.path, 'utf8')
  assert.equal(auditPortableBundle(html).ok, true)
  const payload = decodePortable(html)
  assert.deepEqual(payload.buildManifest, manifest)
  assert.equal(payload.origin.sourceRevision, preview.proposedRevision)
  assert.equal(JSON.stringify(payload.document).includes('Requested title'), true)
  const sourceDigest = sha(project)
  const pdf = join(install, 'unavailable.pdf')
  const missingBrowser = spawnSync(join(install, 'node_modules/.bin/ppte'), ['export', project, '--format', 'pdf', '--out', pdf], { cwd: install, env, encoding: 'utf8' })
  assert.equal(missingBrowser.status, 1)
  assert.match(missingBrowser.stdout, /EXPORT_RENDERER_UNAVAILABLE/)
  assert.match(missingBrowser.stdout, /npm install playwright/)
  assert.match(missingBrowser.stdout, /npx playwright install chromium/)
  assert.equal(existsSync(pdf), false); assert.equal(sha(project), sourceDigest)
  const digest = sha(primary.path)
  assert.equal(cli('deliver', project).artifacts.find((a: any) => a.primary).path, primary.path)
  assert.equal(sha(primary.path), digest)
  report.journey = { status: 'pass', network: 'Node network APIs blocked (negative probe passed)', modelCredentials: 'absent', mcp: 'not-started', beforeRevision: compiled.revision, afterRevision: preview.proposedRevision, artifactSha256: digest, artifactIdentity: payload.artifactIdentity }
  report.actions.skillInstall = { status: 'pass', scope: 'isolated temporary directory; removed after verification', userInstallation: 'not-run', files: tree(skill) }
})

test('C06 A01/A03/A04/A05/A06: M0 failure fixtures and compatibility regressions pass for the packaged build', () => {
  const files = ['evolution-baseline', 'history-inverse-roundtrip', 'history-repair', 'artifact-identity', 'portable-presentation', 'presentation-controller', 'surface-mode-contract', 'product-workflows']
  const regressionEnv = { ...process.env }
  delete regressionEnv.NODE_TEST_CONTEXT
  const output = run(process.execPath, ['--test', '--test-reporter=tap', ...files.map(f => `dist/tests/${f}.test.js`)], repo, regressionEnv)
  assert.match(output, /# fail 0\b/); assert.match(output, /# skipped 0\b/)
  assert.deepEqual(JSON.parse(readFileSync('artifacts/build-manifest.json', 'utf8')), manifest)
  assert.deepEqual(tree(join(stage, 'dist/packages')), tree('dist/packages'))
  const blackbox = JSON.parse(run(process.execPath, ['scripts/blackbox-gates.mjs', '--group', 'core-basic']))
  assert.equal(blackbox.ok, true); assert.equal(blackbox.red, 0)
  assert.deepEqual(blackbox.buildManifest, manifest)
  assert.equal(blackbox.environment.node, process.version)
  report.regressions = { status: 'pass', buildManifest: manifest, tests: files.map(f => `tests/${f}.test.ts`), passed: Number(output.match(/# pass (\d+)/)![1]), fixtureManifestSha256: sha('tests/fixtures/evolution/manifest.json'), fixtureProvenance: 'public synthetic equivalents; no private user originals supplied' }
})

test('C06: release evidence distinguishes Git push, candidate tarball, npm publication and temporary Skill installation', () => {
  assert.equal(report.journey.status, 'pass'); assert.equal(report.regressions.status, 'pass')
  assert.deepEqual(Object.keys(report.actions).sort(), ['candidateTarball', 'gitPush', 'npmPublish', 'skillInstall'])
  assert.equal(report.actions.gitPush.status, 'not-run'); assert.equal(report.actions.npmPublish.status, 'not-run')
  assert.equal(report.actions.candidateTarball.status, 'pass'); assert.match(report.actions.candidateTarball.sha256, /^[a-f0-9]{64}$/)
  assert.equal(report.actions.skillInstall.status, 'pass'); assert.equal(report.actions.skillInstall.userInstallation, 'not-run')
  // Existing installations cannot be silently replaced by the candidate.
  const before = tree(skill)
  const duplicate = spawnSync(join(install, 'node_modules/.bin/ppte'), ['skill-install', '--out', skill], { cwd: install, env, encoding: 'utf8' })
  assert.equal(duplicate.status, 1); assert.match(duplicate.stdout, /OUTPUT_EXISTS/); assert.deepEqual(tree(skill), before)
})
