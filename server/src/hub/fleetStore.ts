import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  ASLEEP_AFTER_MS,
  MachineSnapshotSchema,
  type FleetMachine,
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

export interface FleetStoreOptions {
  /** Directory that holds `snapshots/`. Undefined = memory only (no disk). */
  dataDir?: string;
  now?: () => Date;
  asleepAfterMs?: number;
  /** Told about files that could not be read or written. Never thrown: the hub keeps serving. */
  onDiskError?: (message: string, err: unknown) => void;
}

export class FleetStore {
  private readonly machines = new Map<string, FleetMachine>();
  private readonly now: () => Date;
  private readonly asleepAfterMs: number;
  private readonly dir: string | undefined;
  private readonly onDiskError: (message: string, err: unknown) => void;
  /** Per machine: the write in flight, and the latest entry waiting behind it (coalesced). */
  private readonly writes = new Map<string, Promise<void>>();
  private readonly pending = new Map<string, FleetMachine>();

  constructor(opts: FleetStoreOptions = {}) {
    this.now = opts.now ?? (() => new Date());
    this.asleepAfterMs = opts.asleepAfterMs ?? ASLEEP_AFTER_MS;
    this.dir = opts.dataDir ? join(opts.dataDir, 'snapshots') : undefined;
    this.onDiskError = opts.onDiskError ?? (() => {});
  }

  livenessAt(lastSeen: string): Liveness {
    return this.now().getTime() - Date.parse(lastSeen) >= this.asleepAfterMs ? 'asleep' : 'live';
  }

  list(): FleetMachine[] {
    return [...this.machines.values()].sort((a, b) => a.machine.id.localeCompare(b.machine.id));
  }

  get(machineId: string): FleetMachine | undefined {
    return this.machines.get(machineId);
  }

  /** Record a validated snapshot as received now. Returns the new entry (always `live`). */
  put(snapshot: MachineSnapshot): FleetMachine {
    const entry: FleetMachine = {
      machine: snapshot.machine,
      liveness: 'live',
      lastSeen: this.now().toISOString(),
      snapshot,
    };
    this.machines.set(entry.machine.id, entry);
    this.persist(entry);
    return entry;
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
        changed.push(asleep);
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

  /** Resolves when every write queued so far has finished. */
  async flush(): Promise<void> {
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
      await mkdir(dir, { recursive: true });
      await writeFile(tmp, JSON.stringify({ lastSeen: entry.lastSeen, snapshot: entry.snapshot }));
      await rename(tmp, file); // atomic: a crash mid-write never leaves a half file
    } catch (err) {
      this.onDiskError(`cannot write ${file}`, err);
    }
  }
}
