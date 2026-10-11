/**
 * v1.4 · S7-ui: a small YAML reader for display only (it never loads or runs anything). Each line
 * becomes coloured tokens, and lines that open a nested block can be folded. It knows enough YAML
 * for rig specs: comments, keys, list dashes, quoted strings, numbers, booleans, null, anchors, and
 * block scalars (`summary: >`), whose lines are shown as plain text rather than mis-read as keys.
 */

export type YamlTokenKind =
  | 'indent'
  | 'dash'
  | 'key'
  | 'colon'
  | 'string'
  | 'number'
  | 'bool'
  | 'null'
  | 'comment'
  | 'anchor'
  | 'indicator'
  | 'block'
  | 'text';

export interface YamlToken {
  kind: YamlTokenKind;
  text: string;
}

export interface YamlLine {
  /** 1-based line number. */
  n: number;
  indent: number;
  tokens: YamlToken[];
  /** Last line (1-based) of the block this line opens, when it can be folded. */
  foldTo: number | null;
}

const KEY = /^((?:"[^"]*"|'[^']*'|[^\s#:'"-][^#:]*?|-[^\s#:][^#:]*?))(\s*):(?=\s|$)/;
const BLOCK_START = /^[|>][+-]?\d*\s*(#.*)?$/;

function valueTokens(rest: string): YamlToken[] {
  const out: YamlToken[] = [];
  let s = rest;
  const lead = /^\s+/.exec(s);
  if (lead) {
    out.push({ kind: 'indent', text: lead[0] });
    s = s.slice(lead[0].length);
  }
  if (!s) return out;
  // trailing comment (` #…` outside quotes, kept simple: only when the value is not quoted)
  let comment = '';
  if (!/^["']/.test(s)) {
    const c = /\s#.*$/.exec(s);
    if (c) {
      comment = c[0];
      s = s.slice(0, s.length - comment.length);
    }
  }
  if (BLOCK_START.test(s.trim())) out.push({ kind: 'indicator', text: s });
  else if (/^"(?:[^"\\]|\\.)*"\s*$|^'(?:[^']|'')*'\s*$/.test(s))
    out.push({ kind: 'string', text: s });
  else if (/^[&*][\w-]+/.test(s)) out.push({ kind: 'anchor', text: s });
  else if (/^-?\d+(\.\d+)?\s*$/.test(s)) out.push({ kind: 'number', text: s });
  else if (/^(true|false|yes|no|on|off)\s*$/i.test(s)) out.push({ kind: 'bool', text: s });
  else if (/^(null|~)\s*$/i.test(s)) out.push({ kind: 'null', text: s });
  else out.push({ kind: 'text', text: s });
  if (comment) out.push({ kind: 'comment', text: comment });
  return out;
}

export function tokenizeYaml(source: string): YamlLine[] {
  const raw = source.replace(/\r\n?/g, '\n').split('\n');
  if (raw.length > 1 && raw[raw.length - 1] === '') raw.pop();
  const lines: YamlLine[] = [];
  /** While > -1: inside a block scalar opened at this indent; lines indented deeper are plain text. */
  let blockIndent = -1;
  raw.forEach((line, i) => {
    const indent = line.length - line.trimStart().length;
    const tokens: YamlToken[] = [];
    const blank = line.trim() === '';
    if (blockIndent >= 0 && (blank || indent > blockIndent)) {
      if (indent) tokens.push({ kind: 'indent', text: line.slice(0, indent) });
      if (!blank) tokens.push({ kind: 'block', text: line.slice(indent) });
      lines.push({ n: i + 1, indent, tokens, foldTo: null });
      return;
    }
    blockIndent = -1;
    if (blank) {
      lines.push({ n: i + 1, indent: 0, tokens, foldTo: null });
      return;
    }
    let rest = line.slice(indent);
    if (indent) tokens.push({ kind: 'indent', text: line.slice(0, indent) });
    if (rest.startsWith('#')) {
      tokens.push({ kind: 'comment', text: rest });
      lines.push({ n: i + 1, indent, tokens, foldTo: null });
      return;
    }
    // list dashes, possibly stacked ("- - a") and followed by a key ("- id: x")
    for (let d = /^-(\s+|$)/.exec(rest); d; d = /^-(\s+|$)/.exec(rest)) {
      tokens.push({ kind: 'dash', text: '-' });
      if (d[1]) tokens.push({ kind: 'indent', text: d[1] });
      rest = rest.slice(d[0].length);
    }
    const k = KEY.exec(rest);
    if (k) {
      tokens.push(
        { kind: 'key', text: k[1]! },
        { kind: 'indent', text: k[2]! },
        { kind: 'colon', text: ':' }
      );
      const value = rest.slice(k[0].length);
      const vt = valueTokens(value);
      tokens.push(...vt);
      if (vt.some((t) => t.kind === 'indicator')) blockIndent = indent;
      lines.push({ n: i + 1, indent, tokens, foldTo: null });
      return;
    }
    tokens.push(...valueTokens(rest));
    lines.push({ n: i + 1, indent, tokens, foldTo: null });
  });

  // Folds: a line opens a block when the next non-blank line is indented deeper. The block runs
  // until a non-blank line at the same or shallower indent. Block-scalar bodies fold with their key.
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.tokens.length === 0 || l.tokens.every((t) => t.kind === 'comment')) continue;
    let j = i + 1;
    while (j < lines.length && lines[j]!.tokens.length === 0) j++;
    if (j >= lines.length || lines[j]!.indent <= l.indent) continue;
    let end = j;
    for (let m = j; m < lines.length; m++) {
      const mm = lines[m]!;
      if (mm.tokens.length === 0) continue;
      if (mm.indent <= l.indent) break;
      end = m;
    }
    l.foldTo = lines[end]!.n;
  }
  return lines;
}
