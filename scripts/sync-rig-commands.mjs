// Regenerates the v2 Learn page's command list from the brain (its canonical home), trimmed to the
// fields the panel shows. Brain first, then `npm run rig-commands:sync`, then prettier.
// Source: ~/dev/ad/brains/openrig/rig-commands.json (override with RIG_COMMANDS_SRC).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const src =
  process.env.RIG_COMMANDS_SRC ?? join(homedir(), 'dev/ad/brains/openrig/rig-commands.json');
const dst = new URL('../client/src/v2/pages/learn/rig-commands.json', import.meta.url);
if (!existsSync(src)) {
  console.error(`rig-commands:sync: no file at ${src}`);
  process.exit(1);
}
const brain = JSON.parse(readFileSync(src, 'utf8'));

const FIELDS = [
  'command',
  'group',
  'usage',
  'openrig_says',
  'plain',
  'when_to_use',
  'when_not',
  'effect',
  'where_to_run',
  'example',
  'curated',
  'status',
  'is_group',
];
const trim = (c) => Object.fromEntries(FIELDS.map((k) => [k, c[k] ?? null]));

const out = {
  schema: brain.schema,
  openrig_version: brain.openrig_version,
  generated: brain.generated,
  source: `${brain.source} · copied from brains/openrig/rig-commands.json`,
  effects: brain.effects,
  commands: brain.commands.map(trim),
};
writeFileSync(dst, `${JSON.stringify(out, null, 2)}\n`);
console.log(
  `rig-commands:sync: ${brain.commands.length} commands (OpenRig ${brain.openrig_version}) -> client/src/v2/pages/learn/rig-commands.json`
);
