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

/** The last readable line of a terminal's text, colour codes removed (with or without the ESC byte). */
export function tailLine(lines: readonly string[] | null | undefined): string | null {
  return (
    lines
      ?.map((l) => plainLine(l).trim())
      .filter(Boolean)
      .at(-1) ?? null
  );
}
