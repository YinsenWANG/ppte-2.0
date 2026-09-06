// Synthetic Apache-2.0 C01 originals; run deliberately after pnpm build.
import {makeCoreDocument} from './blackbox-fixtures.mjs';
import {PpteSession} from '../dist/packages/core/src/index.js';
import {canonicalRevision} from '../dist/packages/canonical-json/src/index.js';
import {buildCheckpointBytes} from '../dist/packages/file-format/src/index.js';
import {buildPortable} from '../dist/packages/portable-runtime/src/index.js';
import {mkdirSync,writeFileSync} from 'node:fs';
const dir='tests/fixtures/evolution';mkdirSync(dir,{recursive:true});
const document=makeCoreDocument();document.assets={};document.fonts={};const slide=document.slides.bb_slide_main;slide.elements={};slide.rootOrder=[];slide.readingOrder=[];delete slide.background;
const session=new PpteSession(document);
const transaction={transactionId:'c01-background',baseRevision:session.getRevision(),actor:{type:'human',id:'synthetic-c01'},scope:{kind:'document',permissions:['style','structure'],allowInsert:false,allowDelete:false},changeContract:{allowedOperationKinds:['slide.update'],maxChangedSlides:1},createdAt:'2026-09-06T00:00:00Z',operations:[{opId:'background',kind:'slide.update',slideId:slide.id,patch:{background:{kind:'solid',color:{kind:'value',value:'#112233'}}}}]};
const result=session.commit(transaction);if(!result.ok)throw Error(JSON.stringify(result));
const bad=structuredClone([...session.getHistory()]);bad[0].inverse.operations=[{opId:'legacy-inverse',kind:'slide.update',slideId:slide.id,patch:{}}];
const data={document,transaction,expected:{beforeRevision:canonicalRevision(document),afterRevision:session.getRevision()},legacySerializedInverse:bad[0].inverse,invalidHistory:bad};
writeFileSync(`${dir}/history-background.json`,JSON.stringify(data,null,2)+'\n');
writeFileSync(`${dir}/legacy-profile.ppte`,buildCheckpointBytes(document,{timestamp:'2026-09-06T00:00:00Z'}));
const built=buildPortable(document,{profile:'full-portable',derivedAt:'2026-09-06T00:00:00Z'});if(!built.ok)throw Error(JSON.stringify(built.issues));
const old=built.html.replace(/(<script id="ppte-portable-payload"[^>]*>)([\s\S]*?)(<\/script>)/,(_,a,b,c)=>{const payload=JSON.parse(b);delete payload.artifactIdentity;return a+JSON.stringify(payload)+c;});
if(old===built.html)throw Error('payload pattern did not match');writeFileSync(`${dir}/legacy-identity.html`,old);
