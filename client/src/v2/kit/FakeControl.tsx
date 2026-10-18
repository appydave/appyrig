import { useCallback, useEffect, useRef, useState } from 'react';
import MockMark from './MockMark.js';
import { useMockNote } from './MockNote.js';

/**
 * v2 kit · FakeControl: a button that behaves like the real thing — confirm, then progress, then a
 * result — and does nothing at all. It never touches the socket, the hub, OpenRig or any verb: it
 * takes no socket, and its only effect is its own state. For controls AppyRig does not have yet
 * (Start / Restore / Launch, Settings edits, schedules), so David can judge the flow before anyone
 * builds it. Always carries MockMark.
 */
export type FakePhase = 'idle' | 'confirm' | 'working' | 'done';

export interface FakeAction {
  phase: FakePhase;
  ask: () => void;
  confirm: () => void;
  cancel: () => void;
  reset: () => void;
}

/** The state machine behind FakeControl, for pages that want their own markup. */
export function useFakeAction(workMs = 1200): FakeAction {
  const [phase, setPhase] = useState<FakePhase>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  const confirm = useCallback(() => {
    setPhase('working');
    timer.current = setTimeout(() => setPhase('done'), workMs);
  }, [workMs]);
  return {
    phase,
    ask: () => setPhase('confirm'),
    confirm,
    cancel: () => setPhase('idle'),
    reset: () => setPhase('idle'),
  };
}

interface Props {
  /** The button's words, e.g. "Restore rig". */
  label: string;
  /** What the confirm step asks, e.g. "Restore d09-crew on the M2?" */
  question: string;
  /** What the pretend result says, e.g. "d09-crew restored (pretend)". */
  result: string;
  /** How long the pretend progress runs. */
  workMs?: number;
}

export default function FakeControl({ label, question, result, workMs }: Props) {
  const a = useFakeAction(workMs);
  const box = useRef<HTMLSpanElement>(null);
  // walk #8: the page carries one "mocks" note; this control's own badge shows on hover / focus.
  useMockNote(box);
  return (
    <span ref={box} className="v2-fake" data-testid="fake-control" data-phase={a.phase}>
      {a.phase === 'idle' && (
        <button
          type="button"
          className="pill-btn"
          title={`${label}: a mock, nothing is sent`}
          onClick={a.ask}
        >
          {label}
        </button>
      )}
      {a.phase === 'confirm' && (
        <span role="group" aria-label={question}>
          <span className="v2-fake-q">{question}</span>{' '}
          <button
            type="button"
            className="pill-btn v2-fake-yes"
            data-testid="fake-confirm"
            onClick={a.confirm}
          >
            Yes
          </button>{' '}
          <button type="button" className="pill-btn" data-testid="fake-cancel" onClick={a.cancel}>
            Cancel
          </button>
        </span>
      )}
      {a.phase === 'working' && (
        <span className="v2-fake-working" role="status">
          <span className="v2-fake-bar" aria-hidden="true" /> {label}…
        </span>
      )}
      {a.phase === 'done' && (
        <span className="v2-fake-done" role="status" data-testid="fake-result">
          ✓ {result}{' '}
          <button type="button" className="pill-btn" onClick={a.reset}>
            OK
          </button>
        </span>
      )}{' '}
      <MockMark />
    </span>
  );
}
