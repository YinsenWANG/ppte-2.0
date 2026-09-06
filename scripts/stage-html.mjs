// Compatibility alias for H02's installed-package verification, same candidate.
import { stagePackage } from './stage-package.mjs';
import { mkdir } from 'node:fs/promises';
await mkdir('artifacts',{recursive:true});
console.log(await stagePackage('artifacts/html-package'));
