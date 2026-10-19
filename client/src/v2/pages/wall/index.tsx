import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FleetMachine, Seat } from '@appydave/shared';
import {
  PIP,
  blockedLine,
  WALL_ORDER_TEXT,
  freshness,
  groupSeats,
  groupState,
  modelChip,
  pipFor,
  seatName,
  type PipKey,
  type WallGroup,
} from '../../../fleet/model.js';
import { useStableOrder } from '../../../lib/stableOrder.js';
import { groupRank } from '../../../fleet/model.js';
import { FakeControl, MockNote, PageHeader, WallCard } from '../../kit/index.js';
import { useUrlParam } from '../../shell/urlState.js';
import TeamPicker from './TeamPicker.js';
import './wall.css';
import type { V2PageDef, V2PageProps } from '../../types.js';
import {
  seatFlags,
  teamsOf,
  cardBody,
  machineCounts,
  orderByMachine,
  wallView,
  type SeatFlags,
  type WallFilter,
} from './model.js';

const MACHINE_ORDER_TEXT =
  'Order: by machine, as in the Rigs drawer · its rigs, then its plain tmux sessions, then its stopped rigs · stopped rigs collapsed';
const TEAMS_KEY = 'appyrig.v2.wallHiddenTeams';
// v2 keeps its own choice: switching it here never changes Current's Wall.
const STOPPED_KEY = 'appyrig.v2.hideStopped';
const OPEN_KEY = 'appyrig.v2.wallGroups';

function readSet(key: string): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // per-viewer convenience only
  }
}
function readOpen(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
function readHideStopped(): boolean {
  try {
    return localStorage.getItem(STOPPED_KEY) !== 'off';
  } catch {
    return true;
  }
}

const FILTERS: { id: WallFilter; label: string; hint: string }[] = [
  { id: 'all', label: 'All', hint: 'Every seat that passes the team and stopped choices' },
  {
    id: 'needs',
    label: 'Needs me',
    hint: 'Blocked: a permission prompt or a question is waiting for a person',
  },
  {
    id: 'stuck',
    label: 'Stuck',
    hint: 'OpenRig flags it for attention, a queue item is blocked, or work is waiting and the agent has done nothing for 10 minutes',
  },
  {
    id: 'failing',
    label: 'Failing',
    hint: 'Stopped while its rig is running, or stopped and flagged by OpenRig',
  },
];

const PIP_ORDER: PipKey[] = ['blocked', 'working', 'idle', 'unknown', 'stopped', 'asleep'];

function statusCounts(g: WallGroup): { pip: PipKey; n: number }[] {
  const n = new Map<PipKey, number>();
  for (const t of g.tiles) {
    const pip = pipFor(t.seat, t.machine);
    n.set(pip, (n.get(pip) ?? 0) + 1);
  }
  return PIP_ORDER.filter((p) => n.has(p)).map((pip) => ({ pip, n: n.get(pip)! }));
}

const flagWords = (f: SeatFlags) =>
  [f.needs && 'needs me', f.stuck && 'stuck', f.failing && 'failing'].filter(Boolean) as string[];

interface CardProps {
  tileKey: string;
  machine: FleetMachine;
  seat: Seat;
  now: number;
  /** The machine's freshness label ("live · 2s"). */
  fresh: string;
  /** The card body: open the agent (the panel over this page). */
  onOpen: (machineId: string, tileKey: string) => void;
  /** ⋯ → Documents: the same panel on its Documents tab. */
  onDocs: (machineId: string, tileKey: string) => void;
}

/**
 * One agent on the Wall: the kit's dark TerminalCard at its fixed `wall` size, so every card is the
 * same size whatever it holds (a long tail or address is clipped to one line). The ⋯ opens the mock
 * Restart / Stop in a popover over the card, never in its layout.
 */
const SeatCard = memo(function SeatCard({
  tileKey,
  machine,
  seat,
  now,
  fresh,
  onOpen,
  onDocs,
}: CardProps) {
  const [more, setMore] = useState(false);
  // The ⋯ popover closes on Escape or a click anywhere else, so it (and its tooltip) never lingers.
  useEffect(() => {
    if (!more) return;
    const away = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest(`[data-owner="${tileKey}"]`)) setMore(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMore(false);
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [more, tileKey]);
  const pip = pipFor(seat, machine);
  const chip = modelChip(seat);
  const name = seatName(seat);
  const flags = seatFlags(seat, machine, now);
  const body = cardBody(seat);
  return (
    <WallCard
      name={name}
      status={pip}
      address={seat.id}
      runtime={seat.runtime}
      model={seat.model}
      modelLabel={chip.text}
      modelFamily={chip.family}
      role={seat.agentRole}
      where={machine.machine.label}
      skillCount={seat.skillCount}
      lastTyped={body.lastTyped}
      fallbackLines={body.fallback}
      warning={pip === 'blocked' ? blockedLine(seat) : null}
      folder={body.folder}
      branch={body.branch}
      fresh={seat.status === 'stopped' ? `stopped · ${fresh}` : fresh}
      contextPct={seat.contextUsedPct}
      contextTokens={seat.contextTokens}
      queue={seat.work}
      onOpen={() => onOpen(machine.machine.id, tileKey)}
      ariaLabel={`${name}, ${PIP[pip].label}, ${seat.rig ?? 'tmux'} on ${machine.machine.label}: open the agent panel`}
      testId="v2-seat-card"
      dataAttrs={{
        'data-seat-key': tileKey,
        'data-seat-id': seat.id,
        'data-flags': flagWords(flags).join(',') || undefined,
      }}
      corner={
        <button
          type="button"
          className="v2w-more"
          data-testid="v2-card-more"
          data-owner={tileKey}
          aria-expanded={more}
          aria-label={`Documents, and mock actions for ${name}`}
          title={more ? undefined : 'Documents, or Restart / Stop (mocks: nothing is sent)'}
          onClick={() => setMore((m) => !m)}
        >
          {'\u22ef'}
        </button>
      }
      overlay={
        more ? (
          <div className="v2w-actions" data-testid="v2-card-actions" data-owner={tileKey}>
            <button
              type="button"
              className="pill-btn"
              data-testid="v2-card-docs"
              onClick={() => {
                setMore(false);
                onDocs(machine.machine.id, tileKey);
              }}
            >
              Documents
            </button>
            <FakeControl
              label="Restart"
              question={`Restart ${name} on ${machine.machine.label}?`}
              result={`${name} restarted (pretend)`}
            />
            <FakeControl
              label="Stop"
              question={`Stop ${name} on ${machine.machine.label}?`}
              result={`${name} stopped (pretend)`}
            />
          </div>
        ) : null
      }
    />
  );
});

function WallV2({ ctx }: V2PageProps) {
  const [filter, setFilter] = useState<WallFilter>('all');
  const [hideStopped, setHideStopped] = useState(readHideStopped);
  const [hiddenTeams, setHiddenTeams] = useState<Set<string>>(() => readSet(TEAMS_KEY));
  const [openAt, setOpenAt] = useState<Record<string, boolean>>(readOpen);
  const [over, setOver] = useState(false);
  // A card body opens the agent panel over the Wall; ⋯ → Documents opens it on its Documents tab.
  // Neither changes the page: only the panel's own link goes to the Agent page.
  const { openAgentPanel } = ctx;
  const onOpen = useCallback(
    (machineId: string, seatKey: string) => openAgentPanel({ machineId, seatKey }),
    [openAgentPanel]
  );
  const onDocs = useCallback(
    (machineId: string, seatKey: string) =>
      openAgentPanel({ machineId, seatKey, tab: 'documents' }),
    [openAgentPanel]
  );

  const teams = useMemo(() => teamsOf(ctx.machines), [ctx.machines]);
  const view = useMemo(
    () => wallView(ctx.machines, { hideStopped, hiddenTeams, filter }, ctx.now),
    [ctx.machines, hideStopped, hiddenTeams, filter, ctx.now]
  );
  const groups = useStableOrder(
    groupSeats(view.machines, 'rig'),
    (g) => g.key,
    (g) => String(groupRank(g)),
    over
  );

  // The order: by machine (the Rigs drawer's order, the default) or busiest first. Kept in the address
  // as `order=busy`; the default is left out of it.
  const [orderParam, setOrderParam] = useUrlParam('order');
  const busyFirst = orderParam === 'busy';
  const sections = useMemo(() => {
    if (busyFirst) return [{ machineId: '', label: '', groups }];
    const label = new Map(view.machines.map((m) => [m.machine.id, m.machine.label]));
    return orderByMachine(
      groups,
      view.machines.map((m) => m.machine.id),
      ctx.rigs.map((r) => r.key)
    ).map((m) => ({ ...m, label: label.get(m.machineId) ?? m.machineId }));
  }, [busyFirst, groups, view.machines, ctx.rigs]);

  const toggleTeam = (key: string) => {
    const next = new Set(hiddenTeams);
    if (!next.delete(key)) next.add(key);
    setHiddenTeams(next);
    writeJson(TEAMS_KEY, [...next]);
  };
  const setTeams = (keys: string[]) => {
    setHiddenTeams(new Set(keys));
    writeJson(TEAMS_KEY, keys);
  };
  const toggleStopped = () => {
    const next = !hideStopped;
    setHideStopped(next);
    try {
      localStorage.setItem(STOPPED_KEY, next ? 'on' : 'off');
    } catch {
      // per-viewer convenience only
    }
  };
  // A filtered Wall opens every group (the viewer asked to see them); otherwise quiet teams start closed.
  const isOpen = (g: WallGroup) =>
    openAt[g.key] ?? (filter !== 'all' || !['stopped', 'asleep'].includes(groupState(g)));
  const toggleGroup = (g: WallGroup) => {
    const next = { ...openAt, [g.key]: !isOpen(g) };
    setOpenAt(next);
    writeJson(OPEN_KEY, next);
  };
  const freshLabel = (m: FleetMachine) => freshness(m, ctx.now, ctx.hubConnected).label;
  const noSeats = ctx.received && teams.length === 0 && ctx.hidden.length === 0;

  // A rig picked in the Rigs drawer is never a no-op here: its group is scrolled to and outlined,
  // and "Only this rig" narrows the Wall to it. A repeat pick (focusNonce) focuses again.
  const root = useRef<HTMLElement>(null);
  const picked = ctx.pickedRig;
  const focusKey = picked?.key ?? null;
  const [only, setOnly] = useState(false);
  useEffect(() => setOnly(false), [focusKey]);
  const present = focusKey !== null && groups.some((g) => g.key === focusKey);
  useEffect(() => {
    if (!focusKey) return;
    setOpenAt((o) => (o[focusKey] === true ? o : { ...o, [focusKey]: true }));
    const go = () => {
      const el = root.current?.querySelector(
        `[data-group-key="${focusKey}"]`
      ) as HTMLElement | null;
      if (!el) return;
      // Leave room for what is stuck above the content: the shell's bar plus THIS page's header, whose
      // height changes (it wraps to two rows when the agent panel narrows the page). Measured now.
      const bar = document.querySelector('.app-header')?.getBoundingClientRect().height ?? 0;
      const head =
        root.current?.querySelector('[data-testid="v2-page-head"]')?.getBoundingClientRect()
          .height ?? 0;
      el.style.scrollMarginTop = `${Math.round(bar + head + 12)}px`;
      el.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    };
    // once the open group has laid out, and again after the page settles (the drawer closing reflows it)
    const id = requestAnimationFrame(() => requestAnimationFrame(go));
    const again = setTimeout(go, 500);
    return () => {
      cancelAnimationFrame(id);
      clearTimeout(again);
    };
  }, [focusKey, ctx.focusNonce]);
  const shownSections = (
    only && present
      ? sections.map((sec) => ({ ...sec, groups: sec.groups.filter((g) => g.key === focusKey) }))
      : sections
  ).filter((sec) => sec.groups.length > 0);

  return (
    <main
      ref={root}
      className="v2-wall"
      data-testid="v2-wall"
      aria-label="The Wall (v2)"
      onPointerEnter={() => setOver(true)}
      onPointerLeave={() => setOver(false)}
    >
      <PageHeader
        title="Wall"
        facts={[
          `${view.counts.all} agents`,
          view.stoppedHidden > 0 ? `${view.stoppedHidden} stopped hidden` : null,
        ].filter((f): f is string => f !== null)}
        actions={
          <span className="v2w-actions-row" role="group" aria-label="Wall filters">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className="pill-btn v2w-filter"
                data-testid={`v2-filter-${f.id}`}
                data-filter={f.id}
                aria-pressed={filter === f.id}
                title={f.hint}
                onClick={() => setFilter(f.id)}
              >
                {f.label} <b data-testid={`v2-filter-count-${f.id}`}>{view.counts[f.id]}</b>
              </button>
            ))}
            <span className="v2w-order-toggle" role="group" aria-label="Wall order">
              <span className="v2w-order-label">Order:</span>
              <button
                type="button"
                className="pill-btn"
                data-testid="v2w-order-machine"
                aria-pressed={!busyFirst}
                title="Machine by machine, in the Rigs drawer's order: its rigs, its plain tmux, its stopped rigs"
                onClick={() => setOrderParam(null)}
              >
                By machine
              </button>
              <button
                type="button"
                className="pill-btn"
                data-testid="v2w-order-busy"
                aria-pressed={busyFirst}
                title="One list, blocked first, then working, idle, unknown, stopped"
                onClick={() => setOrderParam('busy')}
              >
                Busiest first
              </button>
            </span>
            <button
              type="button"
              className="pill-btn"
              data-testid="v2-hide-stopped"
              aria-pressed={hideStopped}
              title="On: stopped seats are left off, except failing ones (down while their rig runs). Remembered for you."
              onClick={toggleStopped}
            >
              {hideStopped ? '\u25cf' : '\u25cb'} Hide stopped
            </button>
            {teams.length > 0 && (
              <TeamPicker
                teams={teams}
                hidden={hiddenTeams}
                onToggle={toggleTeam}
                onSet={setTeams}
              />
            )}
            {picked && (
              <button
                type="button"
                className="pill-btn v2w-only"
                data-testid="v2-only-rig"
                disabled={!present}
                title={
                  present
                    ? only
                      ? 'Showing only this rig: click to show every rig again'
                      : `Hide every other rig and show only ${picked.displayName ?? picked.name} (${picked.machineLabel})`
                    : `${picked.name} has no seat on the Wall right now (stopped seats hidden, a filter, or a team switched off)`
                }
                onClick={() => setOnly((o) => !o)}
              >
                {present
                  ? only
                    ? `Showing only ${picked.displayName ?? picked.name} \u00b7 \u00d7 show all`
                    : `Show only ${picked.displayName ?? picked.name}`
                  : `${picked.displayName ?? picked.name} \u00b7 ${picked.machineLabel}: not shown`}
              </button>
            )}
          </span>
        }
        mocks={
          <>
            <MockNote>Restart and Stop on the cards are mocks — nothing is sent</MockNote>
            <p className="quiet" data-testid="v2w-order">
              {busyFirst ? WALL_ORDER_TEXT : MACHINE_ORDER_TEXT}
            </p>
          </>
        }
      />
      {ctx.hidden.length > 0 && (
        <p className="filter-note" data-testid="v2-wall-hidden">
          Hidden by the machine filter:{' '}
          {ctx.hidden.map((m) => (
            <button
              key={m.id}
              type="button"
              className="pill-btn"
              onClick={() => ctx.onShowMachine(m.id)}
            >
              {'\u25cb'} {m.label} {'\u00b7'} show
            </button>
          ))}
        </p>
      )}
      {noSeats && (
        <p className="empty">
          No seats yet. Machines appear here as soon as their collector reports.
        </p>
      )}
      {ctx.received && !noSeats && groups.length === 0 && (
        <p className="empty" data-testid="v2-wall-none">
          {filter === 'all'
            ? 'No seats to show: every team is switched off, or all seats are stopped and hidden.'
            : `No seat is ${FILTERS.find((f) => f.id === filter)!.label.toLowerCase()} right now.`}
        </p>
      )}
      <div
        className="v2w-groups"
        data-testid="v2w-groups"
        data-order={busyFirst ? 'busy' : 'machine'}
      >
        {shownSections.map((sec) => (
          <div key={sec.machineId || 'all'} className="v2w-machine" data-testid="v2w-machine">
            {!busyFirst && (
              <h2 className="v2w-machine-head" data-testid="v2w-machine-head">
                {machineCounts(sec.label, sec.groups)}
              </h2>
            )}
            {sec.groups.map((g) => {
              const open = isOpen(g);
              const plain = !g.rig;
              const title = plain ? `No rig \u00b7 ${g.where}` : (g.rig?.displayName ?? g.name);
              const state = groupState(g);
              return (
                <section
                  key={g.key}
                  className="v2w-group"
                  data-testid="v2w-group"
                  data-group-key={g.key}
                  data-state={state}
                  data-frosted={['stopped', 'asleep', 'unknown'].includes(state) || undefined}
                  data-focused={g.key === focusKey || undefined}
                >
                  <button
                    type="button"
                    className="v2w-group-head"
                    data-testid="v2w-group-head"
                    aria-expanded={open}
                    onClick={() => toggleGroup(g)}
                  >
                    <span aria-hidden="true">{open ? '\u25be' : '\u25b8'}</span>
                    <b>{title}</b>
                    {!plain && <span className="v2w-where">{g.where}</span>}
                    {g.asleep && <span>{'\u00b7'} asleep</span>}
                    <span className="v2w-counts">
                      {statusCounts(g).map(({ pip, n }) => (
                        <span key={pip} data-pip={pip}>
                          {PIP[pip].glyph} {n} {PIP[pip].label}
                        </span>
                      ))}
                    </span>
                  </button>
                  <p className="v2w-summary" data-testid="v2w-summary">
                    {plain
                      ? 'plain tmux sessions, not part of an OpenRig rig'
                      : (g.rig?.summary ?? '\u00a0')}
                  </p>
                  {open && (
                    <div className="v2w-grid">
                      {g.tiles.map((t) => (
                        <SeatCard
                          key={t.key}
                          tileKey={t.key}
                          machine={t.machine}
                          seat={t.seat}
                          now={ctx.now}
                          fresh={freshLabel(t.machine)}
                          onOpen={onOpen}
                          onDocs={onDocs}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        ))}
      </div>
      <p className="v2w-notread quiet" data-testid="v2w-not-read">
        Reads the default tmux server on each machine only: a session on another tmux server, in
        herdr or in iTerm is not shown.
      </p>
    </main>
  );
}

export const page: V2PageDef = {
  key: 'wall',
  label: 'Wall',
  group: 'fleet',
  component: WallV2,
  blurb:
    'Every seat: team picker, Needs me / Stuck / Failing filters, roomy mono cards with full address, harness, model and context.',
};
