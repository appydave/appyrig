import { useCallback, useEffect, useRef, useState } from 'react';
import { callVerb } from '../../domain/fleet/coreCall.js';
import { MockMark, SampleData, SampleLabel, useFakeAction } from '../../kit/index.js';
import type { SettingsGetOutput } from '@appydave/shared';
import '../../kit/data/coverage.css';
import type { PageDef, PageProps } from '../../app/types.js';
import {
  groupSettings,
  sampleSchedules,
  sampleSettings,
  show,
  showSource,
  type SettingLine,
  type SettingValue,
  type SettingsMachine,
} from '../../domain/settings/model.js';
import '../w5b.css';

type Loaded =
  | { state: 'loading' }
  | { state: 'ok'; out: SettingsGetOutput }
  | { state: 'refused'; why: string };

type Toast = (text: string) => void;

/** One fake edit: Edit → a field → Save → confirm → progress → toast. Never a call. */
function FakeEdit({
  line,
  machineLabel,
  onToast,
}: {
  line: SettingLine;
  machineLabel: string;
  onToast: Toast;
}) {
  const a = useFakeAction(900);
  const [editing, setEditing] = useState(false);
  const first = Object.values(line.byMachine).find(Boolean);
  const [draft, setDraft] = useState(show(first?.value));
  const done = useRef(false);
  const { phase, reset } = a;

  useEffect(() => {
    if (phase !== 'done' || done.current) {
      return;
    }

    done.current = true;
    onToast(`${line.key} = ${draft} on ${machineLabel} (pretend): nothing changed`);
    setEditing(false);
    reset();
    done.current = false;
  }, [phase, reset, onToast, line.key, draft, machineLabel]);
  if (!editing) {
    return (
      <button
        type="button"
        className="pill-btn st2-edit"
        data-testid="st2-edit"
        onClick={() => setEditing(true)}
      >
        Edit
      </button>
    );
  }

  return (
    <span className="st2-editing" data-testid="st2-editing">
      <input
        className="mono st2-input"
        aria-label={`New value for ${line.key}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={a.phase !== 'idle'}
      />
      {a.phase === 'idle' && (
        <>
          <button type="button" className="pill-btn" data-testid="st2-save" onClick={a.ask}>
            Save
          </button>
          <button type="button" className="pill-btn" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </>
      )}
      {a.phase === 'confirm' && (
        <span role="group" aria-label="Confirm">
          Set <b className="mono">{line.key}</b> to <b className="mono">{draft}</b> on{' '}
          {machineLabel}?{' '}
          <button
            type="button"
            className="pill-btn ar-fake-yes"
            data-testid="st2-confirm"
            onClick={a.confirm}
          >
            Yes
          </button>{' '}
          <button type="button" className="pill-btn" onClick={a.cancel}>
            No
          </button>
        </span>
      )}
      {a.phase === 'working' && (
        <span role="status" data-testid="st2-working">
          <span className="ar-fake-bar" aria-hidden="true" /> saving…
        </span>
      )}
      <MockMark />
    </span>
  );
}

const valueText = (v: SettingValue | undefined) => show(v);

/**
 * v2 Settings (C31, home for C20): the OpenRig daemon's settings per machine, read-only, grouped,
 * values that differ from the default highlighted, and machines that disagree marked. Every edit is
 * a mock. Schedules are mock rows with sample last runs.
 */
function SettingsPage({ ctx }: PageProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [changedOnly, setChangedOnly] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const next = useRef(0);

  useEffect(() => {
    let live = true;

    void callVerb<SettingsGetOutput>(ctx.getSocket(), 'settings.get', {}).then((a) => {
      if (!live) {
        return;
      }

      setLoaded(a.ok ? { state: 'ok', out: a.value } : { state: 'refused', why: a.error.message });
    });

    return () => {
      live = false;
    };
    // once per visit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toast = useCallback<Toast>((text) => {
    const id = ++next.current;

    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const label = (id: string) =>
    ctx.allMachines.find((m) => m.machine.id === id)?.machine.label ?? id;
  const real: SettingsMachine[] =
    loaded.state === 'ok' ? loaded.out.machines.filter((m) => m.status === 'ok') : [];
  const missing =
    loaded.state === 'ok'
      ? loaded.out.machines
          .filter((m) => m.status !== 'ok')
          .map((m) => `${label(m.machine)}: ${m.status}${m.reason ? ` (${m.reason})` : ''}`)
      : [];
  const sample = loaded.state !== 'loading' && real.length === 0;
  const shown = sample ? sampleSettings(ctx.allMachines) : real;
  const groups = groupSettings(shown, changedOnly);
  const ids = shown.map((m) => m.machine);

  const table = (
    <>
      <p className="st2-controls">
        <label>
          <input
            type="checkbox"
            data-testid="st2-changed-only"
            checked={changedOnly}
            onChange={(e) => setChangedOnly(e.target.checked)}
          />{' '}
          changed from default only
        </label>
        <span className="quiet">
          {shown.reduce((n, m) => n + m.withheld, 0)} keys withheld (paths, secrets) ·{' '}
          {shown.reduce((n, m) => n + m.pathsHidden, 0)} path values hidden
        </span>
      </p>
      {groups.map((g) => (
        <section key={g.name} className="st2-group" data-testid="st2-group" data-group={g.name}>
          <h4 className="st2-group-name">{g.name}</h4>
          <table className="x2-table">
            <thead>
              <tr>
                <th>key</th>
                {ids.map((id) => (
                  <th key={id}>{label(id)}</th>
                ))}
                <th>default</th>
                <th>edit</th>
              </tr>
            </thead>
            <tbody>
              {g.lines.map((l) => (
                <tr
                  key={l.key}
                  data-testid="st2-row"
                  data-key={l.key}
                  data-changed={l.changed || undefined}
                  data-differs={l.differs || undefined}
                >
                  <td className="mono">
                    {l.key}
                    {l.differs && <span className="st2-differs"> machines differ</span>}
                  </td>
                  {ids.map((id) => {
                    const v = l.byMachine[id];

                    return (
                      <td
                        key={id}
                        className="mono st2-val"
                        data-changed={v?.changed || undefined}
                        data-testid="st2-cell"
                        title={v ? `source: ${showSource(v.source) || 'not said'}` : 'not reported'}
                      >
                        {v ? valueText(v.value) : 'not reported'}
                        {v?.source && v.source !== 'default' && (
                          <span className="st2-src"> {showSource(v.source)}</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="mono quiet">{valueText(l.defaultValue)}</td>
                  <td>
                    <FakeEdit
                      line={l}
                      machineLabel={ids.length > 1 ? 'every machine' : label(ids[0] ?? '')}
                      onToast={toast}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {groups.length === 0 && <p className="empty">No setting differs from its default.</p>}
    </>
  );

  return (
    <main className="view x2-page" data-testid="ar-settings">
      <div className="view-caption">
        <b>OpenRig settings</b>, read-only, per machine.{' '}
        <span className="st2-key-changed">Highlighted</span> = differs from its default.{' '}
        <details className="cov-details" style={{ display: 'inline' }}>
          <summary>more</summary>
          Where a value was set (file, env) is shown beside any value not from the default. Editing
          is a mock everywhere on this page.
        </details>
      </div>
      {loaded.state === 'loading' && <p className="quiet">Asking the hub…</p>}
      {sample ? (
        <SampleData
          title="Settings"
          what={`No machine sent its settings (${loaded.state === 'refused' ? `the hub said: ${loaded.why.replace(/\.+$/, '')}` : missing.join('; ') || 'none reported'}). These keys and values are made up in OpenRig's shape, for this fleet's machines.`}
        >
          {table}
        </SampleData>
      ) : (
        loaded.state === 'ok' && (
          <>
            {missing.length > 0 && (
              <div className="cov" data-testid="st2-missing">
                <span className="cov-line">
                  Real data · Not shown: {missing.map((m) => m.split(' ')[0]).join(', ')}
                </span>
                <details className="cov-details">
                  <summary>details</summary>
                  <p>{missing.join('; ')}.</p>
                </details>
              </div>
            )}
            {table}
          </>
        )
      )}

      <section className="x2-section" data-testid="st2-schedules">
        <h3 className="x2-h">
          Schedules <SampleLabel /> <MockMark />
        </h3>
        <p className="quiet">
          AppyRig has no scheduler yet. These rows show how scheduled work would read: what, when,
          where, last run.
        </p>
        <table className="x2-table">
          <thead>
            <tr>
              <th>what</th>
              <th>when</th>
              <th>where</th>
              <th>last run</th>
              <th>result</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sampleSchedules(ctx.allMachines).map((s) => (
              <tr key={s.id} data-testid="st2-schedule">
                <td>{s.what}</td>
                <td className="mono">{s.when}</td>
                <td>{s.machine}</td>
                <td className="mono">{s.lastRun}</td>
                <td className="st2-result" data-result={s.result}>
                  {s.result === 'pass' ? '● pass' : s.result === 'fail' ? '■ fail' : '– never run'}
                </td>
                <td>
                  <ScheduleRun what={s.what} onToast={toast} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {toasts.length > 0 && (
        <div className="x2-toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className="x2-toast" role="status" data-testid="st2-toast">
              ✓ {t.text} <MockMark />
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function ScheduleRun({ what, onToast }: { what: string; onToast: Toast }) {
  const a = useFakeAction(900);
  const { phase, reset } = a;

  useEffect(() => {
    if (phase !== 'done') {
      return;
    }

    onToast(`ran "${what}" (pretend): nothing ran`);
    reset();
  }, [phase, reset, onToast, what]);
  if (phase === 'confirm') {
    return (
      <span>
        Run now?{' '}
        <button
          type="button"
          className="pill-btn ar-fake-yes"
          data-testid="st2-run-yes"
          onClick={a.confirm}
        >
          Yes
        </button>{' '}
        <button type="button" className="pill-btn" onClick={a.cancel}>
          No
        </button>
      </span>
    );
  }

  if (phase === 'working') {
    return <span className="ar-fake-bar" aria-label="running" />;
  }

  return (
    <button type="button" className="pill-btn" data-testid="st2-run" onClick={a.ask}>
      Run now
    </button>
  );
}

export const page: PageDef = {
  key: 'settings',
  label: 'Settings',
  group: 'hood',
  component: SettingsPage,
  blurb:
    'OpenRig settings per machine, read-only, changed-from-default highlighted; mock edits and schedules.',
};
