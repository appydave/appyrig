import { createHash } from 'node:crypto';
import { lstat, open, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { parse } from 'yaml';
import {
  OpenRig,
  SEAT_DOC_MAX_BYTES,
  LOADOUT_SKILLS_MAX,
  shortSkillName,
  type LoadoutSkill,
  type SeatDoc,
  type SeatDocId,
  type SeatLoadout,
  type SkillSource,
} from '@appydave/shared';
import { redactString } from '../redact.js';
import { defaultProjectsDir, TranscriptIndex, type TranscriptFile } from './history.js';
import type { SpecInfo } from './specs.js';

/**
 * v1.5 · L1: what a seat runs with, for the Debug view.
 *
 * Skills: Claude Code writes what it showed the model as an `attachment` line of type
 * `skill_listing` (`skillCount`, `names`, `isInitial`) in the seat's transcript: one full listing,
 * then listings of later additions only. The newest full listing plus its later additions is read
 * (foldListing), by an incremental scan (only bytes appended since the last scan). Each name is
 * then sorted by where it lives on this machine; nothing is guessed from folders alone.
 *
 * Seat documents: a fixed set of names in fixed places (the seat's cwd, its agent spec folder, its
 * rig's spec folder), all read-only, capped and redacted. Folders come from the daemon (cwd,
 * agentRef) and from the collector's configured spec folders, never from a client.
 */

// ── the skills shown: newest full listing + later additions ───────────────────────────────────────────────────

export interface SkillListing {
  at: string;
  skillCount: number;
  isInitial: boolean;
  names: string[];
}

/**
 * What the model has been shown so far. Claude Code writes one full listing (`isInitial: true`),
 * then listings carrying ONLY skills added later (`isInitial: false`, e.g. OpenRig copying role
 * skills in after start). So the set is the last initial listing plus every later delta, not the
 * last line (QA D1: a 307-skill seat read as "1" from its last delta).
 */
export interface ShownSkills extends SkillListing {
  /** The names, initial first, each once. */
  names: string[];
  /** The count shown: the size of the union (ruling, openrig-orch-m4 2026-10-12). */
  skillCount: number;
  /** Claude Code's own `skillCount`s summed over the initial listing and its deltas: a cross-check. */
  reported: number;
  /** True when the set starts from an initial listing (false: only deltas were seen). */
  isInitial: boolean;
  /** How many delta listings were added on top. */
  deltas: number;
  /** When the newest listing in the set was written. */
  at: string;
  /** When the listing that started the set was written (the full one, unless only deltas exist). */
  startedAt: string;
}

/**
 * Which transcript a seat's skills come from, when it has several (rebuilt or resumed): the one
 * whose set starts from the newest full listing. Deltas are never mixed across files (QA, ruling).
 */
export function newerSet(a: ShownSkills, b: ShownSkills | null): boolean {
  if (!b) return true;
  if (a.isInitial !== b.isInitial) return a.isInitial;
  return a.startedAt > b.startedAt || (a.startedAt === b.startedAt && a.at > b.at);
}

/** Folds one listing into the set: an initial listing starts it again; a delta adds to it. */
export function foldListing(cur: ShownSkills | null, l: SkillListing): ShownSkills {
  if (l.isInitial || !cur) {
    const names = [...new Set(l.names)];
    return {
      at: l.at,
      names,
      skillCount: names.length,
      reported: l.skillCount,
      isInitial: l.isInitial,
      deltas: 0,
      startedAt: l.at,
    };
  }
  const names = [...new Set([...cur.names, ...l.names])];
  return {
    at: l.at,
    names,
    skillCount: names.length,
    reported: cur.reported + l.skillCount,
    isInitial: cur.isInitial,
    deltas: cur.deltas + 1,
    startedAt: cur.startedAt,
  };
}

/** The listing on one transcript line, or null when the line is anything else. */
export function listingOfLine(line: string): SkillListing | null {
  if (!line.includes('"skill_listing"')) return null;
  try {
    const d = JSON.parse(line) as {
      type?: unknown;
      timestamp?: unknown;
      attachment?: { type?: unknown; skillCount?: unknown; isInitial?: unknown; names?: unknown };
    };
    const a = d.attachment;
    if (d.type !== 'attachment' || !a || a.type !== 'skill_listing') return null;
    if (typeof d.timestamp !== 'string' || Number.isNaN(Date.parse(d.timestamp))) return null;
    const names = Array.isArray(a.names)
      ? a.names.filter((n): n is string => typeof n === 'string' && n.length > 0)
      : [];
    return {
      at: new Date(d.timestamp).toISOString(),
      skillCount: typeof a.skillCount === 'number' ? a.skillCount : names.length,
      isInitial: a.isInitial === true,
      names,
    };
  } catch {
    return null;
  }
}

interface ScanState {
  offset: number;
  latest: ShownSkills | null;
  count: number;
}

const BLOCK = 1024 * 1024;

/**
 * Remembers, per transcript, how far it was read and the skills shown so far (foldListing). A transcript only
 * grows, so each scan reads just the new bytes; a file that shrank is read again from the start.
 * A line still being written (no newline yet) is left for the next scan.
 */
export class ListingTracker {
  private readonly state = new Map<string, ScanState>();

  async latest(file: TranscriptFile): Promise<{ listing: ShownSkills; count: number } | null> {
    let s = this.state.get(file.path);
    if (!s || file.size < s.offset) s = { offset: 0, latest: null, count: 0 };
    if (file.size > s.offset) s = await this.scan(file.path, s, file.size);
    this.state.set(file.path, s);
    return s.latest ? { listing: s.latest, count: s.count } : null;
  }

  private async scan(path: string, from: ScanState, size: number): Promise<ScanState> {
    const s = { ...from };
    const fh = await open(path, 'r');
    try {
      let pos = s.offset;
      let carry = Buffer.alloc(0);
      while (pos < size) {
        const buf = Buffer.alloc(Math.min(BLOCK, size - pos));
        const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
        if (bytesRead === 0) break;
        pos += bytesRead;
        let chunk = Buffer.concat([carry, buf.subarray(0, bytesRead)]);
        let nl = chunk.indexOf(10);
        while (nl !== -1) {
          const found = listingOfLine(chunk.subarray(0, nl).toString('utf8'));
          if (found) {
            s.latest = foldListing(s.latest, found);
            s.count += 1;
          }
          chunk = chunk.subarray(nl + 1);
          nl = chunk.indexOf(10);
        }
        carry = chunk;
      }
      // Only whole lines count as read: an unfinished last line is read again next time.
      s.offset = pos - carry.length;
    } finally {
      await fh.close();
    }
    return s;
  }
}

// ── sorting the listed names ───────────────────────────────────────────────────────────────────

export interface SkillPlaces {
  /** Skill folders (with a SKILL.md) in the seat cwd's `.claude/skills/`. */
  cwd: Set<string>;
  /** Of those, the ones git tracks in the cwd's repo. */
  tracked: Set<string>;
  /** Skill folders in `~/.claude/skills/`. */
  personal: Set<string>;
  /**
   * False when the seat's folder could not be scanned (gone, or not reported): then a name that is
   * not personal or a plugin is `unplaced`, not `builtin`. Absent = true.
   */
  cwdKnown?: boolean;
}

/** Sorts each listed name by where it came from, and flags names that exist in more than one place. */
export function classifySkills(names: string[], places: SkillPlaces): LoadoutSkill[] {
  const pluginShort = new Set(names.filter((n) => n.includes(':')).map(shortSkillName));
  const placesOf = (short: string): SkillSource[] => {
    const out: SkillSource[] = [];
    if (places.cwd.has(short)) out.push(places.tracked.has(short) ? 'repo' : 'role');
    if (places.personal.has(short)) out.push('personal');
    if (pluginShort.has(short)) out.push('plugin');
    return out;
  };
  return [...new Set(names)].slice(0, LOADOUT_SKILLS_MAX).map((name) => {
    const colon = name.indexOf(':');
    const short = shortSkillName(name);
    const where = placesOf(short);
    let source: SkillSource;
    if (colon > 0) source = 'plugin';
    else if (places.cwd.has(name)) source = places.tracked.has(name) ? 'repo' : 'role';
    else if (places.personal.has(name)) source = 'personal';
    else source = places.cwdKnown === false ? 'unplaced' : 'builtin';
    // A plugin skill is "also in" a plugin only when it is a different plugin's skill of that name.
    const otherPlugins =
      source === 'plugin' &&
      names.some((n) => n !== name && n.includes(':') && shortSkillName(n) === short);
    const alsoIn = where.filter((w) => w !== source || (w === 'plugin' && otherPlugins));
    return {
      name,
      source,
      plugin: colon > 0 ? name.slice(0, colon) : null,
      alsoIn: [...new Set(alsoIn)],
    };
  });
}

/** Folder names under `dir` that hold a SKILL.md (links followed). Empty when the folder is missing. */
export async function skillFolders(dir: string): Promise<Set<string>> {
  const out = new Set<string>();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    try {
      if ((await stat(join(dir, n, 'SKILL.md'))).isFile()) out.add(n);
    } catch {
      // not a skill folder
    }
  }
  return out;
}

export type Exec = (
  bin: string,
  args: string[]
) => Promise<{ stdout: string; stderr: string; code: number }>;

/** Skill folder names git tracks under `<cwd>/.claude/skills`; isRepo false outside a repo. */
export async function trackedSkills(
  exec: Exec,
  cwd: string
): Promise<{ isRepo: boolean; tracked: Set<string> }> {
  const tracked = new Set<string>();
  try {
    const r = await exec('git', ['-C', cwd, 'ls-files', '-z', '--', '.claude/skills']);
    if (r.code !== 0) return { isRepo: false, tracked };
    for (const p of r.stdout.split('\0')) {
      const m = /^\.claude\/skills\/([^/]+)\//.exec(p);
      if (m) tracked.add(m[1]!);
    }
    return { isRepo: true, tracked };
  } catch {
    return { isRepo: false, tracked };
  }
}

// ── seat documents ─────────────────────────────────────────────────────────────────────────────

const isUnder = (child: string, parent: string): boolean =>
  child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

interface DocSpot {
  path: string;
  /** The real file must stay inside this folder (symlinks resolved). */
  within: string;
}

async function readDocFile(
  spot: DocSpot
): Promise<{ path: string; text: string; bytes: number; mtime: Date; truncated: boolean } | null> {
  let real: string;
  let within: string;
  try {
    real = await realpath(spot.path);
    within = await realpath(spot.within);
    if (!isUnder(dirname(real), within) || !(await lstat(real)).isFile()) return null;
  } catch {
    return null; // absent, a broken link, or no permission
  }
  let fh;
  try {
    fh = await open(real, 'r');
    const st = await fh.stat();
    const want = Math.min(st.size, SEAT_DOC_MAX_BYTES);
    const buf = Buffer.alloc(want);
    const { bytesRead } = await fh.read(buf, 0, want, 0);
    const slice = buf.subarray(0, bytesRead);
    if (slice.includes(0)) return null; // binary
    return {
      path: spot.path,
      text: slice.toString('utf8'),
      bytes: st.size,
      mtime: st.mtime,
      truncated: st.size > SEAT_DOC_MAX_BYTES,
    };
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}

/** The first of `spots` that exists, as a seat document; absent (with where it looked) when none does. */
async function doc(
  id: SeatDocId,
  name: string,
  spots: DocSpot[],
  notes: string[] = []
): Promise<SeatDoc> {
  for (const spot of spots) {
    const r = await readDocFile(spot);
    if (r) {
      return {
        id,
        name: basename(r.path),
        present: true,
        path: r.path,
        looked: spots.map((s) => s.path),
        bytes: r.bytes,
        modifiedAt: r.mtime.toISOString(),
        truncated: r.truncated,
        content: redactString(r.text),
      };
    }
  }
  return {
    id,
    name,
    present: false,
    path: null,
    looked: [...spots.map((s) => s.path), ...notes].slice(0, 8),
    bytes: null,
    modifiedAt: null,
    truncated: false,
    content: null,
  };
}

/** A plain file name (no folders, no dots-only), as rig.yaml `culture_file` should be. */
const PLAIN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

/** The rig.yaml `culture_file`, when the spec validates and names a plain file; else the default name. */
function cultureName(spec: SpecInfo): string {
  const c = spec.spec?.culture_file?.trim();
  return c && PLAIN.test(c) ? c : 'CULTURE.md';
}

/**
 * The role file the agent spec delivers: its startup file marked `orientation: role` (OpenRig's own
 * marker), else one named role.md, else guidance/role.md.
 */
async function roleSpot(agentDir: string): Promise<DocSpot> {
  let rel = 'guidance/role.md';
  try {
    const doc = OpenRig.AgentSpecSchema.safeParse(
      parse(await readFile(join(agentDir, 'agent.yaml'), 'utf8'))
    );
    const files = doc.success ? (doc.data.startup?.files ?? []) : [];
    const hit =
      files.find((f) => f.orientation === 'role') ??
      files.find((f) => basename(f.path) === 'role.md');
    if (hit && !hit.path.split('/').includes('..')) rel = hit.path;
  } catch {
    // no agent.yaml: the usual place
  }
  return { path: join(agentDir, rel), within: agentDir };
}

export interface LoadoutSeat {
  id: string;
  rig: string | null;
  runtime: string | null;
  cwd: string | null;
}

export async function readSeatDocs(
  seat: LoadoutSeat,
  spec: SpecInfo | undefined,
  agentDir: string | undefined
): Promise<SeatDoc[]> {
  const cwd = seat.cwd;
  const specDir = spec ? dirname(spec.path) : null;
  const inCwd = (name: string): DocSpot[] => (cwd ? [{ path: join(cwd, name), within: cwd }] : []);
  const inSpec = (name: string): DocSpot[] =>
    specDir && spec ? [{ path: join(specDir, name), within: spec.root }] : [];
  const noSpec = specDir ? [] : ['(no rig.yaml found for this rig in the configured spec folders)'];
  const noCwd = cwd ? [] : ['(the daemon reports no folder for this seat)'];
  const member = seat.id.split('@')[0] ?? seat.id;

  return [
    await doc('culture', 'CULTURE.md', spec ? inSpec(cultureName(spec)) : [], noSpec),
    await doc(
      'role',
      'role.md',
      agentDir ? [await roleSpot(agentDir)] : [],
      agentDir ? [] : ['(the daemon reports no agent spec folder for this seat)']
    ),
    await doc('claude-md', 'CLAUDE.md', inCwd('CLAUDE.md'), noCwd),
    await doc('claude-local', 'CLAUDE.local.md', inCwd('CLAUDE.local.md'), noCwd),
    await doc(
      'recap',
      'RECAP.md',
      [...inCwd('RECAP.md'), ...inSpec('RECAP.md')],
      [...noCwd, ...noSpec]
    ),
    await doc(
      'learned',
      `LEARNED-${member}.md`,
      [...inSpec(`LEARNED-${member}.md`), ...inSpec('LEARNED.md'), ...inCwd('LEARNED.md')],
      [...noSpec, ...noCwd]
    ),
  ];
}

// ── the reader ─────────────────────────────────────────────────────────────────────────────────

export interface PendingLoadouts {
  loadouts: SeatLoadout[];
  markSent(): void;
}

export interface LoadoutReaderOptions {
  projectsDir?: string;
  /** Where `~/.claude/skills` is looked for. */
  home?: string;
  exec: Exec;
  now?: () => Date;
  ttlMs?: number;
}

/**
 * Builds each OpenRig seat's loadout at most every `ttlMs`, and hands over only the seats whose
 * loadout changed since the hub last accepted it.
 */
export class LoadoutReader {
  private readonly index: TranscriptIndex;
  private readonly tracker = new ListingTracker();
  private readonly sent = new Map<string, string>();
  private readonly home: string;
  private readonly exec: Exec;
  private readonly now: () => Date;
  private readonly ttlMs: number;
  private lastScan = 0;
  /** seat → skillCount from the latest scan (null: Codex, or no listing). Kept for the snapshot's pill. */
  private counts = new Map<string, number | null>();
  /** D09 W3: seat → the names it has listed, from the latest scan (for the card's key skills). */
  private names = new Map<string, string[]>();

  constructor(
    private readonly machineId: string,
    opts: LoadoutReaderOptions
  ) {
    this.index = new TranscriptIndex(opts.projectsDir ?? defaultProjectsDir());
    this.home = opts.home ?? homedir();
    this.exec = opts.exec;
    this.now = opts.now ?? (() => new Date());
    this.ttlMs = opts.ttlMs ?? 30_000;
  }

  /** The latest skillCount per seat this reader has scanned (the pill); empty before the first scan. */
  skillCounts(): Map<string, number | null> {
    return this.counts;
  }

  /** D09 W3: the skill names each seat has listed (seats with no listing are absent). */
  skillNames(): Map<string, string[]> {
    return this.names;
  }

  /** Forget what was sent (a reconnect: the hub may have restarted and holds nothing). */
  reset(): void {
    this.sent.clear();
    this.lastScan = 0;
  }

  async next(
    seats: LoadoutSeat[],
    specs: Map<string, SpecInfo>,
    agentDirs: Map<string, string>
  ): Promise<PendingLoadouts | null> {
    if (this.now().getTime() - this.lastScan < this.ttlMs) return null;
    this.lastScan = this.now().getTime();
    const claude = seats.filter((s) => s.runtime === 'claude-code');
    const transcripts = await this.index.scan(new Set(claude.map((s) => s.id)));
    const personal = await skillFolders(join(this.home, '.claude', 'skills'));
    const byCwd = new Map<
      string,
      Promise<{ places: SkillPlaces; isRepo: boolean; exists: boolean }>
    >();
    const placesFor = (cwd: string) => {
      let p = byCwd.get(cwd);
      if (!p) {
        p = (async () => {
          const exists = await stat(cwd).then(
            (st) => st.isDirectory(),
            () => false
          );
          if (!exists)
            return {
              places: {
                cwd: new Set<string>(),
                tracked: new Set<string>(),
                personal,
                cwdKnown: false,
              },
              isRepo: false,
              exists,
            };
          const [dirs, git] = await Promise.all([
            skillFolders(join(cwd, '.claude', 'skills')),
            trackedSkills(this.exec, cwd),
          ]);
          return {
            places: { cwd: dirs, tracked: git.tracked, personal },
            isRepo: git.isRepo,
            exists,
          };
        })();
        byCwd.set(cwd, p);
      }
      return p;
    };

    const out: SeatLoadout[] = [];
    const sigs = new Map<string, string>();
    const counts = new Map<string, number | null>();
    const names = new Map<string, string[]>();
    for (const seat of seats) {
      const base = {
        machineId: this.machineId,
        seat: seat.id,
        collectedAt: this.now().toISOString(),
        runtime: seat.runtime,
        cwd: seat.cwd,
      };
      let loadout: SeatLoadout;
      if (seat.runtime !== 'claude-code') {
        loadout = {
          ...base,
          status: 'not-claude',
          listing: null,
          cwdIsGitRepo: null,
          cwdExists: null,
          skills: [],
          layers: [],
        };
      } else {
        let best: { listing: ShownSkills; count: number; path: string } | null = null;
        for (const f of transcripts.get(seat.id) ?? []) {
          try {
            const r = await this.tracker.latest(f);
            if (!r) continue;
            if (newerSet(r.listing, best?.listing ?? null)) best = { ...r, path: f.path };
          } catch {
            // unreadable this round
          }
        }
        const where = seat.cwd ? await placesFor(seat.cwd) : null;
        const places = where?.places ?? {
          cwd: new Set<string>(),
          tracked: new Set<string>(),
          personal,
          cwdKnown: false,
        };
        loadout = {
          ...base,
          status: best ? 'ok' : 'no-listing',
          listing: best
            ? {
                at: best.listing.at,
                skillCount: best.listing.skillCount,
                isInitial: best.listing.isInitial,
                deltas: best.listing.deltas,
                reported: best.listing.reported,
                listings: Math.max(1, best.count),
                transcript: best.path,
              }
            : null,
          cwdIsGitRepo: where?.exists ? where.isRepo : null,
          cwdExists: where ? where.exists : null,
          skills: best ? classifySkills(best.listing.names, places) : [],
          layers: await readSeatDocs(
            seat,
            seat.rig ? specs.get(seat.rig) : undefined,
            agentDirs.get(seat.id)
          ),
        };
      }
      counts.set(seat.id, loadout.listing?.skillCount ?? null);
      if (loadout.status === 'ok')
        names.set(
          seat.id,
          loadout.skills.map((k) => k.name)
        );
      const sig = createHash('sha1')
        .update(JSON.stringify({ ...loadout, collectedAt: '' }))
        .digest('hex');
      if (this.sent.get(seat.id) === sig) continue;
      out.push(loadout);
      sigs.set(seat.id, sig);
    }
    this.counts = counts;
    this.names = names;
    if (out.length === 0) return null;
    return {
      loadouts: out,
      markSent: () => sigs.forEach((sig, seat) => this.sent.set(seat, sig)),
    };
  }
}

/**
 * The pill: each scanned seat gets its `skillCount` (or null). A seat the reader has not scanned
 * yet is left without the field, which says "not reported", never 0.
 */
export function withSkillCounts<T extends { id: string }>(
  seats: T[],
  counts: Map<string, number | null>
): (T & { skillCount?: number | null })[] {
  return seats.map((s) => (counts.has(s.id) ? { ...s, skillCount: counts.get(s.id)! } : s));
}
