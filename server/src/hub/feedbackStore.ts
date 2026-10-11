import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  FEEDBACK_NOTES_MAX,
  FEEDBACK_SCREENSHOT_MAX_BYTES,
  FEEDBACK_SCREENSHOT_MAX_DIMENSION,
  FeedbackNoteSchema,
  FeedbackSummarySchema,
  type FeedbackAddInput,
  type FeedbackNote,
  type FeedbackSummary,
} from '@appydave/shared';

/**
 * v1.4 · S8: the one place AppyRig writes. Everything under `<dataDir>/feedback/`, nothing anywhere
 * else:
 *
 *   index.jsonl        one JSON line per note (append-only; the agent-readable list)
 *   fb-0001/note.json  the full record
 *   fb-0001/screenshot.png   the PNG, when there is one
 *
 * Folder names are ids this class makes (`fb-` + a counter); a client's text never becomes part of a
 * path. A note's files are written first and the index line last, so the index never names a note
 * that is not fully on disk. Files 0600, folders 0700 (the notes can quote anything on screen).
 * The index is a sidecar of the notes, not their source: the folders are. A note must never be lost or
 * overwritten (r1 S8 HIGH), so:
 *   - on load, the summaries are rebuilt from `fb-*\/note.json` for any note the index lacks (a crash
 *     between writing the files and the index line, or a deleted or short index), and the index is
 *     rewritten whole; `list`, `count` and the 500-note cap therefore count the notes that exist;
 *   - the next id is above every id seen in the index AND every `fb-*` folder, even an unreadable or
 *     half-made one (its id stays reserved);
 *   - a note's folder is created WITHOUT `recursive`, so an existing folder is an error, never a
 *     target: add() moves on to the next id instead of writing into it.
 */

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class FeedbackRefusal extends Error {
  constructor(
    readonly failureMode: 'invalid-input' | 'feedback-full' | 'feedback-unavailable',
    message: string,
    readonly details?: unknown
  ) {
    super(message);
  }
}

/** Validates the PNG the client sent and reads its size from the file itself (never from the client). */
export function inspectPng(b64: string): { bytes: Buffer; width: number; height: number } {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
    throw new FeedbackRefusal(
      'invalid-input',
      'screenshotPng is not plain base64 (no data: prefix, no line breaks).'
    );
  }
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length > FEEDBACK_SCREENSHOT_MAX_BYTES) {
    throw new FeedbackRefusal(
      'invalid-input',
      `The screenshot is ${bytes.length} bytes; the limit is ${FEEDBACK_SCREENSHOT_MAX_BYTES}. Downscale it first.`
    );
  }
  // 8-byte signature, then the IHDR chunk: length(4)=13, "IHDR", width(4), height(4).
  if (
    bytes.length < 33 ||
    !bytes.subarray(0, 8).equals(PNG_MAGIC) ||
    bytes.subarray(12, 16).toString('latin1') !== 'IHDR'
  ) {
    throw new FeedbackRefusal('invalid-input', 'screenshotPng is not a PNG.');
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (
    width < 1 ||
    height < 1 ||
    width > FEEDBACK_SCREENSHOT_MAX_DIMENSION ||
    height > FEEDBACK_SCREENSHOT_MAX_DIMENSION
  ) {
    throw new FeedbackRefusal(
      'invalid-input',
      `The screenshot is ${width}x${height}; the limit is ${FEEDBACK_SCREENSHOT_MAX_DIMENSION} on either side.`
    );
  }
  return { bytes, width, height };
}

const summaryOf = (n: FeedbackNote): FeedbackSummary => ({
  id: n.id,
  createdAt: n.createdAt,
  viewer: n.viewer,
  verdict: n.verdict,
  region: n.region,
  note: n.note.length > 200 ? `${n.note.slice(0, 200)}…` : n.note,
  route: n.viewState.route,
  view: n.viewState.view ?? null,
  selectedRig: n.viewState.selectedRig ?? null,
  hasScreenshot: n.screenshot !== null,
  appVersion: n.appVersion,
});

export class FeedbackStore {
  private readonly dir: string | undefined;
  private summaries: FeedbackSummary[] | undefined;
  private nextId = 0;

  constructor(dataDir: string | undefined) {
    this.dir = dataDir ? join(dataDir, 'feedback') : undefined;
  }

  get indexFile(): string | null {
    return this.dir ? join(this.dir, 'index.jsonl') : null;
  }

  get available(): boolean {
    return this.dir !== undefined;
  }

  /**
   * Reads the index once (later calls use memory), then reconciles it with the note folders on disk.
   * Lines that do not parse are skipped, not fatal.
   */
  private load(): FeedbackSummary[] {
    if (this.summaries) return this.summaries;
    const byId = new Map<string, FeedbackSummary>();
    if (this.dir && existsSync(this.indexFile!)) {
      for (const line of readFileSync(this.indexFile!, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const parsed = FeedbackSummarySchema.safeParse(JSON.parse(line));
          if (parsed.success) byId.set(parsed.data.id, parsed.data);
        } catch {
          // a torn last line after a crash: skipped
        }
      }
    }
    let maxSeen = [...byId.keys()].reduce((m, id) => Math.max(m, Number(id.slice(3))), 0);
    let rebuilt = false;
    if (this.dir && existsSync(this.dir)) {
      for (const name of readdirSync(this.dir)) {
        if (!/^fb-\d{4,}$/.test(name)) continue;
        maxSeen = Math.max(maxSeen, Number(name.slice(3))); // reserved even if its note is unreadable
        if (byId.has(name)) continue;
        const found = this.get(name);
        if (found) {
          byId.set(name, summaryOf(found.note));
          rebuilt = true;
        }
      }
    }
    const rows = [...byId.values()].sort((a, b) => Number(a.id.slice(3)) - Number(b.id.slice(3)));
    this.summaries = rows;
    this.nextId = maxSeen + 1;
    if (rebuilt && this.dir) {
      // the index was missing notes: write it out whole so cat index.jsonl is truthful again
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      this.writeAtomic(this.indexFile!, rows.map((r) => `${JSON.stringify(r)}\n`).join(''));
    }
    return rows;
  }

  count(): number {
    return this.load().length;
  }

  list(): FeedbackSummary[] {
    return [...this.load()].reverse(); // newest first
  }

  get(id: string): { note: FeedbackNote; folder: string } | undefined {
    if (!this.dir || !/^fb-\d{4,}$/.test(id)) return undefined;
    const folder = join(this.dir, id);
    try {
      const parsed = FeedbackNoteSchema.safeParse(
        JSON.parse(readFileSync(join(folder, 'note.json'), 'utf8'))
      );
      return parsed.success ? { note: parsed.data, folder } : undefined;
    } catch {
      return undefined;
    }
  }

  /** The screenshot bytes of a note, or undefined. `id` is checked against the id pattern before any path is built. */
  screenshot(id: string): Buffer | undefined {
    if (!this.dir || !/^fb-\d{4,}$/.test(id)) return undefined;
    try {
      return readFileSync(join(this.dir, id, 'screenshot.png'));
    } catch {
      return undefined;
    }
  }

  /** Validates fully, and writes only when `dryRun` is false. */
  add(
    input: FeedbackAddInput,
    meta: { viewer: string; appVersion: string; now: Date },
    dryRun: boolean
  ): { note: FeedbackNote; count: number } {
    if (!this.dir) {
      throw new FeedbackRefusal(
        'feedback-unavailable',
        'This hub has no data directory, so it cannot store feedback.'
      );
    }
    const rows = this.load();
    if (rows.length >= FEEDBACK_NOTES_MAX) {
      throw new FeedbackRefusal(
        'feedback-full',
        `${FEEDBACK_NOTES_MAX} notes are stored, which is the limit. Move or archive data/feedback/ to make room.`
      );
    }
    const png = input.screenshotPng ? inspectPng(input.screenshotPng) : null;
    // Reserve a folder that does not exist yet. mkdir without `recursive` fails on an existing
    // folder, so a filed note is never written into, whatever the index or the counter says.
    if (!dryRun) mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    let id = '';
    let folder = '';
    for (let tries = 0; ; tries++) {
      id = `fb-${String(this.nextId).padStart(4, '0')}`;
      folder = join(this.dir, id);
      if (dryRun) {
        if (!existsSync(folder)) break;
        this.nextId += 1;
        continue;
      }
      try {
        mkdirSync(folder, { mode: 0o700 });
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || tries >= 1000) throw e;
        this.nextId += 1; // taken (by a note, or by one a crash left half-made): never write into it
      }
    }
    const fields: Omit<FeedbackAddInput, 'screenshotPng'> & { screenshotPng?: string } = {
      ...input,
    };
    const note: FeedbackNote = {
      id,
      createdAt: meta.now.toISOString(),
      viewer: meta.viewer,
      appVersion: meta.appVersion,
      clientBuild: fields.clientBuild ?? null,
      verdict: fields.verdict,
      region: fields.region,
      note: fields.note,
      snapshot: fields.snapshot ?? null,
      viewState: fields.viewState,
      screenshot: png ? { bytes: png.bytes.length, width: png.width, height: png.height } : null,
      status: 'open',
    };
    if (dryRun) return { note, count: rows.length + 1 };

    if (png) this.writeAtomic(join(folder, 'screenshot.png'), png.bytes);
    this.writeAtomic(join(folder, 'note.json'), `${JSON.stringify(note, null, 2)}\n`);
    const summary = summaryOf(note);
    appendFileSync(this.indexFile!, `${JSON.stringify(summary)}\n`, { mode: 0o600 });
    rows.push(summary);
    this.nextId += 1;
    return { note, count: rows.length };
  }

  private writeAtomic(path: string, data: string | Buffer): void {
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, data, { mode: 0o600 });
    renameSync(tmp, path);
  }
}
