import { useEffect, useState } from 'react';
import type { FleetMachine, HealthFindingsOutput, SettingsGetOutput } from '@appydave/shared';
import { callVerb } from '../../domain/fleet/coreCall.js';
import { FakeControl, SampleData } from '../../kit/index.js';
import type { PageDef, PageProps } from '../../app/types.js';
import {
  contextRollup,
  coverageLine,
  daemonReach,
  HEALTH_REFRESH_MS,
  reconcile,
  sampleFindings,
  staleWords,
  thresholdsFor,
  verdictFor,
  type HealthFindingsMachine,
} from '../../domain/health/model.js';
import '../w5b.css';
import '../../kit/data/coverage.css';

type Loaded =
  | { state: 'loading' }
  | { state: 'ok'; out: HealthFindingsOutput }
  | { state: 'refused'; why: string };

const when = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

function MachineHealth({
  fm,
  row,
  refusal,
  missing,
  stale,
  settings,
}: {
  fm: FleetMachine;
  row: HealthFindingsMachine | undefined;
  refusal: string | null;
  missing: boolean;
  stale: string | null;
  settings: SettingsGetOutput['machines'][number] | undefined;
}) {
  const v = verdictFor(row, { refusal, missing, stale });
  const d = row?.data ?? null;
  const t = thresholdsFor(d, settings);
  const ctx = contextRollup(fm, t);
  const reach = daemonReach(fm);
  const asOf = when(row?.collectedAt);
  const theirs = reconcile(ctx, d?.contextSummary);
  const diagnosisOff = d?.policy?.diagnosisEnabled !== true;
  return (
    <section className="x2-card hl2-machine" data-testid="hl2-machine" data-verdict={v.kind}>
      <header className="hl2-head">
        <b className="hl2-name">{fm.machine.label}</b>
        <span
          className="hl2-verdict"
          data-kind={v.kind}
          data-stale={stale ? true : undefined}
          data-testid="hl2-verdict"
        >
          {v.glyph} {v.headline}
        </span>
        {asOf && (
          <span className="quiet mono" data-testid="hl2-asof">
            as of {asOf}
          </span>
        )}
      </header>
      {v.reasons.length > 0 && (
        <ul className="hl2-reasons" data-testid="hl2-reasons">
          {v.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}

      {v.kind === 'findings' && d?.findings && (
        <table className="x2-table" data-testid="hl2-findings">
          <thead>
            <tr>
              <th>severity</th>
              <th>detector</th>
              <th>what it found</th>
              <th>when</th>
            </tr>
          </thead>
          <tbody>
            {d.findings.map((f) => (
              <tr key={f.id} data-testid="hl2-finding">
                <td className="hl2-sev" data-sev={f.severity ?? undefined}>
                  {f.severity ?? '—'}
                </td>
                <td className="mono">{f.detector ?? '—'}</td>
                <td>{f.summary ?? f.id}</td>
                <td className="mono">{f.evaluatedAt ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {v.kind === 'cannot-tell' && (
        <SampleData
          title="What findings will look like here"
          what={`Made up from ${fm.machine.label}'s real rig and seat names, because no real findings could be read.`}
        >
          <ul className="hl2-sample" data-testid="hl2-sample">
            {sampleFindings(fm).map((f) => (
              <li key={f.detector}>
                <span className="hl2-sev" data-sev={f.severity}>
                  {f.severity}
                </span>{' '}
                <span className="mono">{f.detector}</span> · {f.summary}
              </li>
            ))}
          </ul>
        </SampleData>
      )}

      <dl className="hl2-facts">
        <div>
          <dt>daemon</dt>
          <dd data-testid="hl2-daemon" data-ok={reach.ok}>
            {reach.ok ? '● ' : '■ '}
            {reach.words}
            {d?.daemon?.eventLoopLagP99Ms != null &&
              ` · event-loop lag p99 ${Math.round(d.daemon.eventLoopLagP99Ms)} ms`}
          </dd>
        </div>
        <div>
          <dt>coverage</dt>
          <dd>{d ? coverageLine(d) : 'not read'}</dd>
        </div>
        <div>
          <dt>diagnosis</dt>
          <dd data-testid="hl2-diagnosis">
            {d?.policy == null
              ? 'policy not read: cannot tell whether detectors run'
              : d.policy.diagnosisEnabled === true
                ? `on · ${d.policy.detectors.length} detectors${d.policy.disabledDetectors.length ? `, ${d.policy.disabledDetectors.length} disabled (${d.policy.disabledDetectors.join(', ')})` : ''}`
                : d.policy.diagnosisEnabled === false
                  ? 'off: scheduled detectors do not run'
                  : 'the policy does not say'}
            {diagnosisOff && (
              <>
                {' '}
                <FakeControl
                  label="Enable diagnosis"
                  question={`Turn on OpenRig diagnosis on the ${fm.machine.label}?`}
                  result={`diagnosis enabled on the ${fm.machine.label} (pretend): nothing changed`}
                />
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>restore check</dt>
          <dd data-testid="hl2-restore">
            {d?.restore
              ? `${d.restore.verdict ?? '—'} · ${d.restore.green ?? 0} green · ${d.restore.yellow ?? 0} yellow · ${d.restore.red ?? 0} red`
              : 'not read'}
          </dd>
        </div>
        <div>
          <dt>context pressure</dt>
          <dd data-testid="hl2-context" data-level={ctx.level}>
            {stale && <span className="hl2-stale">{stale}: </span>}
            {ctx.level === 'unmeasured' ? (
              <span data-level="unmeasured">
                not measured:{' '}
                {ctx.live
                  ? `none of ${ctx.live} running seats reports its context`
                  : 'no running seats'}
              </span>
            ) : (
              <>
                <span data-level={ctx.level}>
                  {ctx.critical} at {t.critical}%+ · {ctx.warning} at {t.warning}–{t.critical}%
                </span>{' '}
                <span className="quiet">
                  of {ctx.read} seat{ctx.read === 1 ? '' : 's'} with a reading
                  {ctx.unread ? ` (${ctx.unread} of ${ctx.live} not reported)` : ''}
                </span>
              </>
            )}
            <span className="quiet" data-testid="hl2-thresholds">
              {' '}
              · thresholds{' '}
              {t.source === 'assumed'
                ? `assumed default ${t.critical}/${t.warning}`
                : `${t.critical}/${t.warning} from ${t.source === 'policy' ? 'the health policy' : 'its settings'}`}
            </span>
            {ctx.top.length > 0 && (
              <span className="hl2-top">
                {' '}
                · fullest:{' '}
                {ctx.top.map((s, i) => (
                  <span key={`${s.name}@${s.rig}`} className="mono">
                    {i > 0 && ', '}
                    {s.name}
                    {s.rig ? `@${s.rig}` : ''} {Math.round(s.pct)}%
                  </span>
                ))}
              </span>
            )}
            {theirs && (
              <span className="quiet" data-testid="hl2-reconcile">
                {' '}
                · {theirs}
              </span>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

/**
 * v2 Health (gap #2): per machine, OpenRig's health findings with the coverage and policy that say
 * what an empty list means; an empty list is never read as all-clear on its own. Next to it, what
 * AppyRig reads itself: context pressure from the seats, the restore check, and whether the daemon
 * answers. Asked again every minute.
 */
function HealthPage({ ctx }: PageProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [settings, setSettings] = useState<SettingsGetOutput | null>(null);
  useEffect(() => {
    let live = true;
    const ask = () => {
      void callVerb<HealthFindingsOutput>(ctx.getSocket(), 'health.findings', {}).then((a) => {
        if (!live) return;
        setLoaded(
          a.ok ? { state: 'ok', out: a.value } : { state: 'refused', why: a.error.message }
        );
      });
      // The machine's own context thresholds, for when its health policy does not carry them.
      void callVerb<SettingsGetOutput>(ctx.getSocket(), 'settings.get', {
        key: 'health.context_pressure.',
      }).then((a) => {
        if (live && a.ok) setSettings(a.value);
      });
    };
    ask();
    const t = setInterval(ask, HEALTH_REFRESH_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
    // the getter is stable for the page's life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const refusal = loaded.state === 'refused' ? loaded.why : null;
  const rowOf = (id: string) =>
    loaded.state === 'ok' ? loaded.out.machines.find((m) => m.machine === id) : undefined;
  return (
    <main className="view x2-page" data-testid="ar-health">
      <div className="view-caption">
        <b>Health findings</b> from OpenRig&apos;s detectors. An empty list is not all-clear.{' '}
        <details className="cov-details" style={{ display: 'inline' }}>
          <summary>more</summary>
          It is only as good as what was evaluated, so the reasons are shown beside it. Context
          pressure and the daemon line are AppyRig&apos;s own readings. Asked again every minute.
        </details>
      </div>
      <ul className="hl2-summary" data-testid="hl2-summary">
        {ctx.allMachines.map((fm) => {
          const row = rowOf(fm.machine.id);
          const v = verdictFor(row, {
            refusal,
            missing: loaded.state === 'ok' && !row,
            stale: staleWords(fm, ctx.now, ctx.hubConnected),
          });
          return (
            <li key={fm.machine.id} data-kind={v.kind}>
              <b>{fm.machine.label}</b> {v.glyph} {v.headline}
            </li>
          );
        })}
      </ul>
      <div className="hl2-grid">
        {ctx.allMachines.map((fm) => (
          <MachineHealth
            key={fm.machine.id}
            fm={fm}
            row={rowOf(fm.machine.id)}
            refusal={refusal}
            missing={loaded.state === 'ok' && !rowOf(fm.machine.id)}
            stale={staleWords(fm, ctx.now, ctx.hubConnected)}
            settings={settings?.machines.find((m) => m.machine === fm.machine.id)}
          />
        ))}
      </div>
    </main>
  );
}

export const page: PageDef = {
  key: 'health',
  label: 'Health',
  group: 'hood',
  component: HealthPage,
  blurb:
    'OpenRig health findings with coverage and policy (an empty list is never read as all-clear), context pressure, restore, daemon.',
};
