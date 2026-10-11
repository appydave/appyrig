import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  DB_VERSIONS_KEPT,
  DbTableSchema,
  SchemaStatusSchema,
  type DbSchemaOutput,
  type DbTable,
  type SchemaPush,
} from '@appydave/shared';
import { diffSchemas } from '../core/schemaDiff.js';

/**
 * v1.4 · S7: the OpenRig database shape per machine, and the schema seen under each OpenRig
 * version. Kept in AppyRig's own data directory (`<data>/schemas/<machine>.json`), never in OpenRig,
 * so "changed since the last version" survives a hub restart. The latest push is also kept for
 * its status (no OpenRig here, unreadable).
 */

const isoDate = z.iso.datetime({ offset: true });
const StoredSchema = z.strictObject({
  machineId: z.string().min(1),
  latest: z.strictObject({
    status: SchemaStatusSchema,
    reason: z.string().nullable(),
    openrigVersion: z.string().nullable(),
    sampledAt: isoDate,
  }),
  versions: z
    .array(
      z.strictObject({ version: z.string(), firstSeenAt: isoDate, tables: z.array(DbTableSchema) })
    )
    .max(DB_VERSIONS_KEPT),
});
type Stored = z.infer<typeof StoredSchema>;

export class SchemaStore {
  private readonly byMachine = new Map<string, Stored>();
  private writes = new Map<string, Promise<void>>();

  constructor(
    private readonly dir: string | undefined,
    private readonly onDiskError: (message: string, err: unknown) => void = () => {}
  ) {}

  put(push: SchemaPush): void {
    const prev = this.byMachine.get(push.machineId);
    const versions = [...(prev?.versions ?? [])];
    // Only a readable schema under a known version becomes history.
    if (push.status === 'ok' && push.openrigVersion) {
      const at = versions.findIndex((v) => v.version === push.openrigVersion);
      if (at >= 0) versions[at] = { ...versions[at]!, tables: push.tables };
      else
        versions.push({
          version: push.openrigVersion,
          firstSeenAt: push.collectedAt,
          tables: push.tables,
        });
    }
    const next: Stored = {
      machineId: push.machineId,
      latest: {
        status: push.status,
        reason: push.reason,
        openrigVersion: push.openrigVersion,
        sampledAt: push.collectedAt,
      },
      versions: versions.slice(-DB_VERSIONS_KEPT),
    };
    this.byMachine.set(push.machineId, next);
    this.persist(next);
  }

  /** The db.schema answer for a machine; `no-data` when its collector never sent one. */
  get(machineId: string, now: Date): DbSchemaOutput {
    const s = this.byMachine.get(machineId);
    if (!s) {
      return {
        machine: machineId,
        status: 'no-data',
        reason:
          'no database schema from this collector yet (it predates v1.4, or has not sampled yet)',
        openrigVersion: null,
        sampledAt: null,
        sampleAgeMs: null,
        tables: [],
        changes: null,
        versionsSeen: [],
      };
    }
    const versionsSeen = s.versions.map((v) => ({
      version: v.version,
      firstSeenAt: v.firstSeenAt,
    }));
    const base = {
      machine: machineId,
      openrigVersion: s.latest.openrigVersion,
      sampledAt: s.latest.sampledAt,
      sampleAgeMs: Math.max(0, now.getTime() - Date.parse(s.latest.sampledAt)),
      versionsSeen,
    };
    if (s.latest.status !== 'ok') {
      return {
        ...base,
        status: s.latest.status,
        reason: s.latest.reason,
        tables: [],
        changes: null,
      };
    }
    // The current version's schema, and the one seen just before it.
    const idx = s.versions.findIndex((v) => v.version === s.latest.openrigVersion);
    const current = idx >= 0 ? s.versions[idx]! : s.versions[s.versions.length - 1];
    const tables: DbTable[] = current?.tables ?? [];
    const before = idx > 0 ? s.versions[idx - 1]! : null;
    return {
      ...base,
      status: 'ok',
      reason: s.latest.openrigVersion
        ? null
        : 'OpenRig version could not be read; showing the latest schema read',
      tables,
      changes: diffSchemas(
        before ? { version: before.version, tables: before.tables } : null,
        tables
      ),
    };
  }

  private persist(s: Stored): void {
    if (!this.dir) return;
    const dir = this.dir;
    const file = join(dir, `${encodeURIComponent(s.machineId)}.json`);
    const prev = this.writes.get(s.machineId) ?? Promise.resolve();
    const run = prev.then(async () => {
      const tmp = `${file}.${process.pid}.tmp`;
      try {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        await writeFile(tmp, JSON.stringify(this.byMachine.get(s.machineId)), { mode: 0o600 });
        await rename(tmp, file);
      } catch (err) {
        this.onDiskError(`cannot write ${file}`, err);
      }
    });
    this.writes.set(s.machineId, run);
    void run.then(() => {
      if (this.writes.get(s.machineId) === run) this.writes.delete(s.machineId);
    });
  }

  async flush(): Promise<void> {
    while (this.writes.size > 0) await Promise.all([...this.writes.values()]);
  }

  async load(): Promise<number> {
    if (!this.dir) return 0;
    let names: string[];
    try {
      names = (await readdir(this.dir)).filter((n) => n.endsWith('.json'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
        this.onDiskError(`cannot read ${this.dir}`, err);
      return 0;
    }
    for (const name of names) {
      const file = join(this.dir, name);
      try {
        const parsed = StoredSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
        if (!parsed.success) {
          this.onDiskError(`${file} is not a stored schema; skipped`, parsed.error);
          continue;
        }
        if (!this.byMachine.has(parsed.data.machineId))
          this.byMachine.set(parsed.data.machineId, parsed.data);
      } catch (err) {
        this.onDiskError(`cannot load ${file}; skipped`, err);
      }
    }
    return this.byMachine.size;
  }
}
