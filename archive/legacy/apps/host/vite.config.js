import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const hostRoot = fileURLToPath(new URL('.', import.meta.url))

function inlineFileProtocolAssets() {
  let output = resolve(hostRoot, 'dist')
  return {
    name: 'ppte-inline-file-protocol-assets',
    configResolved(config) { output = resolve(config.root, config.build.outDir) },
    closeBundle() {
      let html = readFileSync(resolve(output, 'index.html'), 'utf8')
      html = html.replace(/<script type="module" crossorigin src="\.\/assets\/([^" ]+)"><\/script>/g, (_match, file) => `<script type="module">${readFileSync(resolve(output, 'assets', file), 'utf8')}</script>`)
      html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/assets\/([^" ]+)">/g, (_match, file) => `<style>${readFileSync(resolve(output, 'assets', file), 'utf8')}</style>`)
      writeFileSync(resolve(output, 'index.html'), html)
    },
  }
}

export default defineConfig({
  root: hostRoot,
  base: './',
  plugins: [react(), inlineFileProtocolAssets()],
  build: { outDir: 'dist', emptyOutDir: true },
})
