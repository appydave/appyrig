import { useMemo } from 'react';
import { AnsiUp } from 'ansi_up';

/**
 * ANSI → HTML for Wall tiles (no xterm on the Wall). ansi_up escapes HTML in the terminal text
 * before adding its colour spans, so pane content can never inject markup. A fresh converter per
 * render: ansi_up carries colour state between calls, and tiles must not bleed into each other.
 */
export function ansiToHtml(lines: string[]): string {
  const au = new AnsiUp();
  au.escape_html = true;
  au.use_classes = false;
  return au.ansi_to_html(lines.join('\n'));
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
