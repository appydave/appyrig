/** The last readable line of a terminal's text, colour codes removed (with or without the ESC byte). */
export function tailLine(lines: readonly string[] | null | undefined): string | null {
  return (
    lines
      // eslint-disable-next-line no-control-regex
      ?.map((l) => l.replace(/\u001b?\[[0-9;?]*[ -/]*[@-~]/g, '').trim())
      .filter(Boolean)
      .at(-1) ?? null
  );
}
