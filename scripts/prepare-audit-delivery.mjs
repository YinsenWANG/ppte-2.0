import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const evidence=resolve('docs/audits/2026-09-08-main-52e3bf0/evidence/DLV');
const verification=join(evidence,'verification');await mkdir(verification,{recursive:true});
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const version=`audit-followup-${commit.slice(0,7)}-${Date.now()}`;
const install=join(homedir(),'.local','ppte-html-'+version);
const skill=join(homedir(),'.codex','skills','ppte-html-'+version);
const commands=[];
function run(command,args){const startedAt=new Date().toISOString(),r=spawnSync(command,args,{encoding:'utf8'});commands.push({command,args,startedAt,finishedAt:new Date().toISOString(),status:r.status,stdout:r.stdout,stderr:r.stderr});assert.equal(r.status,0,r.stdout+'\n'+r.stderr);return r.stdout;}
const sha=b=>createHash('sha256').update(b).digest('hex');
try{
 run('pnpm',['package:pack']);
 const tarball=resolve('artifacts/ppte-html-1.0.0-html.0.tgz');
 run('npm',['install','--prefix',install,'--offline','--ignore-scripts',tarball]);
 const pkg=join(install,'node_modules/ppte-html'),cli=join(pkg,'ppte.js');
 run(process.execPath,[cli,'--help']);run(process.execPath,[cli,'skill-install','--out',skill]);
 const skillBytes=await readFile('skills/ppte/SKILL.md'),readme=await readFile('README-AGENT.md');
 assert.deepEqual(await readFile(join(skill,'SKILL.md')),skillBytes);
 assert.deepEqual(await readFile(join(pkg,'skills/ppte/SKILL.md')),skillBytes);
 assert.deepEqual(await readFile(join(pkg,'README.md')),readme);
 const source=resolve('docs/usability-reset/evidence/U01/source/full-deck.html');
 const delivery=join(evidence,'delivery','Cherry-Studio-开源之路.ppte.html');
 await mkdir(join(evidence,'delivery'),{recursive:true});
 const started=performance.now();run(process.execPath,[cli,'enhance',source,'--out',delivery]);
 await writeFile(join(verification,'installation.json'),JSON.stringify({commit,platform:process.platform,arch:process.arch,node:process.version,install,skill,cli,commands,enhancement:{calls:1,milliseconds:performance.now()-started},sha256:{source:sha(await readFile(source)),tarball:sha(await readFile(tarball)),cli:sha(await readFile(cli)),skill:sha(skillBytes),readme:sha(readme),delivery:sha(await readFile(delivery))}},null,2)+'\n');
}finally{await writeFile(join(verification,'installation-commands.json'),JSON.stringify(commands,null,2)+'\n');}
