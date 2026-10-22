import { describe, expect, it } from 'vitest';
import { gb, value } from '@client/lib/readings.js';

const MB = 1024 ** 2;
const GB = 1024 ** 3;

describe('gb', () => {
  it('says megabytes below one gigabyte', () => {
    expect(gb(812 * MB)).toBe('812 MB');
  });

  it('says gigabytes with one decimal, dropping a trailing .0', () => {
    expect(gb(7.44 * GB)).toBe('7.4 GB');
    expect(gb(8 * GB)).toBe('8 GB');
  });

  it('drops the decimal from 100 GB up', () => {
    expect(gb(99.9 * GB)).toBe('99.9 GB');
    expect(gb(128.4 * GB)).toBe('128 GB');
  });
});

describe('value', () => {
  it('returns the value with no reason when the reading was taken', () => {
    expect(value({ status: 'ok', value: 7 })).toEqual({ v: 7, why: null });
  });

  it('returns null and keeps the reason when it was not', () => {
    expect(value({ status: 'unavailable', reason: 'no sensor' })).toEqual({
      v: null,
      why: 'no sensor',
    });
  });
});
