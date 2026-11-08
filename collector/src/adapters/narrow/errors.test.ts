import { describe, expect, it } from 'vitest';
import { causeOf, errnoCode, errorMessage } from './errors.js';

const withCode = (code: unknown) => Object.assign(new Error('boom'), { code });

describe('errorMessage', () => {
  it.each([
    ['an Error', new Error('boom'), 'boom'],
    ['an Error with a code', withCode('ENOENT'), 'boom'],
    ['a thrown string', 'plain words', 'plain words'],
    ['a thrown null', null, 'null'],
    ['a thrown undefined', undefined, 'undefined'],
    ['an object with a message', { message: 'not an Error' }, '[object Object]'],
  ])('says %s in words', (_name, caught, expected) => {
    expect(errorMessage(caught)).toBe(expected);
  });
});

describe('errnoCode', () => {
  it.each([
    ['an Error with a string code', withCode('ECONNREFUSED'), 'ECONNREFUSED'],
    ['an object with a string code', { code: 'ENOENT' }, 'ENOENT'],
    ['an Error without a code', new Error('boom'), undefined],
    ['an Error with a numeric code', withCode(1), undefined],
    ['a thrown string', 'ENOENT', undefined],
    ['a thrown null', null, undefined],
  ])('reads %s', (_name, caught, expected) => {
    expect(errnoCode(caught)).toBe(expected);
  });
});

describe('causeOf', () => {
  it('returns the cause of an Error, and nothing for anything else', () => {
    const cause = withCode('ECONNREFUSED');

    expect(causeOf(new Error('fetch failed', { cause }))).toBe(cause);
    expect(causeOf(new Error('no cause'))).toBeUndefined();
    expect(causeOf({ cause })).toBeUndefined();
    expect(causeOf('fetch failed')).toBeUndefined();
  });
});
