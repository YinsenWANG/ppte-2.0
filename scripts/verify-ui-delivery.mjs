import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const out=resolve('docs/ui-redesign/evidence/delivery');
const source=resolve('docs/ui-redesign/evidence/UI07-close/authored.html');
const temp=await mkdtemp(join(tmpdir(),'ppte-closing-'));
const initial=join(temp,'initial.ppte.html'),file=join(out,'把作品带走.ppte.html');
const command=['dist/apps/html-cli/index.js','enhance',source,'--out',initial];
const cli=spawnSync(process.execPath,command,{encoding:'utf8'});
assert.equal(cli.status,0,cli.stderr+cli.stdout);assert.equal(JSON.parse(cli.stdout).ok,true);
await mkdir(out,{recursive:true});
const network=[],errors=[],sessions=[];
let browser;
async function open(path){
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-background-networking']});
 const p=await browser.newPage({offline:true,acceptDownloads:true,viewport:{width:1440,height:1000}});
 p.on('request',r=>{if(/^(https?|wss?):/.test(r.url()))network.push(r.url());});
 p.on('pageerror',e=>errors.push(String(e)));
 await p.goto(pathToFileURL(path).href);await p.waitForFunction(()=>!!window.PPTeSave);
 assert.equal(await p.locator('#ppte-save-ui').getAttribute('data-mode'),'read');
 assert.equal(await p.evaluate(()=>localStorage.length),0);
 sessions.push({browser:browser.version(),protocol:new URL(p.url()).protocol,emptyLocalStorage:true});return p;
}
async function history(p){await p.getByText('更多',{exact:true}).click();await p.getByRole('menuitem',{name:'版本历史',exact:true}).click();}
async function checkpoint(p,name){await history(p);p.once('dialog',d=>d.accept(name));await p.getByRole('button',{name:'保存命名版本',exact:true}).click();await p.locator('#ppte-versions section').filter({hasText:name}).waitFor();await p.getByRole('button',{name:'关闭版本历史',exact:true}).click();}
try{
 let p=await open(initial);await p.getByRole('button',{name:'编辑',exact:true}).click();await checkpoint(p,'交付 · 第一稿');
 await p.getByRole('button',{name:'下一页',exact:true}).click();
 await p.frameLocator('#ppte-frame').locator('[data-ppte-kind=text]').fill('第二稿 · 继续表达');await checkpoint(p,'交付 · 第二稿');
 await history(p);p.once('dialog',d=>d.accept());await p.locator('#ppte-versions section').filter({hasText:'交付 · 第一稿'}).getByRole('button',{name:'恢复到此版本',exact:true}).click();
 await p.waitForFunction(()=>!window.PPTeHTML.content().includes('第二稿 · 继续表达'));
 await p.getByRole('button',{name:'关闭版本历史',exact:true}).click();
 const event=p.waitForEvent('download');await p.getByRole('button',{name:'下载更新后的文件',exact:true}).click();const d=await event;await d.saveAs(file);assert.equal(await d.failure(),null);
 assert.match(await p.getByRole('status').innerText(),/原文件未覆盖/);
 await browser.close();p=await open(file);
 await p.screenshot({path:join(out,'reading.png')});
 await history(p);const rows=p.locator('#ppte-versions section');assert.equal(await rows.filter({hasText:'恢复前'}).count(),1);
 await rows.filter({hasText:'交付 · 第二稿'}).getByRole('button',{name:'预览',exact:true}).click();
 assert.equal(await p.frameLocator('iframe[title="版本预览（只读）"]').locator('[data-ppte-kind=text]').innerText(),'第二稿 · 继续表达');
 await p.screenshot({path:join(out,'history.png')});await p.getByRole('button',{name:'关闭版本历史',exact:true}).click();
 await p.getByRole('button',{name:'下一页',exact:true}).click();
 assert.equal(await p.frameLocator('#ppte-frame').locator('[data-ppte-kind=text]').innerText(),'第一稿 · 保留想法');
 for(const selector of ['[data-ppte-kind=shape]','img','table'])assert.equal(await p.frameLocator('#ppte-frame').locator(selector).count(),1);
 await p.screenshot({path:join(out,'content.png')});await p.getByRole('button',{name:'放映',exact:true}).click();assert.equal(await p.locator('#ppte-save-ui').isVisible(),false);await p.mouse.move(700,300);assert.equal(await p.locator('#ppte-save-ui').isVisible(),false);await p.keyboard.press('Escape');assert.equal(await p.locator('#ppte-save-ui').getAttribute('data-mode'),'read');
 assert.deepEqual(network,[]);assert.deepEqual(errors,[]);
 const bytes=await readFile(file);const record={timestamp:new Date().toISOString(),commit:spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim(),command:'node scripts/verify-ui-delivery.mjs',cli:{command:['node',...command].join(' '),result:JSON.parse(cli.stdout)},status:'passed',file:'docs/ui-redesign/evidence/delivery/把作品带走.ppte.html',source:'docs/ui-redesign/evidence/UI07-close/authored.html',sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,headless:true,offline:true,sessions,wholeBrowserShutdowns:1,network,errors,checks:['CLI enhance authored HTML','UI two named versions and restore-before checkpoint','actual download','fresh Chrome process file:// read','read-only second-version preview','four current objects','clean presentation and Escape'],nativePermissions:null,humanReview:null,reason:'Chrome headless download evidence only; native authorization and human review unavailable.'};
 await writeFile(join(out,'open-check.json'),JSON.stringify(record,null,2)+'\n');
 console.log(JSON.stringify(record));
}finally{await browser?.close();}
