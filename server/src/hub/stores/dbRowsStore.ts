import type { DbRowsPush } from '@appydave/shared';

/**
 * Batch 1 · B5: each machine's OpenRig table rows, as its collector pushed them, in memory only.
 * A hub restart forgets them and every collector sends them again on reconnecting.
 */
export class DbRowsStore {
  private readonly byTable = new Map<string, DbRowsPush>();

  private key(machine: string, table: string): string {
    return `${machine}\u0000${table}`;
  }

  put(push: DbRowsPush): void {
    this.byTable.set(this.key(push.machineId, push.table), push);
  }

  get(machine: string, table: string): DbRowsPush | undefined {
    return this.byTable.get(this.key(machine, table));
  }
}
