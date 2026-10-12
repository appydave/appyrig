import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { FeedbackStore } from './feedbackStore.js';
import { LoadoutStore } from './loadoutStore.js';
import { RigFileStore } from './rigFileStore.js';
import { SchemaStore } from './schemaStore.js';
import {
  ASLEEP_AFTER_MS,
  MachineSnapshotSchema,
  SeatHistorySchema,
  HANDOFF_STORE_MAX,
  HANDOFF_BODY_MAX,
  type HandoffBodies,
  type FleetMachine,
  type SeatHistory,
  type Liveness,
  type MachineSnapshot,
} from '@appydave/shared';

/**
 * The hub's last-known state: one FleetMachine per machine, in memory, mirrored to
 * `<dataDir>/snapshots/<machine>.json` so a restarted hub shows the last-known fleet at once (S8).
 *
 * Liveness is derived, never stored: a machine is `asleep` once `now - lastSeen >= asleepAfterMs`
 * (AC 6). A restarted hub therefore shows a machine that pushed long ago as asleep straight away,
 * with its real lastSeen, not as live.
 */

/** What goes on disk. Liveness is recomputed on load. */
const StoredMachineSchema = z.strictObject({
  lastSeen: z.iso.datetime({ offset: true }),
  snapshot: MachineSnapshotSchema,
});

/** What goes on disk for queue bodies (no per-batch limit: it holds up to HANDOFF_STORE_MAX). */
const StoredHandoffsSchema = z.strictObject({
  machineId: z.string().min(1),
  items: z.array(
    z.strictObject({
      id: z.string().min(1),
      body: z.string().max(HANDOFF_BODY_MAX),
      truncated: z.boolean(),
    })
  ),
});

export interface FleetStoreOptions {
  /** Directory that holds `snapshots/`. Undefined = memory only (no disk). */
  dataDir?: string;
  now?: () => Date;
  asleepAfterMs?: number;
  /** Told about files that could not be read or written. Never thrown: the hub keeps serving. */
  onDiskError?: (message: string, err: unknown) => void;
  /** Told when a machine's liveness changes: first push (from null), live → asleep, asleep → live. */
  onLiveness?: (change: LivenessChange) => void;
  /** Laid over a machine on every read and emit (v1.4: rig labels). Never stored or written to disk. */
  decorate?: (machine: FleetMachine, all: FleetMachine[]) => FleetMachine;
}

export interface LivenessChange {
  machine: string;
  /** null = the hub had never heard from this machine (not even on disk). */
  from: Liveness | null;
  to: Liveness;
  lastSeen: string;
}

export class FleetStore {
  /** v1.4 · S7: rig files and the OpenRig database shape, as collectors pushed them. */
  readonly rigFiles = new RigFileStore();
  readonly schemas: SchemaStore;
  /** v1.5 · L1: seat loadouts (listed skills, prompt layers) for the Debug view. Memory only. */
  readonly loadouts = new LoadoutStore();
  /** v1.4 · S8: in-app feedback notes. The only thing AppyRig writes. */
  readonly feedback: FeedbackStore;
  private readonly machines = new Map<string, FleetMachine>();
  private readonly now: () => Date;
  private readonly asleepAfterMs: number;
  private readonly dir: string | undefined;
  private readonly onDiskError: (message: string, err: unknown) => void;
  private readonly onLiveness: (change: LivenessChange) => void;
  private readonly decorate: (machine: FleetMachine, all: FleetMachine[]) => FleetMachine;
  /** When (ms) the hub saw each machine's login change from one account to another. Not persisted. */
  private readonly emailChanged = new Map<string, number>();
  /** Per machine: the write in flight, and the latest entry waiting behind it (coalesced). */
  private readonly writes = new Map<string, Promise<void>>();
  private readonly pending = new Map<string, FleetMachine>();
  /** v1.2: seat histories for the replay consoles, by `<machine>/<seat>`. */
  private readonly histories = new Map<string, SeatHistory>();
  private readonly historyDir: string | undefined;
  /** v1.4 · S4: queue message bodies by machine, then queue id. Over the cap the oldest items (by queue createdAt) are dropped. */
  private readonly handoffs = new Map<string, Map<string, { body: string; truncated: boolean }>>();
  private readonly handoffDir: string | undefined;

  constructor(opts: FleetStoreOptions = {}) {
    this.now = opts.now ?? (() => new Date());
    this.asleepAfterMs = opts.asleepAfterMs ?? ASLEEP_AFTER_MS;
    this.dir = opts.dataDir ? join(opts.dataDir, 'snapshots') : undefined;
    this.historyDir = opts.dataDir ? join(opts.dataDir, 'history') : undefined;
    this.handoffDir = opts.dataDir ? join(opts.dataDir, 'handoffs') : undefined;
    this.feedback = new FeedbackStore(opts.dataDir);
    this.schemas = new SchemaStore(
      opts.dataDir ? join(opts.dataDir, 'schemas') : undefined,
      opts.onDiskError
    );
    this.onDiskError = opts.onDiskError ?? (() => {});
    this.onLiveness = opts.onLiveness ?? (() => {});
    this.decorate = opts.decorate ?? ((m) => m);
  }

  /** When (ms since epoch) the hub saw this machine login change accounts, if it has. */
  emailChangedAt(machineId: string): number | undefined {
    return this.emailChanged.get(machineId);
  }

  livenessAt(lastSeen: string): Liveness {
    return this.now().getTime() - Date.parse(lastSeen) >= this.asleepAfterMs ? 'asleep' : 'live';
  }

  list(): FleetMachine[] {
    const raw = [...this.machines.values()].sort((a, b) =>
      a.machine.id.localeCompare(b.machine.id)
    );
    return raw.map((m) => this.decorate(m, raw));
  }

  get(machineId: string): FleetMachine | undefined {
    const m = this.machines.get(machineId);
    return m && this.decorate(m, [...this.machines.values()]);
  }

  /** Record a validated snapshot as received now. Returns the new entry (always `live`). */
  put(snapshot: MachineSnapshot): FleetMachine {
    const entry: FleetMachine = {
      machine: snapshot.machine,
      liveness: 'live',
      lastSeen: this.now().toISOString(),
      snapshot,
    };
    const prior = this.machines.get(entry.machine.id);
    const before = prior?.liveness ?? null;
    const was = prior?.snapshot.account?.email?.toLowerCase();
    const is = snapshot.account?.email?.toLowerCase();
    if (was && is && was !== is) this.emailChanged.set(entry.machine.id, this.now().getTime());
    this.machines.set(entry.machine.id, entry);
    this.persist(entry);
    if (before !== 'live') {
      this.onLiveness({
        machine: entry.machine.id,
        from: before,
        to: 'live',
        lastSeen: entry.lastSeen,
      });
    }
    return this.decorate(entry, [...this.machines.values()]);
  }

  /**
   * Flip every live machine whose last push is too old to `asleep`. Returns only the machines
   * that changed, so the caller can emit them. Asleep machines wake only through put().
   */
  sweep(): FleetMachine[] {
    const changed: FleetMachine[] = [];
    for (const entry of this.machines.values()) {
      if (entry.liveness === 'live' && this.livenessAt(entry.lastSeen) === 'asleep') {
        const asleep: FleetMachine = { ...entry, liveness: 'asleep' };
        this.machines.set(entry.machine.id, asleep);
        changed.push(this.decorate(asleep, [...this.machines.values()]));
        this.onLiveness({
          machine: entry.machine.id,
          from: 'live',
          to: 'asleep',
          lastSeen: entry.lastSeen,
        });
      }
    }
    return changed;
  }

  /** Load every `<machine>.json` from disk. Unreadable or invalid files are reported and skipped. */
  async load(): Promise<FleetMachine[]> {
    if (!this.dir) return [];
    let names: string[];
    try {
      names = (await readdir(this.dir)).filter((n) => n.endsWith('.json'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      this.onDiskError(`cannot read ${this.dir}`, err);
      return [];
    }
    for (const name of names) {
      const file = join(this.dir, name);
      try {
        const parsed = StoredMachineSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
        if (!parsed.success) {
          this.onDiskError(`${file} is not a stored snapshot; skipped`, parsed.error);
          continue;
        }
        const { lastSeen, snapshot } = parsed.data;
        if (`${snapshot.machine.id}.json` !== name) {
          this.onDiskError(`${file} holds machine ${snapshot.machine.id}; skipped`, null);
          continue;
        }
        // A newer push may already have arrived while loading; never overwrite it.
        if (this.machines.has(snapshot.machine.id)) continue;
        this.machines.set(snapshot.machine.id, {
          machine: snapshot.machine,
          liveness: this.livenessAt(lastSeen),
          lastSeen,
          snapshot,
        });
      } catch (err) {
        this.onDiskError(`cannot load ${file}; skipped`, err);
      }
    }
    return this.list();
  }

  /** v1.2: keep the latest history a collector sent for one seat (memory + disk). */
  putHistory(h: SeatHistory): void {
    this.histories.set(`${h.machineId}/${h.seat}`, h);
    if (!this.historyDir) return;
    const key = `history:${h.machineId}/${h.seat}`;
    const file = join(
      this.historyDir,
      `${encodeURIComponent(h.machineId)}__${encodeURIComponent(h.seat)}.json`
    );
    const prev = this.writes.get(key) ?? Promise.resolve();
    const run = prev.then(async () => {
      const tmp = `${file}.${process.pid}.tmp`;
      try {
        await mkdir(this.historyDir!, { recursive: true, mode: 0o700 });
        await writeFile(tmp, JSON.stringify(this.histories.get(`${h.machineId}/${h.seat}`)), {
          mode: 0o600,
        });
        await rename(tmp, file);
      } catch (err) {
        this.onDiskError(`cannot write ${file}`, err);
      }
    });
    this.writes.set(key, run);
    void run.then(() => {
      if (this.writes.get(key) === run) this.writes.delete(key);
    });
  }

  getHistory(machineId: string, seat: string): SeatHistory | undefined {
    return this.histories.get(`${machineId}/${seat}`);
  }

  /** Load stored histories; invalid files are reported and skipped. */
  async loadHistories(): Promise<number> {
    if (!this.historyDir) return 0;
    let names: string[];
    try {
      names = (await readdir(this.historyDir)).filter((n) => n.endsWith('.json'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.onDiskError(`cannot read ${this.historyDir}`, err);
      }
      return 0;
    }
    for (const name of names) {
      const file = join(this.historyDir, name);
      try {
        const parsed = SeatHistorySchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
        if (!parsed.success) {
          this.onDiskError(`${file} is not a seat history; skipped`, parsed.error);
          continue;
        }
        const key = `${parsed.data.machineId}/${parsed.data.seat}`;
        if (!this.histories.has(key)) this.histories.set(key, parsed.data);
      } catch (err) {
        this.onDiskError(`cannot load ${file}; skipped`, err);
      }
    }
    return this.histories.size;
  }

  /** v1.4 · S4: keep queue bodies a collector sent (memory + disk). Oldest dropped past HANDOFF_STORE_MAX. */
  putHandoffs(b: HandoffBodies): void {
    const m = this.handoffs.get(b.machineId) ?? new Map();
    this.handoffs.set(b.machineId, m);
    for (const i of b.items) m.set(i.id, { body: i.body, truncated: i.truncated });
    // Over the cap, drop the OLDEST items, not the earliest arrivals: a collector sends newest first,
    // so arrival order would throw away exactly what a person is looking at. Age comes from the
    // machine's queue rows; a body whose item is not in them (nothing serves it) goes first.
    if (m.size > HANDOFF_STORE_MAX) {
      const created = new Map(
        (this.machines.get(b.machineId)?.snapshot.queue ?? []).map((q) => [
          q.id,
          Date.parse(q.createdAt),
        ])
      );
      const oldestFirst = [...m.keys()].sort(
        (x, y) =>
          (created.get(x) ?? -Infinity) - (created.get(y) ?? -Infinity) ||
          (x < y ? -1 : x > y ? 1 : 0)
      );
      for (const id of oldestFirst.slice(0, m.size - HANDOFF_STORE_MAX)) m.delete(id);
    }
    if (!this.handoffDir) return;
    const key = `handoffs:${b.machineId}`;
    const file = join(this.handoffDir, `${encodeURIComponent(b.machineId)}.json`);
    const prev = this.writes.get(key) ?? Promise.resolve();
    const run = prev.then(async () => {
      const tmp = `${file}.${process.pid}.tmp`;
      try {
        await mkdir(this.handoffDir!, { recursive: true, mode: 0o700 });
        const items = [...(this.handoffs.get(b.machineId) ?? new Map()).entries()].map(
          ([id, v]) => ({ id, ...v })
        );
        await writeFile(tmp, JSON.stringify({ machineId: b.machineId, items }), { mode: 0o600 });
        await rename(tmp, file);
      } catch (err) {
        this.onDiskError(`cannot write ${file}`, err);
      }
    });
    this.writes.set(key, run);
    void run.then(() => {
      if (this.writes.get(key) === run) this.writes.delete(key);
    });
  }

  getHandoff(machineId: string, id: string): { body: string; truncated: boolean } | undefined {
    return this.handoffs.get(machineId)?.get(id);
  }

  /** Load stored queue bodies; invalid files are reported and skipped. */
  async loadHandoffs(): Promise<number> {
    if (!this.handoffDir) return 0;
    let names: string[];
    try {
      names = (await readdir(this.handoffDir)).filter((n) => n.endsWith('.json'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.onDiskError(`cannot read ${this.handoffDir}`, err);
      }
      return 0;
    }
    for (const name of names) {
      const file = join(this.handoffDir, name);
      try {
        const parsed = StoredHandoffsSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
        if (!parsed.success) {
          this.onDiskError(`${file} is not stored queue bodies; skipped`, parsed.error);
          continue;
        }
        // Bodies that arrived while loading win; never overwrite them.
        const m = this.handoffs.get(parsed.data.machineId) ?? new Map();
        for (const i of parsed.data.items.slice(-HANDOFF_STORE_MAX))
          if (!m.has(i.id)) m.set(i.id, { body: i.body, truncated: i.truncated });
        this.handoffs.set(parsed.data.machineId, m);
      } catch (err) {
        this.onDiskError(`cannot load ${file}; skipped`, err);
      }
    }
    return [...this.handoffs.values()].reduce((n, m) => n + m.size, 0);
  }

  /** Resolves when every write queued so far has finished. */
  async flush(): Promise<void> {
    await this.schemas.flush();
    while (this.writes.size > 0) await Promise.all([...this.writes.values()]);
  }

  private persist(entry: FleetMachine): void {
    if (!this.dir) return;
    const id = entry.machine.id;
    this.pending.set(id, entry);
    if (this.writes.has(id)) return; // the running write picks up the latest entry when it ends
    const run = async () => {
      for (let next = this.pending.get(id); next; next = this.pending.get(id)) {
        this.pending.delete(id);
        await this.write(next);
      }
      this.writes.delete(id);
    };
    this.writes.set(id, run());
  }

  private async write(entry: FleetMachine): Promise<void> {
    const dir = this.dir!;
    const file = join(dir, `${entry.machine.id}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      // 0600: snapshots carry (redacted) terminal text; only this user reads them.
      await writeFile(tmp, JSON.stringify({ lastSeen: entry.lastSeen, snapshot: entry.snapshot }), {
        mode: 0o600,
      });
      await rename(tmp, file); // atomic: a crash mid-write never leaves a half file
    } catch (err) {
      this.onDiskError(`cannot write ${file}`, err);
    }
  }
}
