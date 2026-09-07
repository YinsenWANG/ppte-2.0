// Explicit F04A evidence preparation; never imported by the product.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
const out=resolve('docs/focused-product/evidence/F04A');
await mkdir(`${out}/inputs`,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const browser=await chromium.launch({channel:'chrome',headless:true});
const p=await browser.newPage({offline:true,viewport:{width:1440,height:960}});
const upstream=['docs/ui-redesign/UI_PROTOTYPE.html','docs/audits/2026-09-07-main-d1db13d/sample/source.html'];
const sources=await Promise.all(upstream.map(async path=>({path,sha256:sha(await readFile(path))})));
await p.goto(pathToFileURL(resolve(upstream[0])).href);
const proto=await p.evaluate(()=>({style:document.querySelector('style').textContent,pages:slides.map((s,i)=>{go(i);return document.querySelector('#slide').outerHTML;})}));
// Retain original style sheet and page DOM. Only remove workspace scale/position.
await writeFile(`${out}/inputs/prototype.html`,`<!doctype html><meta charset="utf-8"><style>${proto.style}\nbody{overflow:visible}#slide{transform:none!important;position:relative!important}</style>${proto.pages.join('\n')}`);
await copyFile(upstream[1],`${out}/inputs/cherry.html`);
const img=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=240;c.height=120;const x=c.getContext('2d');x.fillStyle='#ff000080';x.fillRect(0,0,160,120);x.fillStyle='#0000ff';x.fillRect(160,0,80,120);return c.toDataURL();});
await writeFile(`${out}/inputs/fixtures.html`,`<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:F04AEmbedded;src:url('embedded.ttf')}*{box-sizing:border-box}body{margin:0;font:24px F04AEmbedded,sans-serif;color:#182734}.slide{width:960px;height:540px;padding:40px;position:relative;overflow:hidden;background:white}h1{font-size:38px;line-height:1.3;margin:0 0 24px}p{line-height:1.5}.grid{display:grid;grid-template-columns:2fr 1fr;gap:28px}.flex{display:flex;justify-content:space-between;background:#d9eee7;padding:20px}.box{height:130px;background:linear-gradient(35deg,#136a50,#aadfc5);box-shadow:12px 10px 16px #20304070;border-radius:25px}.red{background:#f00;width:100px;height:100px}.blue{background:#00f;width:100px;height:100px}
</style>
<section class="slide" data-case="fonts"><h1>中文多行：第一行<br>第二行 English 2026</h1><p>嵌入字体，复制顺序：甲乙丙丁。<br>Mixed 中文 punctuation，标点 &amp; 123。</p><p style="font-family:F04AMissing,serif">缺失字体 F04AMissing：不得静默替换。</p></section>
<section class="slide" data-case="grid-flex"><h1>Grid / Flex 布局与文字顺序</h1><div class="grid"><div><p>左列第一段<br>左列第二行</p><div class="flex"><span>一 Alpha</span><span>二 Beta</span></div></div><div><p>右列第三段<br>右列第四行</p></div></div><table style="margin-top:30px;border-collapse:collapse"><tr><td style="border:2px solid">表格甲</td><td style="border:2px solid">表格乙</td></tr></table></section>
<section class="slide" data-case="effects"><h1>SVG、透明图、裁切、渐变阴影</h1><div class="grid"><div class="box"></div><svg width="200" height="130" viewBox="0 0 200 130"><circle cx="65" cy="65" r="60" fill="#f00"/><path d="M80 10L190 120H80Z" fill="#00f" opacity=".65"/><text x="12" y="75" font-size="18">SVG 文字</text></svg></div><img alt="透明红色与蓝色裁切图" src="${img}" style="width:170px;height:110px;object-fit:cover;object-position:100% 50%;margin-top:30px"><p>透明区域应与白底混合，右侧保留蓝色。</p></section>
<section class="slide" data-case="transforms" style="width:640px;height:800px"><h1>不同页面尺寸与复杂变换</h1><div style="transform:rotate(-12deg) skewX(8deg);transform-origin:20% 60%;margin:90px 40px;background:#d9eee7;padding:24px"><p style="transform:translate(13px,7px) scale(.92)">变换后的中文 Text<br>选区应贴合可见字形</p></div><div style="perspective:700px;margin:60px"><div style="transform:rotateY(28deg);background:linear-gradient(90deg,#df9,#4a8);padding:28px">三维变换 3D</div></div></section>
<section class="slide" data-case="colors"><h1>红蓝正样本</h1><div class="flex"><div class="red"></div><div class="blue"></div></div><p>两种颜色都必须保留。</p></section>
<section class="slide" data-case="missing-red"><h1>缺红负样本</h1><div class="flex"><div style="width:100px"></div><div class="blue"></div></div><p>此页故意没有红色。</p></section>
<section class="slide" data-case="missing-blue"><h1>缺蓝负样本</h1><div class="flex"><div class="red"></div><div style="width:100px"></div></div><p>此页故意没有蓝色。</p></section>`);
await writeFile(`${out}/inputs/subset-text.txt`,(await Promise.all(['prototype','cherry','fixtures'].map(n=>readFile(`${out}/inputs/${n}.html`,'utf8')))).join(''));
await writeFile(`${out}/freeze.json`,JSON.stringify({frozenAt:new Date().toISOString(),baselineCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sources,environment:{platform:os.platform(),release:os.release(),arch:os.arch(),node:process.version,browser:browser.version(),headless:true,offline:true,viewport:{width:1440,height:960},deviceScaleFactor:1},font:{upstream:'https://github.com/google/fonts/tree/main/ofl/notosanssc',sourceSHA256:sha(await readFile(process.env.F04A_FONT_SOURCE || '/tmp/d04-noto.ttf')),license:'OFL-1.1',note:'Locally cached original Noto Sans SC; subset for fixtures and explicit candidate font substitution only. Original prototype/Cherry fonts preserved in reference/Chromium.'}},null,2));
await browser.close();
