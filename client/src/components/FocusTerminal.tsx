import { useEffect, useRef } from 'react';
import type { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { TAIL_MAX_LINES } from '@appydave/shared';
import { stripLinks } from '../fleet/model.js';
import { trackTerminal } from '../fleet/xtermRegistry.js';

interface Props {
  lines: string[];
  hidden: boolean;
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function render(term: Terminal, lines: string[]) {
  term.reset();
  // Hide the cursor: this is a picture of someone else's terminal, not a prompt.
  // No live links in the terminal either (r1 L1, QA): OSC 8 is stripped before xterm parses it.
  term.write('\u001b[?25l' + stripLinks(lines.join('\r\n')));
}

/**
 * The only xterm.js on the page. Created lazily when Focus opens (the module is loaded on demand),
 * disposed when Focus closes. Read-only: stdin is disabled and nothing is ever sent anywhere.
 * It stays alive while the rich-text view is shown, so Focus always holds exactly one terminal.
 */
export default function FocusTerminal({ lines, hidden }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<{ fit: () => void } | null>(null);
  const linesRef = useRef(lines);
  linesRef.current = lines;

  useEffect(() => {
    let cancelled = false;
    let release: (() => void) | null = null;
    let observer: ResizeObserver | null = null;
    let term: Terminal | null = null;

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      const host = hostRef.current;
      if (cancelled || !host) return;
      term = new Terminal({
        disableStdin: true,
        convertEol: true,
        cursorBlink: false,
        scrollback: TAIL_MAX_LINES + 50,
        fontFamily: cssVar('--ar-font-term', 'monospace'),
        fontSize: 14,
        lineHeight: 1.25,
        theme: {
          background: cssVar('--ar-term-bg-deep', '#1a1515'),
          foreground: cssVar('--ar-term-fg', '#e8e0d4'),
        },
      });
      release = trackTerminal();
      // Esc and Cmd/Ctrl+Enter belong to Focus (close), not to the terminal. Returning false tells
      // xterm not to handle or cancel them, so they still reach Focus after a click in the
      // terminal gave it keyboard focus (QA M1).
      term.attachCustomKeyEventHandler(
        (e) => !(e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey)))
      );
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      fitRef.current = fit;
      termRef.current = term;
      fit.fit();
      render(term, linesRef.current);
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => fit.fit());
        observer.observe(host);
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      term?.dispose();
      release?.();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (termRef.current) render(termRef.current, lines);
  }, [lines]);

  useEffect(() => {
    if (!hidden) fitRef.current?.fit();
  }, [hidden]);

  return (
    <div className="focus-terminal" data-testid="focus-terminal" hidden={hidden}>
      <div ref={hostRef} className="focus-terminal-host" />
    </div>
  );
}
