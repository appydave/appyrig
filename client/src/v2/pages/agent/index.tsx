import { useMemo, useState, type ReactNode } from 'react';
import type { FleetMachine, LoadoutLayer, QueueItem, Seat } from '@appydave/shared';
import { loadoutCounts } from '@appydave/shared';
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
} from '../../../fleet/model.js';
import FocusTerminal from '../../../components/FocusTerminal.js';
import AnsiText from '../../../components/AnsiText.js';
import MarkdownView from '../../../components/MarkdownView.js';
import YamlView from '../../../components/YamlView.js';
import {
  CopyAttach,
  HarnessMark,
  RoleTag,
  pctText,
  tokensText,
} from '../../../components/SeatCardLines.js';
import { attachLine } from '../../../components/WaitingOnDavid.js';
import { FakeControl, MockMark, SampleData } from '../../kit/index.js';
import { allTiles, findTile, seatAddresses } from '../../seats.js';
import type { V2Context, V2PageDef, V2PageProps } from '../../types.js';
import { sampleDetail, type SeatDetailView } from './detail.js';
import { useAgentData, useRigFile } from './useAgentData.js';

const LAYER_ORDER: LoadoutLayer['id'][] = [
  'role',
  'claude-md',
  'claude-local',
  'culture',
  'recap',
  'learned',
];
const LAYER_ABOUT: Record<LoadoutLayer['id'], string> = {
  role: 'Its role: the instructions OpenRig types into the agent.',
  'claude-md': "The agent's own CLAUDE.md.",
  'claude-local': 'CLAUDE.local.md, with the startup files merged in.',
  culture: "The team's culture file.",
  recap: 'A recap, if one was written.',
  learned: 'What this agent learned.',
};
const RESUME_WHY =
  'The resume command holds a session id that AppyRig deliberately never carries, so this is a mock.';

const kb = (n: number) =>
  n >= 10_240 ? `${Math.round(n / 1024)} KB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;

function DocView({ name, content }: { name: string; content: string }) {
  const [source, setSource] = useState(false);
  const isMd = /\.md$/i.test(name) || !/\.[a-z]+$/i.test(name);
  const isYaml = /\.ya?ml$/i.test(name);
  return (
    <div className="agent-doc-body" data-testid="v2a-doc-body" data-doc-name={name}>
      {isMd && (
        <button
          type="button"
          className="pill-btn"
          aria-pressed={source}
          onClick={() => setSource((v) => !v)}
        >
          {source ? 'Show formatted' : 'Show source'}
        </button>
      )}
      {isMd && !source ? (
        <MarkdownView source={content} />
      ) : isYaml ? (
        <YamlView source={content} />
      ) : (
        <pre className="md-code" tabIndex={0}>
          <code>{content}</code>
        </pre>
      )}
    </div>
  );
}

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
    <section className="v2a-section" data-testid={`v2a-${id}`} aria-label={title}>
      <h3 className="v2a-h">{title}</h3>
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
      <h3 className="v2a-h">{title}</h3>
      {children}
    </>
  );
}

function Picker({ ctx, current }: { ctx: V2Context; current: string }) {
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
    <label className="rig-select v2a-picker">
      <span className="label">Agent</span>
      <select
        data-testid="v2a-picker"
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
}: {
  ctx: V2Context;
  tile: TileRef;
  ssh: string | null | 'loading';
}) {
  const { seat, machine } = tile;
  const pip = pipFor(seat, machine);
  const chip = modelChip(seat);
  const name = seatName(seat);
  const fresh = freshness(machine, ctx.now, ctx.hubConnected).label;
  const line = attachLine(seat.id, ssh === 'loading' ? null : ssh);
  return (
    <header className="v2a-head" data-testid="v2a-header" data-pip={pip}>
      <div className="v2a-title">
        <h2 data-testid="v2a-name">{name}</h2>
        <span className="state-badge" data-pip={pip} data-testid="v2a-state">
          {PIP[pip].glyph} {PIP[pip].label}
          {pip === 'blocked' ? ` · ${blockedBecause(seat)}` : ''}
        </span>
        <Picker ctx={ctx} current={tile.key} />
      </div>
      <p className="v2a-address mono" data-testid="v2a-address">
        {seat.id}
      </p>
      <dl className="v2a-facts">
        <div>
          <dt>Rig</dt>
          <dd data-testid="v2a-rig">{seat.rig ?? 'none (plain tmux)'}</dd>
        </div>
        <div>
          <dt>Pod</dt>
          <dd data-testid="v2a-pod">{seat.pod ?? '—'}</dd>
        </div>
        <div>
          <dt>Member</dt>
          <dd data-testid="v2a-member">{seat.logicalId ?? name}</dd>
        </div>
        <div>
          <dt>Harness · model</dt>
          <dd>
            <HarnessMark runtime={seat.runtime} model={seat.model} />{' '}
            <span className="chip" data-family={chip.family} data-testid="v2a-model">
              {chip.text}
            </span>{' '}
            <RoleTag agentRole={seat.agentRole} />
          </dd>
        </div>
        <div>
          <dt>Context</dt>
          <dd className="mono" data-testid="v2a-context">
            {pctText(seat.contextUsedPct)} · {tokensText(seat.contextTokens)} tokens
          </dd>
        </div>
        <div>
          <dt>Machine</dt>
          <dd data-testid="v2a-machine">
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
      <div className="v2a-buttons">
        {line ? (
          <>
            <CopyAttach session={seat.id} ssh={ssh === 'loading' ? null : ssh} />
            {ssh === null && (
              <span className="quiet">
                run it on {machine.machine.label} (no ssh address in AppyRig config)
              </span>
            )}
          </>
        ) : (
          <span className="quiet" data-testid="v2a-no-attach">
            No attach line: this session name has characters a shell would read.
          </span>
        )}
        <span className="v2a-resume" title={RESUME_WHY}>
          <FakeControl
            label="Copy resume"
            question="Copy the resume command?"
            result="resume command copied (pretend)"
            workMs={400}
          />
          <span className="quiet" data-testid="v2a-resume-why">
            {RESUME_WHY}
          </span>
        </span>
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
      </div>
    </header>
  );
}

function Instructions({ layers, status }: { layers: LoadoutLayer[]; status: string }) {
  const present = [...layers]
    .filter((l) => l.present && l.content !== null)
    .sort((a, b) => LAYER_ORDER.indexOf(a.id) - LAYER_ORDER.indexOf(b.id));
  const [pick, setPick] = useState<string | null>(null);
  const shown = present.find((l) => l.id === pick) ?? present[0];
  const absent = layers.filter((l) => !(l.present && l.content !== null));
  return (
    <Section id="instructions" title="Instructions / role">
      {status === 'loading' && <p className="quiet">Reading its instructions…</p>}
      {status !== 'loading' && !shown && (
        <p className="quiet" data-testid="v2a-instructions-none">
          {status === 'refused'
            ? 'Could not read its instructions.'
            : 'No instruction files found for this agent yet.'}
        </p>
      )}
      {present.length > 1 && (
        <ul className="agent-doc-list">
          {present.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                className="agent-doc"
                aria-current={shown?.id === l.id ? 'true' : undefined}
                onClick={() => setPick(l.id)}
              >
                <b>{l.name}</b>
                <span className="files-about">{LAYER_ABOUT[l.id]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {shown && (
        <>
          <p className="label" data-testid="v2a-instructions-name">
            {shown.name} · {kb(shown.bytes ?? 0)}
            {shown.truncated ? ' · cut' : ''}
          </p>
          <DocView key={shown.id} name={shown.name} content={shown.content ?? ''} />
        </>
      )}
      {absent.length > 0 && present.length > 0 && (
        <p className="quiet">Not present: {absent.map((l) => l.name).join(' · ')}</p>
      )}
    </Section>
  );
}

function StartupFiles({
  view,
  sample,
  why,
}: {
  view: SeatDetailView;
  sample: boolean;
  why: string;
}) {
  const [at, setAt] = useState(0);
  const file = view.startupFiles[at] ?? view.startupFiles[0];
  return (
    <Section id="startup" title="Startup files">
      <MaybeSample
        sample={sample}
        title="Files sent at start"
        what={`${why}. File names follow OpenRig's layout; their texts are made up.`}
      >
        {view.spec && (
          <p className="mono" data-testid="v2a-spec">
            spec {view.spec.name ?? '—'}@{view.spec.version ?? '—'} · profile{' '}
            {view.spec.profile ?? '—'}
          </p>
        )}
        <ul className="agent-doc-list" data-testid="v2a-startup-list">
          {view.startupFiles.map((f, i) => (
            <li key={f.path}>
              <button
                type="button"
                className="agent-doc"
                data-testid="v2a-startup-file"
                aria-current={f === file ? 'true' : undefined}
                onClick={() => setAt(i)}
              >
                <b>{f.path}</b>
                <span className="files-sub">
                  {f.required ? 'required' : 'optional'}
                  {f.deliveryHint ? ` · ${f.deliveryHint}` : ''}
                  {f.appliesOn.length ? ` · on ${f.appliesOn.join(', ')}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {file &&
          (file.text !== null ? (
            <DocView key={file.path} name={file.path} content={file.text} />
          ) : (
            <p className="quiet">The text of this file was not sent.</p>
          ))}
      </MaybeSample>
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
  const skills = useMemo(() => out?.loadout?.skills ?? [], [out]);
  const counts = useMemo(() => loadoutCounts(skills), [skills]);
  const mine = skills.filter((s) => s.source === 'role' || s.source === 'repo');
  const rest = skills.filter((s) => s.source !== 'role' && s.source !== 'repo');
  return (
    <Section id="skills" title="Skills">
      {loadout.state === 'loading' && <p className="quiet">Reading its skills…</p>}
      {loadout.state === 'refused' && (
        <p className="quiet">Could not read its skills: {loadout.error.failureMode}.</p>
      )}
      {out && skills.length === 0 && (
        <p className="quiet" data-testid="v2a-skills-none">
          {out.reason ?? 'No skill listing for this agent yet.'}
        </p>
      )}
      {seat.keySkills && seat.keySkills.length > 0 && (
        <p data-testid="v2a-key-skills">
          <span className="label">Key</span>{' '}
          {seat.keySkills.map((s) => (
            <span key={s} className="seat-key-skill">
              {s.slice(s.lastIndexOf(':') + 1)}
            </span>
          ))}
        </p>
      )}
      {skills.length > 0 && (
        <>
          <p className="mono" data-testid="v2a-skills-count">
            {skills.length} listed ·{' '}
            {(['role', 'repo', 'personal', 'plugin', 'builtin', 'unplaced'] as const)
              .filter((k) => counts.bySource[k] > 0)
              .map((k) => `${counts.bySource[k]} ${k}`)
              .join(' · ')}
          </p>
          {mine.length > 0 && (
            <p className="v2a-chips" data-testid="v2a-role-skills">
              <span className="label">This team&rsquo;s own</span>{' '}
              {mine.map((s) => (
                <span key={s.name} className="seat-key-skill" title={s.source}>
                  {s.name}
                </span>
              ))}
            </p>
          )}
          {rest.length > 0 && (
            <details>
              <summary>The other {rest.length} (personal, plugin, built-in)</summary>
              <p className="v2a-chips">
                {rest.map((s) => (
                  <span key={s.name} className="seat-key-skill" title={s.source}>
                    {s.name}
                  </span>
                ))}
              </p>
            </details>
          )}
        </>
      )}
    </Section>
  );
}

function ParentDocs({
  ctx,
  tile,
  files,
}: {
  ctx: V2Context;
  tile: TileRef;
  files: ReturnType<typeof useAgentData>['files'];
}) {
  const { seat, machine } = tile;
  const list = files.state === 'ok' ? files.value.files : [];
  const [pick, setPick] = useState<string | null>(null);
  // The rig's MISSION.md is the first thing shown: the page is useful before anyone clicks.
  const first = list.find((f) => f.name === 'MISSION.md') ?? list[0];
  const shown = list.find((f) => f.id === pick) ?? first;
  const doc = useRigFile(ctx.getSocket(), machine.machine.id, seat.rig, shown?.id ?? null);
  return (
    <Section id="parent-docs" title={seat.rig ? `Parent docs · rig ${seat.rig}` : 'Parent docs'}>
      {!seat.rig && <p className="quiet">This agent is not part of a rig.</p>}
      {seat.rig && files.state === 'loading' && (
        <p className="quiet">Reading the rig&rsquo;s files…</p>
      )}
      {files.state === 'refused' && (
        <p className="quiet">Could not list the rig&rsquo;s files: {files.error.failureMode}.</p>
      )}
      {files.state === 'ok' && files.value.status !== 'ok' && (
        <p className="quiet" data-testid="v2a-rigfiles-status">
          {files.value.reason ?? 'No rig files are available for this rig yet.'}
        </p>
      )}
      {list.length > 0 && (
        <ul className="agent-doc-list" data-testid="v2a-rigfiles">
          {list.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                className="agent-doc"
                data-testid="v2a-rigfile"
                aria-current={shown?.id === f.id ? 'true' : undefined}
                onClick={() => setPick(f.id)}
              >
                <b>{f.name}</b>
                <span className="files-sub">
                  {f.scope === 'spec' ? 'team folder' : 'mission folder'} · {kb(f.bytes)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {doc?.state === 'loading' && <p className="quiet">Opening…</p>}
      {doc?.state === 'refused' && (
        <p className="quiet">Could not open it: {doc.error.failureMode}.</p>
      )}
      {doc?.state === 'ok' && (
        <>
          <p className="label" data-testid="v2a-parent-name">
            {doc.name} · {kb(doc.bytes)}
          </p>
          <DocView key={doc.name} name={doc.name} content={doc.content} />
        </>
      )}
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
        <div className="qrow" key={q.id} data-testid={`v2a-msg-${dir}`}>
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
      <div className="v2a-cols">
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
        <ul data-testid="v2a-edges">
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
        <AnsiText className="v2w-term" testId="v2a-tail" lines={preview} ansi={seat.tail.ansi} />
      )}
      {!open ? (
        <button
          type="button"
          className="pill-btn"
          data-testid="v2a-terminal-open"
          onClick={() => setOpen(true)}
        >
          {seat.tail ? 'Show the full terminal' : 'Terminal (no text for this seat)'}
        </button>
      ) : seat.tail ? (
        <div data-testid="v2a-xterm">
          <FocusTerminal lines={visibleTail(seat.tail.lines, Infinity)} hidden={false} />
        </div>
      ) : (
        <p className="quiet">No terminal text for this seat.</p>
      )}
    </Section>
  );
}

function AgentBody({ ctx, tile }: { ctx: V2Context; tile: TileRef }) {
  const { seat, machine } = tile;
  const socket = ctx.getSocket();
  const data = useAgentData(socket, machine.machine.id, seat.id, seat.rig);
  const mates = machine.snapshot.seats.filter((s) => s.rig === seat.rig).map((s) => s.id);
  const sample = data.detail.state !== 'ok';
  const detail: SeatDetailView =
    data.detail.state === 'ok' ? data.detail.view : sampleDetail(seat, mates);
  const why =
    data.detail.state === 'sample'
      ? data.detail.why
      : data.detail.state === 'loading'
        ? 'Asking seat.detail…'
        : '';
  const ssh =
    data.waiting.state === 'loading'
      ? 'loading'
      : data.waiting.state === 'ok'
        ? data.waiting.value.ssh
        : null;
  const layers = data.loadout.state === 'ok' ? (data.loadout.value.loadout?.layers ?? []) : [];
  return (
    <>
      <Header ctx={ctx} tile={tile} ssh={ssh} />
      <div className="v2a-grid">
        <div className="v2a-col">
          <Instructions layers={layers} status={data.loadout.state} />
          <StartupFiles view={detail} sample={sample} why={why} />
          <Skills seat={seat} loadout={data.loadout} />
        </div>
        <div className="v2a-col">
          <ParentDocs ctx={ctx} tile={tile} files={data.files} />
          <Messages tile={tile} now={ctx.now} />
          <Peers tile={tile} detail={detail} sample={sample} />
        </div>
      </div>
      <Terminal seat={seat} />
    </>
  );
}

/** The agent shown: the chosen one, else the first working or blocked seat of the chosen rig, else the first seat. */
export function defaultAgent(machines: FleetMachine[], rigName: string | null): TileRef | null {
  const tiles = allTiles(machines);
  const live = (t: TileRef) => ['working', 'blocked'].includes(pipFor(t.seat, t.machine));
  return (
    tiles.find((t) => t.seat.rig === rigName && live(t)) ?? tiles.find(live) ?? tiles[0] ?? null
  );
}

function AgentV2({ ctx }: V2PageProps) {
  const tile =
    findTile(ctx.allMachines, ctx.agentKey) ??
    defaultAgent(ctx.allMachines, ctx.activeRig?.name ?? null);
  return (
    <main className="view v2-agent" data-testid="v2-agent">
      <p className="quiet v2a-new" data-testid="v2a-new-note">
        New in v2: there is no old version of this page. <MockMark label="mock" /> marks controls
        that change nothing.
      </p>
      {!tile ? (
        <p className="empty" data-testid="v2a-empty">
          No agents reported yet. Machines appear here as soon as their collector reports.
        </p>
      ) : (
        <AgentBody key={tile.key} ctx={ctx} tile={tile} />
      )}
      {tile && !ctx.agentKey && (
        <p className="quiet">
          No agent chosen yet, so this is the first working one. Pick another above, or click any
          agent on the Wall.
        </p>
      )}
    </main>
  );
}

export const page: V2PageDef = {
  key: 'agent',
  label: 'Agent',
  group: 'agents',
  component: AgentV2,
  blurb:
    'One page per agent: role, startup files, skills, parent docs, messages, terminal, attach.',
};
