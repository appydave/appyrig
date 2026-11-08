import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SEP = '|';

/** One exemption: where it is read from, what kind, and the path or rule it exempts. */
export const make = ({ source, where = '', kind, pattern }) => ({
  key: [source, ...(where ? [where] : []), kind, pattern].join(SEP),
  source,
  where,
  kind,
  pattern,
});

const QUOTED = /'([^']+)'/g;

/**
 * The quoted names in the first list `pattern` finds in a config's text. A config that runs on import
 * cannot be loaded, so its list is read as text; a read that finds nothing must stop the run, or a
 * reworded config would empty the list and read as "no exemptions".
 */
export function quotedIn({ root, file, pattern }) {
  const found = [
    ...(pattern.exec(readFileSync(join(root, file), 'utf8'))?.[1] ?? '').matchAll(QUOTED),
  ];

  if (found.length === 0) {
    throw new Error(
      `${file}: found no exemption list with ${pattern}. The config was probably reworded, so docs/gates.md would list nothing for it. Update the pattern in scripts/gates-doc (files.mjs or configs.mjs) to match the new wording.`
    );
  }

  return found.map((m) => m[1]);
}
