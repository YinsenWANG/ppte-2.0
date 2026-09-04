#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const MCP_ENTRY = join(ROOT, 'dist/apps/mcp/index.js')
const EXAMPLE = join(ROOT, 'examples/ga-c-document.json')

function pixelPng() {
  return Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10,
    0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
    0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1, 255, 137, 153, 61, 29,
    0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
  ])
}

function richText(value) {
  return { paragraphs: [{ id: 'mcp-smoke-paragraph', runs: [{ id: 'mcp-smoke-run', text: value }] }] }
}

function ensureBuild() {
  if (existsSync(MCP_ENTRY)) return
  const result = spawnSync('pnpm', ['build'], { cwd: ROOT, encoding: 'utf8' })
  if (result.error || result.status !== 0) throw new Error(`${result.stdout ?? ''}${result.stderr ?? result.error?.message ?? ''}`)
}

async function main() {
  ensureBuild()
  const [{ writeCheckpoint }, { MockAgent }] = await Promise.all([
    import('../dist/packages/file-format/src/index.js'),
    import('../dist/packages/agent-tools/src/index.js'),
  ])
  const directory = mkdtempSync(join(tmpdir(), 'ppte-mcp-smoke-'))
  const checkpointPath = join(directory, 'ga-c-example.ppte')
  try {
    const document = JSON.parse(readFileSync(EXAMPLE, 'utf8'))
    const imageBytes = pixelPng()
    const asset = document.assets.asset_artwork
    asset.hash = `sha256-${createHash('sha256').update(imageBytes).digest('hex')}`
    asset.byteLength = imageBytes.length
    // The public example intentionally leaves the artwork payload as a
    // placeholder. Make this smoke fixture checkpointable without changing
    // the example itself.
    document.theme.presets.image['image.default'] = {}
    writeCheckpoint(document, checkpointPath, {
      clean: true,
      compatibilityProfile: 'ppte-2.0-ga-c.1',
      assetBytes: { asset_artwork: imageBytes },
      timestamp: '2026-09-04T00:00:00.000Z',
    })

    const initial = await withServer(checkpointPath, async (client) => {
      const initialized = await client.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mcp-smoke', version: '1' } })
      assert(initialized.result?.serverInfo?.name === 'ppte', 'initialize did not return the PPTe server info')
      const listed = await client.request('tools/list')
      const tools = listed.result?.tools ?? []
      const names = new Set(tools.map((tool) => tool.name))
      for (const required of ['inspect_document', 'render_slide', 'preview_transaction', 'commit_transaction']) assert(names.has(required), `tools/list is missing ${required}`)
      for (const tool of tools) assert(tool.inputSchema?.type === 'object', `tool ${tool.name} has no object JSON Schema`)
      const inspected = parseToolResult(await client.request('tools/call', { name: 'inspect_document', arguments: {} }))
      assert(inspected.ok === true && inspected.data?.slideCount === 1, 'inspect_document did not report one page')
      return { revision: inspected.data.revision, tools: names }
    })

    await withServer(checkpointPath, ['--readonly'], async (client) => {
      const listed = await client.request('tools/list')
      const names = new Set((listed.result?.tools ?? []).map((tool) => tool.name))
      assert(!names.has('commit_transaction') && !names.has('undo_transaction'), 'readonly tools/list exposed a mutation tool')
    })

    const transaction = new MockAgent().createTextReplaceTransaction(
      document,
      initial.revision,
      'slide_ga_c',
      'title',
      richText('MCP smoke edited title'),
      'mcp-smoke-text-replace',
    )
    await withServer(checkpointPath, async (client) => {
      const preview = parseToolResult(await client.request('tools/call', { name: 'preview_transaction', arguments: { transaction } }))
      assert(preview.ok === true && preview.diff?.mutationSummary?.changedElements === 1, 'preview_transaction did not validate text.replaceContent')
      const committed = parseToolResult(await client.request('tools/call', { name: 'commit_transaction', arguments: { transaction, confirmed: true } }))
      assert(committed.ok === true, `commit_transaction failed: ${JSON.stringify(committed)}`)
    })

    await withServer(checkpointPath, async (client) => {
      const reopened = parseToolResult(await client.request('tools/call', { name: 'get_element', arguments: { slideId: 'slide_ga_c', elementId: 'title' } }))
      const text = reopened.data?.content?.paragraphs?.[0]?.runs?.[0]?.text
      assert(reopened.ok === true && text === 'MCP smoke edited title', 'reopened server did not observe persisted text')
    })

    process.stdout.write('MCP smoke OK: initialize, tools/list, inspect, readonly filtering, preview→commit, and reopen persistence\n')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

class StdioClient {
  nextId = 1
  pending = new Map()
  child
  lines
  stderr = ''
  closePromise

  constructor(checkpointPath, args = []) {
    this.child = spawn(process.execPath, [MCP_ENTRY, checkpointPath, ...args], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] })
    this.closePromise = once(this.child, 'close')
    this.lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity })
    this.lines.on('line', (line) => {
      if (!line.trim()) return
      let response
      try { response = JSON.parse(line) } catch (cause) { this.rejectAll(new Error(`MCP emitted invalid JSON: ${cause.message}`)); return }
      const pending = this.pending.get(response.id)
      if (pending) {
        this.pending.delete(response.id)
        pending.resolve(response)
      }
    })
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk })
    this.child.on('close', (_code, signal) => this.rejectAll(new Error(`MCP server exited before responding (${signal ?? 'closed'}): ${this.stderr}`)))
  }

  request(method, params) {
    const id = this.nextId++
    const request = { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child.stdin.write(`${JSON.stringify(request)}\n`)
    })
  }

  async close() {
    if (!this.child.killed) this.child.stdin.end()
    const [code, signal] = await this.closePromise
    this.lines.close()
    if (code !== 0 || signal) throw new Error(`MCP server close failed (${code ?? signal}): ${this.stderr}`)
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}

async function withServer(checkpointPath, argsOrRun, maybeRun) {
  const args = Array.isArray(argsOrRun) ? argsOrRun : []
  const run = Array.isArray(argsOrRun) ? maybeRun : argsOrRun
  const client = new StdioClient(checkpointPath, args)
  try {
    return await run(client)
  } finally {
    await client.close()
  }
}

function parseToolResult(response) {
  if (response.error) throw new Error(`JSON-RPC error: ${response.error.message}`)
  const text = response.result?.content?.find((item) => item.type === 'text')?.text
  if (typeof text !== 'string') throw new Error(`tools/call returned no text content: ${JSON.stringify(response)}`)
  return JSON.parse(text)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

main().catch((cause) => {
  process.stderr.write(`MCP smoke failed: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`)
  process.exitCode = 1
})
