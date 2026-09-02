import { writeCheckpoint } from '../packages/file-format/src/index.js'
import { makeContractDocument } from '../apps/contract-deck/index.js'

const target = process.argv[2]
const readyFile = process.argv[3]
if (!target || !readyFile) process.exit(2)
const { document, imageBytes } = makeContractDocument()
writeCheckpoint(document, target, { assetBytes: { asset_pixel: imageBytes }, readyFile, pauseBeforeRenameMs: 10000 })
