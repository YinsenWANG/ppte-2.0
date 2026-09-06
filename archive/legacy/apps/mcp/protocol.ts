import { createInterface } from 'node:readline'

export type JsonRpcId = string | number | null

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method: string
  params?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export interface JsonRpcHandler {
  handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | undefined> | JsonRpcResponse | undefined
}

export class McpProtocolError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) {
    super(message)
    this.name = 'McpProtocolError'
  }
}

/** Minimal MCP stdio transport: one JSON-RPC message per UTF-8 line. */
export async function serveStdio(
  handler: JsonRpcHandler,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<void> {
  const lines = createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      const response = await parseAndHandle(handler, line)
      if (response) output.write(`${JSON.stringify(response)}\n`)
    }
  } finally {
    lines.close()
  }
}

async function parseAndHandle(handler: JsonRpcHandler, line: string): Promise<JsonRpcResponse | undefined> {
  if (!line.trim()) return undefined
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch (cause) {
    return errorResponse(null, -32700, `Parse error: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (!isRequest(value)) return errorResponse(requestId(value), -32600, 'Invalid Request')
  const notification = !Object.prototype.hasOwnProperty.call(value, 'id')
  try {
    const response = await handler.handleRequest(value)
    return notification ? undefined : response
  } catch (cause) {
    if (notification) return undefined
    if (cause instanceof McpProtocolError) return errorResponse(value.id ?? null, cause.code, cause.message, cause.data)
    return errorResponse(value.id ?? null, -32603, cause instanceof Error ? cause.message : String(cause))
  }
}

export function resultResponse(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

export function errorResponse(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }
}

function isRequest(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (candidate.jsonrpc !== '2.0' || typeof candidate.method !== 'string' || candidate.method.length === 0) return false
  if (candidate.id !== undefined && candidate.id !== null && typeof candidate.id !== 'string' && typeof candidate.id !== 'number') return false
  return true
}

function requestId(value: unknown): JsonRpcId {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const id = (value as Record<string, unknown>).id
  return typeof id === 'string' || typeof id === 'number' || id === null ? id : null
}
