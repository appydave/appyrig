import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { View } from '../App.js';
import { isShortcutBlocked } from '../lib/keys.js';
import type { FrozenMeta } from './frozen/frozenSocket.js';
import { groupOf, isCurrentView, navGroups, navLabel, v2PageFor } from './registry.js';
import type { NavGroupKey, PageKey, V2Context, V2OnlyKey } from './types.js';
import { readMode, writeMode, type Mode } from './version.js';
import './v2.css';

/** The global version switch and the per-page flip. Not used by Current's own keys (? L F O D J K / [ ]). */
export const VERSION_KEY = 'v';
export const FLIP_KEY = 'b';
const NOTE_MS = 2500;

export interface UseV2Args {
  view: View;
  chooseView: (v: View) => void;
  /** Screen keys are live: nothing on top, no seat open. */
  keys: boolean;
  frozen?: FrozenMeta;
  ctx: Omit<V2Context, 'goTo'>;
}

export interface V2Frame {
  mode: Mode;
  /** The page on screen: a Current view, or a page that exists only in v2. */
  page: PageKey;
  /** A v2-only page is on screen (Current's `view` is underneath, untouched). */
  newPage: V2OnlyKey | null;
  /** True: v2 is showing its grouped nav, so Current's tab strip is hidden. */
  groupedNav: boolean;
  /** Version switch, flip and frozen badge, for the header. */
  controls: ReactNode;
  nav: ReactNode;
  /** The v2 page, when one replaces Current's page; null means Current's page shows. */
  body: ReactNode;
  /** "no v2 yet", the flip note, a frozen-snapshot problem. */
  banner: ReactNode;
}

function formatRecorded(iso: string | null): string {
  if (!iso) return 'unknown time';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
}

export function useV2({ view, chooseView, keys, frozen, ctx }: UseV2Args): V2Frame {
  const [mode, setModeState] = useState<Mode>(() => readMode());
  const [newPage, setNewPage] = useState<V2OnlyKey | null>(null);
  /** The page the viewer flipped; flipping is per page and forgotten on leaving it. */
  const [flippedFor, setFlippedFor] = useState<PageKey | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const page: PageKey = newPage ?? view;
  const [openGroup, setOpenGroup] = useState<NavGroupKey | null>(null);

  // A remembered v2 shows in the address too, so the link David copies opens the same version.
  useEffect(() => {
    if (mode === 'v2') writeMode('v2');
    // once, on load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(null), NOTE_MS);
    return () => window.clearTimeout(id);
  }, [note]);

  // The group shown under the nav follows the page, until the viewer opens another group.
  useEffect(() => setOpenGroup(null), [page]);

  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    writeMode(m);
    setFlippedFor(null);
    if (m === 'current') setNewPage(null);
  }, []);

  const goTo = useCallback(
    (p: PageKey) => {
      if (isCurrentView(p)) {
        setNewPage(null);
        chooseView(p);
      } else {
        setNewPage(p);
      }
    },
    [chooseView]
  );

  const flipped = flippedFor === page;
  const wantV2 = (mode === 'v2') !== flipped;
  const def = v2PageFor(page);

  const flip = useCallback(() => {
    if (newPage) {
      setNote('New page: there is no old version of it.');
      return;
    }
    setFlippedFor((f) => (f === page ? null : page));
  }, [newPage, page]);

  useEffect(() => {
    if (!keys) return;
    const onKey = (e: KeyboardEvent) => {
      if (isShortcutBlocked(e)) return;
      const k = e.key.toLowerCase();
      if (k === VERSION_KEY) {
        e.preventDefault();
        setMode(mode === 'v2' ? 'current' : 'v2');
      } else if (k === FLIP_KEY) {
        e.preventDefault();
        flip();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keys, mode, setMode, flip]);

  // Esc on a v2-only page goes back to the page underneath. Capture phase, so App's own Esc
  // (back to the previous screen) sees it spent and stands down.
  useEffect(() => {
    if (!keys || !newPage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isShortcutBlocked(e)) return;
      e.preventDefault();
      setNewPage(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [keys, newPage]);

  const fullCtx: V2Context = { ...ctx, goTo };
  const Page = def?.component;
  const body = Page && (newPage || wantV2) ? <Page ctx={fullCtx} /> : null;
  const showingNew = !!newPage || (wantV2 && !!def);

  const controls = (
    <span className="v2-controls" data-explain="v2-switch">
      <span className="v2-switch" role="group" aria-label="Version">
        {(['current', 'v2'] as const).map((m) => (
          <button
            key={m}
            type="button"
            className="v2-switch-btn"
            data-testid={`version-${m}`}
            aria-pressed={mode === m}
            aria-keyshortcuts="V"
            title="Switch the whole app between Current and v2 (V)"
            onClick={() => setMode(m)}
          >
            {m === 'current' ? 'Current' : 'v2'}
          </button>
        ))}
        <kbd className="v2-key">V</kbd>
      </span>
      <button
        type="button"
        className="pill-btn v2-flip"
        data-testid="flip"
        data-showing={showingNew ? 'new' : 'old'}
        aria-keyshortcuts="B"
        title="Flip this page between old and new, keeping the rig, selection and scroll (B)"
        onClick={flip}
      >
        Flip · B <span className="v2-flip-state">{showingNew ? 'new' : 'old'}</span>
      </button>
      {frozen && (
        <span
          className="v2-frozen"
          data-testid="frozen-badge"
          title={[
            'Frozen data: a recorded snapshot, not the live fleet. Nothing here updates.',
            ...(frozen.stripped ?? []).map((s) => `· ${s}`),
          ].join('\n')}
        >
          FROZEN: {frozen.name} · recorded {formatRecorded(frozen.recordedAt)}
        </span>
      )}
    </span>
  );

  const groups = navGroups();
  const shownGroup = openGroup ?? groupOf(page) ?? groups[0]?.key;
  const nav =
    mode === 'v2' ? (
      <nav className="v2-nav" aria-label="Screens (v2)" data-testid="v2-nav">
        <span className="v2-nav-groups" role="group" aria-label="Groups">
          {groups.map((g) => (
            <button
              key={g.key}
              type="button"
              className="view-tab"
              data-testid={`v2-group-${g.key}`}
              aria-pressed={shownGroup === g.key}
              aria-current={groupOf(page) === g.key ? 'true' : undefined}
              onClick={() => setOpenGroup(g.key)}
            >
              {g.label}
            </button>
          ))}
        </span>
        <span className="v2-nav-pages" role="group" aria-label="Pages">
          {groups
            .find((g) => g.key === shownGroup)
            ?.pages.map((p) => (
              <button
                key={p}
                type="button"
                className="v2-nav-page"
                data-testid={`v2-page-${p}`}
                aria-current={page === p ? 'page' : undefined}
                title={v2PageFor(p)?.blurb ?? `${navLabel(p)}: no v2 yet, shows Current's page`}
                onClick={() => goTo(p)}
              >
                {navLabel(p)}
                {!v2PageFor(p) && (
                  <span className="v2-nav-old" aria-label="no v2 yet">
                    {' '}
                    ·old
                  </span>
                )}
              </button>
            ))}
        </span>
      </nav>
    ) : null;

  const banner = (
    <>
      {frozen?.problem && (
        <p className="v2-note v2-note-warn" role="alert" data-testid="frozen-problem">
          Frozen snapshot: {frozen.problem}
        </p>
      )}
      {!newPage && wantV2 && !def && (
        <p className="v2-note" data-testid="v2-no-v2" role="status">
          <b>No v2 yet</b> for {navLabel(view)}: showing Current&apos;s page.
        </p>
      )}
      {note && (
        <p className="v2-note" data-testid="v2-flip-note" role="status">
          {note}
        </p>
      )}
    </>
  );

  return { mode, page, newPage, groupedNav: mode === 'v2', controls, nav, body, banner };
}
