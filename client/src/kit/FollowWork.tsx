import { useEffect, useRef, useState } from 'react';
import type { HandoffGetOutput } from '@appydave/shared';
import { callVerb } from '@client/domain/fleet/coreCall.js';
import type { FleetSocket } from '@client/domain/fleet/useFleet.js';
import { DOT_STATE_LABEL, dotState, type WorkChain } from '@client/domain/fleet/timeline.js';
import { isTextEntry } from '@client/lib/keys.js';

interface Props {
  machineId: string;
  chain: WorkChain;
  /** The handoff it was opened from: marked "you started here". */
  fromId: string;
  socket?: FleetSocket;
  /** Bodies already fetched, shared with the handoff panel. */
  cache: Map<string, HandoffGetOutput>;
  onClose: () => void;
  /** r1 MEDIUM-2: false while something sits on top (Files, feedback, a seat, ?): Esc is theirs. */
  keys?: boolean;
}

const clock = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
const who = (raw: string | null) => (raw ?? '?').split('@')[0];

export const STATE_GLYPH = { done: '●', 'handed-on': '◆', open: '○', stopped: '■' } as const;

const ROLE = {
  in: 'what started it',
  step: '',
  out: 'went back out',
} as const;

/**
 * Views V2: follow one piece of work. The chain the chosen handoff belongs to, oldest → newest:
 * each step's time, from → to, state and the first line of its text; "Show the full text" reads
 * the message through `handoff.get`. The panel says which rule linked the steps, because the
 * snapshot has no hand-on links and the link is a judgement, not a record.
 */
export default function FollowWork({
  machineId,
  chain,
  fromId,
  socket,
  cache,
  onClose,
  keys = true,
}: Props) {
  const [open, setOpen] = useState<Record<string, HandoffGetOutput | 'loading' | string>>({});
  const back = useRef<HTMLButtonElement>(null);

  useEffect(() => back.current?.focus(), []);

  // r1 LOW-3: closing hands keyboard focus back to the panel's "Follow this work" button.
  const close = () => {
    onClose();
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('[data-testid="handoff-follow"]')?.focus()
    );
  };

  const closeRef = useRef(close);

  closeRef.current = close;

  // Esc goes back to the handoff panel only (capture, before the panel's own Esc closes it).
  // r1 MEDIUM-2: not while an overlay owns the keyboard, nor from inside a text field.
  useEffect(() => {
    if (!keys) {
      return;
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isTextEntry(e.target)) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
    };

    window.addEventListener('keydown', onKey, true);

    return () => window.removeEventListener('keydown', onKey, true);
  }, [keys]);

  const toggle = (id: string) => {
    if (open[id]) {
      setOpen(({ [id]: _, ...rest }) => rest);

      return;
    }

    const cached = cache.get(id);

    if (cached) {
      setOpen((o) => ({ ...o, [id]: cached }));

      return;
    }

    if (!socket) {
      setOpen((o) => ({ ...o, [id]: 'No hub connection to read the message.' }));

      return;
    }

    setOpen((o) => ({ ...o, [id]: 'loading' }));
    void callVerb<HandoffGetOutput>(socket, 'handoff.get', { machine: machineId, id }).then((a) => {
      if (a.ok && a.value.bodyStatus === 'present') {
        cache.set(id, a.value);
      }

      setOpen((o) =>
        id in o
          ? {
              ...o,
              [id]: a.ok
                ? a.value.bodyStatus === 'present'
                  ? a.value
                  : "This machine's collector hasn't sent this message yet."
                : a.error.message,
            }
          : o
      );
    });
  };

  const steps = chain.steps;

  return (
    <aside
      className="handoff-panel follow-work"
      data-testid="follow-work"
      data-rule={chain.rule}
      aria-label="Follow this work"
    >
      <header>
        <span className="label">
          Follow this work · {steps.length} step{steps.length === 1 ? '' : 's'}, oldest first
        </span>
        <button
          ref={back}
          type="button"
          className="pill-btn"
          data-testid="follow-close"
          onClick={close}
        >
          ← Back · Esc
        </button>
      </header>
      <p className="follow-rule" data-testid="follow-rule">
        <b>How the steps were linked:</b> {chain.ruleText}
      </p>
      <ol className="follow-steps" data-testid="follow-steps">
        {steps.map(({ item, role }) => {
          const st = dotState(item.state);
          const body = open[item.id];

          return (
            <li
              key={item.id}
              className="follow-step"
              data-testid="follow-step"
              data-role={role}
              data-id={item.id}
              aria-current={item.id === fromId ? 'true' : undefined}
            >
              <div className="follow-step-head">
                <span className="follow-time">{clock(item.createdAt)}</span>
                <span>
                  {who(item.source)} → {who(item.destination)}
                </span>
                <span className="tl-state" data-state={st}>
                  {STATE_GLYPH[st]} {DOT_STATE_LABEL[st]}
                </span>
                {role !== 'step' && <span className="follow-role">{ROLE[role]}</span>}
                {item.id === fromId && <span className="follow-role">you started here</span>}
              </div>
              <p className="follow-first">{item.summary || item.tags.join(', ') || item.id}</p>
              <button
                type="button"
                className="linklike"
                data-testid="follow-expand"
                aria-expanded={!!body}
                onClick={() => toggle(item.id)}
              >
                {body ? '▾ Hide the full text' : '▸ Show the full text'}
              </button>
              {body === 'loading' && <p className="quiet">loading message…</p>}
              {typeof body === 'string' && body !== 'loading' && (
                <p className="quiet">Couldn&rsquo;t read the message: {body}</p>
              )}
              {body && typeof body === 'object' && (
                <pre data-testid="follow-text">{body.body || '(empty message)'}</pre>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
