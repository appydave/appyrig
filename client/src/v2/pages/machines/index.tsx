import { gb } from '../../../fleet/health.js';
import { FakeControl, MockNote, SampleLabel } from '../../kit/index.js';
import type { V2PageDef, V2PageProps } from '../../types.js';
import {
  behindWords,
  latestIsStale,
  LATEST_OPENRIG,
  machineView,
  sampleLoad,
  type MachineView,
} from './model.js';
import '../w4.css';
import './machines.css';

const pct = (a: number | null, b: number | null) =>
  a === null || !b ? null : Math.round((a / b) * 100);

function Meter({
  label,
  used,
  total,
  testId,
}: {
  label: string;
  used: number | null;
  total: number | null;
  testId: string;
}) {
  const p = pct(used, total);
  return (
    <div className="mc2-meter" data-testid={testId}>
      <span className="mc2-meter-label">{label}</span>
      <span className="mc2-meter-bar" aria-hidden="true">
        <span
          style={{ width: `${p ?? 0}%` }}
          data-high={p !== null && p >= 80 ? true : undefined}
        />
      </span>
      <span className="mono mc2-meter-num">
        {used === null || total === null ? 'not read' : `${gb(used)} / ${gb(total)} · ${p}%`}
      </span>
    </div>
  );
}

function Card({ m, latestStale }: { m: MachineView; latestStale: boolean }) {
  const load = sampleLoad(m);
  return (
    <section
      className="w4-card mc2-card"
      data-testid="mc2-machine"
      data-liveness={m.liveness}
      data-version={m.version}
    >
      <header className="mc2-head">
        <b className="mc2-name">{m.label}</b>
        <span className="quiet">{m.liveness}</span>
        <span
          className="mc2-pressure"
          data-kind={m.pressure.kind}
          title={m.pressure.basis ?? m.pressure.reason ?? ''}
          data-testid="mc2-pressure"
        >
          {m.pressure.glyph} {m.pressure.word}
        </span>
      </header>
      <Meter label="memory" used={m.memUsed} total={m.memTotal} testId="mc2-mem" />
      <p
        className="mc2-free"
        data-testid="mc2-free"
        title="macOS's own estimate (the memory_pressure command): memory it could hand out right now, counting free pages plus pages it can reclaim (inactive, purgeable, file cache). It is not total minus used, so it can read high while memory used is high too."
      >
        <span className="mc2-meter-label">could be freed</span>{' '}
        <b className="mono">{m.freePct === null ? '—' : `${Math.round(m.freePct)}%`}</b>{' '}
        <span className="quiet">
          macOS estimate
          {m.freePct !== null && pct(m.memUsed, m.memTotal) !== null
            ? `: ${pct(m.memUsed, m.memTotal)}% used, ${Math.round(m.freePct)}% could be freed`
            : ''}
        </span>
      </p>
      <Meter label="swap" used={m.swapUsed} total={m.swapTotal} testId="mc2-swap" />
      <dl className="w4-stats mono">
        <div>
          <dt>claude processes</dt>
          <dd>{m.claude ?? '—'}</dd>
        </div>
        <div>
          <dt>tmux sessions</dt>
          <dd>{m.tmux ?? '—'}</dd>
        </div>
        <div>
          <dt>shells</dt>
          <dd>{m.shells ?? '—'}</dd>
        </div>
        <div>
          <dt>rigs · seats</dt>
          <dd>
            {m.rigs} · {m.seats}
          </dd>
        </div>
        <div>
          <dt>
            load 1/5/15 <SampleLabel />
          </dt>
          <dd data-testid="mc2-load">{load.map((x) => x.toFixed(2)).join(' ')}</dd>
        </div>
      </dl>
      {m.apps.length > 0 && (
        <p className="quiet mc2-apps">
          terminal apps:{' '}
          {m.apps.map((a) => `${a.app} ×${a.processes} (${gb(a.rssBytes)})`).join(' · ')}
        </p>
      )}
      <div className="mc2-versions">
        <div>
          <span className="quiet">OpenRig</span>{' '}
          <b className="mono" data-testid="mc2-openrig">
            {m.openrig ?? 'not reported'}
          </b>{' '}
          <span className="mc2-vstate" data-state={m.version} data-testid="mc2-vstate">
            {m.version === 'behind' ? '▲ ' : m.version === 'current' ? '● ' : ''}
            {latestStale
              ? `latest release not rechecked since ${LATEST_OPENRIG.readOn}`
              : behindWords(m.openrig, LATEST_OPENRIG.version)}
          </span>
          {!m.openrigOk && <span className="quiet"> · daemon not answering</span>}
        </div>
        <div>
          <span className="quiet">collector</span> <b className="mono">{m.collector}</b>
        </div>
        {m.version === 'behind' && (
          <FakeControl
            label="Upgrade OpenRig"
            question={`Upgrade OpenRig on the ${m.label} from ${m.openrig} to ${LATEST_OPENRIG.version}?`}
            result={`${m.label} upgraded to ${LATEST_OPENRIG.version} (pretend): nothing changed`}
          />
        )}
      </div>
    </section>
  );
}

/**
 * v2 Machines: one card per machine. Memory and swap as meters, the pressure verdict (the worse of
 * macOS memory pressure and swap use), processes, and the OpenRig and collector versions against
 * the latest OpenRig release (C21). Load and the latest release are sample data, labelled.
 */
function MachinesV2({ ctx }: V2PageProps) {
  const views = ctx.machines.map((fm) => machineView(fm, ctx.now));
  const versions = [...new Set(views.map((v) => v.openrig).filter(Boolean))];
  const behind = views.filter((v) => v.version === 'behind').length;
  const latestStale = latestIsStale(ctx.now);
  return (
    <main className="view w4-page" data-testid="v2-machines">
      <p className="mc2-watch" data-testid="mc2-watch">
        OpenRig on the fleet <b className="mono">{versions.join(', ') || 'not reported'}</b> ·
        latest release{' '}
        <b className="mono" data-testid="mc2-latest">
          {LATEST_OPENRIG.version}
        </b>
        , {LATEST_OPENRIG.source}, as of {LATEST_OPENRIG.readOn} <SampleLabel />
        <span className="quiet">
          {latestStale
            ? ' · not rechecked for over 7 days, so no machine is compared'
            : behind
              ? ` · ${behind} of ${views.length} behind by that sample`
              : ' · all current by that sample'}{' '}
          (AppyRig does not check npm yet)
        </span>
      </p>
      {behind > 0 && !latestStale && <MockNote />}
      <div className="mc2-grid">
        {views.map((m) => (
          <Card key={m.id} m={m} latestStale={latestStale} />
        ))}
      </div>
      {ctx.hidden.length > 0 && (
        <p className="quiet">{ctx.hidden.length} machine(s) hidden by your filter.</p>
      )}
    </main>
  );
}

export const page: V2PageDef = {
  key: 'machines',
  label: 'Machines',
  group: 'fleet',
  component: MachinesV2,
  blurb:
    'Memory, swap, pressure and processes per machine; OpenRig version against the latest release.',
};
