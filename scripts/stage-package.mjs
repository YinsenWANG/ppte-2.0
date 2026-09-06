import { build } from 'esbuild';
import { mkdir, writeFile, readFile, cp, chmod, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export async function stagePackage(target='artifacts/npm-package') {
  target=resolve(target);
  // Never clear an arbitrary caller directory. Only replace our own staging output.
  try {
    if ((await readFile(`${target}/.ppte-stage`, 'utf8')) !== 'html-first\n') throw Error('NOT_A_STAGE');
    await rm(target,{recursive:true});
  } catch(e) { if(e.code!=='ENOENT')throw e; }
  await mkdir(target,{recursive:false});
  await writeFile(`${target}/.ppte-stage`,'html-first\n');
  const result=await build({entryPoints:['apps/html-cli/index.ts'],bundle:true,platform:'node',format:'esm',target:'node22',minify:true,metafile:true,banner:{js:"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"},outfile:`${target}/ppte.js`});
  await chmod(`${target}/ppte.js`,0o755);
  const repo=JSON.parse(await readFile('package.json','utf8'));
  await writeFile(`${target}/package.json`,JSON.stringify({name:'ppte-html',version:repo.version,description:repo.description,type:'module',bin:{ppte:'ppte.js'},engines:{node:'>=22'},license:repo.license,files:['ppte.js','skills','README.md','LICENSE','dependency-graph.json']},null,2)+'\n');
  await cp('skills/ppte',`${target}/skills/ppte`,{recursive:true});
  await cp('README-AGENT.md',`${target}/README.md`);await cp('LICENSE',`${target}/LICENSE`);
  const runtime=await build({entryPoints:['packages/html-document/src/runtime.ts'],bundle:true,platform:'browser',write:false,metafile:true});
  await writeFile(`${target}/dependency-graph.json`,JSON.stringify({cli:result.metafile,runtime:runtime.metafile},null,2)+'\n');
  return target;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){await mkdir('artifacts',{recursive:true});console.log(await stagePackage(process.argv[2]));}
