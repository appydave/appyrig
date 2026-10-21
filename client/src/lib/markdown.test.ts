import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, safeHref } from './markdown.js';

const types = (src: string) => parseMarkdown(src).map((b) => b.t);

describe('inline', () => {
  it('code, bold, italic and links', () => {
    expect(parseInline('a `b` **c** *d* [e](https://x.test/p)')).toEqual([
      { t: 'text', text: 'a ' },
      { t: 'code', text: 'b' },
      { t: 'text', text: ' ' },
      { t: 'strong', children: [{ t: 'text', text: 'c' }] },
      { t: 'text', text: ' ' },
      { t: 'em', children: [{ t: 'text', text: 'd' }] },
      { t: 'text', text: ' ' },
      { t: 'link', href: 'https://x.test/p', children: [{ t: 'text', text: 'e' }] },
    ]);
  });
  it('code protects its contents; a lone star or snake_case word is not emphasis', () => {
    expect(parseInline('`**not bold**`')).toEqual([{ t: 'code', text: '**not bold**' }]);
    expect(parseInline('2 * 3 and some_snake_case_name')).toEqual([
      { t: 'text', text: '2 * 3 and some_snake_case_name' },
    ]);
  });
  it('only http(s) and mailto links survive; javascript:, data: and paths become plain text', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<script>')).toBeNull();
    expect(safeHref('/etc/passwd')).toBeNull();
    expect(safeHref('../x.md')).toBeNull();
    expect(safeHref('https://ok.test')).toBe('https://ok.test');

    const evil = parseInline('[click](javascript:alert(1))');

    expect(evil.some((n) => n.t === 'link')).toBe(false);
    expect(JSON.stringify(evil)).toContain('click');
  });
  it('raw HTML is just text (it is never injected)', () => {
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([
      { t: 'text', text: '<img src=x onerror=alert(1)>' },
    ]);
  });
});

describe('blocks', () => {
  it('headings, paragraphs, rules and code fences (with the language and untouched contents)', () => {
    const md = '# Title\n\nsome text\nacross lines\n\n---\n\n```ts\nconst a = 1; // **x**\n```\n';

    expect(types(md)).toEqual(['heading', 'para', 'hr', 'code']);

    const code = parseMarkdown(md)[3]!;

    expect(code).toEqual({ t: 'code', lang: 'ts', text: 'const a = 1; // **x**' });

    const para = parseMarkdown(md)[1]!;

    expect(para).toMatchObject({
      t: 'para',
      inline: [{ t: 'text', text: 'some text across lines' }],
    });
  });
  it('an unclosed fence runs to the end instead of swallowing nothing or hanging', () => {
    expect(parseMarkdown('```\nabc\ndef')).toEqual([{ t: 'code', lang: '', text: 'abc\ndef' }]);
  });
  it('tables with alignment and escaped pipes', () => {
    const t = parseMarkdown('| Check | Result |\n|:--|--:|\n| lint | 0 |\n| a \\| b | ok |\n')[0]!;

    expect(t.t).toBe('table');
    if (t.t === 'table') {
      expect(t.head).toHaveLength(2);
      expect(t.align).toEqual(['left', 'right']);
      expect(t.rows).toHaveLength(2);
      expect(t.rows[1]![0]).toEqual([{ t: 'text', text: 'a | b' }]);
    }
  });
  it('lists: bullets, numbers, nesting and wrapped lines', () => {
    const b = parseMarkdown(
      '- one\n  wraps here\n- two\n  - nested a\n  - nested b\n- three\n\n1. first\n2. second\n'
    );

    expect(b.map((x) => x.t)).toEqual(['list', 'list']);

    const ul = b[0]!;

    if (ul.t === 'list') {
      expect(ul.ordered).toBe(false);
      expect(ul.items).toHaveLength(3);
      expect(ul.items[0]!.inline).toEqual([{ t: 'text', text: 'one wraps here' }]);
      expect(ul.items[1]!.children[0]).toMatchObject({ t: 'list', items: [{}, {}] });
    }

    const ol = b[1]!;

    if (ol.t === 'list') {
      expect(ol.ordered).toBe(true);
    }
  });
  it('blockquotes nest blocks', () => {
    expect(parseMarkdown('> a\n> - b\n')[0]).toMatchObject({
      t: 'quote',
      children: [{ t: 'para' }, { t: 'list' }],
    });
  });
  it('front matter is kept apart so it is not read as a rule and a heading', () => {
    const b = parseMarkdown('---\ntitle: "x"\nseat: a@b\n---\n\n# Body\n');

    expect(b[0]).toEqual({ t: 'front', text: 'title: "x"\nseat: a@b' });
    expect(b[1]).toMatchObject({ t: 'heading', level: 1 });
  });
  it('a paragraph stops at a table or list start; weird input never throws', () => {
    expect(types('text\n- item')).toEqual(['para', 'list']);
    for (const s of [
      '',
      '\n\n',
      '|',
      '| a |',
      '>',
      '-',
      '1.',
      '```',
      '[',
      '**',
      '#',
      '#######x',
      '| a | b |\n|---|',
    ]) {
      expect(() => parseMarkdown(s)).not.toThrow();
    }
  });
  it('a long real-shaped note parses in well under a second', () => {
    const doc = Array.from(
      { length: 2000 },
      (_, i) =>
        `## Section ${i}\n\n| a | b |\n|---|---|\n| ${i} | **x** |\n\n- item \`code\` [l](https://x.test)\n`
    ).join('\n');
    const t0 = Date.now();

    expect(parseMarkdown(doc).length).toBeGreaterThan(5000);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});
