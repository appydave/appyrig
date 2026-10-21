import { describe, expect, it } from 'vitest';
import { tokenizeYaml } from './yamlLines.js';

const kinds = (src: string, line = 0) => {
  const l = tokenizeYaml(src)[line]!;

  return l.tokens.filter((t) => t.kind !== 'indent').map((t) => `${t.kind}:${t.text.trim()}`);
};

describe('tokenizeYaml', () => {
  it('colours keys, strings, numbers, booleans, null, anchors and comments', () => {
    expect(kinds('name: flicut-ab')).toEqual(['key:name', 'colon::', 'text:flicut-ab']);
    expect(kinds('version: "0.2"')).toEqual(['key:version', 'colon::', 'string:"0.2"']);
    expect(kinds("model: 'opus'")).toEqual(['key:model', 'colon::', "string:'opus'"]);
    expect(kinds('retries: 3')).toEqual(['key:retries', 'colon::', 'number:3']);
    expect(kinds('on: true')).toEqual(['key:on', 'colon::', 'bool:true']);
    expect(kinds('x: null')).toEqual(['key:x', 'colon::', 'null:null']);
    expect(kinds('base: &b')).toEqual(['key:base', 'colon::', 'anchor:&b']);
    expect(kinds('# a whole-line comment')).toEqual(['comment:# a whole-line comment']);
    expect(kinds('cwd: /Users/x # where it runs')).toEqual([
      'key:cwd',
      'colon::',
      'text:/Users/x',
      'comment:# where it runs',
    ]);
  });

  it('list dashes, with or without a key after them', () => {
    expect(kinds('  - id: lead')).toEqual(['dash:-', 'key:id', 'colon::', 'text:lead']);
    expect(kinds('  - plain item')).toEqual(['dash:-', 'text:plain item']);
    expect(kinds('- - nested')).toEqual(['dash:-', 'dash:-', 'text:nested']);
  });

  it('a block scalar body is plain text, not mistaken for keys or comments', () => {
    const src = 'summary: >\n  Launch with: no --cwd.\n  # not a comment here\n\nnext: 1';
    const lines = tokenizeYaml(src);
    expect(lines[0]!.tokens.some((t) => t.kind === 'indicator')).toBe(true);
    expect(lines[1]!.tokens.map((t) => t.kind)).toEqual(['indent', 'block']);
    expect(lines[2]!.tokens.map((t) => t.kind)).toEqual(['indent', 'block']);
    expect(lines[4]!.tokens.map((t) => t.kind)).toContain('key'); // back to normal after the body
  });

  it('keys with spaces, quotes and colons inside values', () => {
    expect(kinds('"a key": 1')).toEqual(['key:"a key"', 'colon::', 'number:1']);
    expect(kinds('url: http://x.test:80/p')).toEqual([
      'key:url',
      'colon::',
      'text:http://x.test:80/p',
    ]);
  });

  it('folds: a key with deeper lines under it folds to its last line, including a block scalar', () => {
    const src = [
      'pods:',
      '  - id: orch',
      '    members:',
      '      - id: lead',
      '  - id: dev',
      'summary: >',
      '  one',
      '  two',
      'end: 1',
    ].join('\n');
    const l = tokenizeYaml(src);
    expect(l[0]!.foldTo).toBe(5); // pods: … through "- id: dev"
    expect(l[1]!.foldTo).toBe(4); // - id: orch … through the member
    expect(l[2]!.foldTo).toBe(4);
    expect(l[3]!.foldTo).toBeNull();
    expect(l[5]!.foldTo).toBe(8); // summary: > … its two lines (lines 6..8)
    expect(l[8]!.foldTo).toBeNull();
    expect(l[7]!.foldTo).toBeNull();
  });

  it('never throws on odd input and keeps one entry per line', () => {
    for (const s of [
      '',
      '\n',
      ':::',
      '- ',
      '\t\tx',
      'a: [1, 2',
      '"unterminated',
      '---',
      '...',
      'key:',
    ]) {
      expect(() => tokenizeYaml(s)).not.toThrow();
    }
    expect(tokenizeYaml('a: 1\nb: 2\n')).toHaveLength(2);
    expect(tokenizeYaml('a: 1\r\nb: 2\r\n')).toHaveLength(2);
  });
});
