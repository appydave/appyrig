import type { ReactNode } from 'react';
import { PIP, type ModelFamily, type PipKey } from '../domain/fleet/model.js';
import { HarnessMark, pctText, tokensText } from './SeatCardLines.js';
import './wallCard.css';

/**
 * v2 kit · WallCard: V1's seat card body in V2's kit. A dark, terminal-like card with FIXED SLOTS,
 * the same place on every card, at ONE fixed size (232 × 172, V1's tile width): nothing a card holds
 * can change its size, so a row of cards always lines up.
 *
 *   name + runtime mark + model chip
 *   address
 *   status · role · machine · skills pill
 *   the last thing typed (V1's prompt line)
 *   folder + branch
 *   live · age  |  context + tokens  |  queue
 *
 * Live cards are solid dark; stopped and unknown ones are frosted (pale, dashed edge), so contrast
 * does the triage. Pure and presentational: the page maps its own data in. The Graph's agent card is
 * the kit's `TerminalCard` `compact`; this one is for the Wall.
 */
export interface WallCardProps {
  name: string;
  status: PipKey;
  address?: string | null;
  runtime?: string | null;
  model?: string | null;
  modelLabel?: string | null;
  modelFamily?: ModelFamily;
  role?: string | null;
  /** The machine label. */
  where?: string | null;
  skillCount?: number | null;
  /** The last thing typed at the prompt (without the ❯). */
  lastTyped?: string | null;
  /** Readable terminal lines to show when there is no prompt line to show. */
  fallbackLines?: string[];
  /** Replaces the terminal block with a highlighted line (e.g. why a seat is blocked). */
  warning?: string | null;
  folder?: string | null;
  branch?: string | null;
  /** "live · 2s", or "stopped · M4 live 2s". */
  fresh: string;
  contextPct?: number | null;
  contextTokens?: number | null;
  queue: { pending: number; inProgress: number; blocked: number };
  selected?: boolean;
  onOpen?: () => void;
  corner?: ReactNode;
  overlay?: ReactNode;
  testId?: string;
  dataAttrs?: Record<string, string | undefined>;
  ariaLabel?: string;
}

/** A card is frosted when its session is not live: stopped, asleep, or state unknown (plain tmux). */
export const isFrosted = (s: PipKey): boolean =>
  s === 'stopped' || s === 'asleep' || s === 'unknown';

export default function WallCard(p: WallCardProps) {
  const frosted = isFrosted(p.status);
  const typed = p.lastTyped?.trim() || null;
  const stopped = p.status === 'stopped' || p.status === 'asleep';
  const rest = p.fallbackLines ?? [];

  return (
    <div
      className="wcard"
      data-pip={p.status}
      data-frosted={frosted || undefined}
      data-selected={p.selected || undefined}
      data-testid={p.testId ?? 'wall-card'}
      {...p.dataAttrs}
    >
      <span className="wcard-face">
        <span className="wcard-bar" aria-hidden="true" />
        <button
          type="button"
          className="wcard-main"
          onClick={p.onOpen}
          disabled={!p.onOpen}
          aria-label={p.ariaLabel ?? `${p.name}, ${PIP[p.status].label}`}
          data-testid="terminal-card-open"
        >
          <span className="wcard-head">
            <span className="wcard-name" title={p.name}>
              {p.name}
            </span>
            {(p.runtime || p.model) && <HarnessMark runtime={p.runtime} model={p.model} />}
            {p.modelLabel && (
              <span className="chip" data-family={p.modelFamily} data-testid="terminal-card-model">
                {p.modelLabel}
              </span>
            )}
          </span>
          <span
            className="wcard-address"
            data-testid="terminal-card-address"
            title={p.address ?? ''}
          >
            {p.address ?? ' '}
          </span>
          <span className="wcard-meta">
            <span className="wcard-pip" data-testid="terminal-card-status">
              <span aria-hidden="true">{PIP[p.status].glyph}</span> {PIP[p.status].label}
            </span>
            {p.role && <span className="wcard-role">{p.role}</span>}
            {p.where && <span className="wcard-where">{p.where}</span>}
            <span className="wcard-skills" data-testid="terminal-card-skills">
              {p.skillCount != null ? `${p.skillCount} skills` : '— skills'}
            </span>
          </span>
          <span
            className="wcard-term"
            data-testid="terminal-card-tail"
            data-warn={p.warning ? true : undefined}
          >
            {p.warning ? (
              <span className="wcard-line wcard-warn">{`▲ ${p.warning}`}</span>
            ) : stopped ? (
              <span className="wcard-line wcard-dim">session stopped · no terminal</span>
            ) : typed ? (
              <span className="wcard-line" data-testid="terminal-card-typed" title={typed}>
                <span className="wcard-prompt" aria-hidden="true">
                  {'❯'}
                </span>{' '}
                {typed}
              </span>
            ) : rest.length > 0 ? (
              rest.slice(0, 1).map((l) => (
                <span key={l} className="wcard-line" title={l}>
                  {l}
                </span>
              ))
            ) : (
              <span className="wcard-line wcard-dim">no terminal text</span>
            )}
            {!stopped && (p.folder || p.branch) ? (
              <span className="wcard-line wcard-folder" data-testid="terminal-card-folder">
                {p.folder && <span className="wcard-cwd">{p.folder}</span>}
                {p.branch && <span className="wcard-branch"> ({p.branch})</span>}
              </span>
            ) : null}
          </span>
          <span className="wcard-foot">
            <span className="wcard-fresh" data-testid="seat-freshness" title={p.fresh}>
              {p.fresh}
            </span>
            <span
              className="wcard-ctx"
              data-testid="terminal-card-context"
              title="Context used and tokens"
            >
              {pctText(p.contextPct)} {tokensText(p.contextTokens)}
            </span>
            <span className="wcard-q" title="queue: pending / in progress / blocked">
              q {p.queue.pending}/{p.queue.inProgress}/{p.queue.blocked}
            </span>
          </span>
        </button>
      </span>
      {p.corner && <span className="wcard-corner">{p.corner}</span>}
      {p.overlay}
    </div>
  );
}
