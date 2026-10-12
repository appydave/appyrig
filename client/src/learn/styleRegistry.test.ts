import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STYLE_IGNORED, STYLE_REGISTRY, stylesFor } from './styleRegistry.js';

/**
 * C7: every style token the stylesheet uses must be named in the style registry (and so in the
 * legend), or listed in STYLE_IGNORED with a reason. Adding `.tile[data-pip=new]` to index.css
 * without registering it fails this test.
 */
export function styleTokens(css: string): string[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = new Set<string>();
  for (const m of clean.matchAll(/([^{}]+)\{/g)) {
    for (const sel of m[1]!.split(',')) {
      for (const comp of sel.trim().split(/[\s>+~]+/)) {
        const a = /^([a-z]*)((?:\.[\w-]+)*)((?:\[data-[\w-]+(?:=['"][^'"]*['"])?\])+)/.exec(comp);
        if (a) {
          tokens.add(`${a[2] || a[1] || '*'}${a[3]!.replace(/["']/g, '')}`);
          continue;
        }
        const c = /^((?:\.[\w-]+){2,})(?::|$)/.exec(comp);
        if (c) tokens.add(c[1]!);
      }
    }
  }
  return [...tokens].sort();
}

const CSS = readFileSync(resolve(__dirname, '../styles/index.css'), 'utf8');

describe('C7: the legend names every style on screen', () => {
  it('every style token in index.css is registered (or ignored with a reason)', () => {
    const named = new Set(STYLE_REGISTRY.flatMap((e) => e.tokens));
    const unnamed = styleTokens(CSS).filter((t) => !named.has(t) && !(t in STYLE_IGNORED));
    expect(unnamed, `register these in learn/styleRegistry.ts: ${unnamed.join(', ')}`).toEqual([]);
  });

  it('a new unregistered style fails (the check is live)', () => {
    const named = new Set(STYLE_REGISTRY.flatMap((e) => e.tokens));
    const added = styleTokens(`${CSS}\n.tile[data-pip='invented'] { color: hotpink; }`);
    expect(added.filter((t) => !named.has(t) && !(t in STYLE_IGNORED))).toEqual([
      '.tile[data-pip=invented]',
    ]);
  });

  it('no registered token is stale: each still exists in the stylesheet', () => {
    const inCss = new Set(styleTokens(CSS));
    const stale = STYLE_REGISTRY.flatMap((e) => e.tokens).filter((t) => !inCss.has(t));
    expect(stale, `remove or fix: ${stale.join(', ')}`).toEqual([]);
    const staleIgnored = Object.keys(STYLE_IGNORED).filter((t) => !inCss.has(t));
    expect(staleIgnored).toEqual([]);
  });

  it('every entry has plain words, and every screen with styles shows them', () => {
    for (const e of STYLE_REGISTRY) {
      expect(e.look.length, e.id).toBeGreaterThan(5);
      expect(e.means.length, e.id).toBeGreaterThan(10);
      expect(e.screens.length, e.id).toBeGreaterThan(0);
    }
    for (const s of ['wall', 'map', 'flow', 'machines', 'accounts', 'schema', 'learn'] as const)
      expect(stylesFor(s).length, s).toBeGreaterThan(0);
  });

  it("answers David's question: green, orange (amber), grey, dotted and dashed are all named", () => {
    const words = STYLE_REGISTRY.map((e) => e.look.toLowerCase()).join(' ');
    for (const w of ['green', 'amber', 'orange', 'grey', 'dotted', 'dashed'])
      expect(words).toContain(w);
  });
});
