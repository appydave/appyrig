// OSC sequences whole (ESC ] … BEL or ESC \\): hyperlinks and the like. The link text between stays.
// eslint-disable-next-line no-control-regex
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
// What is left of an OSC 8 hyperlink that lost its ESC byte on the way (`]8;id=abc;https://…\` and
// `]8;;\`), or was cut short: params and URL hold no whitespace, so the link text after them stays.
// eslint-disable-next-line no-control-regex
const LINK_REMAINS = /\u001b?\]8;[^;\s\u0007\u001b\\]*;[^\s\u0007\u001b\\]*(?:\u0007|\u001b?\\)?/g;
// Colour and cursor codes, with or without their ESC byte.
// eslint-disable-next-line no-control-regex
const CSI = /\u001b?\[[0-9;?]*[ -/]*[@-~]/g;

/** One terminal line as plain text: hyperlink sequences and their remains, then colour codes (with or without their ESC byte). */
export const plainLine = (l: string): string =>
  l.replace(OSC, '').replace(LINK_REMAINS, '').replace(CSI, '');

// Claude Code's suggested reply: after the prompt glyph (and any colour codes or spaces), the text
// starts in dim (SGR 2, "ESC [ 2 m", alone or first in the code list). Typed input is not dim.
const DIM_SUGGESTION =
  // eslint-disable-next-line no-control-regex
  /^(?:\u001b?\[[0-9;]*m|[\s\u00a0])*[\u276f\u203a>](?:\u001b?\[[0-9;]*m|[\s\u00a0])*\u001b?\[(?:0;)?2(?:;[0-9;]*)?m[\s\u00a0]*[^\s\u00a0\u001b]/;

/**
 * Claude Code shows a suggested reply in its input box in dim text after the prompt glyph:
 * "\u276f\u00a0<dim>go on</dim>". It was never typed or sent. True when a line is a prompt whose text
 * starts dim. Typed input (normal weight) and normal output never match.
 */
export function isDimSuggestion(raw: string): boolean {
  return DIM_SUGGESTION.test(raw.replace(OSC, ''));
}

/**
 * The last readable line of a terminal's text, colour codes removed (with or without the ESC byte).
 * Claude Code's dim suggested reply is skipped: it was never sent.
 */
export function tailLine(lines: readonly string[] | null | undefined): string | null {
  return (
    lines
      ?.filter((l) => !isDimSuggestion(l))
      .map((l) => plainLine(l).trim())
      .filter(Boolean)
      .at(-1) ?? null
  );
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

/**
 * Every OSC sequence: ESC ] … (BEL | ESC \\). That covers OSC 8 hyperlinks (r1 L1: the link text
 * stays, the link goes) and OSC 52 clipboard writes (qa-backend: a pane must never reach the
 * viewer's clipboard), plus titles and the rest. Applied before ANSI → HTML on tiles and before
 * writing to the Focus terminal, so neither renderer ever sees one.
 */
export function stripOsc(text: string): string {
  return text.replace(OSC, '');
}

export function stripAnsi(line: string): string {
  return line.replace(ANSI, '');
}

/**
 * Claude Code's input box and footer, which sit under every turn: rules, the empty prompt, the mode
 * line ("auto mode on (shift+tab to cycle)"), "? for shortcuts" and tips. None of it says what the
 * seat is doing.
 */
const CHROME = [
  /^[\s─━—-]{8,}[\w@.-]*[\s─━—-]*$/, // a rule, maybe with the session name in it
  /^\s*[❯›>]\s*$/, // the empty prompt
  /shift\+tab to cycle|\? for shortcuts|esc to interrupt|ctrl\+[a-z] to /i,
  /^\s*[⏵▶►⏸]{1,2}\s/,
  /^\s*[└⎿│|]?\s*Tip: /,
  /Update installed|Restart to update|new task\? \/clear/,
  /paste again to expand|Press up to edit queued messages|queued messages?$/i,
  // A draft typed into the input box, or Claude Code's dimmed suggestion (ghost text) there: the
  // viewer's text or a guess, never the seat's work. D09 W3: Claude Code puts a NO-BREAK SPACE after
  // the ❯, which a plain " " never matched, so "❯ rig capture …" was shown as the seat's activity.
  /^\s*[❯›>]\s/,
];
const TIP = /^\s*[└⎿│|]?\s*Tip: |^\s{2,}current work\s*$/;
const isChrome = (line: string) => {
  const t = stripAnsi(line);

  return t.trim() === '' || CHROME.some((re) => re.test(t));
};

const RULE = /^[\s─━—-]{8,}[\w@.-]*[\s─━—-]*$/;
const PROMPT_LINE = /^\s*[❯›>](\s|$)/;

/**
 * D09 W3 (QA MEDIUM-2): where Claude Code's input box starts: a rule, then the ❯ prompt line, with
 * another rule below it. Everything from there down is the box (a draft of any length, wrapped or
 * with shift+enter lines, a dimmed suggestion) and its footer, never the seat's work. -1 = none.
 */
function inputBoxStart(lines: string[]): number {
  for (let i = lines.length - 1; i > 0; i -= 1) {
    if (isInputBox(lines, i)) {
      return i - 1;
    }
  }

  return -1;
}

/** Whether the prompt line at `i` sits between two rules with only footer chrome (or blank) below the lower one. */
function isInputBox(lines: string[], i: number): boolean {
  if (!PROMPT_LINE.test(stripAnsi(lines[i]!)) || !RULE.test(stripAnsi(lines[i - 1]!))) {
    return false;
  }

  const lower = lines.findIndex((l, k) => k > i && RULE.test(stripAnsi(l)));

  // r1 W3 LOW-2: only the box when what follows its lower rule is footer chrome (or blank), so a
  // plain pane with "> quoted" between two long rules keeps the output after it.
  return lower !== -1 && lines.slice(lower + 1).every(isChrome);
}

/**
 * S3: the last n lines of what the seat is doing, for a Wall tile. Trailing input-box chrome is
 * dropped first, so a short tile still shows the work. Focus keeps the exact screen.
 */
export function contentTail(all: string[], n: number): string[] {
  const box = inputBoxStart(all);
  const lines = box >= 0 ? all.slice(0, box) : all;
  let end = lines.length;

  while (end > 0 && isChrome(lines[end - 1]!)) {
    end -= 1;
  }

  if (end === 0) {
    return visibleTail(lines, n);
  }

  // Blank lines and Claude Code's tips carry nothing on a small tile; keep the n last lines that
  // say something.
  const said = lines
    .slice(0, end)
    .filter((l) => stripAnsi(l).trim() !== '' && !TIP.test(stripAnsi(l)));

  return said.slice(Math.max(0, said.length - n));
}

/** Drop trailing blank lines (panes are mostly padding at the bottom), then keep the last `n`. */
export function visibleTail(lines: string[], n: number): string[] {
  let end = lines.length;

  while (end > 0 && stripAnsi(lines[end - 1]).trim() === '') {
    end -= 1;
  }

  return lines.slice(Math.max(0, end - n), end);
}
