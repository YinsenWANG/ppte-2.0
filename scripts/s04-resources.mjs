import { embedResources } from '../dist/packages/html-document/src/resources.js';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash } from './html-benchmark.mjs';
const root=await mkdtemp(join(tmpdir(),'s04-media-')),label=process.argv[2];
try {
 const bytes=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>');
 await writeFile(join(root,'image.svg'),bytes);
 const input=Array.from({length:40},()=>'<img src="image.svg">').join('');
 let encodings=0;const original=Buffer.prototype.toString;
 Buffer.prototype.toString=function(...args){if(args[0]==='base64')encodings++;return original.apply(this,args);};
 const traces=[];
 for(let i=0;i<6;i++){const start=performance.now(),before=encodings;const output=await embedResources(input,{root,base:root});traces.push({heat:i?'hot':'cold-process-cache',elapsedMs:performance.now()-start,base64Calls:encodings-before,mediaBytes:output.mediaBytes,outputSha256:hash(output.html),metrics:output.metrics??'unavailable in baseline'});}
 Buffer.prototype.toString=original;
 await writeFile(`docs/single-file-first/evidence/s04/resources-${label}.json`,JSON.stringify({inputSha256:hash(input),assetSha256:hash(bytes),traces},null,2)+'\n');
}finally{await rm(root,{recursive:true,force:true});}
