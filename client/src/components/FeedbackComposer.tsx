import { useEffect, useRef, useState } from 'react';
import type { FeedbackListOutput, FeedbackVerdict, FeedbackViewState } from '@appydave/shared';
import { callVerb } from '../fleet/coreCall.js';
import type { FleetSocket } from '../fleet/useFleet.js';
import { fileFeedback, regionOf, type Shot } from '../feedback/capture.js';

/** ImageDrip Live UAT's four verdicts, same words. */
const VERDICTS: { key: FeedbackVerdict; glyph: string; label: string; hint: string }[] = [
  { key: 'down', glyph: '👎', label: 'wrong', hint: 'wrong, broken or missing' },
  { key: 'question', glyph: '❓', label: "don't get it", hint: "I can't tell what this is or why" },
  { key: 'up', glyph: '👍', label: 'good', hint: 'confirmed good: this works' },
  { key: 'idea', glyph: '💡', label: 'idea', hint: 'a wish, not a defect' },
];

export type ShotState =
  { state: 'capturing' } | { state: 'ready'; shot: Shot } | { state: 'failed'; message: string };

interface Props {
  region: string;
  snapshot: string;
  viewState: FeedbackViewState;
  shot: ShotState;
  socket?: FleetSocket;
  onClose: () => void;
  /** Told the new note id after a successful file. */
  onFiled: (message: string) => void;
}

/**
 * S8 · the feedback composer. The screen was captured before this opened (it is marked
 * data-feedback-skip, so it never appears in its own screenshot). The note is the point, so it has
 * focus; ⌘↵ files, Esc cancels. Keys never fire while you type here (S2 rule).
 */
export default function FeedbackComposer({
  region: initialRegion,
  snapshot,
  viewState,
  shot,
  socket,
  onClose,
  onFiled,
}: Props) {
  const [verdict, setVerdict] = useState<FeedbackVerdict>('down');
  const [note, setNote] = useState('');
  const [region, setRegion] = useState(initialRegion);
  const [withShot, setWithShot] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<FeedbackListOutput | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => noteRef.current?.focus(), []);

  // The last few notes, so filing feels like adding to a list (feedback.list, read-only).
  useEffect(() => {
    if (!socket) return;
    let current = true;
    void callVerb<FeedbackListOutput>(socket, 'feedback.list', { limit: 3 }).then((a) => {
      if (current && a.ok) setRecent(a.value);
    });
    return () => {
      current = false;
    };
  }, [socket]);

  // Esc cancels, before anything else hears it (capture), so it never also goes back a screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const send = async () => {
    if (sending) return;
    if (!note.trim()) {
      setError('Write a sentence first: the note is the point.');
      noteRef.current?.focus();
      return;
    }
    setSending(true);
    setError(null);
    const r = await fileFeedback({
      verdict,
      region: regionOf(region),
      note: note.trim(),
      snapshot,
      viewState,
      ...(withShot && shot.state === 'ready' ? { screenshotPng: shot.shot.png } : {}),
    });
    setSending(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    onFiled(
      `Filed ${r.value.id}${r.value.hasScreenshot ? ' with a screenshot' : ''} · ${r.value.count} note${r.value.count === 1 ? '' : 's'} in all`
    );
  };

  return (
    <div className="feedback-scrim" data-feedback-skip="">
      <section
        className="feedback-composer"
        role="dialog"
        aria-modal="true"
        aria-label="Feedback"
        data-testid="feedback-composer"
      >
        <header>
          <span className="label">⚑ Feedback</span>
          <button
            type="button"
            className="pill-btn"
            data-testid="feedback-cancel"
            onClick={onClose}
          >
            Cancel · Esc
          </button>
        </header>
        <div className="feedback-verdicts" role="radiogroup" aria-label="Verdict">
          {VERDICTS.map((v) => (
            <button
              key={v.key}
              type="button"
              role="radio"
              aria-checked={verdict === v.key}
              data-testid={`feedback-verdict-${v.key}`}
              title={v.hint}
              onClick={() => setVerdict(v.key)}
            >
              <span aria-hidden="true">{v.glyph}</span>
              <span>{v.label}</span>
            </button>
          ))}
        </div>
        <textarea
          ref={noteRef}
          data-testid="feedback-note"
          value={note}
          maxLength={4000}
          aria-label="Your note"
          placeholder="What's wrong, in your words. This sentence is the whole point."
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <label className="feedback-region">
          <span className="label">About</span>
          <input
            data-testid="feedback-region"
            value={region}
            maxLength={64}
            onChange={(e) => setRegion(e.target.value)}
          />
        </label>
        <div className="feedback-shot" data-testid="feedback-shot" data-state={shot.state}>
          {shot.state === 'capturing' && <span className="quiet">capturing the screen…</span>}
          {shot.state === 'failed' && (
            <span className="quiet">
              No screenshot ({shot.message}); the note and what was on screen still go.
            </span>
          )}
          {shot.state === 'ready' && (
            <>
              <img
                src={`data:image/png;base64,${shot.shot.png}`}
                alt="The screen as it was when you pressed Feedback"
                data-testid="feedback-thumb"
              />
              <label>
                <input
                  type="checkbox"
                  checked={withShot}
                  data-testid="feedback-with-shot"
                  onChange={(e) => setWithShot(e.target.checked)}
                />{' '}
                Include this screenshot ({shot.shot.width}×{shot.shot.height},{' '}
                {Math.round(shot.shot.bytes / 1024)} KB)
              </label>
            </>
          )}
        </div>
        {error && (
          <p className="feedback-error" role="alert" data-testid="feedback-error">
            {error}
          </p>
        )}
        <footer>
          <span className="quiet">
            Also saved: what was on screen as text, and where you were (screen, rig, seat, filters).
          </span>
          <button
            type="button"
            className="pill-btn cta"
            data-testid="feedback-send"
            disabled={sending}
            onClick={() => void send()}
          >
            {sending ? 'Filing…' : 'File it · ⌘↵'}
          </button>
        </footer>
        {recent && recent.total > 0 && (
          <div className="feedback-recent" data-testid="feedback-recent">
            <span className="label">Your notes · {recent.total} in all</span>
            <ul>
              {recent.notes.map((n) => (
                <li key={n.id}>
                  <code>{n.id}</code> {VERDICTS.find((v) => v.key === n.verdict)?.glyph}{' '}
                  <span className="quiet">{n.region}</span> {n.note}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
