// The replay consoles on the Handoff Flow page: they follow the replay step.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FleetMachine, SeatHistoryOutput } from '@appydave/shared';
import { callVerb } from '../../domain/fleet/coreCall.js';
import { modelChip, seatName } from '../../domain/fleet/model.js';
import type { FleetSocket } from '../../domain/fleet/useFleet.js';
import { consoleLines, rigQueue, type ConsoleKind } from '../../domain/fleet/views.js';

interface Props {
  machine: FleetMachine;
  rig: string;
  /** Replay time (ms). */
  at: number;
  socket?: FleetSocket;
  /**
   * The seats of the handoff the replay is on (sender, receiver; this rig's only). While following,
   * these are the consoles shown; empty keeps whatever was last followed.
   */
  follow: string[];
}

const OPEN_KEY = 'appyrig.v2.consoles.open';
const VISIBLE_LINES = 80;

const GLYPH: Record<ConsoleKind, string> = {
  received: '←',
  sent: '→',
  prompt: '▸',
  reply: '◂',
  tool: '⚙',
};

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v);
  } catch {
    // per-viewer convenience only
  }
};

type Hist = { state: 'loading' } | { state: 'ok'; value: SeatHistoryOutput } | { state: 'none' };

function Pane({
  name,
  model,
  family,
  lines,
  hist,
  current,
}: {
  name: string;
  model: string;
  family: string;
  lines: ReturnType<typeof consoleLines>;
  hist: Hist | undefined;
  current: boolean;
}) {
  const body = useRef<HTMLDivElement>(null);
  const shown = lines.slice(-VISIBLE_LINES);
  const newest = shown.at(-1)?.at;
  useLayoutEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, newest]);
  const source =
    hist?.state === 'ok' && hist.value.available
      ? `transcript + handoffs${hist.value.truncated ? ' · earliest dropped' : ''}`
      : hist?.state === 'loading'
        ? 'loading…'
        : 'handoffs only · no transcript for this seat';
  return (
    <section
      className="console"
      data-testid="replay-console"
      data-seat={name}
      data-current={current || undefined}
    >
      <header>
        <b>{name}</b>
        <span className="chip" data-family={family}>
          {model}
        </span>
        <span className="console-src">{source}</span>
      </header>
      <div className="console-body" ref={body}>
        {shown.length === 0 && <p className="quiet">Nothing yet at this point in the run.</p>}
        {shown.map((l, i) => (
          <p key={`${l.at}-${i}`} className="console-line" data-kind={l.kind}>
            <time>{new Date(l.at).toLocaleTimeString(undefined, { hour12: false })}</time>
            <span className="console-glyph">{GLYPH[l.kind]}</span>
            <span>{l.text}</span>
          </p>
        ))}
      </div>
    </section>
  );
}

/**
 * v2 replay consoles (UX notes 2026-10-19, Screen 8: "I don't understand why you start with two
 * consoles"). One visible rule: by default they FOLLOW the handoff (its sender and receiver are
 * open); clicking a seat PINS the set by hand, and "Follow the handoff" goes back. The mode is
 * always written on screen.
 */
export default function ReplayConsoles({ machine, rig, at, socket, follow }: Props) {
  const seats = useMemo(
    () => machine.snapshot.seats.filter((s) => s.rig === rig),
    [machine.snapshot.seats, rig]
  );
  const items = useMemo(() => rigQueue(machine, rig), [machine, rig]);
  const [open, setOpen] = useState(() => read(OPEN_KEY) !== 'off');
  const [pinned, setPinned] = useState<string[] | null>(null);
  const [lastFollow, setLastFollow] = useState<string[]>([]);
  const [hist, setHist] = useState<Record<string, Hist>>({});
  const names = useMemo(() => seats.map(seatName), [seats]);
  const followKey = follow.filter((n) => names.includes(n)).join(',');
  // Remember the last handoff followed, so the consoles do not empty between steps.
  useEffect(() => {
    if (followKey) setLastFollow(followKey.split(','));
  }, [followKey]);
  // A new rig starts following again.
  useEffect(() => {
    setPinned(null);
    setLastFollow([]);
    setHist({});
  }, [rig]);
  const shown = pinned ?? lastFollow;

  useEffect(() => {
    if (!open || !socket) return;
    for (const name of shown) {
      if (hist[name]) continue;
      const seat = seats.find((s) => seatName(s) === name);
      if (!seat) continue;
      setHist((h) => ({ ...h, [name]: { state: 'loading' } }));
      void callVerb<SeatHistoryOutput>(socket, 'seat.history', {
        machine: machine.machine.id,
        seat: seat.id,
      }).then((a) =>
        setHist((h) => ({
          ...h,
          [name]: a.ok ? { state: 'ok', value: a.value } : { state: 'none' },
        }))
      );
    }
  }, [open, shown, socket, seats, machine.machine.id, hist]);

  const toggleOpen = () => {
    write(OPEN_KEY, open ? 'off' : 'on');
    setOpen(!open);
  };
  const toggleSeat = (name: string) => {
    const base = pinned ?? lastFollow;
    setPinned(base.includes(name) ? base.filter((n) => n !== name) : [...base, name]);
  };

  return (
    <div
      className="consoles ar-consoles"
      data-testid="replay-consoles"
      data-open={open}
      data-mode={pinned ? 'pinned' : 'following'}
    >
      <div className="consoles-bar">
        <button
          type="button"
          className="pill-btn"
          data-testid="consoles-toggle"
          aria-expanded={open}
          onClick={toggleOpen}
        >
          {open ? '▾' : '▸'} Consoles
        </button>
        {open && (
          <>
            <span className="ar-console-mode" data-testid="console-mode">
              {pinned
                ? 'pinned: the seats you picked'
                : 'following the handoff: its sender and receiver'}
            </span>
            {seats.map((s) => {
              const name = seatName(s);
              return (
                <button
                  key={s.id}
                  type="button"
                  className="pill-btn console-chip"
                  data-testid="console-chip"
                  aria-pressed={shown.includes(name)}
                  title={pinned ? 'Show or hide this console' : 'Pin: pick the consoles by hand'}
                  onClick={() => toggleSeat(name)}
                >
                  {name}
                </button>
              );
            })}
            {pinned && (
              <button
                type="button"
                className="pill-btn"
                data-testid="console-follow"
                onClick={() => setPinned(null)}
              >
                Follow the handoff
              </button>
            )}
          </>
        )}
      </div>
      {open && (
        <div className="console-grid">
          {shown.length === 0 && (
            <p className="quiet" data-testid="console-none">
              Step or replay the run: the consoles open on the handoff&apos;s two seats.
            </p>
          )}
          {seats
            .filter((s) => shown.includes(seatName(s)))
            .map((s) => {
              const name = seatName(s);
              const h = hist[name];
              const events = h?.state === 'ok' && h.value.available ? h.value.events : null;
              const chip = modelChip(s);
              return (
                <Pane
                  key={s.id}
                  name={name}
                  model={chip.text}
                  family={chip.family}
                  hist={h}
                  current={!pinned || followKey.split(',').includes(name)}
                  lines={consoleLines(name, rig, items, events, at)}
                />
              );
            })}
        </div>
      )}
    </div>
  );
}
