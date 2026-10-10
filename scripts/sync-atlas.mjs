// Copies the OpenRig Concept Atlas from the brain (its canonical home) into the client.
// Brain first, then `npm run atlas:sync`. Source: ~/dev/ad/brains/openrig/atlas/concept-atlas.json
import { copyFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const src =
  process.env.ATLAS_SRC ?? join(homedir(), 'dev/ad/brains/openrig/atlas/concept-atlas.json');
const dst = new URL('../client/src/learn/atlas.json', import.meta.url);
if (!existsSync(src)) {
  console.error(`atlas:sync: no atlas at ${src}`);
  process.exit(1);
}
copyFileSync(src, dst);
console.log(`atlas:sync: ${src} -> client/src/learn/atlas.json`);
