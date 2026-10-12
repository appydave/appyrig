import { describe, expect, it } from 'vitest';
import { EVERYWHERE, FILES, SCREEN, SEAT } from './KeysHelp.js';
import type { View } from '../App.js';

/**
 * v1.4: two lanes each bound a letter (S7 Files, S8 Feedback) and only a merge showed it. The keys
 * overlay is the one list of what the keys do, so it is also where a clash shows: no printable key
 * (a letter, `?` or `/`) may be listed for two different actions on one screen. Esc, Enter and the
 * arrows are context keys by design (each closes or moves "the thing on top") and are not counted.
 */
const PRINTABLE = /^[A-Za-z?/]$/;

const listed = (view: View) => {
  const rows = [
    ...SCREEN[view],
    ...(view === 'map' || view === 'flow' ? FILES : []),
    ...SEAT,
    ...EVERYWHERE,
  ];
  return rows.filter(([k]) => PRINTABLE.test(k));
};

describe('keys overlay: every printable key is unique on each screen', () => {
  for (const view of Object.keys(SCREEN) as View[]) {
    it(view, () => {
      const rows = listed(view);
      const keys = rows.map(([k]) => k.toUpperCase());
      const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
      expect(dupes, `a key is listed twice on "${view}": ${dupes.join(', ')}`).toEqual([]);
    });
  }

  it('a key a screen binds is never one of the keys that work anywhere', () => {
    const everywhere = new Set(
      EVERYWHERE.filter(([k]) => PRINTABLE.test(k)).map(([k]) => k.toUpperCase())
    );
    for (const view of Object.keys(SCREEN) as View[]) {
      for (const [k] of [...SCREEN[view], ...FILES, ...SEAT].filter(([key]) =>
        PRINTABLE.test(key)
      )) {
        expect(everywhere.has(k.toUpperCase()), `${view}: ${k} is also a global key`).toBe(false);
      }
    }
  });

  it('Files is O; F is reserved for Feedback', () => {
    const files = [...SCREEN.map, ...SCREEN.flow].find(([, d]) => d.includes('files'));
    expect(files?.[0]).toBe('O');
    // MERGE-ui: both lanes are in. F is listed exactly once on every screen, and it is Feedback.
    for (const v of Object.keys(SCREEN) as View[]) {
      const f = listed(v).filter(([k]) => k.toUpperCase() === 'F');
      expect(f, `${v}: F`).toHaveLength(1);
      expect(f[0]![1], `${v}: F`).toMatch(/^Feedback/);
    }
  });
});
