import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { FleetMachine, QueueItem, Seat } from '@appydave/shared';
import {
  PIP,
  ago,
  blockedBecause,
  freshness,
  modelChip,
  pipFor,
  seatName,
  visibleTail,
  type TileRef,
} from '../../domain/fleet/model.js';
import FocusTerminal from '../../kit/FocusTerminal.js';
import AnsiText from '../../kit/AnsiText.js';
import { CopyAttach, HarnessMark, RoleTag, pctText, tokensText } from '../../kit/SeatCardLines.js';
import { attachLine } from '../../kit/WaitingOnDavid.js';
import {
  DocsLayout,
  FakeControl,
  MockMark,
  PageHeader,
  SampleData,
  SkillsPanel,
} from '../../kit/index.js';
import { allTiles, findTile, seatAddresses } from '../../domain/fleet/seats.js';
import type { PageContext, PageDef, PageProps } from '../../app/types.js';
import { isOpenRigSeat, sampleDetail, type SeatDetailView } from '../../domain/agent/detail.js';
import { useAgentData } from './useAgentData.js';
import './agent.css';

const RESUME_WHY =
  'The resume command holds a session id that AppyRig deliberately never carries, so this is a mock.';

function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="ar-agent-section" data-testid={`ar-agent-${id}`} aria-label={title}>
      <h3 className="ar-agent-h">{title}</h3>
      {note && <p className="quiet">{note}</p>}
      {children}
    </section>
  );
}

/** Real content, or the same section as labelled sample data. */
function MaybeSample({
  sample,
  title,
  what,
  children,
}: {
  sample: boolean;
  title: string;
  what: string;
  children: ReactNode;
}) {
  return sample ? (
    <SampleData title={title} what={what}>
      {children}
    </SampleData>
  ) : (
    <>
      <h3 className="ar-agent-h">{title}</h3>
      {children}
    </>
  );
}

function Picker({ ctx, current }: { ctx: PageContext; current: string }) {
  const tiles = useMemo(() => allTiles(ctx.allMachines), [ctx.allMachines]);
  const groups = useMemo(() => {
    const m = new Map<string, TileRef[]>();
    for (const t of tiles) {
      const k = `${t.machine.machine.label} · ${t.seat.rig ?? 'tmux sessions'}`;
      m.set(k, [...(m.get(k) ?? []), t]);
    }

    return [...m.entries()];
  }, [tiles]);

  return (
    <label className="rig-select ar-agent-picker">
      <span className="label">Agent</span>
      <select
        data-testid="ar-agent-picker"
        aria-label="Pick an agent"
        value={current}
        onChange={(e) => e.target.value && ctx.openAgentPage(e.target.value)}
      >
        {groups.map(([label, ts]) => (
          <optgroup key={label} label={label}>
            {ts.map((t) => (
              <option key={t.key} value={t.key}>
                {seatName(t.seat)} — {PIP[pipFor(t.seat, t.machine)].label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function Header({
  ctx,
  tile,
  ssh,
  noRig,
}: {
  ctx: PageContext;
  tile: TileRef;
  ssh: string | null | 'loading';
  /** The seat is in no rig, so there is no ssh address to ask for. */
  noRig: boolean;
}) {
  const { seat, machine } = tile;
  const pip = pipFor(seat, machine);
  const chip = modelChip(seat);
  const name = seatName(seat);
  const fresh = freshness(machine, ctx.now, ctx.hubConnected).label;
  const line = attachLine(seat.id, ssh === 'loading' ? null : ssh);

  return (
    <header className="ar-agent-head" data-testid="ar-agent-header" data-pip={pip}>
      <PageHeader
        title={name}
        titleTestId="ar-agent-name"
        facts={[
          <span key="state" className="state-badge" data-pip={pip} data-testid="ar-agent-state">
            {PIP[pip].glyph} {PIP[pip].label}
            {pip === 'blocked' ? ` · ${blockedBecause(seat)}` : ''}
          </span>,
          <span key="addr" className="ar-agent-address mono" data-testid="ar-agent-address">
            {seat.id}
          </span>,
        ]}
        actions={
          <>
            <Picker ctx={ctx} current={tile.key} />
            {line && <CopyAttach session={seat.id} ssh={ssh === 'loading' ? null : ssh} />}
          </>
        }
        mocks={
          <>
            <FakeControl
              label="Copy resume"
              question="Copy the resume command?"
              result="resume command copied (pretend)"
              workMs={400}
            />
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
            <FakeControl
              label="Handover"
              question={`Hand ${name} over to a fresh session?`}
              result={`${name} handed over (pretend)`}
            />
            <FakeControl
              label="Refocus"
              question={`Refocus ${name} on its mission?`}
              result={`${name} refocused (pretend)`}
            />
          </>
        }
      />
      <dl className="ar-agent-facts">
        <div>
          <dt>Rig</dt>
          <dd data-testid="ar-agent-rig">{seat.rig ?? 'none (plain tmux)'}</dd>
        </div>
        <div>
          <dt>Pod</dt>
          <dd data-testid="ar-agent-pod">{seat.pod ?? '—'}</dd>
        </div>
        <div>
          <dt>Member</dt>
          <dd data-testid="ar-agent-member">{seat.logicalId ?? name}</dd>
        </div>
        <div>
          <dt>Harness · model</dt>
          <dd>
            <HarnessMark runtime={seat.runtime} model={seat.model} />{' '}
            <span className="chip" data-family={chip.family} data-testid="ar-agent-model">
              {chip.text}
            </span>{' '}
            <RoleTag agentRole={seat.agentRole} />
          </dd>
        </div>
        <div>
          <dt>Context</dt>
          <dd className="mono" data-testid="ar-agent-context">
            {pctText(seat.contextUsedPct)} · {tokensText(seat.contextTokens)} tokens
          </dd>
        </div>
        <div>
          <dt>Machine</dt>
          <dd data-testid="ar-agent-machine">
            {machine.machine.label} <span className="quiet">{fresh}</span>
          </dd>
        </div>
        {seat.cwd && (
          <div>
            <dt>Folder</dt>
            <dd className="mono">{seat.cwd}</dd>
          </div>
        )}
      </dl>
      <div className="ar-agent-buttons ar-explainer">
        {line ? (
          ssh === null && (
            <span className="quiet">
              Run the attach line on {machine.machine.label} (
              {noRig ? 'no rig, so no ssh address' : 'no ssh address in AppyRig config'})
            </span>
          )
        ) : (
          <span className="quiet" data-testid="ar-agent-no-attach">
            No attach line: this session name has characters a shell would read.
          </span>
        )}
        <span className="quiet ar-agent-resume" data-testid="ar-agent-resume-why">
          Copy resume (in ⋯): {RESUME_WHY}
        </span>
      </div>
    </header>
  );
}

function Documents({ ctx, tile }: { ctx: PageContext; tile: TileRef }) {
  return (
    <Section id="documents" title="Documents">
      <div className="ar-agent-docs" data-testid="ar-agent-docs">
        <DocsLayout
          getSocket={ctx.getSocket}
          target={{ machineId: tile.machine.machine.id, seat: tile.seat }}
        />
      </div>
    </Section>
  );
}

function Skills({
  seat,
  loadout,
}: {
  seat: Seat;
  loadout: ReturnType<typeof useAgentData>['loadout'];
}) {
  const out = loadout.state === 'ok' ? loadout.value : null;
  const skills = out?.loadout?.skills ?? [];

  return (
    <Section id="skills" title="Skills">
      {loadout.state === 'loading' && <p className="quiet">Reading its skills…</p>}
      {loadout.state === 'refused' && (
        <p className="quiet">Could not read its skills: {loadout.error.failureMode}.</p>
      )}
      {out && skills.length === 0 && (
        <p className="quiet" data-testid="ar-agent-skills-none">
          {out.reason ?? 'No skill listing for this agent yet.'}
        </p>
      )}
      {skills.length > 0 && <SkillsPanel skills={skills} keySkills={seat.keySkills ?? []} />}
    </Section>
  );
}

function Messages({ tile, now }: { tile: TileRef; now: number }) {
  const { seat, machine } = tile;
  const mine = useMemo(() => seatAddresses(seat), [seat]);
  const [all, setAll] = useState(false);
  const rows: QueueItem[] = useMemo(
    () =>
      machine.snapshot.queue
        .filter((q) => mine.has(q.destination ?? '') || mine.has(q.source ?? ''))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [machine.snapshot.queue, mine]
  );
  const inbox = rows.filter((q) => mine.has(q.destination ?? ''));
  const outbox = rows.filter((q) => mine.has(q.source ?? '') && !mine.has(q.destination ?? ''));
  const cap = all ? Infinity : 6;
  const list = (items: QueueItem[], dir: 'in' | 'out') =>
    items.length === 0 ? (
      <p className="quiet">None.</p>
    ) : (
      items.slice(0, cap).map((q) => (
        <div className="qrow" key={q.id} data-testid={`ar-agent-msg-${dir}`}>
          <span>{q.summary || q.tags.join(', ') || q.id}</span>
          <span className="fresh">{q.state}</span>
          <span className="mono">
            {dir === 'in' ? `← ${q.source ?? '?'}` : `→ ${q.destination ?? '?'}`}
          </span>
          <span className="mono">{ago(now - Date.parse(q.updatedAt))} ago</span>
        </div>
      ))
    );

  return (
    <Section
      id="messages"
      title={`Messages · ${rows.length}`}
      note="Formal handoffs through the OpenRig queue."
    >
      <div className="ar-agent-cols">
        <div>
          <p className="label">In · {inbox.length}</p>
          {list(inbox, 'in')}
        </div>
        <div>
          <p className="label">Out · {outbox.length}</p>
          {list(outbox, 'out')}
        </div>
      </div>
      {!all && (inbox.length > 6 || outbox.length > 6) && (
        <button type="button" className="pill-btn" onClick={() => setAll(true)}>
          show all
        </button>
      )}
    </Section>
  );
}

function Peers({
  tile,
  detail,
  sample,
}: {
  tile: TileRef;
  detail: SeatDetailView;
  sample: boolean;
}) {
  const { seat, machine } = tile;
  const rig = seat.rig ? machine.snapshot.rigs.find((r) => r.name === seat.rig) : undefined;
  const edges = (rig?.edges ?? []).filter((e) => e.from === seat.id || e.to === seat.id);

  return (
    <Section id="peers" title="Works with">
      {edges.length > 0 ? (
        <ul data-testid="ar-agent-edges">
          {edges.map((e) => (
            <li key={`${e.from}>${e.to}>${e.kind}`} className="mono">
              {e.from === seat.id ? `${e.kind} → ${e.to}` : `${e.from} → ${e.kind}`}
            </li>
          ))}
        </ul>
      ) : (
        <MaybeSample
          sample={sample}
          title="Peers"
          what="The rig reported no planned lines for this agent, so these are its rig mates."
        >
          {detail.peers.length === 0 ? (
            <p className="quiet">No peers.</p>
          ) : (
            <ul>
              {detail.peers.map((p) => (
                <li key={p.session ?? p.logicalId} className="mono">
                  {p.session ?? p.logicalId}
                </li>
              ))}
            </ul>
          )}
        </MaybeSample>
      )}
    </Section>
  );
}

function Terminal({ seat }: { seat: Seat }) {
  const [open, setOpen] = useState(false);
  const preview = seat.tail ? visibleTail(seat.tail.lines, 4) : [];

  return (
    <Section id="terminal" title="Terminal">
      {preview.length > 0 && seat.tail && (
        <AnsiText
          className="ar-wall-term"
          testId="ar-agent-tail"
          lines={preview}
          ansi={seat.tail.ansi}
        />
      )}
      {!open ? (
        <button
          type="button"
          className="pill-btn"
          data-testid="ar-agent-terminal-open"
          onClick={() => setOpen(true)}
        >
          {seat.tail ? 'Show the full terminal' : 'Terminal (no text for this seat)'}
        </button>
      ) : seat.tail ? (
        <div data-testid="ar-agent-xterm">
          <FocusTerminal lines={visibleTail(seat.tail.lines, Infinity)} hidden={false} />
        </div>
      ) : (
        <p className="quiet">No terminal text for this seat.</p>
      )}
    </Section>
  );
}

function AgentBody({ ctx, tile }: { ctx: PageContext; tile: TileRef }) {
  const { seat, machine } = tile;
  const socket = ctx.getSocket();
  const data = useAgentData(socket, machine.machine.id, seat.id, seat.rig);
  const mates = machine.snapshot.seats.filter((s) => s.rig === seat.rig).map((s) => s.id);
  const notOpenRig = !isOpenRigSeat(seat) || data.detail.state === 'not-openrig';
  const sample = data.detail.state !== 'ok';
  const detail: SeatDetailView =
    data.detail.state === 'ok'
      ? data.detail.view
      : notOpenRig
        ? { spec: null, startupFiles: [], startupActions: [], peers: [], recoveryNotes: [] }
        : sampleDetail(seat, mates);
  const ssh =
    data.waiting.state === 'loading'
      ? 'loading'
      : data.waiting.state === 'ok'
        ? data.waiting.value.ssh
        : null;

  return (
    <>
      <Header ctx={ctx} tile={tile} ssh={ssh} noRig={data.waiting.state === 'na'} />
      <Documents ctx={ctx} tile={tile} />
      <div className="ar-agent-grid">
        <div className="ar-agent-col">
          <Skills seat={seat} loadout={data.loadout} />
        </div>
        <div className="ar-agent-col">
          <Messages tile={tile} now={ctx.now} />
          <Peers tile={tile} detail={detail} sample={sample && !notOpenRig} />
        </div>
      </div>
      <Terminal seat={seat} />
    </>
  );
}

/**
 * The agent shown when none is chosen: the best live Claude agent IN the chosen rig (the shared
 * choice), and only when that rig has none, the best one fleet-wide (an OpenRig Claude seat that is
 * up, in a running rig, with context in use). Within a pool, agents with messages (queue items in or
 * out) beat idle ones with none, then working or blocked, then the most recent activity. Plain
 * terminal and tmux seats come last; the final fallback is any seat, so the page is never blank.
 */
export function defaultAgent(machines: FleetMachine[], rigName: string | null): TileRef | null {
  const tiles = allTiles(machines);
  const up = (t: TileRef) =>
    pipFor(t.seat, t.machine) !== 'stopped' && pipFor(t.seat, t.machine) !== 'asleep';
  const rigRunning = (t: TileRef) =>
    t.seat.rig !== null &&
    t.machine.snapshot.rigs.some((r) => r.name === t.seat.rig && r.status === 'running');
  const claude = (t: TileRef) =>
    t.seat.runtime === 'claude-code' || /^claude-/.test(t.seat.model ?? '');
  const real = (t: TileRef) =>
    t.seat.source === 'openrig' &&
    claude(t) &&
    up(t) &&
    rigRunning(t) &&
    (t.seat.contextUsedPct ?? 0) > 0;
  const messages = (t: TileRef) => {
    const mine = seatAddresses(t.seat);

    return t.machine.snapshot.queue.filter(
      (q) => mine.has(q.destination ?? '') || mine.has(q.source ?? '')
    ).length;
  };
  const rank = (t: TileRef) => {
    const pip = pipFor(t.seat, t.machine);

    return (
      (messages(t) > 0 ? 0 : 4) +
      (pip === 'working' || pip === 'blocked' ? 0 : 2) +
      ((t.seat.contextUsedPct ?? 0) > 0 ? 0 : 1)
    );
  };
  const best = (list: TileRef[]) =>
    [...list].sort(
      (a, b) =>
        rank(a) - rank(b) ||
        messages(b) - messages(a) ||
        (b.seat.agentActivityAt ?? b.seat.lastActivityAt ?? '').localeCompare(
          a.seat.agentActivityAt ?? a.seat.lastActivityAt ?? ''
        )
    )[0];
  const inRig = (t: TileRef) => rigName !== null && t.seat.rig === rigName;

  return (
    best(tiles.filter((t) => inRig(t) && t.seat.source === 'openrig' && claude(t) && up(t))) ??
    best(tiles.filter(real)) ??
    best(tiles.filter((t) => up(t) && claude(t))) ??
    best(tiles.filter((t) => up(t) && t.seat.source === 'openrig')) ??
    tiles[0] ??
    null
  );
}

function AgentPage({ ctx }: PageProps) {
  const found = findTile(ctx.allMachines, ctx.agentKey);
  const fallback = defaultAgent(ctx.allMachines, ctx.activeRig?.name ?? null);
  // With no agent chosen, the first default is pinned once, so the page never jumps to another
  // agent as states change underneath it.
  const [auto, setAuto] = useState<string | null>(null);
  const { agentKey, openAgentPage } = ctx;
  useEffect(() => {
    if (!agentKey && !auto && fallback) {
      setAuto(fallback.key);
      openAgentPage(fallback.key);
    }
  }, [agentKey, auto, fallback, openAgentPage]);
  const missing = !!agentKey && !found;
  const tile = found ?? findTile(ctx.allMachines, auto) ?? fallback;
  const defaulted = !!tile && !!auto && tile.key === auto && !missing;

  return (
    <main className="view ar-agent" data-testid="ar-agent">
      {/* Navigation brief: the "new in v2" and mock lines live behind Legend · L, not above the
          header (the header's ⋯ carries the mock controls and their MockMark). */}
      <p className="quiet ar-agent-new ar-explainer" data-testid="ar-agent-new-note">
        New page: there is no V1 version of it. <MockMark label="mock" /> marks controls that change
        nothing.
      </p>
      {missing && (
        <p className="quiet" role="status" data-testid="ar-agent-gone">
          <b className="mono">{agentKey}</b> is no longer reported by its machine
          {tile ? `; showing ${tile.seat.id} instead.` : '.'}
        </p>
      )}
      {!tile ? (
        <p className="empty" data-testid="ar-agent-empty">
          No agents reported yet. Machines appear here as soon as their collector reports.
        </p>
      ) : (
        <AgentBody key={tile.key} ctx={ctx} tile={tile} />
      )}
      {tile && defaulted && (
        <p className="quiet" data-testid="ar-agent-default-note">
          No agent was chosen, so this is a Claude agent in a running rig with live data (
          {tile.seat.id}, {PIP[pipFor(tile.seat, tile.machine)].label}). Pick another above, or
          click any agent on the Wall.
        </p>
      )}
    </main>
  );
}

export const page: PageDef = {
  key: 'agent',
  label: 'Agent',
  group: 'agents',
  component: AgentPage,
  blurb: 'One page per agent: its documents (list and reader), skills, messages, terminal, attach.',
};
