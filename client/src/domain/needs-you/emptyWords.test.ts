import { describe, expect, it } from 'vitest';
import { emptyWords } from './emptyWords.js';

/** AFTER audit: "Nothing is waiting" must never cover a machine that was never read. */
const read = { uncollected: null, machineCount: 2, asleep: [], gatesUnread: false };

describe('what Needs You says with an empty list', () => {
  it('says nothing is waiting only when everything was read', () => {
    expect(emptyWords(read)).toBe('Nothing is waiting on David.');
  });

  it('names an asleep machine instead of saying nothing is waiting', () => {
    const words = emptyWords({ ...read, asleep: ['M4'] });

    expect(words).not.toContain('Nothing is waiting');
    expect(words).toContain('M4 is asleep');
    expect(words).toContain('not the same as nothing waiting');
  });

  it('says so when no machine reports, and when gates went unread', () => {
    expect(emptyWords({ ...read, machineCount: 0 })).toContain('No machine is reporting');
    expect(emptyWords({ ...read, gatesUnread: true })).toContain('not every rig could be read');
  });
});
