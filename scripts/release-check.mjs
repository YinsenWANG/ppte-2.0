// Release automation is not native-browser or human acceptance.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
const tests=readdirSync('dist/tests').filter(name=>name.endsWith('.test.js')).sort().map(name=>`dist/tests/${name}`);
if(!tests.length)throw Error('No compiled tests; run pnpm build first');
const result=spawnSync(process.execPath,['--test',...tests],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status??1);
console.log('All current HTML and single-file automation passed. Native picker, IME, print dialog, Safari journeys, no-Node target and human acceptance remain separately tracked in docs/single-file-first/TASKS.json.');
