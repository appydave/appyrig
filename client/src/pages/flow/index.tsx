import RigInfo from '../../kit/RigInfo.js';
import RigPicker from '../../kit/RigPicker.js';
import RunCard from '../../kit/RunCard.js';
import { runCard as runCardModel } from '../../domain/fleet/runcard.js';
import type { PageDef, PageProps } from '../../app/types.js';
import HandoffFlow from './HandoffFlow.js';

/**
 * v2 Handoff Flow: Current's live data and behaviour (No lead by design, From outside the rig,
 * replay, the handoff panel), forked into this folder, with a Traffic / Structure switch (C35),
 * count and waiting badges that read at a glance, and a one-agent box that opens the Agent page.
 */
function FlowPage({ ctx }: PageProps) {
  const rig = ctx.activeRig;
  const fm = rig ? ctx.allMachines.find((m) => m.machine.id === rig.machineId) : undefined;
  const card =
    fm && rig
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
