/**
 * How many entries each store keeps in memory. The keys are seat and rig names, which come and go
 * for as long as the hub runs, so without a limit these only ever grow. Sized well above a real
 * fleet (140 seats have a history on this hub after months), so only long-gone names are dropped.
 */
export const MEMORY_LIMITS = {
  /** A history is ~100 KB typically and ~600 KB at most. Dropped ones are read back from disk. */
  historySeats: 400,
  /** Memory only: a dropped seat has no loadout until its collector reconnects or it changes. */
  loadoutSeats: 400,
  /** Up to 8 MB a rig (32 files of 256 KB). Memory only, resent the same way. */
  fileRigs: 64,
  /** Up to 48 MB a rig, so the tightest limit. Memory only, resent the same way. */
  missionRigs: 32,
  /** Chunked uploads under way. One the collector abandoned would otherwise stay forever. */
  missionUploads: 64,
} as const;

/** A Map holding at most `limit` entries: past that, the one least recently set or read is dropped. */
export class RecentMap<K, V> extends Map<K, V> {
  constructor(private readonly limit: number) {
    super();
  }

  override set(key: K, value: V): this {
    this.delete(key);
    super.set(key, value);

    for (const oldest of this.keys()) {
      if (this.size <= this.limit) {
        break;
      }

      this.delete(oldest);
    }

    return this;
  }

  override get(key: K): V | undefined {
    const value = super.get(key);

    if (value !== undefined) {
      this.set(key, value);
    }

    return value;
  }
}
