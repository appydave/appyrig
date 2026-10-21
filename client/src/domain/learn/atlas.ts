/**
 * The OpenRig Concept Atlas: every OpenRig term David met, checked against OpenRig's code, plus the
 * AppyDave ideas around it, each with a status so the two never blur.
 *
 * Canonical home: ~/dev/ad/brains/openrig/atlas/concept-atlas.json (built by atlas/scripts/build_atlas.py).
 * This client keeps a copy: update the brain, then `npm run atlas:sync`.
 */
import data from './atlas.json';

export type AtlasStatus =
  | 'implemented'
  | 'documented'
  | 'claimed'
  | 'interpretation'
  | 'not-found'
  | 'ours-built'
  | 'ours-proposed';

export interface AtlasTerm {
  id: string;
  term: string;
  aliases?: string[];
  world: 'openrig' | 'appydave';
  group: string;
  status: AtlasStatus;
  definition: string;
  evidence: { ref: string; what: string }[];
  example?: string;
  note?: string;
  related: { id: string; rel: string }[];
}

export interface Atlas {
  snapshot: {
    repo: string;
    commit: string;
    changelog: string;
    npm: string;
    study_base: string;
    checked: string;
  };
  statuses: AtlasStatus[];
  seed: { heard: string; id: string }[];
  terms: AtlasTerm[];
}

export const ATLAS = data as Atlas;

/** The published atlas views (Claude artifacts). */
export const ATLAS_URL = 'https://claude.ai/artifact/LynaDYmcT8jCmD2BBeeUpC';

export const STATUS_LABEL: Record<AtlasStatus, string> = {
  implemented: 'in the code',
  documented: 'docs only',
  claimed: 'video only',
  interpretation: 'our word',
  'not-found': 'not OpenRig',
  'ours-built': 'ours · built',
  'ours-proposed': 'ours · idea',
};

/** Terms grouped for display: OpenRig groups first, then AppyDave's, each A–Z. */
export function atlasGroups(
  atlas: Atlas = ATLAS
): { world: string; group: string; terms: AtlasTerm[] }[] {
  const out = new Map<string, { world: string; group: string; terms: AtlasTerm[] }>();
  for (const t of atlas.terms) {
    const key = `${t.world}/${t.group}`;
    if (!out.has(key)) {
      out.set(key, { world: t.world, group: t.group, terms: [] });
    }
    out.get(key)!.terms.push(t);
  }

  return [...out.values()]
    .map((g) => ({ ...g, terms: g.terms.sort((a, b) => a.term.localeCompare(b.term)) }))
    .sort((a, b) =>
      a.world === b.world ? a.group.localeCompare(b.group) : a.world === 'openrig' ? -1 : 1
    );
}
