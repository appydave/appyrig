import RigInfo from '@client/kit/RigInfo.js';
import RigPicker from '@client/kit/RigPicker.js';
import RunCard from '@client/kit/runcard/RunCard.js';
import { runCard as runCardModel } from '@client/domain/fleet/runcard.js';
import { queueCapNote } from '@client/domain/fleet/views/core/queueCap.js';
import type { FleetMachine } from '@appydave/shared';
import type { PageDef, PageProps } from '@client/app/types.js';
import HandoffFlow from './HandoffFlow.js';

/** Says when this machine's queue list was cut off; renders nothing otherwise. */
function QueueCapNote({ machine }: { machine: FleetMachine | undefined }) {
  const note = machine ? queueCapNote(machine) : null;

  return note ? (
    <p className="quiet" data-testid="queue-capped">
      {note}
    </p>
  ) : null;
}

function flowRunCard(
  ctx: PageProps['ctx'],
  fm: FleetMachine | undefined,
  rig: PageProps['ctx']['activeRig']
) {
  return fm && rig
    ? runCardModel(fm, rig.name, ctx.now) && (
        <RunCard
          key={rig.key}
          machine={fm}
          rig={rig.name}
          now={ctx.now}
          socket={ctx.getSocket()}
          details={
            <RigInfo
              rig={rig}
              preview={false}
              onOpenFiles={(r) => ctx.onOpenFiles(r.machineId, r.name)}
            />
          }
        />
      )
    : null;
}

/**
 * v2 Handoff Flow: Current's live data and behaviour (No lead by design, From outside the rig,
 * replay, the handoff panel), forked into this folder, with a Traffic / Structure switch (C35),
 * count and waiting badges that read at a glance, and a one-agent box that opens the Agent page.
 */
function FlowPage({ ctx }: PageProps) {
  const rig = ctx.activeRig;
  const fm = rig ? ctx.allMachines.find((m) => m.machine.id === rig.machineId) : undefined;
  const card = flowRunCard(ctx, fm, rig);

  return (
    <main className="view ar-flow-page" data-testid="ar-flow">
      <RigPicker
        rigs={ctx.rigs}
        selected={rig?.key ?? null}
        onSelect={ctx.chooseRig}
        onOpenFiles={(r) => ctx.onOpenFiles(r.machineId, r.name)}
        info={!card}
      />
      {card}
      <QueueCapNote machine={fm} />
      <HandoffFlow
        machine={fm ?? null}
        rig={rig?.name ?? null}
        now={ctx.now}
        socket={ctx.getSocket()}
        keys={ctx.keys}
        // Navigation model: an agent click opens the Agent panel on top of this page; it never
        // leaves the page (the panel's "Open full agent page" is the way there).
        onOpenAgent={(key) =>
          ctx.openAgentPanel({ machineId: key.slice(0, key.indexOf('/')), seatKey: key })
        }
      />
    </main>
  );
}

export const page: PageDef = {
  key: 'flow',
  label: 'Handoff Flow',
  group: 'work',
  component: FlowPage,
  blurb:
    'Who handed what to whom, or who works with whom (Traffic / Structure), with readable counts.',
};
