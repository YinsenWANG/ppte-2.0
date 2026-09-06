import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { makeFixture } from './perf-browser.mjs'
import { cpus, platform, release } from 'node:os'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export async function profileJobs() {
  const bundle = await build({ stdin: { contents: `export {canonicalHash} from './packages/canonical-json/src/index.ts'; export {buildDerivedIndexes} from './packages/core/src/index.ts'; export {BackgroundJobs} from './packages/editor-controller/src/background-jobs.ts'`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', globalName: 'P03' })
  const workerBundle = await build({ stdin: { contents: `export {canonicalHash} from './packages/canonical-json/src/index.ts'`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', globalName: 'P03' })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    const cases = []
    for (const count of [12, 30, 100]) {
      const { document } = await makeFixture(count)
      cases.push(await page.evaluate(async ({ input, code }) => {
        const { canonicalHash, buildDerivedIndexes, BackgroundJobs } = globalThis.P03
        const workerSource = code + '\nonmessage = ({data}) => { const start=performance.now(); const hash=P03.canonicalHash(data.input); postMessage({...data,input:undefined,hash,computeMs:performance.now()-start}); };'
        const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
        const startup = performance.now()
        const worker = new Worker(url)
        const roundtrip = request => new Promise((resolve, reject) => { worker.onmessage = event => resolve(event.data); worker.onerror = reject; worker.postMessage(request) })
        const expected = canonicalHash(input)
        const cold = await roundtrip({ jobId: 'cold', baseRevision: expected, inputDigest: expected, input })
        const coldWorkerTotalMs = performance.now() - startup
        if (cold.hash !== expected) throw Error('WORKER_HASH_MISMATCH')
        for (let warm = 0; warm < 5; warm++) { canonicalHash(input); await roundtrip({ jobId: 'warm', baseRevision: expected, inputDigest: expected, input }) }
        let lastWorkerComputeMs = 0
        const native = new BackgroundJobs(() => expected)
        const remote = new BackgroundJobs(() => expected, { run: async request => { const result = await roundtrip(request); lastWorkerComputeMs = result.computeMs; return result }, dispose() {} })
        const samples = { hashComputeMs: [], indexComputeMs: [], nativeTotalMs: [], workerTotalMs: [], workerComputeMs: [] }
        try {
          for (let i = 0; i < 30; i++) {
            let start = performance.now(); canonicalHash(input); samples.hashComputeMs.push(performance.now() - start)
            start = performance.now(); buildDerivedIndexes(input); samples.indexComputeMs.push(performance.now() - start)
            const run = async mode => {
              const start = performance.now(), pool = mode === 'worker' ? remote : native
              const outcome = await pool.submit(input).result
              if (outcome.status !== 'ready' || pool.take(outcome.proposal) !== expected) throw Error('PROPOSAL_MISMATCH')
              samples[mode + 'TotalMs'].push(performance.now() - start)
              if (mode === 'worker') samples.workerComputeMs.push(lastWorkerComputeMs)
            }
            // Alternate order to reduce systematic warmup/order bias.
            for (const mode of i % 2 ? ['worker', 'native'] : ['native', 'worker']) await run(mode)
          }
        } finally { native.dispose(); remote.dispose(); worker.terminate(); URL.revokeObjectURL(url) }
        const p95 = values => [...values].sort((a,b) => a-b)[Math.ceil(values.length * .95)-1]
        return { pageCount: input.slideOrder.length, fixtureDigest: expected, coldWorkerTotalMs, samples, p95: Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, p95(values)])) }
      }, { input: document, code: workerBundle.outputFiles[0].text }))
    }
    return { protocol: 'P03-compute-and-envelope-total/1', implementationDigest: createHash('sha256').update(bundle.outputFiles[0].text).digest('hex'), workerDigest: createHash('sha256').update(workerBundle.outputFiles[0].text).digest('hex'), environment: { cpu: cpus()[0].model, os: platform(), release: release(), browser: browser.version() }, sampleCount: 30, warmupCount: 5, cases, migrations: [], scope: 'Chromium computation and structured-clone roundtrip; not interaction latency or physical-device A20 certification. Worker is trusted application code, not a script sandbox.' }
  } finally { await browser.close() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await profileJobs()
  writeFileSync('docs/evolution/quality/p03-job-costs.json', JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report.cases.map(c => ({pageCount:c.pageCount,p95:c.p95,coldWorkerTotalMs:c.coldWorkerTotalMs})), null, 2))
}
