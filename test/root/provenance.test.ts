import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  constList,
  docMdNames,
  functionKeys,
  interfaceFields,
  mapKeys,
  unionLiterals,
} from '../../scripts/provenance/extract.js';

/**
 * The provenance check's extractors (scripts/provenance/extract.ts). A missing anchor must come
 * back as null, never as an empty list: an empty list would read as "OpenRig removed everything",
 * and null is what the check reports as anchor-missing drift.
 */
describe('provenance extractors', () => {
  const src = `
const RIG_KEYS = new Set([
  "version", "name",
  "pods",
]);
export const VALID_EDGE_KINDS = new Set(["delegates_to", "can_observe"]);
export const BUILT_IN_RUNTIMES: ReadonlySet<string> = new Set(["claude-code", "codex"]);
export const WORKSPACE_KINDS = ["user", "project"] as const;
const BUILTIN: ReadonlyMap<string, string> = new Map([
  ["CULTURE-default.md", "guidance/CULTURE-default.md"],
  ["openrig-start.md", "guidance/openrig-start.md"],
]);
export interface StartupLayerInputs {
  specStartup: StartupBlock;
  profileStartup?: StartupBlock;
}
export type SliceStatus = "active" | "done";
export function normalizeProfile(raw: Record<string, unknown>): ProfileSpec {
  const uses = raw["uses"] as Record<string, unknown> | undefined;
  return { summary: raw["summary"], skills: uses?.["skills"], nested: { x: raw["startup"] } };
}
function after() { return raw["not_this"]; }
`;

  it('reads Set, typed Set and as-const lists in source order', () => {
    expect(constList(src, 'RIG_KEYS')).toEqual(['version', 'name', 'pods']);
    expect(constList(src, 'VALID_EDGE_KINDS')).toEqual(['delegates_to', 'can_observe']);
    expect(constList(src, 'BUILT_IN_RUNTIMES')).toEqual(['claude-code', 'codex']);
    expect(constList(src, 'WORKSPACE_KINDS')).toEqual(['user', 'project']);
  });

  it('reads Map keys, interface fields and union literals', () => {
    expect(mapKeys(src, 'BUILTIN')).toEqual(['CULTURE-default.md', 'openrig-start.md']);
    expect(interfaceFields(src, 'StartupLayerInputs')).toEqual(['specStartup', 'profileStartup']);
    expect(unionLiterals(src, 'SliceStatus')).toEqual(['active', 'done']);
  });

  it('reads the keys a normaliser takes from one variable, inside that function only', () => {
    expect(functionKeys(src, 'normalizeProfile', 'raw')).toEqual(['uses', 'summary', 'startup']);
    expect(functionKeys(src, 'normalizeProfile', 'uses')).toEqual(['skills']);
  });

  it('returns null, not an empty list, when an anchor is gone', () => {
    expect(constList(src, 'POD_KEYS')).toBeNull();
    expect(mapKeys(src, 'NOPE')).toBeNull();
    expect(interfaceFields(src, 'Nope')).toBeNull();
    expect(unionLiterals(src, 'Nope')).toBeNull();
    expect(functionKeys(src, 'normalizeNope', 'raw')).toBeNull();
    expect(docMdNames('# a', 'missing heading', '#')).toBeNull();
  });

  it('reads backticked chain names between two doc markers', () => {
    const doc =
      'intro `X.md`\nEstablished names:\n- `LEARNED.md` and `CRAFT.md`\n### Next\n`SPEC.md`';
    expect(docMdNames(doc, 'Established names', '### Next')).toEqual(['LEARNED.md', 'CRAFT.md']);
  });

  it('gives every ignore.json entry a reason', () => {
    const file = JSON.parse(
      readFileSync(new URL('../../scripts/provenance/ignore.json', import.meta.url), 'utf8')
    ) as Record<'unmapped' | 'oursOnly', Array<{ probe: string; value: string; reason: string }>>;
    for (const e of [...file.unmapped, ...file.oursOnly]) {
      expect(e.reason.length, `${e.probe}:${e.value}`).toBeGreaterThan(20);
    }
  });
});
