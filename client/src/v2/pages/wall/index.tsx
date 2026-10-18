import { memo, useMemo, useState } from 'react';
import type { FleetMachine, Seat } from '@appydave/shared';
import {
  PIP,
  blockedLine,
  collapsedByDefault,
  contentTail,
  freshness,
  groupSeats,
  groupState,
  modelChip,
  pipFor,
  seatName,
  type GroupBy,
  type PipKey,
  type WallGroup,
} from '../../../fleet/model.js';
import AnsiText from '../../../components/AnsiText.js';
import { HarnessMark, RoleTag, pctText, tokensText } from '../../../components/SeatCardLines.js';
import SkillPill from '../../../components/SkillPill.js';
import { useStableOrder } from '../../../lib/stableOrder.js';
import { groupRank } from '../../../fleet/model.js';
import { FakeControl, MockNote } from '../../kit/index.js';
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
  fresh: string;
  onOpen: (key: string) => void;
  onOpenSkills: (key: string) => void;
}

/** The roomier mono card (C23, C43): full address, harness + model, context, queue, fake Restart / Stop. */
const SeatCard = memo(function SeatCard({
  tileKey,
  machine,
  seat,
  now,
  fresh,
  onOpen,
  onOpenSkills,
}: CardProps) {
  const [more, setMore] = useState(false);
  const pip = pipFor(seat, machine);
  const chip = modelChip(seat);
  const name = seatName(seat);
  const flags = seatFlags(seat, machine, now);
  const lines = seat.tail
    ? contentTail(seat.tail.lines, pip === 'working' || pip === 'blocked' ? 3 : 1)
    : [];
  const pct = seat.contextUsedPct;
  return (
    <article
      className="v2w-card"
      data-testid="v2-seat-card"
      data-seat-key={tileKey}
      data-seat-id={seat.id}
      data-pip={pip}
      data-flags={flagWords(flags).join(',') || undefined}
    >
      <header className="v2w-card-head">
        <button
          type="button"
          className="v2w-name"
          data-testid="v2-card-open"
          title="Open this agent's page"
          onClick={() => onOpen(tileKey)}
        >
          {name}
        </button>
        <span className="v2w-pip" data-pip={pip} data-testid="v2-card-pip">
          <span aria-hidden="true">{PIP[pip].glyph}</span> {PIP[pip].label}
        </span>
        <button
          type="button"
          className="v2w-more"
          data-testid="v2-card-more"
          aria-expanded={more}
          aria-label={`Actions for ${name} (mocks)`}
          title="Restart / Stop (mocks: nothing is sent)"
          onClick={() => setMore((m) => !m)}
        >
          ⋯
        </button>
      </header>
      <p className="v2w-address" data-testid="v2-card-address" title="Full mailbox address">
        {seat.id}
      </p>
      <p className="v2w-line">
        <HarnessMark runtime={seat.runtime} model={seat.model} />
        <span className="chip" data-family={chip.family} data-testid="v2-card-model">
          {chip.text}
        </span>
        <RoleTag agentRole={seat.agentRole} />
        <SkillPill count={seat.skillCount} onOpen={() => onOpenSkills(tileKey)} />
      </p>
      <p
        className="v2w-ctx"
        data-testid="v2-card-context"
        title="Context used, and tokens in the context"
      >
        <span className="v2w-ctx-label">context</span>
        <span className="v2w-ctx-bar" aria-hidden="true">
          <i
            style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }}
            data-high={(pct ?? 0) >= 80 || undefined}
          />
        </span>
        <b data-testid="v2-card-pct">{pctText(pct)}</b>
        <span data-testid="v2-card-tokens">{tokensText(seat.contextTokens)}</span>
      </p>
      {pip === 'blocked' && (
        <p className="v2w-why" data-testid="v2-card-why">
          ▲ {blockedLine(seat)}
        </p>
      )}
      {lines.length > 0 && seat.tail ? (
        <AnsiText className="v2w-term" testId="v2-card-tail" lines={lines} ansi={seat.tail.ansi} />
      ) : (
        <p className="v2w-term" data-empty="true">
          {seat.status === 'stopped' ? 'session stopped · no terminal' : 'no terminal text'}
        </p>
      )}
      <footer className="v2w-foot">
        <span>{machine.machine.label}</span>
        <span title="queue: pending / in progress / blocked">
          q {seat.work.pending}/{seat.work.inProgress}/{seat.work.blocked}
        </span>
        <span className="v2w-fresh">
          {seat.status === 'stopped' ? `stopped · ${fresh}` : fresh}
        </span>
      </footer>
      {more && (
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
      )}
    </article>
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
  const isOpen = (g: WallGroup) => openAt[g.key] ?? (filter !== 'all' || !collapsedByDefault(g));
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
      {groups.map((g) => {
        const open = isOpen(g);
        const fresh = freshness(
          g.tiles[0]?.machine ?? ctx.machines[0]!,
          ctx.now,
          ctx.hubConnected
        ).label;
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
              <span aria-hidden="true">{open ? '▾' : '▸'}</span>
              <b>{g.rig?.displayName ?? g.name}</b>
              <span>{g.where}</span>
              {g.asleep && <span>· asleep</span>}
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
                    fresh={fresh}
                    onOpen={ctx.openAgentPage}
                    onOpenSkills={ctx.onOpenSkills}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
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
