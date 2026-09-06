// Candidate packaging verification; this is neither publication nor H06 acceptance.
import { spawnSync } from 'node:child_process';
for (const test of ['dist/tests/html-package.test.js','dist/tests/html-player.test.js']) {
  const result=spawnSync(process.execPath,['--test',test],{stdio:'inherit'});
  if(result.status!==0)process.exit(result.status??1);
}
console.log('HTML candidate package and separate PDF checks passed. H00/H02/H04/H06 gaps remain in TASKS.json.');
