import { useEffect, useRef, useState } from 'react';

/**
 * Batch 1 · B1 (fb-0004): live lists must not shuffle under the pointer. Two rigs that talk to
 * each other used to swap places every push, because the list sorts by latest activity.
 *
 * Keeps the previous order and only re-sorts when it is allowed to:
 *   - never while `frozen` (the pointer is over the list);
 *   - otherwise at most once per `everyMs`, or at once when a "big" change happens (`groupOf`
 *     differs, e.g. a rig started or stopped), because that is news worth moving for.
 * Between re-sorts, items that left are dropped and new items go to the end, so nothing jumps.
 */
export function nextOrder(
  prev: string[],
  sorted: string[],
  opts: { allowResort: boolean; groupChanged: boolean; frozen: boolean }
): { order: string[]; resorted: boolean } {
  const present = new Set(sorted);
  if (!opts.frozen && (opts.allowResort || opts.groupChanged || prev.length === 0)) {
    return { order: sorted, resorted: true };
  }
  const kept = prev.filter((k) => present.has(k));
  const known = new Set(kept);
  return { order: [...kept, ...sorted.filter((k) => !known.has(k))], resorted: false };
}

/** Items in a stable order (see nextOrder). `sorted` is the live order; keys must be unique. */
export function useStableOrder<T>(
  sorted: T[],
  keyOf: (t: T) => string,
  groupOf: (t: T) => string,
  frozen: boolean,
  everyMs = 60_000,
  now: () => number = Date.now
): T[] {
  const order = useRef<string[]>([]);
  const groups = useRef<string>('');
  const lastSort = useRef(0);
  // Re-render once the freeze lifts or the interval passes, so a held-back sort lands then.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (frozen) return;
    const id = window.setInterval(() => setTick((t) => t + 1), everyMs);
    return () => window.clearInterval(id);
  }, [frozen, everyMs]);

  const keys = sorted.map(keyOf);
  const groupSig = sorted
    .map((t) => `${keyOf(t)}=${groupOf(t)}`)
    .sort()
    .join('|');
  const t = now();
  const { order: next, resorted } = nextOrder(order.current, keys, {
    allowResort: t - lastSort.current >= everyMs,
    groupChanged: groupSig !== groups.current,
    frozen,
  });
  if (resorted) {
    lastSort.current = t;
    groups.current = groupSig;
  }
  order.current = next;
  const byKey = new Map(sorted.map((s) => [keyOf(s), s]));
  return next.map((k) => byKey.get(k)!).filter(Boolean);
}
