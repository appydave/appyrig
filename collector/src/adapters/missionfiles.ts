import { lstat, open, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  MISSION_FILES_MAX,
  MISSION_IMAGE_MAX_BYTES,
  MISSION_MIME,
  MISSION_PART_BYTES,
  MISSION_TEXT_MAX_BYTES,
  missionSpecPaths,
  type MissionFilePush,
  type MissionFilesPush,
} from '@appydave/shared';
import { redactString } from '../redact.js';
import { candidatesFor } from './rigfiles.js';
import type { SpecInfo } from './specs.js';

/**
 * Run board, lane 1: which mission files the collector will ever read, and the reading of them.
 *
 * This is the security boundary. Nothing a client sends reaches this code: the collector decides the
 * list, pushes it, and the hub only serves paths on it. A path is readable only when ALL hold:
 *   - it is absolute, has no `..` segment, and ends .md .html .png or .jpg;
 *   - EITHER it is named by this rig's own MISSION.md jobs table, and is its own real path (no
 *     symlink anywhere in it) and a regular file;
 *     OR it is a direct child of `qa/` (.md) or `shots/` (.png .jpg .html) beside that MISSION.md,
 *     and its real path still sits directly inside the real `qa/` or `shots/` folder;
 *   - text over 256 KB and images over 2 MB are reported `too_large` and never read.
 */

const EXT = /\.(md|html|png|jpg)$/i;
const extOf = (p: string): string => p.slice(p.lastIndexOf('.') + 1).toLowerCase();
const QA_EXT = new Set(['md']);
const SHOTS_EXT = new Set(['png', 'jpg', 'html']);

export interface MissionAllowlist {
  /** Absolute spec paths named by this rig's MISSION.md jobs table(s). */
  listed: Set<string>;
  /** The real folder holding the rig's MISSION.md, or null when it has none. */
  missionDir: string | null;
}

/** The rig's own MISSION*.md files give both the listed paths and the folder qa/ and shots/ hang off. */
export async function allowlistFor(spec: SpecInfo): Promise<MissionAllowlist> {
  const listed = new Set<string>();
  let missionDir: string | null = null;
  for (const c of await candidatesFor(spec)) {
    if (!/^MISSION/.test(c.name)) continue;
    missionDir ??= dirname(c.path);
    try {
      const st = await lstat(c.path);
      if (st.size > MISSION_TEXT_MAX_BYTES) continue;
      for (const p of missionSpecPaths(await readFile(c.path, 'utf8'))) listed.add(p);
    } catch {
      /* unreadable MISSION.md: it lists nothing */
    }
  }
  return { listed, missionDir };
}

export type PathCheck = { ok: true; real: string } | { ok: false; why: 'refused' | 'missing' };

/** The one gate. Anything not accepted here is never opened. */
export async function checkPath(path: unknown, al: MissionAllowlist): Promise<PathCheck> {
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0'))
    return { ok: false, why: 'refused' };
  if (path.split('/').includes('..') || path.includes('//')) return { ok: false, why: 'refused' };
  if (!EXT.test(path)) return { ok: false, why: 'refused' };
  const ext = extOf(path);

  if (al.listed.has(path)) {
    let real: string;
    try {
      real = await realpath(path);
    } catch {
      return { ok: false, why: 'missing' };
    }
    if (real !== path) return { ok: false, why: 'refused' }; // a symlink somewhere in the path
    return (await isFile(real)) ? { ok: true, real } : { ok: false, why: 'missing' };
  }

  if (al.missionDir) {
    const dir = dirname(path);
    const base = dir.slice(dir.lastIndexOf('/') + 1);
    const allowed =
      dirname(dir) === al.missionDir &&
      ((base === 'qa' && QA_EXT.has(ext)) || (base === 'shots' && SHOTS_EXT.has(ext)));
    if (allowed) {
      let real: string;
      let realDir: string;
      try {
        realDir = await realpath(dir);
        real = await realpath(path);
      } catch {
        return { ok: false, why: 'missing' };
      }
      // the folder and the file must both still be where they say: no link out of qa/ or shots/
      if (realDir !== join(al.missionDir, base) || dirname(real) !== realDir || !EXT.test(real))
        return { ok: false, why: 'refused' };
      return (await isFile(real)) ? { ok: true, real } : { ok: false, why: 'missing' };
    }
  }
  return { ok: false, why: 'refused' };
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await lstat(p)).isFile();
  } catch {
    return false;
  }
}

/** Every path this rig may serve that exists as a name now: listed ones, then qa/*.md, then shots/*. */
export async function manifestFor(al: MissionAllowlist): Promise<string[]> {
  const out: string[] = [];
  for (const p of [...al.listed].sort()) {
    const c = await checkPath(p, al);
    if (c.ok || c.why === 'missing') out.push(p);
  }
  if (al.missionDir) {
    for (const folder of ['qa', 'shots']) {
      let names: string[];
      try {
        names = (await readdir(join(al.missionDir, folder))).sort();
      } catch {
        continue;
      }
      for (const name of names) {
        const p = join(al.missionDir, folder, name);
        if ((await checkPath(p, al)).ok) out.push(p);
      }
    }
  }
  return [...new Set(out)].slice(0, MISSION_FILES_MAX);
}

/** The pushes for one listed path (a `missing`/`too_large` marker, or the text, or the image in parts). */
export async function readMissionFile(
  machineId: string,
  rig: string,
  path: string,
  al: MissionAllowlist,
  collectedAt: string
): Promise<MissionFilePush[]> {
  const base = { kind: 'file' as const, machineId, collectedAt, rig, path, part: 0, parts: 1 };
  const c = await checkPath(path, al);
  if (!c.ok) return [{ ...base, status: 'missing' }]; // refused paths are never on the list; this only races
  const ext = extOf(path);
  const mime = MISSION_MIME[ext]!;
  const image = ext === 'png' || ext === 'jpg';
  let fh;
  try {
    fh = await open(c.real, 'r');
    const st = await fh.stat();
    const bytes = st.size;
    const modifiedAt = st.mtime.toISOString();
    if (bytes > (image ? MISSION_IMAGE_MAX_BYTES : MISSION_TEXT_MAX_BYTES))
      return [{ ...base, status: 'too_large', mime, bytes, modifiedAt }];
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    const data = buf.subarray(0, bytesRead);
    if (!image)
      return [
        {
          ...base,
          status: 'ok',
          mime,
          bytes,
          modifiedAt,
          text: redactString(data.toString('utf8')),
        },
      ];
    const parts = Math.max(1, Math.ceil(data.length / MISSION_PART_BYTES));
    return Array.from({ length: parts }, (_, i) => ({
      ...base,
      status: 'ok' as const,
      mime,
      bytes,
      modifiedAt,
      base64: data
        .subarray(i * MISSION_PART_BYTES, (i + 1) * MISSION_PART_BYTES)
        .toString('base64'),
      part: i,
      parts,
    }));
  } catch {
    return [{ ...base, status: 'missing' }];
  } finally {
    await fh?.close();
  }
}

export interface PendingMissionFiles {
  pushes: MissionFilesPush[];
  markSent(): void;
}

/** Most raw bytes one tick hands over; the rest of a big fleet goes out on the next tick. */
export const MISSION_TICK_BYTES = 6 * 1024 * 1024;

/**
 * Finds rigs whose mission files changed since the hub last accepted them. Cheap when nothing
 * changed: one MISSION.md read, a directory listing of qa/ and shots/, and a stat per listed file.
 * A rig that fails to read is skipped; it never blocks the others or the snapshot push.
 */
export class MissionFilesReader {
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

  async next(specs: Map<string, SpecInfo>): Promise<PendingMissionFiles | null> {
    if (this.now().getTime() - this.lastScan < this.ttlMs) return null;
    const pushes: MissionFilesPush[] = [];
    const sigs = new Map<string, string>();
    let bytes = 0;
    let leftOver = false;
    for (const [rig, spec] of specs) {
      try {
        const al = await allowlistFor(spec);
        if (al.listed.size === 0 && !al.missionDir) continue;
        const paths = await manifestFor(al);
        const sig = (
          await Promise.all(
            paths.map(async (p) => {
              try {
                const st = await lstat(p);
                return `${p}:${st.size}:${st.mtimeMs}`;
              } catch {
                return `${p}:gone`;
              }
            })
          )
        ).join('|');
        if (this.sent.get(rig) === sig) continue;
        if (bytes >= MISSION_TICK_BYTES) {
          leftOver = true;
          continue;
        }
        const at = this.now().toISOString();
        const files: MissionFilePush[] = [];
        for (const p of paths)
          files.push(...(await readMissionFile(this.machineId, rig, p, al, at)));
        bytes += files.reduce((n, f) => n + (f.text?.length ?? 0) + (f.base64?.length ?? 0), 0);
        pushes.push({ kind: 'manifest', machineId: this.machineId, collectedAt: at, rig, paths });
        pushes.push(...files);
        sigs.set(rig, sig);
      } catch {
        /* this rig's files could not be listed: skip it, try again next scan */
      }
    }
    if (!leftOver) this.lastScan = this.now().getTime();
    if (pushes.length === 0) return null;
    return { pushes, markSent: () => sigs.forEach((sig, rig) => this.sent.set(rig, sig)) };
  }
}
