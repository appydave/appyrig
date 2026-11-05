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
