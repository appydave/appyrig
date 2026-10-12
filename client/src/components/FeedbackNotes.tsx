import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeedbackListOutput, Refusal } from '@appydave/shared';
import { callVerb } from '../fleet/coreCall.js';
import type { FleetSocket } from '../fleet/useFleet.js';
import { VERDICTS } from './FeedbackComposer.js';

type State =
  | { state: 'loading' }
  | { state: 'ok'; out: FeedbackListOutput }
  | { state: 'refused'; error: Refusal };

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Batch 2 · C4 (F23): the notes filed with ⚑ Feedback, newest first, with when, verdict, the view
 * they were filed on, the note, and its screenshot. Read-only (feedback.list); Esc closes.
 */
export default function FeedbackNotes({
  socket,
  onClose,
}: {
  socket: FleetSocket;
  onClose: () => void;
}) {
  const [got, setGot] = useState<State>({ state: 'loading' });
  const closeRef = useRef<HTMLButtonElement>(null);
  const load = useCallback(() => {
    setGot({ state: 'loading' });
    void callVerb<FeedbackListOutput>(socket, 'feedback.list', { limit: 50 }).then((a) =>
      setGot(a.ok ? { state: 'ok', out: a.value } : { state: 'refused', error: a.error })
    );
  }, [socket]);
  useEffect(load, [load]);
  useEffect(() => closeRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const out = got.state === 'ok' ? got.out : null;
  return (
    <div className="feedback-scrim" data-testid="notes-scrim" onClick={onClose}>
      <section
        className="feedback-composer feedback-notes"
        role="dialog"
        aria-modal="true"
        aria-label="Filed notes"
        data-testid="feedback-notes"
        data-feedback-skip=""
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <span className="label">
            ⚑ Filed notes{out ? ` · ${out.total} in all, newest first` : ''}
          </span>
          <button
            ref={closeRef}
            type="button"
            className="pill-btn"
            data-testid="notes-close"
            onClick={onClose}
          >
            Close · Esc
          </button>
        </header>
        <div className="feedback-scroll">
          {got.state === 'loading' && <p className="quiet">Loading notes…</p>}
          {got.state === 'refused' && (
            <p className="quiet" data-testid="notes-error">
              feedback.list refused: {got.error.failureMode}. {got.error.message}
            </p>
          )}
          {out && out.notes.length === 0 && (
            <p className="quiet" data-testid="notes-empty">
              No notes filed yet. Press F (or ⚑ Feedback) on any screen to file one.
            </p>
          )}
          {out && out.notes.length > 0 && (
            <ol className="notes-list" data-testid="notes-list">
              {out.notes.map((n) => {
                const v = VERDICTS.find((x) => x.key === n.verdict);
                return (
                  <li key={n.id} data-testid="note-row" data-note-id={n.id}>
                    <div className="note-head">
                      <span className="note-verdict" data-verdict={n.verdict}>
                        {v?.glyph} {v?.label ?? n.verdict}
                      </span>
                      <span className="label">
                        {n.view ?? n.route}
                        {n.selectedRig ? ` · ${n.selectedRig}` : ''} · {n.region}
                      </span>
                      <span className="quiet">
                        {when(n.createdAt)} · <code>{n.id}</code>
                      </span>
                    </div>
                    <p className="note-text">{n.note}</p>
                    {n.hasScreenshot ? (
                      <a
                        href={`/v1/feedback/${n.id}/screenshot.png`}
                        target="_blank"
                        rel="noreferrer"
                        title="Open the screenshot full size"
                      >
                        <img
                          className="note-shot"
                          src={`/v1/feedback/${n.id}/screenshot.png`}
                          alt={`Screenshot filed with ${n.id}`}
                          loading="lazy"
                          data-testid="note-shot"
                        />
                      </a>
                    ) : (
                      <p className="quiet">No screenshot with this note.</p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
