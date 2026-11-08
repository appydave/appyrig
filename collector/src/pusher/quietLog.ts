/** A warning that repeats for as long as its cause lasts is logged once per this long, per key. */
const WARN_EVERY_MS = 10 * 60_000;

export interface QuietLog {
  /** Logs a line unless it repeats the previous one. */
  note(line: string): void;
  /**
   * A warning that repeats for as long as its cause lasts (an older hub with no listener for queue
   * bodies) is logged once per WARN_EVERY_MS, however much other news arrives in between.
   */
  warnSometimes(key: string, line: string): void;
}

export function quietLog(log: (line: string) => void): QuietLog {
  let lastNote = '';
  const lastWarn = new Map<string, number>();

  return {
    note(line) {
      if (line !== lastNote) {
        lastNote = line;
        log(line);
      }
    },
    warnSometimes(key, line) {
      const t = Date.now();

      if (t - (lastWarn.get(key) ?? 0) >= WARN_EVERY_MS) {
        lastWarn.set(key, t);
        log(line);
      }
    },
  };
}
