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
    if (text) out.push({ t: 'text', text });
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
        if (href) out.push({ t: 'link', href, children: kids });
        else out.push(...kids, { t: 'text', text: m[2] ? ` (${m[2]})` : '' });
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
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
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

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1]![0]!;
      const body: string[] = [];
      i++;
      while (
        i < lines.length &&
        !new RegExp(`^\\s*${marker}{${fence[1]!.length},}\\s*$`).test(lines[i]!)
      )
        body.push(lines[i++]!);
      i++; // the closing fence (or the end of the file)
      blocks.push({ t: 'code', lang: fence[2] ?? '', text: body.join('\n') });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      blocks.push({ t: 'heading', level: h[1]!.length, inline: parseInline(h[2]!) });
      i++;
      continue;
    }
    if (HR.test(line)) {
      blocks.push({ t: 'hr' });
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!))
        body.push(lines[i++]!.replace(/^\s*> ?/, ''));
      blocks.push({ t: 'quote', children: parseBlocks(body) });
      continue;
    }
    if (
      line.includes('|') &&
      lines[i + 1] !== undefined &&
      TABLE_SEP.test(lines[i + 1]!) &&
      lines[i + 1]!.includes('-')
    ) {
      const head = cells(line);
      const align = cells(lines[i + 1]!).map((c) =>
        /^:-+:$/.test(c)
          ? ('center' as const)
          : /-:$/.test(c)
            ? ('right' as const)
            : /^:-/.test(c)
              ? ('left' as const)
              : null
      );
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i]!.trim() !== '' && lines[i]!.includes('|')) {
        rows.push(cells(lines[i++]!).map(parseInline));
      }
      blocks.push({ t: 'table', head: head.map(parseInline), align, rows });
      continue;
    }
    const item = ITEM.exec(line);
    if (item) {
      const baseIndent = item[1]!.length;
      const ordered = /\d/.test(item[2]!);
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = ITEM.exec(lines[i]!);
        if (
          !m ||
          m[1]!.length < baseIndent ||
          (m[1]!.length === baseIndent && /\d/.test(m[2]!) !== ordered)
        )
          break;
        if (m[1]!.length > baseIndent) break;
        const text = [m[3]!];
        const nested: string[] = [];
        i++;
        while (i < lines.length) {
          const l = lines[i]!;
          if (l.trim() === '') {
            // a blank line ends the item unless an indented line follows
            if (
              i + 1 < lines.length &&
              /^\s{2,}\S/.test(lines[i + 1]!) &&
              lines[i + 1]!.length - lines[i + 1]!.trimStart().length > baseIndent
            ) {
              nested.push(l);
              i++;
              continue;
            }
            break;
          }
          const indent = l.length - l.trimStart().length;
          if (indent <= baseIndent) break;
          if (ITEM.test(l) || nested.length) nested.push(l.slice(Math.min(indent, baseIndent + 2)));
          else text.push(l.trim());
          i++;
        }
        items.push({
          inline: parseInline(text.join(' ')),
          children: nested.length ? parseBlocks(nested) : [],
        });
      }
      blocks.push({ t: 'list', ordered, items });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      (para.length === 0 || !startsBlock(lines[i]!, lines[i + 1]))
    ) {
      para.push(lines[i++]!.trim());
    }
    blocks.push({ t: 'para', inline: parseInline(para.join(' ')) });
  }
  return blocks;
}
