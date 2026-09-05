import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
// Node packaging adapter. The browser uses shared.ts and the same PpteSession.
import { portableBrowserScript } from './browser-bundle.js'
import { configurePortableScript, configurePortablePlatform } from './shared.js'
configurePortableScript(portableBrowserScript)
export * from './shared.js'

configurePortablePlatform({gzip: gzipSync, hash: data => createHash('sha256').update(data).digest('hex'), base64: data => Buffer.from(data).toString('base64')})
