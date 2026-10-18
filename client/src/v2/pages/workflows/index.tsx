import { useMemo } from 'react';
import {
  DataNotes,
  Loading,
  SampleWhy,
  agoFrom,
  pick,
  useMachineLabel,
  useVerb,
  type WorkflowListOutput,
  type WorkflowSpec,
} from '../../data/index.js';
import { FakeControl, SampleData } from '../../kit/index.js';
import type { V2PageDef, V2PageProps } from '../../types.js';
import { CLOSURE_WORD, sampleInstance, sampleSpecs } from './model.js';

function SpecList({ specs, label }: { specs: WorkflowSpec[]; label: (id: string) => string }) {
  return (
    <ul className="wf-specs" data-testid="wf-specs">
      {specs.map((s) => (
        <li key={`${s.machine}:${s.name}`} data-testid="wf-spec">
          <b>{s.name}</b>{' '}
          <span className="quiet">
            {s.version ? `v${s.version} · ` : ''}
            {s.isBuiltIn ? 'built in · ' : ''}
            {label(s.machine)}
          </span>
          <br />
          {s.purpose ?? 'No purpose given.'}
          <br />
          <span className="quiet">
            {s.targetRig ? `target rig ${s.targetRig} · ` : ''}
            {s.terminalTurnRule ? `ends by: ${s.terminalTurnRule}` : ''}
          </span>{' '}
          <FakeControl
            label="Instantiate"
            question={`Start a ${s.name} run?`}
            result={`${s.name} run started (pretend)`}
          />
        </li>
      ))}
    </ul>
  );
}

function Workflows({ ctx }: V2PageProps) {
  const label = useMachineLabel(ctx.allMachines);
  const s = useVerb<WorkflowListOutput>(ctx.getSocket, 'workflow.list', {});
  const src = pick(s, (v) => v.machines, label);
  const specsSample = useMemo(() => sampleSpecs(ctx.allMachines), [ctx.allMachines]);
  const inst = useMemo(() => sampleInstance(ctx.allMachines), [ctx.allMachines]);

  const live = src.kind === 'live' ? src.value : null;
  const specsRead = live?.machines.some((m) => m.status === 'ok' && m.specsRead) ?? false;
  const instancesRead = live?.machines.some((m) => m.status === 'ok' && m.instancesRead) ?? false;
  // Per machine: a machine whose list was not read is never described as having none.
  const okMachines = live?.machines.filter((m) => m.status === 'ok') ?? [];
  const specsUnread = okMachines.filter((m) => !m.specsRead);
  const runsUnread = okMachines.filter((m) => !m.instancesRead);
  const noRun = okMachines.filter(
    (m) => m.instancesRead && !live!.instances.some((i) => i.machine === m.machine)
  );

  return (
    <main className="view v2-workflows" data-testid="v2-workflows">
      <h2>Workflows</h2>
      <p className="quiet">
        Fixed step-by-step recipes OpenRig can run across seats, and the runs themselves. Read-only:
        AppyRig does not start or steer a workflow.
      </p>
      {src.kind === 'loading' && <Loading what="the workflows" />}
      {src.kind === 'sample' && <SampleWhy why={src.why} />}
      {live && <DataNotes notes={src.kind === 'live' ? src.notes : []} />}

      <h3>Specs</h3>
      {live && specsRead ? (
        <>
          <SpecList specs={live.specs} label={label} />
          {specsUnread.length > 0 && (
            <p className="quiet" data-testid="wf-specs-unread">
              Specs not read on {specsUnread.map((m) => label(m.machine)).join(', ')}: that is not
              the same as having none.
            </p>
          )}
        </>
      ) : src.kind === 'loading' ? null : (
        <SampleData
          title="Built-in workflow specs"
          what={
            live
              ? 'The spec list could not be read from any machine, so these are the six built-ins OpenRig 0.6.6 ships, with made-up wording.'
              : 'The six built-ins OpenRig 0.6.6 ships, with made-up wording.'
          }
        >
          <SpecList specs={specsSample} label={label} />
        </SampleData>
      )}

      <h3>Runs</h3>
      {live && instancesRead && live.instances.length > 0 && (
        <table className="wf-table" data-testid="wf-instances">
          <thead>
            <tr>
              <th>Run</th>
              <th>Workflow</th>
              <th>Status</th>
              <th>Step</th>
              <th>Hops</th>
              <th>Started</th>
              <th>Machine</th>
            </tr>
          </thead>
          <tbody>
            {live.instances.map((i) => (
              <tr key={`${i.machine}:${i.instanceId}`}>
                <td>
                  <code>{i.instanceId}</code>
                </td>
                <td>{i.workflowName ?? '?'}</td>
                <td>{i.status ?? 'unknown'}</td>
                <td>{i.currentStepId ?? '-'}</td>
                <td>{i.hopCount ?? '-'}</td>
                <td>{agoFrom(i.createdAt, ctx.now)}</td>
                <td>{label(i.machine)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {live && noRun.length > 0 && (
        <p data-testid="wf-no-runs">
          No workflow has been run on {noRun.map((m) => label(m.machine)).join(', ')} (its run list
          was read and is empty).
        </p>
      )}
      {live && runsUnread.length > 0 && (
        <p className="quiet" data-testid="wf-unread">
          Run list not read on {runsUnread.map((m) => label(m.machine)).join(', ')}: that is not the
          same as no runs.
        </p>
      )}

      <SampleData
        title="Example run with its step trace"
        what={`Made up: a gated-release run on ${inst.rig} (${inst.machine}) with real seat names. No live run exists to show, and the trace is not collected yet.`}
      >
        <p>
          <b>{inst.workflow}</b> <code>{inst.instanceId}</code> · {inst.status} · {inst.hopCount}{' '}
          hops · now at <b>{inst.currentStepId}</b>{' '}
          <FakeControl label="Route" question="Route to the next step?" result="Routed (pretend)" />{' '}
          <FakeControl label="Resume" question="Resume this run?" result="Resumed (pretend)" />{' '}
          <FakeControl label="Abort" question="Abort this run?" result="Aborted (pretend)" />
        </p>
        <ol className="wf-trail" data-testid="wf-trail">
          {inst.trail.map((t) => (
            <li
              key={t.stepId}
              data-testid="wf-step"
              data-closure={t.closure ?? 'pending'}
              className={t.stepId === inst.currentStepId ? 'wf-current' : undefined}
            >
              <b>{t.stepId}</b> <span className="quiet">({t.role})</span> by {t.actor}:{' '}
              <span className="ms-state">{t.closure ? CLOSURE_WORD[t.closure] : 'pending'}</span>{' '}
              {t.note}
            </li>
          ))}
        </ol>
      </SampleData>
    </main>
  );
}

export const page: V2PageDef = {
  key: 'workflows',
  label: 'Workflows',
  group: 'agents',
  component: Workflows,
  blurb: 'Built-in workflow specs and runs; an example run shows the step trace.',
};
