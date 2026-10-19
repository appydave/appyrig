import { memo, useEffect, useRef, useState } from 'react';
import { ago } from '../../../fleet/model.js';
import { RIG_STATE } from '../../../fleet/views.js';
import { MockMark } from '../../kit/index.js';
import { FakeButton } from './FakeRunner.js';
import type { GraphRig } from './model.js';

interface Props {
  rig: GraphRig;
  now: number;
  /** A rig pick just landed here: outlined for a moment. */
  focused?: boolean;
  /** The rig is open in place (its inside is showing), or a loose group's one-line list is. */
  expanded: boolean;
  /** The open rig's inside (pods, cards, lines), drawn under the box's own lines. */
  children?: React.ReactNode;
  /** The colour of the hovered line that ends at this rig (or the ink when the rig itself is hovered). */
  trace?: string;
  /** All callbacks are stable, so memo(RigBox) skips a box whose rig object is unchanged. */
  onToggle: (rigKey: string, wasExpanded: boolean) => void;
  /** Hover or focus on the box lights its lines on the canvas and dims the rest. */
  onTrace: (rigKey: string | null) => void;
}

/** The newest handoff in words: "dev-build → dev-qa · Refresh before GO · 5m ago". */
export function lastWords(rig: GraphRig, now: number): string {
  if (!rig.ref) return 'Sessions on this machine that belong to no rig';
  const l = rig.last;
  if (!l) return 'No handoffs yet';
  const age = ago(Math.max(0, now - Date.parse(l.at)));
  return `${l.from} → ${l.to}${l.summary ? ` · ${l.summary}` : ''} · ${age} ago`;
}

/**
 * One rig as ONE box: name, machine, state, agent count, flags, and its last handoff in words. No
 * agents are drawn (a click on the box opens that rig's Rig Map); expanding lists their names on
 * one line. Start / Restore / Launch are mocks behind the "⋯" menu.
 */
function RigBox({ rig, now, expanded, focused, children, trace, onToggle, onTrace }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const st = RIG_STATE[rig.state];
  const loose = !rig.ref;
  const running = rig.ref?.status === 'running';
  // A click opens or closes the box in place (and chooses the rig, in the page's handler).
  const open = () => onToggle(rig.key, expanded);
  return (
    <article
      className="g2-box"
      data-graph-rig={rig.key}
      data-testid="g2-rig"
      data-rig-key={rig.key}
      data-state={rig.state}
      data-loose={loose || undefined}
      data-expanded={expanded || undefined}
      data-focus={focused || undefined}
      data-menu-open={menuOpen || undefined}
      data-trace={trace ? true : undefined}
      style={trace ? ({ ['--g2-trace' as string]: trace } as React.CSSProperties) : undefined}
      onPointerEnter={() => onTrace(rig.key)}
      onPointerLeave={() => onTrace(null)}
      onFocus={() => onTrace(rig.key)}
      onBlur={() => onTrace(null)}
      onClick={(e) => {
        // the whole box opens the rig; its own buttons do their own thing
        if (!(e.target as HTMLElement).closest('button, a, [role="group"]')) open();
      }}
    >
      <header className="g2-box-head" data-testid="g2-rig-head">
        <span className="rig-state" data-state={rig.state} title={st.label}>
          {st.glyph}
        </span>
        <button
          type="button"
          className="g2-box-name mono"
          data-testid="g2-rig-name"
          title={
            loose
              ? 'Show or hide the agent names'
              : `${expanded ? 'Close' : 'Open'} ${rig.name} here`
          }
          onClick={open}
        >
          {rig.name}
        </button>
        {!loose && <RigMenu rig={rig} running={!!running} onOpenChange={setMenuOpen} />}
      </header>
      <p className="g2-box-meta" data-testid="g2-rig-counts">
        <span className="g2-box-machine" data-testid="g2-box-machine">
          {rig.machineLabel}
        </span>
        <span className="mono">
          {rig.agents} agent{rig.agents === 1 ? '' : 's'} · {rig.active} active
        </span>
        {rig.flags.needsMe > 0 && (
          <span
            className="g2-flag"
            data-flag="needsMe"
            title="Needs you: blocked, or asked you something"
          >
            ▲ {rig.flags.needsMe}
          </span>
        )}
        {rig.flags.stuck > 0 && (
          <span
            className="g2-flag"
            data-flag="stuck"
            title={`${rig.flags.stuck} seat${rig.flags.stuck === 1 ? '' : 's'} with work waiting over 2 h`}
          >
            <span className="g2-flag-glyph" aria-hidden="true">
              ⌛
            </span>{' '}
            {rig.flags.stuck} waiting
          </span>
        )}
        {rig.flags.failing > 0 && (
          <span className="g2-flag" data-flag="failing" title="Down while its rig runs">
            ✕ {rig.flags.failing}
          </span>
        )}
        {rig.state === 'attention' && rig.flags.needsMe === 0 && (
          <span className="g2-flag" data-flag="needsMe" title="OpenRig flags this rig">
            ▲ attention
          </span>
        )}
        {(rig.crossOut > 0 || rig.crossIn > 0) && (
          <span
            className="g2-box-cross mono"
            data-testid="g2-rig-cross"
            title="Handoffs with other rigs: sent ↗ and received ↙"
          >
            ↗{rig.crossOut} ↙{rig.crossIn}
          </span>
        )}
      </p>
      <p className="g2-box-last" data-testid="g2-last" title={lastWords(rig, now)}>
        {lastWords(rig, now)}
      </p>
      {rig.agents > 0 && (
        <p className="g2-box-agents">
          <button
            type="button"
            className="g2-box-toggle"
            data-testid="g2-rig-toggle"
            aria-expanded={expanded}
            onClick={() => onToggle(rig.key, expanded)}
          >
            {expanded ? '▾' : '▸'} {loose ? 'agents' : expanded ? 'close' : 'open'}
          </button>
          {expanded && loose && (
            <span className="g2-box-names mono" data-testid="g2-agent-names">
              {rig.agentNames.join(' · ')}
            </span>
          )}
        </p>
      )}
      {expanded && !loose && children}
    </article>
  );
}

export default memo(RigBox);

/**
 * The box's Start / Restore / Launch behind one "⋯" button. They are mocks; the page says so once,
 * and the badge shows beside the button only on hover, focus or while the menu is open.
 */
function RigMenu({
  rig,
  running,
  onOpenChange,
}: {
  rig: GraphRig;
  running: boolean;
  /** The box raises itself above its neighbours while its menu is open. */
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => onOpenChange(open), [open, onOpenChange]);
  // A button closes the menu after raising its ask, not during the click: unmounting the button
  // mid-click swallowed the click in a real browser.
  const close = () => setOpen(false);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc, true);
    };
  }, [open]);
  return (
    <span className="g2-menu-wrap" ref={wrap} data-open={open || undefined}>
      <button
        type="button"
        ref={trigger}
        className="pill-btn g2-menu-btn"
        data-testid="g2-rig-menu"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Actions for ${rig.name} (mock)`}
        title="Start, Restore, Launch (mocks: they change nothing)"
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      <MockMark />
      {open && (
        <div
          className="g2-menu"
          role="group"
          aria-label={`${rig.name} actions (mock)`}
          data-testid="g2-rig-menu-items"
        >
          <FakeButton
            testId="g2-fake-start"
            onAsk={close}
            disabled={running}
            title={running ? 'Already running' : undefined}
            ask={{
              label: 'Start',
              question: `Start ${rig.name} on the ${rig.machineLabel}?`,
              result: `${rig.name} started on the ${rig.machineLabel} (pretend)`,
            }}
          />
          <FakeButton
            testId="g2-fake-restore"
            onAsk={close}
            ask={{
              label: 'Restore',
              question: `Restore ${rig.name} from its last snapshot on the ${rig.machineLabel}?`,
              result: `${rig.name} restored (pretend)`,
            }}
          />
          <FakeButton
            testId="g2-fake-launch"
            onAsk={close}
            ask={{
              label: 'Launch',
              question: `Launch a fresh ${rig.name} from its spec on the ${rig.machineLabel}?`,
              result: `${rig.name} launched (pretend)`,
            }}
          />
        </div>
      )}
    </span>
  );
}
