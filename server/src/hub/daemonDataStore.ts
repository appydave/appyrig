import type { DaemonDataPush, DaemonKind } from '@appydave/shared';

/**
 * v2 data channels: the latest push per machine, kind and key (seat id for seat detail, empty for
 * the rest), exactly as the collector sent it, in memory only. A hub restart forgets them and every
 * collector sends them again on reconnecting (it resets what it sent). Read-only: nothing here is
 * ever sent back to a collector or an OpenRig daemon.
 */
export class DaemonDataStore {
  private readonly byKey = new Map<string, DaemonDataPush>();

  private key(machine: string, kind: DaemonKind, key: string): string {
    return `${machine}\u0000${kind}\u0000${key}`;
  }

  put(push: DaemonDataPush): void {
    this.byKey.set(this.key(push.machineId, push.kind, push.key), push);
  }

  /** The latest push of `kind` (with `key`) from one machine, typed by its kind. */
  get<K extends DaemonKind>(
    machine: string,
    kind: K,
    key = ''
  ): Extract<DaemonDataPush, { kind: K }> | undefined {
    return this.byKey.get(this.key(machine, kind, key)) as
      Extract<DaemonDataPush, { kind: K }> | undefined;
  }
}
