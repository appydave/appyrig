import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FleetMachine, SeatHistoryOutput } from '@appydave/shared';
import { callVerb } from '../fleet/coreCall.js';
import { modelChip, seatName } from '../fleet/model.js';
import type { FleetSocket } from '../fleet/useFleet.js';
import { consoleLines, rigQueue, type ConsoleKind } from '../fleet/views.js';

interface Props {
  machine: FleetMachine;
  rig: string;
  /** Replay time (ms). */
  at: number;
  socket?: FleetSocket;
}

const OPEN_KEY = 'appyrig.consoles.open';
const seatsKey = (rig: string) => `appyrig.consoles.${rig}`;
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
}: {
  name: string;
  model: string;
  family: string;
  lines: ReturnType<typeof consoleLines>;
  hist: Hist | undefined;
}) {
  const body = useRef<HTMLDivElement>(null);
  const shown = lines.slice(-VISIBLE_LINES);
  // Follow the replay: keep the newest line in view.
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
    <section className="console" data-testid="replay-console" data-seat={name}>
      <header data-explain="console">
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
 * The replay's consoles: pick seats, and each shows what it said and did up to the replay time.
 * Handoff messages always; the seat's own prompts, replies and tool calls when the collector sent
 * its transcript history (`seat.history`, read-only).
 */
export default function ReplayConsoles({ machine, rig, at, socket }: Props) {
  const seats = useMemo(
    () => machine.snapshot.seats.filter((s) => s.rig === rig),
    [machine.snapshot.seats, rig]
  );
  const items = useMemo(() => rigQueue(machine, rig), [machine, rig]);
  const [open, setOpen] = useState(() => read(OPEN_KEY) === 'on');
  const [chosen, setChosen] = useState<string[]>([]);
  const [hist, setHist] = useState<Record<string, Hist>>({});

  // Per rig: remember which consoles were open; default to the first two seats.
  useEffect(() => {
    const saved = read(seatsKey(rig));
    const names = seats.map(seatName);
    setChosen(saved ? saved.split(',').filter((n) => names.includes(n)) : names.slice(0, 2));
    setHist({});
  }, [rig, seats]);

  // Fetch each chosen seat's history once.
  useEffect(() => {
    if (!open || !socket) return;
    for (const name of chosen) {
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
  }, [open, chosen, socket, seats, machine.machine.id, hist]);

  const toggleOpen = () => {
    write(OPEN_KEY, open ? 'off' : 'on');
    setOpen(!open);
  };
  const toggleSeat = (name: string) => {
    const next = chosen.includes(name) ? chosen.filter((n) => n !== name) : [...chosen, name];
    setChosen(next);
    write(seatsKey(rig), next.join(','));
  };

  return (
    <div className="consoles" data-testid="replay-consoles" data-open={open}>
      <div className="consoles-bar">
        <button
          type="button"
          className="pill-btn"
          data-testid="consoles-toggle"
          aria-expanded={open}
          data-explain="console"
          onClick={toggleOpen}
        >
          {open ? '▾' : '▸'} Consoles
        </button>
        {open &&
          seats.map((s) => {
            const name = seatName(s);
            return (
              <button
                key={s.id}
                type="button"
                className="pill-btn console-chip"
                data-testid="console-chip"
                aria-pressed={chosen.includes(name)}
                onClick={() => toggleSeat(name)}
              >
                {name}
              </button>
            );
          })}
      </div>
      {open && (
        <div className="console-grid">
          {seats
            .filter((s) => chosen.includes(seatName(s)))
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
                  lines={consoleLines(name, rig, items, events, at)}
                />
              );
            })}
        </div>
      )}
    </div>
  );
}
