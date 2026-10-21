import { describe, expect, it } from 'vitest';
import { ATLAS, STATUS_LABEL, atlasGroups } from './atlas.js';

describe('concept atlas', () => {
  it('every term has a known status and its relations point at real terms', () => {
    const ids = new Set(ATLAS.terms.map((t) => t.id));

    for (const t of ATLAS.terms) {
      expect(STATUS_LABEL[t.status]).toBeDefined();
      for (const r of t.related) {
        expect(ids.has(r.id)).toBe(true);
      }
    }
  });

  it('every OpenRig term marked as in the code cites evidence', () => {
    const bare = ATLAS.terms.filter((t) => t.status === 'implemented' && t.evidence.length === 0);

    expect(bare.map((t) => t.id)).toEqual([]);
  });

  it('groups OpenRig first, then AppyDave, and keeps every term', () => {
    const groups = atlasGroups();

    expect(groups[0]!.world).toBe('openrig');
    expect(groups.at(-1)!.world).toBe('appydave');
    expect(groups.reduce((n, g) => n + g.terms.length, 0)).toBe(ATLAS.terms.length);
  });
});
