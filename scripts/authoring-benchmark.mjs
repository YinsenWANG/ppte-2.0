#!/usr/bin/env node
// Read-only evidence gate. Never generates human verdicts or rewrites submitted evidence.
import { readFileSync, realpathSync } from 'node:fs'
import { resolve, relative, isAbsolute, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { evaluateAuthoringBenchmark } from '../dist/packages/reviewer/src/index.js'
const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
try {
  const args = process.argv.slice(2)
  if (args.length > 2 || (args[1] && !['M1', 'M2', 'M3'].includes(args[1]))) throw new Error('Usage: pnpm benchmark:authoring [report.json] [M1|M2|M3]')
  const manifest = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/evolution/authoring-benchmark.json'), 'utf8'))
  const report = JSON.parse(readFileSync(resolve(root, args[0] ?? 'docs/evolution/quality/benchmark-report.json'), 'utf8'))
  const result = evaluateAuthoringBenchmark(manifest, report.submission, args[1] ?? 'M2', artifact => {
    if (isAbsolute(artifact.path)) return false
    const path = realpathSync(resolve(root, artifact.path))
    const rel = relative(root, path)
    if (rel.startsWith('..') || isAbsolute(rel)) return false
    const bytes = readFileSync(path)
    if (/\.png$/i.test(path) && !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return false
    return createHash('sha256').update(bytes).digest('hex') === artifact.sha256
  })
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  process.exitCode = result.status === 'pass' ? 0 : 1
} catch (error) {
  process.stdout.write(JSON.stringify({ status: 'blocked', blockers: ['invalid-evidence'], message: error.message }) + '\n')
  process.exitCode = 1
}
