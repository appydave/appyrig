/**
 * v1.4 · S7-ui: a small Markdown reader for display only. It produces a tree of plain data that
 * React renders as elements, so file text can never become raw HTML (no dangerouslySetInnerHTML,
 * no script, no event attributes). Covers what rig notes use: headings, paragraphs, lists (nested),
 * tables, fenced code, blockquotes, rules, front matter, and inline code, bold, italic and links.
 * Links are kept only for http(s) and mailto; anything else (javascript:, data:, file paths) is shown as text.
 */

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'code'; text: string }
  | { t: 'strong'; children: Inline[] }
  | { t: 'em'; children: Inline[] }
  | { t: 'link'; href: string; children: Inline[] };

export interface ListItem {
  inline: Inline[];
  children: Block[];
}

export type Block =
  | { t: 'front'; text: string }
  | { t: 'heading'; level: number; inline: Inline[] }
  | { t: 'para'; inline: Inline[] }
  | { t: 'code'; lang: string; text: string }
  | { t: 'list'; ordered: boolean; items: ListItem[] }
  | { t: 'quote'; children: Block[] }
  | {
      t: 'table';
      head: Inline[][];
      align: ('left' | 'right' | 'center' | null)[];
      rows: Inline[][][];
    }
  | { t: 'hr' };

export const safeHref = (href: string): string | null => {
  const h = href.trim();

  return /^(https?:\/\/|mailto:)/i.test(h) ? h : null;
};

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) {
      out.push({ t: 'text', text });
    }

    text = '';
  };

  let i = 0;

  while (i < src.length) {
    const c = src[i]!;

    if (c === '\\' && i + 1 < src.length && /[\\`*_[\]()#|>-]/.test(src[i + 1]!)) {
      text += src[i + 1];
      i += 2;
      continue;
    }

    if (c === '`') {
      const end = src.indexOf('`', i + 1);

      if (end > i) {
        flush();
        out.push({ t: 'code', text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if ((c === '*' || c === '_') && src[i + 1] === c) {
      const end = src.indexOf(c + c, i + 2);

      if (end > i + 2) {
        flush();
        out.push({ t: 'strong', children: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    if (
      (c === '*' || c === '_') &&
      src[i + 1] !== ' ' &&
      (c === '*' || i === 0 || /\W/.test(src[i - 1]!))
    ) {
      const end = src.indexOf(c, i + 1);

      if (end > i + 1 && src[end - 1] !== ' ') {
        flush();
        out.push({ t: 'em', children: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }

    if (c === '[') {
      const m = /^\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/.exec(src.slice(i));

      if (m) {
        flush();

        const href = safeHref(m[2]!);
        const kids = parseInline(m[1]!);

        if (href) {
          out.push({ t: 'link', href, children: kids });
        } else {
          out.push(...kids, { t: 'text', text: m[2] ? ` (${m[2]})` : '' });
        }

        i += m[0].length;
        continue;
      }
    }

    text += c;
    i++;
  }

  flush();

  return out;
}

const FENCE = /^\s*(```+|~~~+)\s*([\w+-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

const cells = (line: string): string[] => {
  let s = line.trim();

  if (s.startsWith('|')) {
    s = s.slice(1);
  }

  if (s.endsWith('|') && !s.endsWith('\\|')) {
    s = s.slice(0, -1);
  }

  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
};

const startsBlock = (line: string, next: string | undefined): boolean =>
  FENCE.test(line) ||
  HEADING.test(line) ||
  HR.test(line) ||
  /^\s*>/.test(line) ||
  ITEM.test(line) ||
  (line.includes('|') && next !== undefined && TABLE_SEP.test(next) && next.includes('-'));

export function parseMarkdown(source: string): Block[] {
  let lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];

  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');

    if (end > 0) {
      blocks.push({ t: 'front', text: lines.slice(1, end).join('\n') });
      lines = lines.slice(end + 1);
    }
  }

  blocks.push(...parseBlocks(lines));

  return blocks;
}

/** One block read from `lines` at index `i`, and the index of the first line after it. */
interface Parsed {
  block: Block;
  next: number;
}

type BlockParser = (lines: string[], i: number) => Parsed | null;

/** The capture group of ITEM that holds the item's own text. */
const ITEM_TEXT_GROUP = 3;

const indentOf = (line: string): number => line.length - line.trimStart().length;

function parseFence(lines: string[], i: number): Parsed | null {
  const fence = FENCE.exec(lines[i]!);

  if (!fence) {
    return null;
  }

  const marker = fence[1]![0]!;
  const closing = new RegExp(`^\\s*${marker}{${fence[1]!.length},}\\s*$`);
  const body: string[] = [];
  let next = i + 1;

  while (next < lines.length && !closing.test(lines[next]!)) {
    body.push(lines[next++]!);
  }

  // the closing fence (or the end of the file) is skipped too
  return { block: { t: 'code', lang: fence[2] ?? '', text: body.join('\n') }, next: next + 1 };
}

function parseHeadingBlock(lines: string[], i: number): Parsed | null {
  const h = HEADING.exec(lines[i]!);

  return h
    ? { block: { t: 'heading', level: h[1]!.length, inline: parseInline(h[2]!) }, next: i + 1 }
    : null;
}

function parseRule(lines: string[], i: number): Parsed | null {
  return HR.test(lines[i]!) ? { block: { t: 'hr' }, next: i + 1 } : null;
}

function parseQuote(lines: string[], i: number): Parsed | null {
  const isQuoteLine = (l: string): boolean => /^\s*>/.test(l);

  if (!isQuoteLine(lines[i]!)) {
    return null;
  }

  const body: string[] = [];
  let next = i;

  while (next < lines.length && isQuoteLine(lines[next]!)) {
    body.push(lines[next++]!.replace(/^\s*> ?/, ''));
  }

  return { block: { t: 'quote', children: parseBlocks(body) }, next };
}

function alignOf(cell: string): 'left' | 'right' | 'center' | null {
  if (/^:-+:$/.test(cell)) {
    return 'center';
  }

  if (/-:$/.test(cell)) {
    return 'right';
  }

  return /^:-/.test(cell) ? 'left' : null;
}

function startsTable(lines: string[], i: number): boolean {
  const separator = lines[i + 1];

  return (
    lines[i]!.includes('|') &&
    separator !== undefined &&
    TABLE_SEP.test(separator) &&
    separator.includes('-')
  );
}

function parseTable(lines: string[], i: number): Parsed | null {
  if (!startsTable(lines, i)) {
    return null;
  }

  const head = cells(lines[i]!);
  const align = cells(lines[i + 1]!).map(alignOf);
  const rows: Inline[][][] = [];
  let next = i + 2;

  while (next < lines.length && lines[next]!.trim() !== '' && lines[next]!.includes('|')) {
    rows.push(cells(lines[next++]!).map(parseInline));
  }

  return { block: { t: 'table', head: head.map(parseInline), align, rows }, next };
}

/** A blank line ends a list item unless a line indented deeper than the item follows. */
function blankContinuesItem(lines: string[], i: number, baseIndent: number): boolean {
  const following = lines[i + 1];

  return following !== undefined && /^\s{2,}\S/.test(following) && indentOf(following) > baseIndent;
}

function endsItem(lines: string[], i: number, baseIndent: number): boolean {
  return lines[i]!.trim() === ''
    ? !blankContinuesItem(lines, i, baseIndent)
    : indentOf(lines[i]!) <= baseIndent;
}

/** A list item being read: its own text lines, and the lines of the blocks nested under it. */
interface ItemBody {
  text: string[];
  nested: string[];
}

/** Routes one line of a list item: its own text, or a nested block's (item lines and everything after one). */
function addItemLine(body: ItemBody, l: string, baseIndent: number): void {
  const { text, nested } = body;

  if (l.trim() === '') {
    nested.push(l);
  } else if (ITEM.test(l) || nested.length) {
    nested.push(l.slice(Math.min(indentOf(l), baseIndent + 2)));
  } else {
    text.push(l.trim());
  }
}

/** The list item starting at `start`, with the index of the first line after it. */
function readListItem(
  lines: string[],
  start: number,
  baseIndent: number
): { item: ListItem; next: number } {
  const body: ItemBody = { text: [ITEM.exec(lines[start]!)![ITEM_TEXT_GROUP]!], nested: [] };
  let i = start + 1;

  while (i < lines.length && !endsItem(lines, i, baseIndent)) {
    addItemLine(body, lines[i++]!, baseIndent);
  }

  const children = body.nested.length ? parseBlocks(body.nested) : [];

  return { item: { inline: parseInline(body.text.join(' ')), children }, next: i };
}

function isSiblingItem(m: RegExpExecArray | null, baseIndent: number, ordered: boolean): boolean {
  return m !== null && m[1]!.length === baseIndent && /\d/.test(m[2]!) === ordered;
}

function parseList(lines: string[], i: number): Parsed | null {
  const first = ITEM.exec(lines[i]!);

  if (!first) {
    return null;
  }

  const baseIndent = first[1]!.length;
  const ordered = /\d/.test(first[2]!);
  const items: ListItem[] = [];
  let next = i;
  let m: RegExpExecArray | null = first;

  while (isSiblingItem(m, baseIndent, ordered)) {
    const read = readListItem(lines, next, baseIndent);

    items.push(read.item);
    next = read.next;
    m = next < lines.length ? ITEM.exec(lines[next]!) : null;
  }

  return { block: { t: 'list', ordered, items }, next };
}

function parseParagraph(lines: string[], i: number): Parsed {
  const para: string[] = [];
  let next = i;

  while (
    next < lines.length &&
    lines[next]!.trim() !== '' &&
    (para.length === 0 || !startsBlock(lines[next]!, lines[next + 1]))
  ) {
    para.push(lines[next++]!.trim());
  }

  return { block: { t: 'para', inline: parseInline(para.join(' ')) }, next };
}

/** Tried in order; a line no parser claims is a paragraph. */
const BLOCK_PARSERS: BlockParser[] = [
  parseFence,
  parseHeadingBlock,
  parseRule,
  parseQuote,
  parseTable,
  parseList,
];

function parseBlockAt(lines: string[], i: number): Parsed {
  for (const parser of BLOCK_PARSERS) {
    const parsed = parser(lines, i);

    if (parsed) {
      return parsed;
    }
  }

  return parseParagraph(lines, i);
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    if (lines[i]!.trim() === '') {
      i++;
      continue;
    }

    const parsed = parseBlockAt(lines, i);

    blocks.push(parsed.block);
    i = parsed.next;
  }

  return blocks;
}
