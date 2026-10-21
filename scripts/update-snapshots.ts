// Rewrites test/fixtures/snapshots/*.json from the recorded captures. Run it on purpose, read the
// diff, and commit it: the collector test only compares, it never writes (a switch that rewrites the
// expected value makes every change pass).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES } from '../collector/src/adapters/fixtureSources.js';
import { SNAPSHOT_CASES } from '../collector/src/snapshotCases.js';

for (const [name, build] of SNAPSHOT_CASES) {
  const file = join(FIXTURES, 'snapshots', `${name}.json`);

  writeFileSync(file, JSON.stringify(await build(), null, 2) + '\n');
  console.log(`snapshots:update: wrote ${file}`);
}
