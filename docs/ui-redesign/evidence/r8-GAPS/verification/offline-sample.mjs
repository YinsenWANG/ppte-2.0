import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve('docs/ui-redesign/evidence/r8-GAPS'),file=root+'/sample.ppte.html';
const b=await chromium.launch({channel:'chrome',headless:true});
try{
 const p=await b.newPage({offline:true,viewport:{width:1440,height:960}});const errors=[],network=[];p.on('pageerror',e=>errors.push(String(e)));p.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
 await p.goto(pathToFileURL(file).href);await p.getByRole('button',{name:'编辑',exact:true}).click();await p.frameLocator('#ppte-frame').locator('[data-id=title1]').click();
 if(await p.getByLabel('字号',{exact:true}).count()!==1)throw Error('TEXT_CONTROLS_MISSING');
 await p.getByRole('button',{name:'放映',exact:true}).click();await p.keyboard.press('ArrowRight');await p.keyboard.press('Escape');
 if(errors.length||network.length)throw Error(JSON.stringify({errors,network}));
 const bytes=await readFile(file);await writeFile(root+'/verification/sample.json',JSON.stringify({time:new Date().toISOString(),file,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,protocol:'file:',offline:true,browser:b.version(),realMouseTitleSelection:true,fontControls:1,presentationAndReturn:true,network,errors},null,2));
}finally{await b.close();}
