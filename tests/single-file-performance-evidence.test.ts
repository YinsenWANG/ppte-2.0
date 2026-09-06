import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { compareEditorSamples } = await import(pathToFileURL(resolve('scripts/html-benchmark.mjs')).href);
test('S04 evidence refuses changed environment, content, undersampling and nonfinite timings',()=>{
 const record={sourceSha256:'same',environment:{referenceFrozen:false},samples:{pages:12,text:'all facts',input:Array(30).fill(20),turn:Array(30).fill(30),save:Array(10).fill(850)}};
 assert.equal(compareEditorSamples(record,record).status,'partial');
 for(const altered of [{...record,sourceSha256:'other'},{...record,environment:{}},{...record,samples:{...record.samples,text:'fewer facts'}},{...record,samples:{...record.samples,input:[1]}},{...record,samples:{...record.samples,save:Array(10).fill(NaN)}}])assert.throws(()=>compareEditorSamples(record,altered));
});
