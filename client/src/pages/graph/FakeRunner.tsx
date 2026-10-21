import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { MockMark, useFakeAction } from '../../kit/index.js';

/**
 * Graph fakes: per-rig Start / Restore / Launch and per-agent Restart / Stop. One runner for the
 * page, so a control in a hover card can close while its pretend work finishes: confirm, then
 * progress, then a toast. It takes no socket and calls nothing; its only effect is its own state.
 */
export interface FakeAsk {
  /** "Restart", "Start rig" … */
  label: string;
  /** "Restart orch-lead on the M2?" */
  question: string;
  /** "orch-lead restarted (pretend)" */
  result: string;
}

type Run = (ask: FakeAsk) => void;
const FakeCtx = createContext<Run>(() => {});
export const useFake = () => useContext(FakeCtx);

const TOAST_MS = 4000;

export function FakeRunner({ children, workMs = 1200 }: { children: ReactNode; workMs?: number }) {
  const a = useFakeAction(workMs);
  const [ask, setAsk] = useState<FakeAsk | null>(null);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const next = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const run = useCallback<Run>(
    (x) => {
      setAsk(x);
      a.ask();
    },
    // a.ask only sets state
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const { phase, reset } = a;
  useEffect(() => {
    if (phase !== 'done' || !ask) return;
    const id = ++next.current;
    setToasts((t) => [...t, { id, text: ask.result }]);
    timers.current.push(setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), TOAST_MS));
    setAsk(null);
    reset();
  }, [phase, ask, reset]);

  return (
    <FakeCtx.Provider value={run}>
      {children}
      {(ask || toasts.length > 0) && (
        <div className="g2-fake-dock" aria-live="polite">
          {ask && a.phase === 'confirm' && (
            <div
              className="g2-fake-dialog"
              role="dialog"
              aria-label={ask.question}
              data-testid="g2-fake-dialog"
            >
              <span>{ask.question}</span>
              <span className="g2-fake-btns">
                <button
                  type="button"
                  className="pill-btn ar-fake-yes"
                  data-testid="g2-fake-yes"
                  onClick={a.confirm}
                >
                  Yes, {ask.label.toLowerCase()}
                </button>
                <button
                  type="button"
                  className="pill-btn"
                  data-testid="g2-fake-cancel"
                  onClick={() => {
                    a.cancel();
                    setAsk(null);
                  }}
                >
                  Cancel
                </button>
              </span>
              <MockMark />
            </div>
          )}
          {ask && a.phase === 'working' && (
            <div className="g2-fake-dialog" role="status" data-testid="g2-fake-working">
              <span className="ar-fake-bar" aria-hidden="true" /> {ask.label}… <MockMark />
            </div>
          )}
          {toasts.map((t) => (
            <div key={t.id} className="g2-toast" role="status" data-testid="g2-toast">
              ✓ {t.text} <MockMark />
            </div>
          ))}
        </div>
      )}
    </FakeCtx.Provider>
  );
}

/** A small fake button: asks the page's runner, never anything else. */
export function FakeButton({
  ask,
  disabled,
  title,
  testId,
  onAsk,
}: {
  ask: FakeAsk;
  disabled?: boolean;
  title?: string;
  testId?: string;
  /** Called after the ask is raised (a menu closes itself here, after the click, not during it). */
  onAsk?: () => void;
}) {
  const run = useFake();
  return (
    <button
      type="button"
      className="pill-btn g2-fake-btn"
      data-testid={testId ?? 'g2-fake'}
      data-fake={ask.label}
      disabled={disabled}
      title={title ?? `${ask.label}: a mock, it changes nothing`}
      onClick={(e) => {
        e.stopPropagation();
        run(ask);
        onAsk?.();
      }}
    >
      {ask.label}
    </button>
  );
}
