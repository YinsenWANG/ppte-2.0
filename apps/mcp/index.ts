import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { canonicalRevision } from '../../packages/canonical-json/src/index.js'
import { PpteSession, type CheckpointAdapter } from '../../packages/core/src/index.js'
import {
  AGENT_TOOL_DEFINITIONS,
  AgentToolServer,
  type AgentToolName,
  type AgentToolResult,
} from '../../packages/agent-tools/src/index.js'
import {
  openCheckpoint,
  readStoredZip,
  writeCheckpoint,
  type CheckpointResult,
} from '../../packages/file-format/src/index.js'
import { RecoveryJournal, readJournal } from '../../packages/recovery-journal/src/index.js'
import type { PpteDocument, RecoveryJournalHeader, Transaction, TransactionScope } from '../../packages/schema/src/index.js'

import {
  errorResponse,
  McpProtocolError,
  resultResponse,
  serveStdio,
  type JsonRpcHandler,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './protocol.js'
import { MCP_TOOL_INPUT_SCHEMAS, type JsonSchema } from './tool-schemas.js'

const SERVER_VERSION = '0.6.0'
const MCP_PROTOCOL_VERSION = '2024-11-05'

export interface McpTool {
  name: AgentToolName
  description: string
  inputSchema: JsonSchema
}

export interface McpRuntimeOptions {
  readonly?: boolean
  grantedScope?: TransactionScope
}

export interface McpCliOptions extends McpRuntimeOptions {
  checkpointPath: string
}

export class PpteMcpRuntime implements JsonRpcHandler {
  readonly session: PpteSession
  readonly agent: AgentToolServer
  readonly checkpointPath: string
  readonly readonlyMode: boolean

  private readonly mutatingTools = new Set<AgentToolName>(AGENT_TOOL_DEFINITIONS.filter((definition) => definition.mutates).map((definition) => definition.name))

  constructor(session: PpteSession, agent: AgentToolServer, checkpointPath: string, readonlyMode: boolean) {
    this.session = session
    this.agent = agent
    this.checkpointPath = checkpointPath
    this.readonlyMode = readonlyMode
  }

  listTools(): McpTool[] {
    return AGENT_TOOL_DEFINITIONS
      .filter((definition) => !this.readonlyMode || !definition.mutates)
      .map((definition) => ({
        name: definition.name,
        description: definition.description,
        inputSchema: MCP_TOOL_INPUT_SCHEMAS[definition.name],
      }))
  }

  callTool(name: string, args: Record<string, unknown> = {}): AgentToolResult {
    const definition = AGENT_TOOL_DEFINITIONS.find((candidate) => candidate.name === name)
    if (!definition || (this.readonlyMode && definition.mutates)) throw new McpProtocolError(-32602, `Unknown or unavailable tool: ${name}`)
    const result = this.agent.execute(definition.name, args)
    if (!result.ok || !this.mutatingTools.has(definition.name)) return result

    const checkpoint = this.session.checkpoint(this.checkpointPath)
    if (checkpoint.ok) return result
    return {
      ...result,
      ok: false,
      data: isRecord(result.data) ? { ...result.data, checkpoint } : { checkpoint },
      issues: [...result.issues, ...checkpoint.issues],
    }
  }

  handleRequest(request: JsonRpcRequest): JsonRpcResponse | undefined {
    const id = request.id ?? null
    switch (request.method) {
      case 'initialize':
        return resultResponse(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'ppte', version: SERVER_VERSION },
          instructions: 'Use inspect_document before editing. Preview every Transaction before committing it.',
        })
      case 'notifications/initialized':
        return undefined
      case 'ping':
        return resultResponse(id, {})
      case 'tools/list':
        return resultResponse(id, { tools: this.listTools() })
      case 'tools/call':
        return resultResponse(id, this.handleToolCall(request.params))
      default:
        throw new McpProtocolError(-32601, `Method not found: ${request.method}`)
    }
  }

  private handleToolCall(rawParams: unknown): { content: Array<{ type: 'text'; text: string }>; isError: boolean } {
    if (!isRecord(rawParams)) throw new McpProtocolError(-32602, 'tools/call params must be an object')
    if (typeof rawParams.name !== 'string' || rawParams.name.length === 0) throw new McpProtocolError(-32602, 'tools/call requires a tool name')
    const rawArguments = rawParams.arguments
    if (rawArguments !== undefined && !isRecord(rawArguments)) throw new McpProtocolError(-32602, 'tools/call arguments must be an object')
    const result = this.callTool(rawParams.name, rawArguments ?? {})
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      isError: !result.ok,
    }
  }
}

export function createMcpRuntime(checkpointPath: string, options: McpRuntimeOptions = {}): PpteMcpRuntime {
  const absolutePath = resolve(checkpointPath)
  const opened = openCheckpoint(absolutePath, { recovery: 'recover', discoverAllJournals: true })
  if (opened.recovery?.status === 'ambiguous' || opened.recovery?.status === 'rejected') {
    const message = opened.recovery.issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n') || 'Checkpoint recovery was rejected.'
    throw new Error(message)
  }

  if (options.readonly) {
    const session = new PpteSession(opened.document)
    return new PpteMcpRuntime(session, new AgentToolServer(session, { grantedScope: options.grantedScope }), absolutePath, true)
  }

  const journalPath = opened.recovery?.journalPath ?? join(dirname(absolutePath), 'recovery.journal')
  const journalState = readJournal(journalPath)
  const header = journalState.header ?? newJournalHeader(opened.document, opened.manifest.compatibilityProfile)
  const journal = new RecoveryJournal(journalPath, header)
  const checkpoint: CheckpointAdapter<string, undefined> = {
    write: (document, target, _options, recentTransactions) => checkpointDocument(document, target, opened.manifest.compatibilityProfile, recentTransactions),
    clearRecovery: () => journal.clear(),
  }
  const session = new PpteSession(opened.document, { journal, checkpoint })
  return new PpteMcpRuntime(session, new AgentToolServer(session, { grantedScope: options.grantedScope }), absolutePath, false)
}

export function parseMcpCliArgs(argv: string[]): McpCliOptions {
  const checkpointPath = argv[0]
  if (!checkpointPath || checkpointPath.startsWith('--')) throw new Error('Usage: node dist/apps/mcp/index.js <path.ppte> [--readonly] [--scope <json>]')
  let readonly = false
  let grantedScope: TransactionScope | undefined
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--readonly') {
      readonly = true
      continue
    }
    if (argument === '--scope') {
      const raw = argv[++index]
      if (!raw) throw new Error('--scope requires a JSON value')
      grantedScope = parseScope(raw)
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }
  return { checkpointPath, readonly, ...(grantedScope ? { grantedScope } : {}) }
}

export async function runMcpCli(argv = process.argv.slice(2)): Promise<void> {
  const options = parseMcpCliArgs(argv)
  const runtime = createMcpRuntime(options.checkpointPath, options)
  await serveStdio(runtime)
}

function checkpointDocument(
  document: PpteDocument,
  target: string,
  compatibilityProfile: string,
  recentTransactions?: ReadonlyArray<Transaction>,
): CheckpointResult {
  const payload = readCheckpointPayload(target, document)
  return writeCheckpoint(document, target, {
    clean: false,
    timestamp: new Date().toISOString(),
    compatibilityProfile,
    recentTransactions: recentTransactions?.length ? [...recentTransactions] : [],
    assetBytes: payload.assetBytes,
    fontBytes: payload.fontBytes,
  })
}

function readCheckpointPayload(target: string, document: PpteDocument): { assetBytes: Record<string, Uint8Array>; fontBytes: Record<string, Uint8Array> } {
  const archive = readStoredZip(new Uint8Array(readFileSync(target)))
  const assetBytes: Record<string, Uint8Array> = {}
  for (const asset of Object.values(document.assets)) {
    const data = archive.get(asset.path)
    if (!data) throw new Error(`ASSET_MISSING: checkpoint does not contain ${asset.id}`)
    assetBytes[asset.id] = data
  }
  const fontBytes: Record<string, Uint8Array> = {}
  for (const font of Object.values(document.fonts)) {
    if (font.source !== 'embedded') continue
    const data = archive.get(font.path ?? `fonts/${font.id}.woff2`)
    if (!data) throw new Error(`FONT_MISSING: checkpoint does not contain ${font.id}`)
    fontBytes[font.id] = data
  }
  return { assetBytes, fontBytes }
}

function newJournalHeader(document: PpteDocument, compatibilityProfile: string): RecoveryJournalHeader {
  return {
    journalVersion: '1',
    documentId: document.documentId,
    baseCheckpointRevision: canonicalRevision(document),
    sessionId: `mcp-${process.pid}-${Date.now()}`,
    createdAt: new Date().toISOString(),
    compatibilityProfile,
  }
}

function parseScope(raw: string): TransactionScope {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (cause) {
    throw new Error(`--scope must be valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (!isRecord(value) || typeof value.kind !== 'string' || !Array.isArray(value.permissions)) throw new Error('--scope must be a TransactionScope JSON object')
  return value as unknown as TransactionScope
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const entryPath = process.argv[1]
if (entryPath && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  runMcpCli().catch((cause) => {
    process.stderr.write(`ppte-mcp: ${cause instanceof Error ? cause.message : String(cause)}\n`)
    process.exitCode = 1
  })
}
