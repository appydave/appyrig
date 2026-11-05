import type { PageKey, PageProps } from '@client/app/types.js';
import { STATE_WORD, type ShownSpec, type SpecState } from '@client/domain/specs/model.js';
import { STATE_HELP } from '@client/domain/specs/stateHelp.js';

/** The state chip; hover says what the state is, how the rig got there and what changes it. */
export function StateBadge({ state, testId }: { state: SpecState; testId?: string }) {
  return (
    <span className="rs-badge" data-state={state} data-testid={testId} title={STATE_HELP[state]}>
      {STATE_WORD[state]}
    </span>
  );
}

const folderOf = (path: string) => path.slice(0, path.lastIndexOf('/')) || path;

export function DetailHead({ spec, label }: { spec: ShownSpec; label: (id: string) => string }) {
  const elsewhere = spec.liveMachine !== null && spec.liveMachine !== spec.machine;

  return (
    <header className="rs-detail-head">
      <h3 data-testid="rs-detail-name">{spec.name}</h3>
      <StateBadge state={spec.state} testId="rs-detail-state" />
      <span className="quiet" data-testid="rs-detail-where">
        spec on {label(spec.machine)}
        {elsewhere ? ` · launched on ${label(spec.liveMachine!)}` : ''}
      </span>
      {spec.specPath && (
        <code className="rs-folder" data-testid="rs-detail-folder" title={spec.specPath}>
          {folderOf(spec.specPath)}
        </code>
      )}
    </header>
  );
}

export function LiveLinks({
  spec,
  ctx,
  label,
}: {
  spec: ShownSpec;
  ctx: PageProps['ctx'];
  label: (id: string) => string;
}) {
  const liveKey = spec.liveMachine ? `${spec.liveMachine}:${spec.name}` : spec.key;
  const open = (page: PageKey) => {
    ctx.chooseRig(liveKey);
    ctx.goTo(page);
  };

  return (
    <p className="rs-links" data-testid="rs-links">
      {spec.liveMachine !== spec.machine
        ? `This rig is launched on ${label(spec.liveMachine!)}, from its own copy of the spec.`
        : 'This rig is launched.'}{' '}
      See it live:{' '}
      <button type="button" className="pill-btn" onClick={() => open('graph')}>
        Graph
      </button>{' '}
      <button type="button" className="pill-btn" onClick={() => open('map')}>
        Rig Map
      </button>{' '}
      <button type="button" className="pill-btn" onClick={() => open('run')}>
        Run board
      </button>{' '}
      <button
        type="button"
        className="pill-btn"
        onClick={() => ctx.onOpenFiles(spec.liveMachine ?? spec.machine, spec.name)}
      >
        Files
      </button>
    </p>
  );
}

export function SummaryToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="rs-summary-toggle"
      data-testid="rs-summary-toggle"
      aria-expanded={open}
      onClick={onToggle}
    >
      <span aria-hidden="true">{open ? '▾' : '▸'}</span> Summary
    </button>
  );
}

export function SpecsNotices({
  refused,
  pending,
  label,
}: {
  refused: boolean;
  pending: { machine: string }[];
  label: (id: string) => string;
}) {
  return (
    <>
      <p className="quiet rs-purpose" data-testid="rs-purpose">
        The rigs written on disk, launched or not.
      </p>
      {refused && (
        <p className="quiet" data-testid="rs-specs-old-hub">
          The hub does not list unlaunched rigs yet (it runs an older AppyRig). Shown: launched
          rigs, from their own records.
        </p>
      )}
      {pending.length > 0 && (
        <p className="quiet" data-testid="rs-specs-pending">
          {pending.map((m) => label(m.machine)).join(', ')}: not sending its spec scan yet, so only
          launched rigs show for {pending.length === 1 ? 'it' : 'them'}.
        </p>
      )}
    </>
  );
}
