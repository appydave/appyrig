import RigInfo from '../../../components/RigInfo.js';
import RigPicker from '../../../components/RigPicker.js';
import RunCard from '../../../components/RunCard.js';
import { runCard as runCardModel } from '../../../fleet/runcard.js';
import type { V2PageDef, V2PageProps } from '../../types.js';
import HandoffFlowV2 from './HandoffFlowV2.js';

/**
 * v2 Handoff Flow: Current's live data and behaviour (No lead by design, From outside the rig,
 * replay, the handoff panel), forked into this folder, with a Traffic / Structure switch (C35),
 * count and waiting badges that read at a glance, and a one-agent box that opens the Agent page.
 */
function FlowV2({ ctx }: V2PageProps) {
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
    <main className="view v2-flow-page" data-testid="v2-flow">
      <RigPicker
        rigs={ctx.rigs}
        selected={rig?.key ?? null}
        onSelect={ctx.chooseRig}
        onOpenFiles={(r) => ctx.onOpenFiles(r.machineId, r.name)}
        info={!card}
      />
      {card}
      <HandoffFlowV2
        machine={fm ?? null}
        rig={rig?.name ?? null}
        now={ctx.now}
        socket={ctx.getSocket()}
        keys={ctx.keys}
        onOpenAgent={ctx.openAgentPage}
      />
    </main>
  );
}

export const page: V2PageDef = {
  key: 'flow',
  label: 'Handoff Flow',
  group: 'work',
  component: FlowV2,
  blurb:
    'Who handed what to whom, or who works with whom (Traffic / Structure), with readable counts.',
};
