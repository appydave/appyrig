import type { SeatLoadout } from '@appydave/shared';

/**
 * v1.5 · L1: each seat's latest loadout, as its collector pushed it, in memory only. A hub restart
 * forgets them and every collector sends them again on reconnecting (it resets what it sent).
 */
export class LoadoutStore {
  private readonly bySeat = new Map<string, SeatLoadout>();

  private key(machine: string, seat: string): string {
    return `${machine}\u0000${seat}`;
  }

  put(loadout: SeatLoadout): void {
    this.bySeat.set(this.key(loadout.machineId, loadout.seat), loadout);
  }

  get(machine: string, seat: string): SeatLoadout | undefined {
    return this.bySeat.get(this.key(machine, seat));
  }
}
