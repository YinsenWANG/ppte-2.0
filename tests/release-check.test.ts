import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const safari = 'H02 acceptance 5: Safari actual WebDriver journey or explicit blocked evidence (not simulated Safari)';
const pattern = '^H02 acceptance 5: Safari actual WebDriver journey or explicit blocked evidence [(]not simulated Safari[)]$';
const cliWaiver = `--test-skip-pattern=${pattern}`;
const waiver = `--test-skip-pattern="${pattern}"`;
const pnpmOptions = ['--config.verify-deps-before-run=false'];
const expectedNodeOptions = '--test-skip-pattern="^H02 acceptance 5: Safari actual WebDriver journey or explicit blocked evidence [(]not simulated Safari[)]$"';
const chrome = 'H02 acceptance 5: real installed Chrome journey';
const neighbours = [`prefix ${safari}`, `${safari} suffix`, safari.replace('acceptance 5', 'acceptance 50')];

// Copy the actual entry unchanged and run its real Node child against a tiny corpus.
function run(args: string[], chromeFails = false) {
  const cwd = mkdtempSync(resolve('.ppte-release-check-'));
  try {
    mkdirSync(join(cwd, 'dist/tests'), { recursive: true });
    copyFileSync(resolve('scripts/release-check.mjs'), join(cwd, 'release-check.mjs'));
    const cases: [string, boolean][] = [[safari, true], [chrome, chromeFails], ...neighbours.map(name => [name, false] as [string, boolean])];
    writeFileSync(join(cwd, 'journey.test.ts'), [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      ...cases.map(([name, fails]) => `test(${JSON.stringify(name)}, () => { console.log(${JSON.stringify(`EXEC:${name}`)}); assert.equal(${fails}, false); });`),
    ].join('\n'));
    const compiled = spawnSync(process.execPath, [
      resolve('node_modules/typescript/bin/tsc'), '--target', 'ES2022', '--module', 'NodeNext',
      '--skipLibCheck', '--types', 'node', '--typeRoots', resolve('node_modules/@types'),
      '--outDir', 'dist/tests', 'journey.test.ts',
    ], { cwd, encoding: 'utf8' });
    assert.ifError(compiled.error);
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    // Isolate the fixture from Node's outer test-worker marker, which otherwise
    // suppresses the nested --test child before it can execute any fixture.
    const { NODE_TEST_CONTEXT: _outerTestContext, NODE_OPTIONS: _outerNodeOptions, ...env } = process.env;
    const command = ['release-check.mjs', ...args];
    const result = spawnSync(process.execPath, command, { cwd, encoding: 'utf8', env });
    assert.ifError(result.error);
    const output = result.stdout + result.stderr;
    console.log(JSON.stringify({ command, chromeFails, status: result.status }), '\n' + output);
    return { status: result.status, output };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function assertExecuted(output: string, names: string[]) {
  for (const name of names) assert.ok(output.includes(`EXEC:${name}\n`), `${name} must execute`);
}

function assertWaived(output: string) {
  assert.ok(!output.includes(`EXEC:${safari}\n`));
  assert.ok(!output.includes(`# Subtest: ${safari}\n`));
  // Node 22 filters matching tests out of TAP rather than reporting # SKIP.
  assert.match(output, /# tests 4\n/);
  assert.match(output, /# skipped 0\n/);
}

test('release-check defaults retain the failing Safari journey without a waiver', () => {
  const result = run([]);
  assert.equal(result.status, 1);
  assertExecuted(result.output, [safari, chrome, ...neighbours]);
  assert.match(result.output, /# fail 1\n/);
  assert.match(result.output, /# skipped 0\n/);
  assert.doesNotMatch(result.output, /All current HTML and single-file automation passed/);
});

test('release-check forwards Node arguments and skips only the exact Safari name', () => {
  const result = run(['--test-reporter=tap', cliWaiver]);
  assert.equal(result.status, 0);
  assertWaived(result.output);
  assertExecuted(result.output, [chrome, ...neighbours]);
  assert.match(result.output, /# pass 4\n/);
  assert.match(result.output, /# fail 0\n/);
});

test('release-check propagates a real Chrome child failure with the Safari waiver', () => {
  const result = run(['--test-reporter=tap', cliWaiver], true);
  assert.equal(result.status, 1);
  assertWaived(result.output);
  assertExecuted(result.output, [chrome, ...neighbours]);
  assert.match(result.output, /# fail 1\n/);
  assert.doesNotMatch(result.output, /All current HTML and single-file automation passed/);
});

test('pnpm per-command NODE_OPTIONS preserves no-waiver failure and waives only exact Safari without installing', () => {
  // Outside the repository/workspace, with only built-in Node modules and no dependencies.
  const cwd = mkdtempSync(join(tmpdir(), 'ppte-pnpm-native-'));
  try {
    mkdirSync(join(cwd, 'dist/tests'), { recursive: true });
    mkdirSync(join(cwd, 'scripts'));
    copyFileSync(resolve('scripts/release-check.mjs'), join(cwd, 'scripts/release-check.mjs'));
    const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({
      private: true,
      type: 'module',
      scripts: {
        build: 'node --check dist/tests/journey.test.js',
        test: scripts.test,
        'release:check': scripts['release:check'],
      },
    }));
    writeFileSync(join(cwd, 'dist/tests/journey.test.js'), [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "console.log('NODE_OPTIONS_BYTES:' + Buffer.from(process.env.NODE_OPTIONS ?? '').toString('hex'));",
      ...[safari, chrome, ...neighbours].map(name =>
        `test(${JSON.stringify(name)}, () => { console.log(${JSON.stringify(`EXEC:${name}`)}); assert.notEqual(${JSON.stringify(name)}, ${JSON.stringify(safari)}); });`),
    ].join('\n'));
    const { NODE_TEST_CONTEXT: _outerTestContext, NODE_OPTIONS: _outerNodeOptions, ...env } = process.env;
    for (const entry of ['test', 'release:check']) {
      for (const waived of [false, true]) {
        const command = [...pnpmOptions, entry];
        const childEnv = waived ? { ...env, NODE_OPTIONS: waiver } : env;
        assert.deepEqual(Buffer.from(childEnv.NODE_OPTIONS ?? ''), Buffer.from(waived ? expectedNodeOptions : ''));
        const result = spawnSync('pnpm', command, { cwd, encoding: 'utf8', env: childEnv, timeout: 30000 });
        assert.ifError(result.error);
        const output = result.stdout + result.stderr;
        console.log(JSON.stringify({ executable: 'pnpm', command, NODE_OPTIONS: childEnv.NODE_OPTIONS, waived, status: result.status }), '\n' + output);
        assert.equal(result.status, waived ? 0 : 1, output);
        assert.ok(output.includes(`NODE_OPTIONS_BYTES:${Buffer.from(waived ? expectedNodeOptions : '').toString('hex')}\n`), 'the test child must receive the exact environment bytes');
        assertExecuted(output, [chrome, ...neighbours]);
        if (waived) {
          assertWaived(output);
          assert.match(output, /# pass 4\n/);
          assert.match(output, /# fail 0\n/);
        } else {
          assertExecuted(output, [safari]);
          assert.ok(output.includes(`not ok 1 - ${safari}\n`), 'Safari must fail its assertion, not the runner transport');
          assert.match(output, /# tests 5\n/);
          assert.match(output, /# pass 4\n/);
          assert.match(output, /# fail 1\n/);
          assert.match(output, /# skipped 0\n/);
          assert.doesNotMatch(output, /All current HTML and single-file automation passed/);
        }
        // pnpm suggests installing after the intentional RED; that exact warning
        // is not install activity. Keep it in the logged output and reject all activity.
        const activityOutput = output.replace(/^\[WARN\]  Local package\.json exists, but node_modules missing, did you mean to install\?\r?\n/gm, '');
        assert.doesNotMatch(activityOutput, /\b(?:install(?:ing)?|download(?:ing|ed)?|purge|purging|reinstall(?:ing|ed)?|ERR_PNPM|dependency-status)\b|\bpnpm\s+i\b|^(?:Progress:|Packages:|dependencies:|devDependencies:|Lockfile is up to date|Already up to date|Done in .* using pnpm)/im);
        assert.equal(existsSync(join(cwd, 'node_modules')), false);
        assert.equal(existsSync(join(cwd, 'pnpm-lock.yaml')), false);
        assert.deepEqual(readdirSync(cwd).sort(), ['dist', 'package.json', 'scripts']);
        assert.deepEqual(readdirSync(join(cwd, 'dist')).sort(), ['tests']);
        assert.deepEqual(readdirSync(join(cwd, 'dist/tests')), ['journey.test.js']);
        assert.deepEqual(readdirSync(join(cwd, 'scripts')), ['release-check.mjs']);
      }
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    assert.equal(existsSync(cwd), false);
  }
});

test('package historical bytes and canonical build-bearing scripts remain unchanged', () => {
  const historical = spawnSync('git', ['show', '9856db3:package.json']);
  assert.ifError(historical.error);
  assert.equal(historical.status, 0, historical.stderr.toString());
  assert.deepEqual(readFileSync('package.json'), historical.stdout);
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(scripts.test, 'pnpm build && node --test dist/tests/*.test.js');
  assert.equal(scripts['release:check'], 'pnpm build && node scripts/release-check.mjs');
});

test('both CI commands parse byte-identical NODE_OPTIONS assignments and canonical pnpm scripts', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  const commands = [...ci.matchAll(/^\s*- run: (?:\|-\n[ \t]+)?(.*)$/gm)].map(match => match[1]);
  for (const entry of ['test', 'release:check']) {
    const matching = commands.filter(command => new RegExp(`\\bpnpm\\b.*\\s${entry}(?:\\s|$)`).test(command));
    assert.deepEqual(matching, [`NODE_OPTIONS='${expectedNodeOptions}' pnpm ${pnpmOptions[0]} ${entry}`]);
    const parsed = /^NODE_OPTIONS='([^']*)' pnpm --config\.verify-deps-before-run=false (test|release:check)$/.exec(matching[0]);
    assert.ok(parsed);
    assert.deepEqual(Buffer.from(parsed[1]), Buffer.from(expectedNodeOptions));
    assert.deepEqual(Buffer.from(waiver), Buffer.from(expectedNodeOptions));
    // Parse the actual CI line in a POSIX shell with a pnpm stub; no package runner executes.
    const { NODE_OPTIONS: _outerNodeOptions, ...env } = process.env;
    const shell = spawnSync('/bin/sh', ['-c', `pnpm() { printf '%s\\0' "$NODE_OPTIONS" "$@"; }\n${matching[0]}`], { env });
    assert.ifError(shell.error);
    assert.equal(shell.status, 0, shell.stderr.toString());
    assert.deepEqual(shell.stdout, Buffer.from([expectedNodeOptions, ...pnpmOptions, entry, ''].join('\0')));
  }
  assert.ok(!commands.some(command => /\bnode\s/.test(command)), 'CI must retain canonical package scripts');
  assert.doesNotMatch(ci, /--config\.node-options|^\s*(?:env:|NODE_OPTIONS:)/m, 'CI must use per-command environment assignments');
  assert.ok(!commands.some(command => /\bpnpm\s+config\b|\b(?:npm_config\w*|PNPM_\w+)=|\bexport\b/.test(command)), 'CI must not persist config');
});
