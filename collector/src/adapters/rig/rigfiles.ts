import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';
import {
  RIG_FILES_CHUNK_BYTES,
  RIG_FILES_MAX,
  RIG_FILE_MAX_BYTES,
  RIG_SPEC_FILES_MAX,
  RigFileIdSchema,
  type RigFile,
  type RigFilesPush,
} from '@appydave/shared';
import { redactString } from '@collector/redact.js';
import { specVariant, type SpecInfo } from './specs.js';

/**
 * v1.4 · S7: which of a rig's files the collector will ever read, and the reading of them.
 *
 * This is the security boundary for the file viewer. Nothing a client sends reaches this code (a
 * client names a file id; the hub only serves what was pushed). What is read is decided here, from
 * the rig's own spec location, by these rules, all of which must hold:
 *   - the name is on the list below (exact names, or LEARNED*.md), in the spec's folder
 *     (`spec:`) or its parent mission folder (`mission:`), and only inside the configured spec folder;
 *   - the extension is .yaml, .yml or .md;
 *   - the REAL path (symlinks resolved) is a regular file whose real folder is still inside the
 *     configured spec folder's real path;
 *   - at most RIG_FILE_MAX_BYTES are read (a `truncated` flag says so), and the text is redacted.
 *
 * Scope `rig` (specCandidatesFor) adds only the files the rig's VALIDATED rig.yaml names, the way
 * OpenRig resolves them (against the rig root, the folder holding rig.yaml): culture_file, docs[],
 * and the rig, pod and member startup files. Each must be a safe relative path, .md/.yaml/.yml, and
 * its real path must stay inside the rig root's real path.
 */

const SPEC_NAMES = new Set([
  'rig.yaml',
  'MISSION.md',
  'CULTURE.md',
  'brief.md',
  'REPORT.md',
  'DEBRIEF.md',
]);
const MISSION_NAMES = new Set(['MISSION.md', 'CULTURE.md', 'brief.md', 'REPORT.md', 'DEBRIEF.md']);
const LEARNED = /^LEARNED[A-Za-z0-9._-]*\.md$/;
const EXT = /\.(?:yaml|yml|md)$/;
/** Run card R3: a run's own mission or report (`MISSION-d10.md`, `MISSION-d10-change-01-x.md`). */
const VARIANT_DOC = /^(?:MISSION|REPORT)-([A-Za-z0-9._-]+)\.md$/;
/** Run card R3: a brief named for its batch (`views-brief.md`, `run-card-brief.md`). */
const BRIEF = /^[A-Za-z0-9._-]+-brief\.md$/;
/** Under the cap, the run card's sources are kept first; what drops is the least needed. */
const keepRank = (name: string): number =>
  /^rig(?:-.+)?\.ya?ml$/.test(name)
    ? 0
    : /^MISSION/.test(name)
      ? 1
      : /brief\.md$/.test(name)
        ? 2
        : /^REPORT/.test(name)
          ? 3
          : name === 'CULTURE.md'
            ? 4
            : name === 'DEBRIEF.md'
              ? 5
              : 6;

export interface Candidate {
  id: string;
  name: string;
  scope: 'spec' | 'mission' | 'rig';
  /** The path to read. Only ever set here, from a directory listing under the configured folder. */
  path: string;
}

const isUnder = (child: string, parent: string): boolean =>
  child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

/**
 * Run card R3 adds, for a variant spec `rig-<v>.yaml`: that file itself (and not the base rig's
 * rig.yaml beside it), and only its own `MISSION-<v>…` / `REPORT-<v>…`, never the base run's
 * MISSION.md / REPORT.md. A base rig.yaml leaves out the docs of a sibling variant spec.
 * `<batch>-brief.md` is allowed in both folders.
 */
function allowedName(
  scope: 'spec' | 'mission',
  name: string,
  { variant, ownSpec, siblings }: { variant: string | null; ownSpec: string; siblings: string[] }
): boolean {
  if (!EXT.test(name)) {
    return false;
  }

  if (scope === 'spec' && /\.ya?ml$/.test(name)) {
    return name === ownSpec;
  }

  const doc = VARIANT_DOC.exec(name)?.[1];

  if (doc !== undefined) {
    if (variant) {
      return doc === variant || doc.startsWith(`${variant}-`);
    }

    return !siblings.some((v) => doc === v || doc.startsWith(`${v}-`));
  }

  if (variant && scope === 'spec' && /^(MISSION|REPORT)\.md$/.test(name)) {
    return false;
  }

  if (BRIEF.test(name)) {
    return true;
  }

  return (scope === 'spec' ? SPEC_NAMES : MISSION_NAMES).has(name) || LEARNED.test(name);
}

/**
 * The files of one rig that may be read. Real paths are used for every containment check, so a
 * symlinked folder or file that leads outside the configured spec folder is dropped.
 */
export async function candidatesFor(spec: SpecInfo): Promise<Candidate[]> {
  let root: string;
  let specDir: string;

  try {
    root = await realpath(spec.root);
    specDir = await realpath(dirname(spec.path));
  } catch {
    return [];
  }

  if (!isUnder(specDir, root)) {
    return [];
  }

  const folders: { scope: 'spec' | 'mission'; dir: string }[] = [{ scope: 'spec', dir: specDir }];
  const parent = dirname(specDir);

  // The mission folder is the spec folder's parent, and only when that is still inside the configured folder.
  // QA R3 LOW-2: the configured folder itself (openrig/rigs/) is every rig's parent, not a
  // mission folder: its MISSION-TEMPLATE.md belongs to no rig.
  if (parent !== specDir && parent !== root && isUnder(parent, root)) {
    folders.push({ scope: 'mission', dir: parent });
  }

  const ownSpec = basename(spec.path);
  const variant = specVariant(ownSpec);
  const out: Candidate[] = [];

  for (const { scope, dir } of folders) {
    let names: string[];

    try {
      names = await readdir(dir);
    } catch {
      continue;
    }

    const siblings = names.map(specVariant).filter((v): v is string => v !== null);

    for (const name of names.sort()) {
      if (!allowedName(scope, name, { variant, ownSpec, siblings })) {
        continue;
      }

      let real: string;

      try {
        real = await realpath(join(dir, name));
        if (!(await lstat(real)).isFile()) {
          continue;
        }
      } catch {
        continue; // broken link, vanished file, permission
      }

      if (!isUnder(dirname(real), root)) {
        continue;
      } // a link out of the configured folder

      out.push({ id: `${scope}:${name}`, name, scope, path: real });
    }
  }

  if (out.length <= RIG_FILES_MAX) {
    return out;
  }

  // Over the cap: keep the run card's sources first, in their listed order.
  const keep = new Set(
    out
      .map((c, i) => ({ c, i }))
      .sort((a, b) => keepRank(a.c.name) - keepRank(b.c.name) || a.i - b.i)
      .slice(0, RIG_FILES_MAX)
      .map((x) => x.c)
  );

  return out.filter((c) => keep.has(c));
}

/** Every path the rig.yaml names, in OpenRig's layer order, each once. */
export function specNamedPaths(spec: SpecInfo): string[] {
  const s = spec.spec;

  if (!s) {
    return [];
  }

  const paths = [
    ...(s.culture_file ? [s.culture_file] : []),
    ...(s.docs ?? []).map((d) => d.path),
    ...(s.startup?.files ?? []).map((f) => f.path),
    ...s.pods.flatMap((p) => [
      ...(p.startup?.files ?? []).map((f) => f.path),
      ...p.members.flatMap((m) => (m.startup?.files ?? []).map((f) => f.path)),
    ]),
  ].map((p) => p.trim().replace(/^\.\//, ''));

  return [...new Set(paths)];
}

/** The files a rig's validated rig.yaml names (scope `rig`), each checked as described above. */
export async function specCandidatesFor(spec: SpecInfo): Promise<Candidate[]> {
  let rigRoot: string;

  try {
    rigRoot = await realpath(dirname(spec.path));
  } catch {
    return [];
  }

  const out: Candidate[] = [];

  for (const rel of specNamedPaths(spec)) {
    const id = `rig:${rel}`;

    if (!EXT.test(rel) || !RigFileIdSchema.safeParse(id).success) {
      continue;
    } // absolute, `..`, odd names

    let real: string;

    try {
      real = await realpath(join(rigRoot, rel));
      if (!(await lstat(real)).isFile()) {
        continue;
      }
    } catch {
      continue; // named but absent: nothing to show
    }

    if (!isUnder(real, rigRoot)) {
      continue;
    } // a link out of the rig root

    out.push({ id, name: rel, scope: 'rig', path: real });
    if (out.length >= RIG_SPEC_FILES_MAX) {
      break;
    }
  }

  return out;
}

async function readCapped(
  path: string
): Promise<{ text: string; bytes: number; mtime: Date; truncated: boolean } | null> {
  let fh;

  try {
    fh = await open(path, 'r');

    const st = await fh.stat();

    if (!st.isFile()) {
      return null;
    }

    const want = Math.min(st.size, RIG_FILE_MAX_BYTES);
    const buf = Buffer.alloc(want);
    const { bytesRead } = await fh.read(buf, 0, want, 0);
    const slice = buf.subarray(0, bytesRead);

    if (slice.includes(0)) {
      return null;
    } // binary, not a text file

    return {
      text: slice.toString('utf8'),
      bytes: st.size,
      mtime: st.mtime,
      truncated: st.size > RIG_FILE_MAX_BYTES,
    };
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}

export async function readRigFiles(spec: SpecInfo, withSpecFiles = false): Promise<RigFile[]> {
  const files: RigFile[] = [];
  const cands = [
    ...(await candidatesFor(spec)),
    ...(withSpecFiles ? await specCandidatesFor(spec) : []),
  ];

  for (const c of cands) {
    const r = await readCapped(c.path);

    if (!r) {
      continue;
    }

    files.push({
      id: c.id,
      name: c.name,
      scope: c.scope,
      bytes: r.bytes,
      modifiedAt: r.mtime.toISOString(),
      truncated: r.truncated,
      content: redactString(r.text),
    });
  }

  return files;
}

/** Splits a rig's files into messages of at most RIG_FILES_CHUNK_BYTES of content; the first replaces. */
export function chunkRigFiles(
  { machineId, rig }: { machineId: string; rig: string },
  files: RigFile[],
  collectedAt: string
): RigFilesPush[] {
  const chunks: RigFile[][] = [[]];
  let size = 0;

  for (const f of files) {
    const n = Buffer.byteLength(f.content);

    if (size + n > RIG_FILES_CHUNK_BYTES && chunks[chunks.length - 1]!.length > 0) {
      chunks.push([]);
      size = 0;
    }

    chunks[chunks.length - 1]!.push(f);
    size += n;
  }

  return chunks.map((c, i) => ({ machineId, collectedAt, rig, replace: i === 0, files: c }));
}

export interface PendingRigFiles {
  pushes: RigFilesPush[];
  markSent(): void;
}

/**
 * Most file text one tick hands over. A first connect carries every rig at once (all of them
 * arrive within one push cycle); a very large fleet of specs spills into the next tick, which
 * does not wait for the rescan interval while there is still something unsent.
 */
export const RIG_FILES_TICK_BYTES = 4 * 1024 * 1024;

/**
 * Finds rigs whose files changed since the hub last accepted them. Cheap when nothing changed: one
 * directory listing and a stat per allowed file (the signature), no reads. Rescans at most every `ttlMs`.
 */
export class RigFilesReader {
  private readonly sent = new Map<string, string>();
  private lastScan = 0;

  constructor(
    private readonly machineId: string,
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs = 30_000
  ) {}

  /** Forget what was sent (a reconnect: the hub may have restarted and holds nothing). */
  reset(): void {
    this.sent.clear();
    this.lastScan = 0;
  }

  /**
   * `withSpecFiles`: also send scope `rig` files, only when the hub advertised HUB_CAPS.SPEC_FILES
   * (an older hub's strict schema refuses a `rig:` id, and with it the whole push).
   */
  async next(specs: Map<string, SpecInfo>, withSpecFiles = false): Promise<PendingRigFiles | null> {
    if (this.now().getTime() - this.lastScan < this.ttlMs) {
      return null;
    }

    const pushes: RigFilesPush[] = [];
    const sigs = new Map<string, string>();
    let bytes = 0;
    let leftOver = false;

    for (const [rig, spec] of specs) {
      const cands = [
        ...(await candidatesFor(spec)),
        ...(withSpecFiles ? await specCandidatesFor(spec) : []),
      ];
      const sig = `${withSpecFiles ? 'S' : '-'}|${(
        await Promise.all(
          cands.map(async (c) => {
            try {
              const st = await lstat(c.path);

              return `${c.id}:${st.size}:${st.mtimeMs}`;
            } catch {
              return `${c.id}:gone`;
            }
          })
        )
      ).join('|')}`;

      if (this.sent.get(rig) === sig) {
        continue;
      }

      if (bytes >= RIG_FILES_TICK_BYTES) {
        leftOver = true; // the budget is spent: this rig goes out on the next tick
        continue;
      }

      const files = await readRigFiles(spec, withSpecFiles);

      bytes += files.reduce((n, f) => n + Buffer.byteLength(f.content), 0);
      pushes.push(
        ...chunkRigFiles({ machineId: this.machineId, rig }, files, this.now().toISOString())
      );
      sigs.set(rig, sig);
    }

    // Only a scan that found nothing left over waits for the rescan interval.
    if (!leftOver) {
      this.lastScan = this.now().getTime();
    }

    if (pushes.length === 0) {
      return null;
    }

    return { pushes, markSent: () => sigs.forEach((sig, rig) => this.sent.set(rig, sig)) };
  }
}
