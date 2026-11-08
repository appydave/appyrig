import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { make, quotedIn } from './entry.mjs';

const SKIP_DIRS = /SKIP_DIRS\s*=\s*new Set\(\[([^\]]*)\]/;
const NOT_SCANNED = /NOT_SCANNED\s*=\s*\[([^\]]*)\]/;
const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);

/** Every distinct `pathNot` in a dependency-cruiser rule set, plus what it will not follow or cruise. */
function fromDepcruise(source, config) {
  const rules = config.forbidden ?? [];
  const pathNots = rules.flatMap((rule) => [rule.from, rule.to].flatMap((s) => list(s?.pathNot)));
  const options = config.options ?? {};

  return [
    ...[...new Set(pathNots)].map((pattern) => make({ source, kind: 'pathNot', pattern })),
    ...list(options.doNotFollow?.path).map((pattern) =>
      make({ source, kind: 'doNotFollow', pattern })
    ),
    ...list(options.exclude?.path).map((pattern) => make({ source, kind: 'exclude', pattern })),
  ];
}

/** oxlint: paths it ignores, and the rules each override switches off for some files. */
function fromOxlint(config) {
  const offs = (config.overrides ?? []).flatMap((o) =>
    Object.entries(o.rules ?? {})
      .filter(([, setting]) => setting === 'off')
      .map(([rule]) => make({ source: 'oxlint', kind: `off ${rule}`, pattern: o.files.join(', ') }))
  );

  return [
    ...(config.ignorePatterns ?? []).map((pattern) =>
      make({ source: 'oxlint', kind: 'ignore', pattern })
    ),
    ...offs,
  ];
}

/** test-trust: folders it never scans. */
const fromTestTrust = (root) =>
  quotedIn({ root, file: 'scripts/test-trust.mjs', pattern: SKIP_DIRS }).map((pattern) =>
    make({ source: 'test-trust', kind: 'skip dir', pattern })
  );

/** folder-limits: paths whose folders are not counted. */
const fromFolderLimits = (root) =>
  quotedIn({ root, file: 'lint/folder-limits.mjs', pattern: NOT_SCANNED }).map((pattern) =>
    make({ source: 'folder-limits', kind: 'not scanned', pattern })
  );

/** Exemptions in configs: oxlint and both dependency-cruiser configs are loaded; folder-limits and test-trust are read as text. */
export const collectLoaded = (root, configs) => [
  ...fromOxlint(configs.oxlint),
  ...fromDepcruise('depcruise', configs.depcruise),
  ...fromDepcruise('depcruise-folders', configs.depcruiseFolders),
  ...fromFolderLimits(root),
  ...fromTestTrust(root),
];
