import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STYLE_IGNORED, STYLE_REGISTRY, stylesFor } from './styleRegistry.js';

/**
 * C7: every style token the stylesheet uses must be named in the style registry (and so in the
 * legend), or listed in STYLE_IGNORED with a reason. A token is the subject of a selector:
 * - any compound with a `[data-…]` or `[aria-…]` attribute, quoted or not: `.tile[data-pip=new]`;
 * - any compound of two or more classes: `.flow-edge.rework`;
 * - a single class, when its rule draws a status signal: a dashed or dotted line, a status
 *   colour (working, blocked, idle, stopped, asleep, error, arrive) or a literal colour, set on
 *   color, background, border, outline, fill, stroke or text-decoration.
 * Hover and focus states are skipped (focus rings and hover tints are not marks with a meaning).
 */
const NAMED_COLOUR =
  'red|orange|green|yellow|blue|purple|pink|hotpink|lime|gold|crimson|tomato|teal|navy|maroon|olive|magenta|cyan|violet|brown|coral|salmon';
const SIGNAL = new RegExp(
  '(?:^|[;{\\s])(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-(?:color|style))?|outline(?:-(?:color|style))?|fill|stroke|text-decoration(?:-style)?)\\s*:[^;]*' +
    `(?:dashed|dotted|#[0-9a-f]{3,8}\\b|rgba?\\(|hsla?\\(|var\\(--ar-(?:working|blocked|idle|stopped|asleep|error|arrive)|\\b(?:${NAMED_COLOUR})\\b)`,
  'i'
);
const ATTR =
  /^([a-z]*)((?:\.[\w-]+)*)((?:\[(?:data|aria)-[\w-]+(?:=(?:'[^']*'|"[^"]*"|[\w-]+))?\])+)/;

export function styleTokens(css: string): string[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = new Set<string>();
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/^\s*@/.test(m[1]!)) continue;
    const signal = SIGNAL.test(m[2]!);
    for (const sel of m[1]!.split(',')) {
      const comps = sel.trim().split(/\s*[\s>+~]\s*/);
      comps.forEach((comp, i) => {
        if (/:(hover|focus|focus-visible|focus-within|active)\b/.test(comp)) return;
        const a = ATTR.exec(comp);
        if (a) return void tokens.add(`${a[2] || a[1] || '*'}${a[3]!.replace(/["']/g, '')}`);
        const c = /^((?:\.[\w-]+){2,})(?::|$)/.exec(comp);
        if (c) return void tokens.add(c[1]!);
        const one = /^(\.[\w-]+)(?::|$)/.exec(comp);
        if (one && signal && i === comps.length - 1) tokens.add(one[1]!);
      });
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

  // QA's probes on C7 (B, C and E passed silently before the fix); each must now fail alone.
  it.each([
    [".tile[data-pip='zzz'] { color: red }", '.tile[data-pip=zzz]'],
    ['.tile[data-pip=zzz2] { color: red }', '.tile[data-pip=zzz2]'],
    ['.qa-new-flag { color: red; border: 1px dotted red }', '.qa-new-flag'],
    ['.tile.qa-hot { color: orange }', '.tile.qa-hot'],
    [".rig-chip[aria-current='true'] { outline: 2px dashed red }", '.rig-chip[aria-current=true]'],
    ['.qa-x { background: var(--ar-blocked-bg) }', '.qa-x'],
  ])('a new unregistered style fails: %s', (rule, token) => {
    const named = new Set(STYLE_REGISTRY.flatMap((e) => e.tokens));
    const added = styleTokens(`${CSS}\n${rule}`);
    expect(added.filter((t) => !named.has(t) && !(t in STYLE_IGNORED))).toEqual([token]);
  });

  it('plain chrome and focus rings are not tokens', () => {
    expect(
      styleTokens('.qa-plain { color: var(--ar-ink); border: 1px solid var(--ar-line) }')
    ).toEqual([]);
    expect(styleTokens('.qa-f:focus-visible { outline: 2px dashed red }')).toEqual([]);
  });

  it("the Map's pod is solid: dashed there means only 'left open'", () => {
    const pod = /\.pod\s*\{([^}]*)\}/.exec(CSS)![1]!;
    expect(pod).not.toMatch(/dashed|dotted/);
    expect(STYLE_REGISTRY.find((e) => e.id === 'pod')!.look).toMatch(/SOLID/);
  });

  it('no registered token is stale: each still exists in the stylesheet', () => {
    // a token is live if the tokenizer sees it, or (a plain registered class such as .pod, drawn
    // solid on purpose) it is still the subject of a rule
    const plain = CSS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/["']/g, '');
    const inCss = new Set(styleTokens(CSS));
    const used = (t: string) =>
      inCss.has(t) || new RegExp(`${t.replace(/[.*[\]=]/g, '\\$&')}\\s*[{,]`).test(plain);
    const stale = STYLE_REGISTRY.flatMap((e) => e.tokens).filter((t) => !used(t));
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
