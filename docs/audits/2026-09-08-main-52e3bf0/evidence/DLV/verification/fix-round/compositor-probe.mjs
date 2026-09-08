import assert from 'node:assert/strict';
import {chromium} from 'playwright';import {mkdir,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const out=resolve('artifacts/r03-compositor-'+(process.argv.includes('--software')?'software':'default'));await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:process.argv.includes('--software')?['--disable-gpu']:[]});
try{for(const name of ['contain-percentage']){
 const p=await browser.newPage({offline:true,deviceScaleFactor:1,viewport:{width:1440,height:1000}});const b=name=>p.getByRole('button',{name,exact:true}),img=p.frameLocator('#ppte-frame').locator('#subject');
 await p.goto(pathToFileURL(resolve('artifacts/audit-followup-r03/'+name+'.html')).href);await b('编辑').click();await img.click();await b('阅读').click();
 const before=await img.screenshot({caret:'initial'}),r=await img.boundingBox();await writeFile(out+'/'+name+'-before.png',before);
 for(let i=0;i<3;i++){
 await b('编辑').click();await img.click();await b('裁切').click();await p.screenshot({caret:'initial'});await b('完成').click();await b('阅读').click();
 const after=await img.screenshot({caret:'initial'}),box=await img.boundingBox();
 if(!before.equals(after)){
 await writeFile(out+'/'+name+'-after.png',after);const samples=[];
 for(let j=0;j<5;j++){const v=await img.screenshot({caret:'initial'});await writeFile(out+'/'+name+'-later-'+j+'.png',v);samples.push({baselineEqual:before.equals(v),afterEqual:after.equals(v)});}
 console.log(JSON.stringify({name,iteration:i,before:r,after:box,samples}));assert.deepEqual(after,before,'single-capture cross-mode raster bytes');
 }if(i===2)console.log(JSON.stringify({name,iterations:3,equal:true}));
 }await p.close();
}}finally{await browser.close();}
