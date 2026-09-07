import {spawn,execFileSync} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import os from 'node:os';
const out=resolve('docs/focused-product/evidence/F04A/verification');
const result={task:'F04A',status:'running',commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(),branch:execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),startedAt:new Date().toISOString(),platform:{os:os.platform(),release:os.release(),arch:os.arch(),node:process.version},commands:[],verification:{code:'passed',automated:'pending','real-browser':'pending',human:'pending'},conclusion:3,routeQuality:'neither-qualified',reason:'Validation tools and regression success do not qualify PDF fidelity. Headless file:// is automated only; desktop drag-selection/copy/search and human visual acceptance unavailable.',initialUntrackedFilesPreserved:['brief9-F04A.md','out9-F01.txt']};
for(const name of ['typecheck','build','test']){
 const startedAt=new Date().toISOString(),start=performance.now();const log=`${name}.log`;const stream=createWriteStream(`${out}/${log}`);
 const command=spawn('pnpm',[name],{stdio:['ignore','pipe','pipe']});command.stdout.pipe(stream,{end:false});command.stderr.pipe(stream,{end:false});
 const outcome=await new Promise((resolve,reject)=>{command.on('error',reject);command.on('close',(exitCode,signal)=>resolve({exitCode,signal}))});
 await new Promise(r=>stream.end(r));
 result.commands.push({command:`pnpm ${name}`,status:outcome.exitCode===0?'passed':'failed',...outcome,startedAt,finishedAt:new Date().toISOString(),durationMs:performance.now()-start,log});
 await writeFile(`${out}/result.json`,JSON.stringify(result,null,2));
 if(outcome.exitCode!==0)break;
}
result.verification.automated=result.commands.length===3 && result.commands.every(c=>c.status==='passed')?'passed':'failed';
result.status=result.verification.automated==='passed'?'validation-passed-routes-not-qualified':'verification-failed';result.finishedAt=new Date().toISOString();
await writeFile(`${out}/result.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
if(result.verification.automated!=='passed')process.exitCode=1;
