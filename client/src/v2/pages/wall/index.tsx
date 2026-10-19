import { memo, useMemo, useState } from 'react';
import type { FleetMachine, Seat } from '@appydave/shared';
import {
  PIP,
  blockedLine,
  WALL_ORDER_TEXT,
  groupSeats,
  groupState,
  modelChip,
  pipFor,
  seatName,
  type GroupBy,
  type PipKey,
  type WallGroup,
} from '../../../fleet/model.js';
import { useStableOrder } from '../../../lib/stableOrder.js';
import { groupRank } from '../../../fleet/model.js';
import { FakeControl, MockNote, TerminalCard, tailLine } from '../../kit/index.js';
import TeamPicker from './TeamPicker.js';
import './wall.css';
import type { V2PageDef, V2PageProps } from '../../types.js';
import { seatFlags, teamsOf, wallView, type SeatFlags, type WallFilter } from './model.js';

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
  onOpen: (key: string) => void;
}

/**
 * One agent on the Wall: the kit's dark TerminalCard at its fixed `wall` size, so every card is the
 * same size whatever it holds (a long tail or address is clipped to one line). The ⋯ opens the mock
 * Restart / Stop in a popover over the card, never in its layout.
 */
const SeatCard = memo(function SeatCard({ tileKey, machine, seat, now, onOpen }: CardProps) {
  const [more, setMore] = useState(false);
  const pip = pipFor(seat, machine);
  const chip = modelChip(seat);
  const name = seatName(seat);
  const flags = seatFlags(seat, machine, now);
  return (
    <TerminalCard
      size="wall"
      name={name}
      status={pip}
      address={seat.id}
      runtime={seat.runtime}
      model={seat.model}
      modelLabel={chip.text}
      modelFamily={chip.family}
      contextPct={seat.contextUsedPct}
      contextTokens={seat.contextTokens}
      tail={tailLine(seat.tail?.lines)}
      warning={pip === 'blocked' ? blockedLine(seat) : null}
      skills={seat.keySkills}
      skillCount={seat.skillCount}
      where={machine.machine.label}
      onOpen={() => onOpen(tileKey)}
      ariaLabel={`${name}, ${PIP[pip].label}, ${seat.rig ?? 'tmux'} on ${machine.machine.label}: open the agent page`}
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
          aria-expanded={more}
          aria-label={`Actions for ${name} (mocks)`}
          title="Restart / Stop (mocks: nothing is sent)"
          onClick={() => setMore((m) => !m)}
        >
          {'\u22ef'}
        </button>
      }
      overlay={
        more ? (
          <div className="v2w-actions" data-testid="v2-card-actions">
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
  const [groupBy, setGroupBy] = useState<GroupBy>(ctx.groupBy);
  // The header's Group control still works: when it changes, so does this page.
  const [seenHeader, setSeenHeader] = useState<GroupBy>(ctx.groupBy);
  if (seenHeader !== ctx.groupBy) {
    setSeenHeader(ctx.groupBy);
    setGroupBy(ctx.groupBy);
  }
  const [over, setOver] = useState(false);

  const teams = useMemo(() => teamsOf(ctx.machines), [ctx.machines]);
  const view = useMemo(
    () => wallView(ctx.machines, { hideStopped, hiddenTeams, filter }, ctx.now),
    [ctx.machines, hideStopped, hiddenTeams, filter, ctx.now]
  );
  const groups = useStableOrder(
    groupSeats(view.machines, groupBy),
    (g) => g.key,
    (g) => String(groupRank(g)),
    over
  );

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
  const noSeats = ctx.received && teams.length === 0 && ctx.hidden.length === 0;

  return (
    <main
      className="v2-wall"
      data-testid="v2-wall"
      aria-label="The Wall (v2)"
      onPointerEnter={() => setOver(true)}
      onPointerLeave={() => setOver(false)}
    >
      <MockNote>Restart and Stop on the cards are mocks — nothing is sent</MockNote>
      <div className="v2w-bar" role="group" aria-label="Filters">
        <div className="v2w-row" role="group" aria-label="Status filter">
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
          <span className="v2w-sep" aria-hidden="true" />
          <button
            type="button"
            className="pill-btn"
            data-testid="v2-hide-stopped"
            aria-pressed={hideStopped}
            title="On: stopped seats are left off, except failing ones (down while their rig runs). Remembered for you."
            onClick={toggleStopped}
          >
            {hideStopped ? '●' : '○'} Hide stopped
            {hideStopped && view.stoppedHidden > 0 ? ` · ${view.stoppedHidden} hidden` : ''}
          </button>
          <span className="v2w-sep" aria-hidden="true" />
          <span className="label">Group</span>
          {(['rig', 'machine'] as const).map((g) => (
            <button
              key={g}
              type="button"
              className="pill-btn"
              data-testid={`v2w-by-${g}`}
              aria-pressed={groupBy === g}
              onClick={() => setGroupBy(g)}
            >
              {g === 'rig' ? 'team' : 'machine'}
            </button>
          ))}
          {teams.length > 0 && (
            <>
              <span className="v2w-sep" aria-hidden="true" />
              <TeamPicker
                teams={teams}
                hidden={hiddenTeams}
                onToggle={toggleTeam}
                onSet={setTeams}
              />
            </>
          )}
        </div>
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
                ○ {m.label} · show
              </button>
            ))}
          </p>
        )}
      </div>
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
      {groups.length > 0 && (
        <p className="v2w-order quiet" data-testid="v2w-order">
          {WALL_ORDER_TEXT}
        </p>
      )}
      <div className="v2w-groups" data-testid="v2w-groups">
        {groups.map((g) => {
          const open = isOpen(g);
          const plain = !g.rig && groupBy === 'rig';
          const title = plain ? `No rig \u00b7 ${g.where}` : (g.rig?.displayName ?? g.name);
          return (
            <section
              key={g.key}
              className="v2w-group"
              data-testid="v2w-group"
              data-group-key={g.key}
              data-state={groupState(g)}
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
                {!plain && <span>{g.where}</span>}
                {plain && (
                  <span className="quiet">plain tmux sessions, not part of an OpenRig rig</span>
                )}
                {g.asleep && <span>{'\u00b7'} asleep</span>}
                <span className="v2w-counts">
                  {statusCounts(g).map(({ pip, n }) => (
                    <span key={pip} data-pip={pip}>
                      {PIP[pip].glyph} {n} {PIP[pip].label}
                    </span>
                  ))}
                </span>
              </button>
              {open && g.rig?.summary && <p className="v2w-summary">{g.rig.summary}</p>}
              {open && (
                <div className="v2w-grid">
                  {g.tiles.map((t) => (
                    <SeatCard
                      key={t.key}
                      tileKey={t.key}
                      machine={t.machine}
                      seat={t.seat}
                      now={ctx.now}
                      onOpen={ctx.openAgentPage}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
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
