/**
 * Small, dependency-free stored ZIP adapter shared by data-only exchange
 * formats. Compression is intentionally not accepted at this boundary so
 * archive limits can be checked before any payload is interpreted.
 */

export interface StoredZipEntry {
  name: string
  data: Uint8Array
}

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
const MAX_ENTRY_BYTES = 256 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 10_000

export function writeStoredZip(entries: StoredZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0
  const names = new Set<string>()
  for (const entry of entries) {
    validatePath(entry.name)
    if (names.has(entry.name)) throw new Error(`ARCHIVE_INVALID: duplicate entry ${entry.name}`)
    names.add(entry.name)
    if (entry.data.length > MAX_ENTRY_BYTES) throw new Error(`ARCHIVE_INVALID: entry exceeds size limit ${entry.name}`)
    const name = bytes(entry.name)
    const data = new Uint8Array(entry.data)
    const crc = crc32(data)
    const local = new Uint8Array(30 + name.length + data.length)
    writeU32(local, 0, 0x04034b50)
    writeU16(local, 4, 20)
    writeU16(local, 6, 0)
    writeU16(local, 8, 0)
    writeU16(local, 10, 0)
    writeU16(local, 12, 0)
    writeU32(local, 14, crc)
    writeU32(local, 18, data.length)
    writeU32(local, 22, data.length)
    writeU16(local, 26, name.length)
    writeU16(local, 28, 0)
    local.set(name, 30)
    local.set(data, 30 + name.length)
    localParts.push(local)

    const central = new Uint8Array(46 + name.length)
    writeU32(central, 0, 0x02014b50)
    writeU16(central, 4, 20)
    writeU16(central, 6, 20)
    writeU16(central, 8, 0)
    writeU16(central, 10, 0)
    writeU16(central, 12, 0)
    writeU16(central, 14, 0)
    writeU32(central, 16, crc)
    writeU32(central, 20, data.length)
    writeU32(central, 24, data.length)
    writeU16(central, 28, name.length)
    writeU16(central, 30, 0)
    writeU16(central, 32, 0)
    writeU16(central, 34, 0)
    writeU16(central, 36, 0)
    writeU32(central, 38, 0)
    writeU32(central, 42, offset)
    central.set(name, 46)
    centralParts.push(central)
    offset += local.length
  }
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error('ARCHIVE_INVALID: too many entries')
  const centralOffset = offset
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  writeU32(end, 0, 0x06054b50)
  writeU16(end, 4, 0)
  writeU16(end, 6, 0)
  writeU16(end, 8, entries.length)
  writeU16(end, 10, entries.length)
  writeU32(end, 12, centralSize)
  writeU32(end, 16, centralOffset)
  writeU16(end, 20, 0)
  const archive = concat([...localParts, ...centralParts, end])
  if (archive.length > MAX_ARCHIVE_BYTES) throw new Error('ARCHIVE_INVALID: archive exceeds size limit')
  return archive
}

export function readStoredZip(data: Uint8Array): Map<string, Uint8Array> {
  if (data.length > MAX_ARCHIVE_BYTES) throw new Error('ARCHIVE_INVALID: archive exceeds size limit')
  const result = new Map<string, Uint8Array>()
  const end = findEndOfCentralDirectory(data)
  const commentLength = readU16(data, end + 20)
  if (end + 22 + commentLength !== data.length) throw new Error('ARCHIVE_INVALID: trailing data or invalid comment length')
  if (readU16(data, end + 4) !== 0 || readU16(data, end + 6) !== 0) throw new Error('ARCHIVE_INVALID: multi-disk archive is not supported')
  const count = readU16(data, end + 10)
  if (readU16(data, end + 8) !== count) throw new Error('ARCHIVE_INVALID: entry counts do not match')
  const centralSize = readU32(data, end + 12)
  const centralOffset = readU32(data, end + 16)
  if (count > MAX_ARCHIVE_ENTRIES || centralOffset > data.length || centralSize > data.length - centralOffset) throw new Error('ARCHIVE_INVALID: unsafe central directory')
  const centralEnd = centralOffset + centralSize
  if (centralEnd !== end) throw new Error('ARCHIVE_INVALID: central directory is not adjacent to end record')
  let cursor = centralOffset
  let totalUncompressed = 0
  const localRanges: Array<{ start: number; end: number }> = []
  for (let index = 0; index < count; index += 1) {
    if (cursor > centralEnd || centralEnd - cursor < 46) throw new Error('ARCHIVE_INVALID: truncated central directory')
    if (readU32(data, cursor) !== 0x02014b50) throw new Error('ARCHIVE_INVALID: invalid central directory')
    const flags = readU16(data, cursor + 8)
    const method = readU16(data, cursor + 10)
    const compressedSize = readU32(data, cursor + 20)
    const uncompressedSize = readU32(data, cursor + 24)
    const nameLength = readU16(data, cursor + 28)
    const extraLength = readU16(data, cursor + 30)
    const commentLengthAtEntry = readU16(data, cursor + 32)
    const localOffset = readU32(data, cursor + 42)
    const centralEntryLength = 46 + nameLength + extraLength + commentLengthAtEntry
    if (centralEntryLength > centralEnd - cursor) throw new Error('ARCHIVE_INVALID: truncated central entry')
    const name = new TextDecoder().decode(data.slice(cursor + 46, cursor + 46 + nameLength))
    validatePath(name)
    if (result.has(name)) throw new Error(`ARCHIVE_INVALID: duplicate entry ${name}`)
    if (flags !== 0 || method !== 0 || compressedSize !== uncompressedSize || compressedSize > MAX_ENTRY_BYTES) throw new Error('ARCHIVE_INVALID: only bounded stored entries are supported')
    totalUncompressed += uncompressedSize
    if (totalUncompressed > MAX_ARCHIVE_BYTES) throw new Error('ARCHIVE_INVALID: uncompressed size exceeds limit')
    if (localOffset > data.length || data.length - localOffset < 30) throw new Error('ARCHIVE_INVALID: truncated local header')
    if (readU32(data, localOffset) !== 0x04034b50 || readU16(data, localOffset + 6) !== 0 || readU16(data, localOffset + 8) !== 0) throw new Error('ARCHIVE_INVALID: unsupported local flags or method')
    const localNameLength = readU16(data, localOffset + 26)
    const localExtraLength = readU16(data, localOffset + 28)
    const localNameStart = localOffset + 30
    const contentStart = localNameStart + localNameLength + localExtraLength
    if (localNameStart + localNameLength > data.length || contentStart < localNameStart || contentStart > data.length) throw new Error('ARCHIVE_INVALID: truncated local entry')
    const localName = new TextDecoder().decode(data.slice(localNameStart, localNameStart + localNameLength))
    if (localName !== name) throw new Error('ARCHIVE_INVALID: central/local name mismatch')
    if (readU32(data, localOffset + 18) !== compressedSize || readU32(data, localOffset + 22) !== uncompressedSize) throw new Error('ARCHIVE_INVALID: local size mismatch')
    const contentEnd = contentStart + compressedSize
    if (contentEnd < contentStart || contentEnd > centralOffset) throw new Error('ARCHIVE_INVALID: entry overlaps central directory')
    if (localRanges.some((range) => contentStart < range.end && contentEnd > range.start)) throw new Error('ARCHIVE_INVALID: local entries overlap')
    localRanges.push({ start: localOffset, end: contentEnd })
    const content = data.slice(contentStart, contentEnd)
    if (crc32(content) !== readU32(data, cursor + 16)) throw new Error(`ARCHIVE_INVALID: CRC mismatch ${name}`)
    result.set(name, new Uint8Array(content))
    cursor += centralEntryLength
  }
  if (cursor !== centralEnd) throw new Error('ARCHIVE_INVALID: central directory size mismatch')
  return result
}

function validatePath(path: string) {
  if (!path || path.startsWith('/') || path.includes('..') || path.includes('\\') || path.includes('\u0000')) throw new Error(`ARCHIVE_INVALID: unsafe path ${path}`)
}
function bytes(value: string): Uint8Array { return new TextEncoder().encode(value) }
function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.length }
  return result
}
function writeU16(buffer: Uint8Array, offset: number, value: number) { buffer[offset] = value & 0xff; buffer[offset + 1] = (value >>> 8) & 0xff }
function writeU32(buffer: Uint8Array, offset: number, value: number) { buffer[offset] = value & 0xff; buffer[offset + 1] = (value >>> 8) & 0xff; buffer[offset + 2] = (value >>> 16) & 0xff; buffer[offset + 3] = (value >>> 24) & 0xff }
function readU16(buffer: Uint8Array, offset: number): number { return buffer[offset] | (buffer[offset + 1] << 8) }
function readU32(buffer: Uint8Array, offset: number): number { return (buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16) | (buffer[offset + 3] << 24)) >>> 0 }
function findEndOfCentralDirectory(data: Uint8Array): number {
  for (let index = data.length - 22; index >= Math.max(0, data.length - 65557); index -= 1) if (readU32(data, index) === 0x06054b50) return index
  throw new Error('ARCHIVE_INVALID: end record not found')
}
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
