import { RIG_FILES_MAX, type RigFile, type RigFileMeta, type RigFilesPush } from '@appydave/shared';

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
    for (const f of push.files) files.set(f.id, f);
    while (files.size > RIG_FILES_MAX) files.delete(files.keys().next().value as string);
    this.byRig.set(k, files);
  }

  has(machine: string, rig: string): boolean {
    return this.byRig.has(this.key(machine, rig));
  }

  list(machine: string, rig: string): RigFileMeta[] {
    return [...(this.byRig.get(this.key(machine, rig))?.values() ?? [])].map(
      ({ content: _c, ...meta }) => meta
    );
  }

  get(machine: string, rig: string, fileId: string): RigFile | undefined {
    return this.byRig.get(this.key(machine, rig))?.get(fileId);
  }
}
