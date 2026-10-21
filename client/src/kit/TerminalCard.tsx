import type { ReactNode } from 'react';
import { PIP, type ModelFamily, type PipKey } from '../domain/fleet/model.js';
import { HarnessMark, pctText, tokensText } from './SeatCardLines.js';
import { tailLine } from '../domain/fleet/terminal.js';
import './terminalCard.css';

export { tailLine };

/**
 * v2 kit · TerminalCard: ONE look for an agent on every v2 page. A dark, terminal-like card, because
 * the card stands for a tmux session and should look like one (David, 2026-10-19).
 *
 * THE RULE: one fixed size, never content-driven. Every card of a `size` has the same width and
 * height whatever it holds: a long tail is clipped to one line, a long address is clipped, skills
 * are a few chips then "+N". The CSS gives `width` and `height` and no `min-` / `max-` height, and a
 * test reads the stylesheet to keep it that way.
 *
 * Sizes: `wall` (the Wall's card: title bar, address, runtime + model, context, tail, skills) and
 * `compact` (the Graph's agent card: name, status, model, context, tail only).
 *
 * Pure and presentational: it takes plain values, so a page maps its own data in. It never reads a
 * seat. Status is drawn by shape as well as colour (the bar and outline), as on V1's tiles.
 */
export type CardSize = 'wall' | 'compact';

export interface TerminalCardProps {
  size: CardSize;
  /** The role / seat name, e.g. `dev-build`. */
  name: string;
  status: PipKey;
  /** The full mailbox address, e.g. `dev-build@d09-crew`. Shown on `wall` only. */
  address?: string | null;
  /** The harness (for its small mark) and the model chip text, e.g. `claude-code` / `opus 5.5`. */
  runtime?: string | null;
  model?: string | null;
  modelLabel?: string | null;
  modelFamily?: ModelFamily;
  contextPct?: number | null;
  contextTokens?: number | null;
  /** One readable line of the terminal (already without colour codes). Clipped to the card. */
  tail?: string | null;
  /** Replaces the tail with a highlighted line (e.g. why a seat is blocked). */
  warning?: string | null;
  /** Key skill names, and the full count. A few chips then "+N". `wall` only. */
  skills?: string[];
  skillCount?: number | null;
  /** The machine label, `wall` only. */
  where?: string | null;
  selected?: boolean;
  onOpen?: () => void;
  /** A small control in the title bar's corner (e.g. a ⋯ menu). It must not change the card's size. */
  corner?: ReactNode;
  /** Absolutely positioned content over the card (a popover); never part of the layout. */
  overlay?: ReactNode;
  testId?: string;
  /** Extra data attributes (`data-seat-key`, …) for the page's own tests and hooks. */
  dataAttrs?: Record<string, string | undefined>;
  ariaLabel?: string;
}

/** Skill chips shown on a wall card before "+N". */
export const SKILL_CHIPS = 3;

const short = (s: string) => s.split(/[:/]/).pop() ?? s;

/** What the skills row says: the names that fit, then how many more. */
export function skillChips(
  skills: readonly string[] | undefined,
  count: number | null | undefined
): { shown: string[]; more: number; onlyCount: number | null } {
  const names = skills ?? [];
  const total = Math.max(count ?? 0, names.length);

  if (names.length === 0) {
    return { shown: [], more: 0, onlyCount: count ?? null };
  }

  const shown = names.slice(0, SKILL_CHIPS).map(short);

  return { shown, more: Math.max(0, total - shown.length), onlyCount: null };
}

export default function TerminalCard(p: TerminalCardProps) {
  const compact = p.size === 'compact';
  const chips = compact ? null : skillChips(p.skills, p.skillCount);
  const line = p.warning ?? p.tail ?? null;
  const open = p.onOpen;

  return (
    <div
      className="tcard"
      data-size={p.size}
      data-pip={p.status}
      data-selected={p.selected || undefined}
      data-testid={p.testId ?? 'terminal-card'}
      {...p.dataAttrs}
    >
      <span className="tcard-face">
        <span className="tcard-bar" aria-hidden="true" />
        <button
          type="button"
          className="tcard-main"
          onClick={open}
          disabled={!open}
          aria-label={p.ariaLabel ?? `${p.name}, ${PIP[p.status].label}`}
          data-testid="terminal-card-open"
        >
          <span className="tcard-head">
            <span className="tcard-name" title={p.name}>
              {p.name}
            </span>
            <span
              className="tcard-pip"
              data-testid="terminal-card-status"
              title={PIP[p.status].label}
            >
              <span aria-hidden="true">{PIP[p.status].glyph}</span> {PIP[p.status].label}
            </span>
          </span>
          {!compact && (
            <span
              className="tcard-address"
              data-testid="terminal-card-address"
              title={p.address ?? ''}
            >
              {p.address ?? ' '}
            </span>
          )}
          <span className="tcard-meta">
            {(p.runtime || p.model) && <HarnessMark runtime={p.runtime} model={p.model} />}
            {p.modelLabel && (
              <span className="chip" data-family={p.modelFamily} data-testid="terminal-card-model">
                {p.modelLabel}
              </span>
            )}
            <span
              className="tcard-ctx mono"
              data-testid="terminal-card-context"
              title="Context used and tokens"
            >
              {pctText(p.contextPct)} {tokensText(p.contextTokens)}
            </span>
            {!compact && p.where && <span className="tcard-where">{p.where}</span>}
          </span>
          <span
            className="tcard-tail"
            data-warn={p.warning ? true : undefined}
            data-empty={line ? undefined : true}
            data-testid="terminal-card-tail"
            title={line ?? ''}
          >
            {line ?? (p.status === 'stopped' ? 'session stopped' : 'no terminal text')}
          </span>
          {chips && (
            <span className="tcard-skills" data-testid="terminal-card-skills">
              {chips.shown.map((s) => (
                <span key={s} className="tcard-skill">
                  {s}
                </span>
              ))}
              {chips.more > 0 && <span className="tcard-skill tcard-more">+{chips.more}</span>}
              {chips.onlyCount !== null && chips.onlyCount > 0 && (
                <span className="tcard-skill">{chips.onlyCount} skills</span>
              )}
            </span>
          )}
        </button>
      </span>
      {p.corner && <span className="tcard-corner">{p.corner}</span>}
      {p.overlay}
    </div>
  );
}
