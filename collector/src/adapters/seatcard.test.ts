import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keySkillsOf, seatConfigReader, withSeatCards } from './seatcard.js';

const AGENTS = '/x/@openrig/cli/daemon/specs/agents';

describe('D09 W3 seat cards (collector)', () => {
  const seats = [
    { id: 'dev-build@d09-crew', rig: 'd09-crew' },
    { id: 'dev-qa@d09-crew', rig: 'd09-crew' },
    { id: 'plain', rig: null },
  ];
  const agentRefs = new Map([
    ['dev-build@d09-crew', `path:${AGENTS}/development/implementer`],
    // QA W3 LOW-3: a local: ref (starter, kernel) names its role the same way.
    ['dev-qa@d09-crew', 'local:../../../agents/development/qa/'],
  ]);
  const names = new Map([
    [
      'dev-build@d09-crew',
      ['appystack:appystack-conventions', 'openrig-core:development-team', 'recipe', 'canvas:x'],
    ],
  ]);

  it('role is the last folder of agent_ref; a plain tmux session gets nothing', () => {
    const out = withSeatCards(seats, { agentRefs, names, config: {} });
    expect(out.map((s) => s.agentRole)).toEqual(['implementer', 'qa', undefined]);
    expect(out.every((s) => !('keySkills' in s))).toBe(true);
  });

  it('key skills: only allowlisted names the seat really listed, in the allowlist order', () => {
    const out = withSeatCards(seats, {
      agentRefs,
      names,
      config: {
        'dev-build@d09-crew': {
          keySkills: [
            'recipe',
            'development-team',
            'not-loaded',
            'appystack:appystack-conventions',
          ],
        },
        // dev-qa has an allowlist but no listing yet: nothing said, the card keeps the count.
        'dev-qa@d09-crew': { keySkills: ['recipe'] },
      },
    });
    expect(out[0]!.keySkills).toEqual([
      'recipe',
      'openrig-core:development-team',
      'appystack:appystack-conventions',
    ]);
    expect('keySkills' in out[1]!).toBe(false);
  });

  it('a prefixed allowlist name must match exactly; at most five are kept', () => {
    expect(keySkillsOf(['other:recipe'], ['recipe', 'a:recipe'])).toEqual([]);
    expect(
      keySkillsOf(['a', 'b', 'c', 'd', 'e', 'f'], ['a', 'b', 'c', 'd', 'e', 'f'])
    ).toHaveLength(5);
  });

  it('a 6th skill or a bad entry on one seat costs only that seat, never the others (r1 W3 MEDIUM-1)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'appyrig-seatcfg-'));
    const file = join(dir, 'config.json');
    writeFileSync(
      file,
      JSON.stringify({
        machines: { m2: { ssh: 'u@100.1.2.3' } },
        seats: {
          'a@r': { keySkills: ['x'] },
          'b@r': { keySkills: ['1', '2', '3', '4', '5', '6'] },
          'c@r': { keySkills: 'not a list' },
        },
      })
    );
    const errors: string[] = [];
    const cfg = seatConfigReader({ APPYRIG_CONFIG: file }, (m) => errors.push(m))();
    expect(cfg['a@r']).toEqual({ keySkills: ['x'] });
    expect(cfg['b@r']!.keySkills).toHaveLength(6); // kept; the card keeps at most five
    expect(cfg['c@r']).toEqual({});
    expect(errors).toEqual([]);
    expect(keySkillsOf(cfg['b@r']!.keySkills!, ['1', '2', '3', '4', '5', '6'])).toHaveLength(5);
  });

  it('any agent_ref scheme gives a role (r1 W3 LOW-1)', () => {
    const out = withSeatCards([{ id: 't@r', rig: 'r' }], {
      agentRefs: new Map([['t@r', 'builtin:terminal']]),
      names: new Map(),
      config: {},
    });
    expect(out[0]!.agentRole).toBe('terminal');
  });

  it('reads the seats part of the config, again when the file changes, and survives a bad file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'appyrig-seatcfg-'));
    const file = join(dir, 'config.json');
    const errors: string[] = [];
    const read = seatConfigReader({ APPYRIG_CONFIG: file }, (m) => errors.push(m));
    expect(read()).toEqual({});
    writeFileSync(file, JSON.stringify({ seats: { 'a@r': { keySkills: ['x'] } } }));
    expect(read()).toEqual({ 'a@r': { keySkills: ['x'] } });
    writeFileSync(file, '{ not json');
    utimesSync(file, new Date(), new Date(Date.now() + 5_000));
    expect(read()).toEqual({});
    // Said once (a warning in the collector's log), not on every push.
    read();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/not a valid AppyRig config; key skills off/);
  });
});
