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
  const agentDirs = new Map([
    ['dev-build@d09-crew', `${AGENTS}/development/implementer`],
    ['dev-qa@d09-crew', `${AGENTS}/development/qa/`],
  ]);
  const names = new Map([
    [
      'dev-build@d09-crew',
      ['appystack:appystack-conventions', 'openrig-core:development-team', 'recipe', 'canvas:x'],
    ],
  ]);

  it('role is the last folder of agent_ref; a plain tmux session gets nothing', () => {
    const out = withSeatCards(seats, { agentDirs, names, config: {} });
    expect(out.map((s) => s.agentRole)).toEqual(['implementer', 'qa', undefined]);
    expect(out.every((s) => !('keySkills' in s))).toBe(true);
  });

  it('key skills: only allowlisted names the seat really listed, in the allowlist order', () => {
    const out = withSeatCards(seats, {
      agentDirs,
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

  it('reads the seats part of the config, again when the file changes, and survives a bad file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'appyrig-seatcfg-'));
    const file = join(dir, 'config.json');
    const read = seatConfigReader({ APPYRIG_CONFIG: file });
    expect(read()).toEqual({});
    writeFileSync(file, JSON.stringify({ seats: { 'a@r': { keySkills: ['x'] } } }));
    expect(read()).toEqual({ 'a@r': { keySkills: ['x'] } });
    writeFileSync(file, '{ not json');
    utimesSync(file, new Date(), new Date(Date.now() + 5_000));
    expect(read()).toEqual({});
  });
});
