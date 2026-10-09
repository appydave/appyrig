import { describe, it, expect } from 'vitest';
import { cn } from './utils.js';

describe('cn', () => {
  it('merges class strings', () => {
    expect(cn('px-4', 'py-2')).toBe('px-4 py-2');
  });

  it('resolves Tailwind conflicts — later class wins', () => {
    expect(cn('bg-red-500', 'bg-blue-500')).toBe('bg-blue-500');
  });

  it('handles conditional classes — falsy values are skipped', () => {
    const condition = false;
    expect(cn('base', condition && 'skip', 'keep')).toBe('base keep');
  });

  it('handles undefined gracefully', () => {
    expect(cn('a', undefined, 'b')).toBe('a b');
  });

  it('handles null gracefully', () => {
    expect(cn('a', null, 'b')).toBe('a b');
  });

  it('returns empty string when given no arguments', () => {
    expect(cn()).toBe('');
  });

  it('handles multiple Tailwind conflicts — last occurrence wins', () => {
    expect(cn('p-2', 'p-4', 'p-8')).toBe('p-8');
  });
});
