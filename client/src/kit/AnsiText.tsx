import { useMemo } from 'react';
import { AnsiUp } from 'ansi_up';
import { stripOsc } from '../domain/fleet/model.js';

/**
 * ANSI → HTML for Wall tiles (no xterm on the Wall). ansi_up escapes HTML in the terminal text
 * before adding its colour spans, so pane content can never inject markup, and OSC 8 hyperlinks
 * are not turned into links. A fresh converter per render: ansi_up carries colour state between
 * calls, and tiles must not bleed into each other.
 */
export function ansiToHtml(lines: string[]): string {
  const au = new AnsiUp();

  au.escape_html = true;
  au.use_classes = false;
  // r1 L1: no live links. OSC 8 wrappers are stripped first (keeping the link text); the empty
  // allowlist is the backstop, so nothing inside a tile (itself a button) navigates anywhere.
  au.url_allowlist = {};

  return au.ansi_to_html(stripOsc(lines.join('\n')));
}

interface Props {
  lines: string[];
  ansi: boolean;
  className?: string;
  testId?: string;
}

export default function AnsiText({ lines, ansi, className, testId }: Props) {
  const html = useMemo(() => (ansi ? ansiToHtml(lines) : null), [lines, ansi]);

  if (html === null) {
    return (
      <div className={className} data-testid={testId}>
        {lines.join('\n')}
      </div>
    );
  }

  return (
    <div className={className} data-testid={testId} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
