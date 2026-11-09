/**
 * N10: the latest push of one side channel per machine (rig specs, rig commands), exactly as the
 * collector sent it, in memory only. A hub restart forgets them; every collector sends them again on
 * reconnecting. Read-only: nothing here is ever sent back to a collector.
 */
export class LatestByMachine<T extends { machineId: string }> {
  private readonly byMachine = new Map<string, T>();

  put(push: T): void {
    this.byMachine.set(push.machineId, push);
  }

  get(machine: string): T | undefined {
    return this.byMachine.get(machine);
  }
}
