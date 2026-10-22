/**
 * OpenRig provenance check (N8): is shared/src/openrig still a true mirror of OpenRig?
 *
 *   npm run provenance                       check against the pinned commit (PROVENANCE.json)
 *   npm run provenance -- --ref <sha|tag>    check against another OpenRig commit
 *   npm run provenance -- --source <dir>     check against an OpenRig tree on disk (no git)
 *   npm run provenance -- --update-pin       on a clean run against --ref, move the pin there
 *
 * Exit codes (the gate contract): 0 = no drift · 1 = drift · 2 = the check could not run.
 * Writes scripts/provenance/out/report.json and report.md either way (except on exit 2); when out/
 * cannot be written, the report goes to <os tmpdir>/appyrig-provenance and stderr says so.
 * Run it through main.ts (`npm run provenance`): main.ts turns any unanticipated error into exit 2.
 *
 * Deterministic and read-only: OpenRig files are read with `git show <ref>:<path>` from the
 * reference clone (or from disk with --source); nothing is checked out, installed or run, and no
 * `rig` command is called. The installed @openrig/cli is only imported for its pure
 * `./spec-validation` export.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import * as OpenRig from '@shared/openrig/index.js';
import {
  constList,
  docMdNames,
  functionKeys,
  interfaceFields,
  mapKeys,
  stringConst,
  unionLiterals,
  unique,
} from './extract.js';

const root = resolve(import.meta.dirname, '../..');
const here = resolve(import.meta.dirname);
const PIN_FILE = join(root, 'shared/src/openrig/PROVENANCE.json');

interface Pin {
  openrig: { version: string; commit: string; describe?: string; commitDate?: string };
  source: { repo: string };
  cli: { path: string };
  checked: string;
  [k: string]: unknown;
}
interface IgnoreEntry {
  probe: string;
  value: string;
  reason: string;
}
interface IgnoreFile {
  unmapped: IgnoreEntry[];
  oursOnly: IgnoreEntry[];
}

function fail(msg: string): never {
  console.error(`provenance: cannot run: ${msg}`);
  process.exit(2);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);

  return i > 0 ? process.argv[i + 1] : undefined;
}

const pin = JSON.parse(readFileSync(PIN_FILE, 'utf8')) as Pin;
const ignore = JSON.parse(readFileSync(join(here, 'ignore.json'), 'utf8')) as IgnoreFile;
const sourceDir = arg('--source');
const repo = process.env.OPENRIG_SRC ?? pin.source.repo;
const ref = arg('--ref') ?? pin.openrig.commit;
const cliPath = process.env.OPENRIG_CLI ?? pin.cli.path;

// ── reading OpenRig at a ref ─────────────────────────────────────────────────────────────────────

function git(args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);

    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

let resolvedRef = 'WORKTREE';
let allFiles: string[];

if (sourceDir) {
  if (!existsSync(sourceDir)) {
    fail(`--source ${sourceDir} does not exist`);
  }

  allFiles = walk(sourceDir).map((p) => relative(sourceDir, p));
} else {
  if (!existsSync(repo)) {
    fail(`OpenRig clone not found at ${repo} (set OPENRIG_SRC)`);
  }

  try {
    resolvedRef = git(['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  } catch {
    fail(`ref ${ref} is not a commit in ${repo} (git fetch in the clone first?)`);
  }

  allFiles = git(['ls-tree', '-r', '--name-only', resolvedRef]).split('\n').filter(Boolean);
}

const fileSet = new Set(allFiles);

function read(path: string): string | null {
  if (!fileSet.has(path)) {
    return null;
  }

  if (sourceDir) {
    return readFileSync(join(sourceDir, path), 'utf8');
  }

  return git(['show', `${resolvedRef}:${path}`]);
}

const DOMAIN = 'packages/daemon/src/domain';
const SPECS = 'packages/daemon/specs';

// ── probes: one OpenRig list vs one of ours ──────────────────────────────────────────────────────

interface Probe {
  id: string;
  /** Where OpenRig keeps it: `file#SYMBOL`. */
  anchor: string;
  theirs: string[] | null;
  ours: readonly string[];
  /** Order is meaningful (the startup layers). */
  ordered?: boolean;
}

const keys = (schema: { shape: Record<string, unknown> }) => Object.keys(schema.shape);

function fromFile(file: string, pick: (text: string) => string[] | null): string[] | null {
  const text = read(file);

  return text === null ? null : pick(text);
}

/** OpenRig's StartupLayerInputs field → our STARTUP_LAYERS name. Unknown fields pass through as-is. */
const LAYER_FIELD: Record<string, string> = {
  specStartup: 'agent',
  profileStartup: 'profile',
  rigCultureFile: 'culture',
  rigStartup: 'rig',
  podStartup: 'pod',
  memberStartup: 'member',
  operatorStartup: 'operator',
};

const rigSchema = `${DOMAIN}/rigspec-schema.ts`;
const manifest = `${DOMAIN}/agent-manifest.ts`;
const startupValidation = `${DOMAIN}/startup-validation.ts`;
const chainDoc = 'docs/reference/chain-file-convention.md';

const shippedTopologyNames = unique(
  allFiles
    .filter((f) => f.startsWith(`${SPECS}/`) && /\/topology\/.*\/[A-Z][A-Z0-9_-]*\.md$/.test(f))
    .map((f) => f.slice(f.lastIndexOf('/') + 1))
);

const probes: Probe[] = [
  {
    id: 'rig.keys',
    anchor: `${rigSchema}#RIG_KEYS`,
    theirs: fromFile(rigSchema, (t) => constList(t, 'RIG_KEYS')),
    ours: keys(OpenRig.RigSpecSchema),
  },
  {
    id: 'pod.keys',
    anchor: `${rigSchema}#POD_KEYS`,
    theirs: fromFile(rigSchema, (t) => constList(t, 'POD_KEYS')),
    ours: keys(OpenRig.PodSpecSchema),
  },
  {
    id: 'member.keys',
    anchor: `${rigSchema}#MEMBER_KEYS`,
    theirs: fromFile(rigSchema, (t) => constList(t, 'MEMBER_KEYS')),
    ours: keys(OpenRig.MemberSpecSchema),
  },
  {
    id: 'edge.keys',
    anchor: `${rigSchema}#EDGE_KEYS`,
    theirs: fromFile(rigSchema, (t) => constList(t, 'EDGE_KEYS')),
    ours: unique([...keys(OpenRig.PodEdgeSchema), ...keys(OpenRig.CrossPodEdgeSchema)]),
  },
  {
    id: 'edge.kinds',
    anchor: `${rigSchema}#VALID_EDGE_KINDS`,
    theirs: fromFile(rigSchema, (t) => constList(t, 'VALID_EDGE_KINDS')),
    ours: OpenRig.EDGE_KINDS,
  },
  {
    id: 'member.restore_policy',
    anchor: `${rigSchema}#VALID_RESTORE_POLICIES`,
    theirs: fromFile(rigSchema, (t) => constList(t, 'VALID_RESTORE_POLICIES')),
    ours: OpenRig.RESTORE_POLICIES,
  },
  {
    id: 'pod.continuity.sync_triggers',
    anchor: `${rigSchema}#VALID_SYNC_TRIGGERS`,
    theirs: fromFile(rigSchema, (t) => constList(t, 'VALID_SYNC_TRIGGERS')),
    ours: OpenRig.ContinuityPolicySchema.shape.sync_triggers.unwrap().element.options,
  },
  {
    id: 'services.down_policy',
    anchor: `${rigSchema}#VALID_DOWN_POLICIES`,
    theirs: fromFile(rigSchema, (t) => constList(t, 'VALID_DOWN_POLICIES')),
    ours: OpenRig.RigServicesSchema.shape.down_policy.unwrap().options,
  },
  {
    id: 'workspace.kinds',
    anchor: `${DOMAIN}/types.ts#WORKSPACE_KINDS`,
    theirs: fromFile(`${DOMAIN}/types.ts`, (t) => constList(t, 'WORKSPACE_KINDS')),
    ours: OpenRig.WORKSPACE_KINDS,
  },
  {
    id: 'runtimes',
    anchor: `${DOMAIN}/built-in-runtimes.ts#BUILT_IN_RUNTIMES`,
    theirs: fromFile(`${DOMAIN}/built-in-runtimes.ts`, (t) => constList(t, 'BUILT_IN_RUNTIMES')),
    ours: OpenRig.RUNTIMES,
  },
  {
    id: 'permission.builtin_policies',
    anchor: `${DOMAIN}/permission-policy/policy-ref.ts#BUILTIN_POLICY_NAMES`,
    theirs: fromFile(`${DOMAIN}/permission-policy/policy-ref.ts`, (t) =>
      constList(t, 'BUILTIN_POLICY_NAMES')
    ),
    ours: OpenRig.BUILTIN_POLICIES,
  },
  {
    id: 'managed_blocks.files',
    anchor: `${DOMAIN}/managed-blocks.ts#CLAUDE_MANAGED_BLOCK_FILES`,
    theirs: fromFile(`${DOMAIN}/managed-blocks.ts`, (t) =>
      constList(t, 'CLAUDE_MANAGED_BLOCK_FILES')
    ),
    ours: OpenRig.RigSpecSchema.shape.managed_blocks.unwrap().shape['claude-code'].options,
  },
  {
    id: 'lifecycle.compaction_strategy',
    anchor: `${manifest}#VALID_COMPACTION_STRATEGIES`,
    theirs: fromFile(manifest, (t) => constList(t, 'VALID_COMPACTION_STRATEGIES')),
    ours: OpenRig.COMPACTION_STRATEGIES,
  },
  {
    id: 'agent.keys',
    anchor: `${manifest}#normalizeAgentSpec`,
    theirs: fromFile(manifest, (t) => functionKeys(t, 'normalizeAgentSpec', 'raw')),
    ours: keys(OpenRig.AgentSpecSchema),
  },
  {
    id: 'agent.defaults.keys',
    anchor: `${manifest}#normalizeAgentSpec(defaults)`,
    theirs: fromFile(manifest, (t) => functionKeys(t, 'normalizeAgentSpec', 'defaults')),
    ours: keys(OpenRig.AgentSpecSchema.shape.defaults.unwrap()),
  },
  {
    id: 'agent.imports.keys',
    anchor: `${manifest}#normalizeAgentSpec(imp)`,
    theirs: fromFile(manifest, (t) => functionKeys(t, 'normalizeAgentSpec', 'imp')),
    ours: keys(OpenRig.AgentSpecSchema.shape.imports.unwrap().element),
  },
  {
    id: 'profile.keys',
    anchor: `${manifest}#normalizeProfile`,
    theirs: fromFile(manifest, (t) => functionKeys(t, 'normalizeProfile', 'raw')),
    ours: keys(OpenRig.AgentProfileSchema),
  },
  {
    id: 'profile.uses.keys',
    anchor: `${manifest}#normalizeProfile(uses)`,
    theirs: fromFile(manifest, (t) => functionKeys(t, 'normalizeProfile', 'uses')),
    ours: keys(OpenRig.ProfileUsesSchema),
  },
  {
    id: 'resources.categories',
    anchor: `${manifest}#normalizeResources`,
    theirs: fromFile(manifest, (t) => functionKeys(t, 'normalizeResources', 'obj')),
    ours: keys(OpenRig.AgentResourcesSchema),
  },
  {
    id: 'lifecycle.keys',
    anchor: `${manifest}#normalizeLifecycle`,
    theirs: fromFile(manifest, (t) => functionKeys(t, 'normalizeLifecycle', 'raw')),
    ours: keys(OpenRig.LifecycleSchema),
  },
  {
    id: 'startup.delivery_hints',
    anchor: `${startupValidation}#VALID_DELIVERY_HINTS`,
    theirs: fromFile(startupValidation, (t) => constList(t, 'VALID_DELIVERY_HINTS')),
    ours: OpenRig.DELIVERY_HINTS,
  },
  {
    id: 'startup.action_types',
    anchor: `${startupValidation}#VALID_ACTION_TYPES`,
    theirs: fromFile(startupValidation, (t) => constList(t, 'VALID_ACTION_TYPES')),
    ours: OpenRig.STARTUP_ACTION_TYPES,
  },
  {
    id: 'startup.phases',
    anchor: `${startupValidation}#VALID_PHASES`,
    theirs: fromFile(startupValidation, (t) => constList(t, 'VALID_PHASES')),
    ours: OpenRig.StartupActionSchema.shape.phase.unwrap().options,
  },
  {
    id: 'startup.applies_on',
    anchor: `${startupValidation}#VALID_APPLIES_ON`,
    theirs: fromFile(startupValidation, (t) => constList(t, 'VALID_APPLIES_ON')),
    ours: OpenRig.APPLIES_ON,
  },
  {
    id: 'startup.layers',
    anchor: `${DOMAIN}/startup-resolver.ts#StartupLayerInputs`,
    theirs:
      fromFile(`${DOMAIN}/startup-resolver.ts`, (t) =>
        interfaceFields(t, 'StartupLayerInputs')
      )?.map((f) => LAYER_FIELD[f] ?? f) ?? null,
    ours: OpenRig.STARTUP_LAYERS,
    ordered: true,
  },
  {
    id: 'startup.builtin_files',
    anchor: `${DOMAIN}/builtin-startup-files.ts#BUILTIN_STARTUP_FILES`,
    theirs: fromFile(`${DOMAIN}/builtin-startup-files.ts`, (t) =>
      mapKeys(t, 'BUILTIN_STARTUP_FILES')
    ),
    ours: OpenRig.BUILTIN_STARTUP_FILES,
  },
  {
    id: 'chain.topology_files',
    anchor: `${chainDoc}#Established chain names + seat-recap-store.ts#RECAP_FILENAME + ${SPECS}/**/topology/*.md`,
    theirs: (() => {
      const doc = fromFile(chainDoc, (t) =>
        docMdNames(t, 'Established chain names on the topology tree', '### The project tree')
      );
      const recap = read(`${DOMAIN}/context-packs/seat-recap-store.ts`);
      const recapName = recap === null ? null : stringConst(recap, 'RECAP_FILENAME');

      if (doc === null || recapName === null) {
        return null;
      }

      return unique([...doc, recapName, ...shippedTopologyNames]);
    })(),
    ours: OpenRig.TOPOLOGY_CHAIN_FILES,
  },
  {
    id: 'chain.project_files',
    anchor: `${chainDoc}#The project tree`,
    theirs: fromFile(chainDoc, (t) =>
      docMdNames(t, '### The project tree', '**Project-tree context cannot ship')
    ),
    ours: unique([...OpenRig.PROJECT_CHAIN_FILES, ...OpenRig.NODE_FILE_PRECEDENCE]),
  },
  {
    id: 'slice.statuses',
    anchor: `${DOMAIN}/slices/slice-indexer.ts#SliceStatus`,
    theirs: fromFile(`${DOMAIN}/slices/slice-indexer.ts`, (t) => unionLiterals(t, 'SliceStatus')),
    ours: OpenRig.SLICE_STATUSES,
  },
];

interface ProbeResult {
  id: string;
  anchor: string;
  status: 'ok' | 'drift' | 'anchor-missing';
  added: string[];
  removed: string[];
  renamed: Array<{ from: string; to: string }>;
  reordered: boolean;
  ignored: string[];
  oursOnly: string[];
}

const ignored = (list: IgnoreEntry[], probe: string, value: string) =>
  list.some((e) => e.probe === probe && e.value === value);

function compare(p: Probe): ProbeResult {
  const base = {
    id: p.id,
    anchor: p.anchor,
    added: [] as string[],
    removed: [] as string[],
    renamed: [] as Array<{ from: string; to: string }>,
    reordered: false,
    ignored: [] as string[],
    oursOnly: [] as string[],
  };

  if (p.theirs === null || p.theirs.length === 0) {
    return { ...base, status: 'anchor-missing' };
  }

  const theirs = new Set(p.theirs);
  const ours = new Set(p.ours);
  const onlyTheirs = p.theirs.filter((x) => !ours.has(x));
  const onlyOurs = p.ours.filter((x) => !theirs.has(x));
  const added = onlyTheirs.filter((x) => !ignored(ignore.unmapped, p.id, x));
  const removed = onlyOurs.filter((x) => !ignored(ignore.oursOnly, p.id, x));
  // One key gone and one key new in the same list reads as a rename.
  const renamed =
    added.length === 1 && removed.length === 1 ? [{ from: removed[0]!, to: added[0]! }] : [];
  const common = p.theirs.filter((x) => ours.has(x));
  const reordered = !!p.ordered && common.join() !== p.ours.filter((x) => theirs.has(x)).join();

  return {
    ...base,
    status: added.length || removed.length || reordered ? 'drift' : 'ok',
    added: renamed.length ? [] : added,
    removed: renamed.length ? [] : removed,
    renamed,
    reordered,
    ignored: onlyTheirs.filter((x) => ignored(ignore.unmapped, p.id, x)),
    oursOnly: onlyOurs.filter((x) => ignored(ignore.oursOnly, p.id, x)),
  };
}

const probeResults = probes.map(compare);

// ── the schemas over OpenRig's shipped examples at this ref ──────────────────────────────────────

interface SpecValidation {
  validateRigSpecImport(yaml: string): { valid: boolean; errors: string[] };
  validateAgentSpecFromYaml(yaml: string): { valid: boolean; errors: string[] };
}

let openrigValidator: SpecValidation | null = null;
let validatorNote: string;
const surface = join(cliPath, 'daemon/dist/spec-validation-surface.js');
let cliVersion: string | null = null;

try {
  cliVersion = (
    JSON.parse(readFileSync(join(cliPath, 'package.json'), 'utf8')) as { version: string }
  ).version;
  openrigValidator = (await import(pathToFileURL(surface).href)) as SpecValidation;
  validatorNote = `loaded ${relative(cliPath, surface)} from @openrig/cli ${cliVersion}`;
} catch (e) {
  validatorNote = `not loaded (${(e as Error).message.split('\n')[0]}); cross-check skipped`;
}

interface ExampleResult {
  file: string;
  kind: 'rig' | 'agent';
  ours: boolean;
  oursError?: string;
  openrig?: boolean;
  openrigErrors?: string[];
}

const exampleFiles = allFiles.filter(
  (f) => f.startsWith(`${SPECS}/`) && (/\/rig[^/]*\.yaml$/.test(f) || f.endsWith('/agent.yaml'))
);
const examples: ExampleResult[] = exampleFiles.map((file) => {
  const text = read(file) ?? '';
  const kind = file.endsWith('/agent.yaml') ? 'agent' : 'rig';
  const schema = kind === 'agent' ? OpenRig.AgentSpecSchema : OpenRig.RigSpecSchema;
  const r = schema.safeParse(parse(text));
  const out: ExampleResult = { file: file.slice(SPECS.length + 1), kind, ours: r.success };

  if (!r.success) {
    out.oursError = JSON.stringify(r.error.issues).slice(0, 300);
  }

  if (openrigValidator) {
    try {
      const v =
        kind === 'agent'
          ? openrigValidator.validateAgentSpecFromYaml(text)
          : openrigValidator.validateRigSpecImport(text);

      out.openrig = v.valid;
      if (!v.valid) {
        out.openrigErrors = v.errors.slice(0, 3);
      }
    } catch (e) {
      out.openrig = false;
      out.openrigErrors = [(e as Error).message];
    }
  }

  return out;
});
// Drift: our schema refuses a file OpenRig ships, or disagrees with OpenRig's own validator.
const exampleDrift = examples.filter(
  (x) => !x.ours || (x.openrig !== undefined && x.openrig !== x.ours)
);

// ── files our schemas cite: do they still exist at this ref? ─────────────────────────────────────

const ourDir = join(root, 'shared/src/openrig');
const citeRe = /\b((?:[\w-]+\/)*[\w-]+\.(?:ts|md))\b/g;
const ourFiles = new Set(readdirSync(ourDir));
const cites = unique(
  readdirSync(ourDir)
    .filter((f) => /\.(ts|md)$/.test(f))
    .flatMap((f) => [...readFileSync(join(ourDir, f), 'utf8').matchAll(citeRe)].map((m) => m[1]!))
)
  // AppyRig's own files (named as "see also") are not OpenRig cites.
  .filter((c) => !ourFiles.has(c) && !existsSync(join(root, c)))
  .filter((c) => !/^(?:missionJobs|missionfiles|rigfiles|snapshot)\.ts$/.test(c))
  // OpenRig file names only: a path inside OpenRig, or a kebab-case .ts (ours are camelCase).
  .filter((c) => c.includes('/') || /^[a-z]+(?:-[a-z]+)+\.ts$/.test(c));
const citeResults = cites.map((c) => {
  const hits = allFiles.filter((f) => f === c || f.endsWith(`/${c}`));

  return { cite: c, found: hits.length > 0, at: hits.slice(0, 2) };
});
const citeDrift = citeResults.filter((c) => !c.found);

// ── report only: OpenRig file:line cites in the UI (client/). Never gating, never edited. ───────

const clientCites: Array<{ where: string; cite: string; status: string; line?: string }> = [];
const clientDir = join(root, 'client/src');

if (existsSync(clientDir)) {
  const lineCite = /\b([a-z][\w-]*\.ts):(\d+)/g;

  for (const f of walk(clientDir).filter((p) => /\.(tsx?|json)$/.test(p))) {
    const text = readFileSync(f, 'utf8');

    for (const m of text.matchAll(lineCite)) {
      const [cite, name, n] = [m[0], m[1]!, Number(m[2])];
      const hits = allFiles.filter((p) => p.endsWith(`/${name}`) && p.startsWith('packages/'));

      if (hits.length === 0) {
        continue;
      } // not an OpenRig file

      const where = relative(root, f);

      if (hits.length > 1) {
        clientCites.push({ where, cite, status: 'ambiguous' });
        continue;
      }

      const lines = (read(hits[0]!) ?? '').split('\n');

      clientCites.push({
        where,
        cite,
        status: n <= lines.length ? 'line exists (symbol unchecked)' : 'line past end of file',
        line: lines[n - 1]?.trim().slice(0, 100),
      });
    }
  }
}

// ── report ───────────────────────────────────────────────────────────────────────────────────────

const unmapped = probeResults.flatMap((r) => [
  ...r.added.map((v) => `${r.id}: ${v}`),
  ...r.renamed.map((x) => `${r.id}: ${x.to} (was ${x.from}?)`),
]);
const drift =
  probeResults.some((r) => r.status !== 'ok') || exampleDrift.length > 0 || citeDrift.length > 0;

const report = {
  checkedAt: new Date().toISOString(),
  result: drift ? 'drift' : 'clean',
  openrig: {
    source: sourceDir ?? repo,
    ref,
    resolved: resolvedRef,
    pinned: pin.openrig.commit,
    atPin: resolvedRef === pin.openrig.commit,
    pinnedVersion: pin.openrig.version,
    installedCli: cliVersion,
  },
  probes: probeResults,
  unmapped,
  examples: {
    total: examples.length,
    oursAccepted: examples.filter((x) => x.ours).length,
    openrigAccepted: openrigValidator ? examples.filter((x) => x.openrig).length : null,
    crossCheck: validatorNote,
    drift: exampleDrift,
  },
  cites: { checked: citeResults.length, missing: citeDrift },
  clientCites: {
    note: 'Report only. Not gating; client/ is not edited by this check.',
    list: clientCites,
  },
};

// The report goes to out/; when that cannot be written (a read-only tree), to the temp folder
// instead, said once on stderr. Where the report lands never changes the exit code.
let outDir = join(here, 'out');

function writeReport(name: string, text: string): void {
  try {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, name), text);
  } catch (e) {
    const fallback = join(tmpdir(), 'appyrig-provenance');

    if (outDir === fallback) {
      throw e;
    }

    console.error(
      `provenance: could not write ${relative(root, outDir) || outDir} (${(e as NodeJS.ErrnoException).code ?? (e as Error).message}); wrote the report to ${fallback}`
    );
    outDir = fallback;
    writeReport(name, text);
  }
}

writeReport('report.json', `${JSON.stringify(report, null, 2)}\n`);

const md: string[] = [
  `# OpenRig provenance: ${drift ? 'DRIFT' : 'clean'}`,
  '',
  `OpenRig ${sourceDir ? `tree ${sourceDir}` : `${resolvedRef.slice(0, 10)} (ref \`${ref}\`)`}; pinned ${pin.openrig.version} @ ${pin.openrig.commit.slice(0, 10)}.`,
  '',
  '| Probe | Status | Detail |',
  '|---|---|---|',
  ...probeResults.map((r) => {
    const d = [
      r.added.length ? `OpenRig added: ${r.added.join(', ')}` : '',
      r.removed.length ? `gone from OpenRig: ${r.removed.join(', ')}` : '',
      r.renamed.map((x) => `renamed? ${x.from} → ${x.to}`).join(', '),
      r.reordered ? 'order changed' : '',
      r.status === 'anchor-missing' ? `anchor not found: ${r.anchor}` : '',
      r.ignored.length ? `ignored: ${r.ignored.join(', ')}` : '',
    ].filter(Boolean);

    return `| ${r.id} | ${r.status} | ${d.join('; ')} |`;
  }),
  '',
  `**Examples:** our schemas accept ${report.examples.oursAccepted}/${examples.length} rig.yaml/agent.yaml files OpenRig ships${report.examples.openrigAccepted === null ? '' : `; OpenRig's own validator accepts ${report.examples.openrigAccepted}`}. Cross-check: ${validatorNote}.`,
  ...exampleDrift.map(
    (x) =>
      `- ${x.file}: ours ${x.ours ? 'accepts' : 'refuses'}, OpenRig ${x.openrig === undefined ? 'n/a' : x.openrig ? 'accepts' : 'refuses'} ${x.oursError ?? x.openrigErrors?.join(' | ') ?? ''}`
  ),
  '',
  `**Cited OpenRig files:** ${citeResults.length} checked, ${citeDrift.length} missing${citeDrift.length ? `: ${citeDrift.map((c) => c.cite).join(', ')}` : ''}.`,
  '',
  `**Unmapped (OpenRig has, we don't model, not in ignore.json):** ${unmapped.length ? unmapped.join('; ') : 'none'}.`,
  '',
  `**UI cites (report only):** ${clientCites.length} OpenRig file:line cites in client/; ${clientCites.filter((c) => c.status !== 'line exists (symbol unchecked)').length} point past the end of their file or are ambiguous. Lines are shown in report.json; whether the right symbol is still there is not checked.`,
  '',
];

writeReport('report.md', md.join('\n'));
console.log(md.join('\n'));

// --update-pin: only on a clean run against a real commit.
if (process.argv.includes('--update-pin')) {
  if (drift || sourceDir) {
    console.error('provenance: --update-pin refused (drift, or --source has no commit)');
  } else {
    pin.openrig.commit = resolvedRef;
    pin.openrig.describe = git(['describe', '--tags', resolvedRef]).trim();
    pin.openrig.commitDate = git(['log', '-1', '--format=%cI', resolvedRef]).trim();

    const pkg = read('packages/cli/package.json');

    if (pkg) {
      pin.openrig.version = (JSON.parse(pkg) as { version: string }).version;
    }

    pin.checked = new Date().toISOString().slice(0, 10);
    writeFileSync(PIN_FILE, `${JSON.stringify(pin, null, 2)}\n`);
    console.log(`provenance: pin moved to ${resolvedRef.slice(0, 10)}`);
  }
}

process.exit(drift ? 1 : 0);
