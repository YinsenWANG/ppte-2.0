import { build } from 'esbuild';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
const target='artifacts/html-package';
await mkdir(target,{recursive:true});
await build({entryPoints:['apps/html-cli/index.ts'],bundle:true,platform:'node',format:'esm',target:'node22',banner:{js:"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"},outfile:`${target}/ppte.js`});
await chmod(`${target}/ppte.js`,0o755);
await writeFile(`${target}/package.json`,JSON.stringify({name:'ppte-html',version:'0.1.0-h02',type:'module',bin:{ppte:'ppte.js'},engines:{node:'>=22'},license:'Apache-2.0'},null,2));
console.log(target);
