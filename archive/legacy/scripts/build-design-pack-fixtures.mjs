// Explicit authoring command: pnpm build && node scripts/build-design-pack-fixtures.mjs
// CI tests never call this command and never accept new previews automatically.
import { mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DESIGN_STYLES, designPackManifest, designPackCoverage, designPackRecipeSpecs } from '../dist/packages/layout-recipes/src/index.js'
import { captureDesignPacks, stressSamples, fontBytes, visualBytes, digestBytes } from '../dist/tests/helpers/design-pack-fixtures.js'
const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + '\n') }
for (const style of DESIGN_STYLES) {
  write(`design-packs/${style}/manifest.json`, designPackManifest(style))
  write(`design-packs/${style}/recipes.json`, designPackRecipeSpecs(style))
}
const report = await captureDesignPacks('artifacts/d04-authoring')
for (const result of report.measurements) {
  mkdirSync(dirname(result.preview), { recursive: true })
  copyFileSync(`artifacts/d04-authoring/${result.preview}`, result.preview)
}
write('design-packs/render-evidence.json', report)
write('tests/fixtures/evolution/design-pack-manifest.json', {
  version: '1.0.0', cells: designPackCoverage(),
  stress: DESIGN_STYLES.flatMap(style => stressSamples(style).map(sample => ({ style, ...sample, preview: `design-packs/${style}/previews/stress-${sample.kind}.png` }))),
  resources: [ { path: 'design-packs/assets/noto-sans-sc-sample-1.woff2', digest: digestBytes(fontBytes()), license: 'OFL-1.1' }, { path: 'design-packs/assets/visual-1.svg', digest: digestBytes(visualBytes()), license: 'Apache-2.0' } ],
  previews: report.measurements.map(result => ({ path: result.preview, digest: digestBytes(readFileSync(result.preview)) })),
})
console.log(`Captured ${report.measurements.length} previews; ${report.measurements.filter(m => m.status === 'pass').length} rendered pages passed.`)
