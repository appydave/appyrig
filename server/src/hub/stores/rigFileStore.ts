import {
  RIG_FILES_MAX,
  RIG_SPEC_FILES_MAX,
  type RigFile,
  type RigFileMeta,
  type RigFilesPush,
} from '@appydave/shared';

/**
 * v1.4 · S7: the rig files each collector pushed, in memory only. A hub restart forgets them and
 * every collector sends them again on reconnecting. The hub never reads a disk for these and never
 * takes a path: a client names a file id, and only ids a collector pushed can be found.
 */
export class RigFileStore {
  private readonly byRig = new Map<string, Map<string, RigFile>>();

  private key(machine: string, rig: string): string {
    return `${machine}\u0000${rig}`;
  }

  put(push: RigFilesPush): void {
    const k = this.key(push.machineId, push.rig);
    const files = push.replace
      ? new Map<string, RigFile>()
      : (this.byRig.get(k) ?? new Map<string, RigFile>());

    for (const f of push.files) {
      files.set(f.id, f);
    }

    // Each kind keeps its own cap: spec-named files (scope `rig`) never push out the allowlisted ones.
    const trim = (spec: boolean, max: number) => {
      const ids = [...files.values()].filter((f) => (f.scope === 'rig') === spec).map((f) => f.id);

      for (const id of ids.slice(0, Math.max(0, ids.length - max))) {
        files.delete(id);
      }
    };

    trim(false, RIG_FILES_MAX);
    trim(true, RIG_SPEC_FILES_MAX);
    this.byRig.set(k, files);
  }

  has(machine: string, rig: string): boolean {
    return this.byRig.has(this.key(machine, rig));
  }

  /** The allowlisted files (scopes spec, mission): what rig.files has always listed. */
  list(machine: string, rig: string): RigFileMeta[] {
    return this.metas(machine, rig).filter((f) => f.scope !== 'rig');
  }

  /** The files the rig's rig.yaml names (scope `rig`); empty when none were sent. */
  listSpecNamed(machine: string, rig: string): RigFileMeta[] {
    return this.metas(machine, rig).filter((f) => f.scope === 'rig');
  }

  private metas(machine: string, rig: string): RigFileMeta[] {
    return [...(this.byRig.get(this.key(machine, rig))?.values() ?? [])].map(
      ({ content: _c, ...meta }) => meta
    );
  }

  get(machine: string, rig: string, fileId: string): RigFile | undefined {
    return this.byRig.get(this.key(machine, rig))?.get(fileId);
  }
}
