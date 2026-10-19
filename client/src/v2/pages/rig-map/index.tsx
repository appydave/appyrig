import { useCallback, useMemo } from 'react';
import RigMap from './RigMapV2.js';
import RigPicker from '../../../components/RigPicker.js';
import { followWork } from '../../../fleet/timeline.js';
import { buildRigMap } from '../../../fleet/views.js';
import { FakeControl, MockNote } from '../../kit/index.js';
import type { V2PageDef, V2PageProps } from '../../types.js';
import './rig-map.css';

/**
 * v2 Rig Map: ONE team, drawn wide. It keeps the original Rig Map's shape (the rig across the full
 * width, pods as bands, agents side by side, curved arcs labelled with counts, dotted planned
 * lines, "other rigs that talk to this rig" below) by drawing the original component read-only,
 * and adds what v2 is for: the shared rig choice and picker, roomier mono cards (rig-map.css),
 * the hover detail card with copy attach (the original's), a click that opens the v2 Agent page,
 * and one mock note over fake rig controls. No machine columns, no all-rigs layout, no tree:
 * those belong to the Graph.
 */
function RigMapV2({ ctx }: V2PageProps) {
  const rig = ctx.activeRig;
  // Minute precision, so the map is not re-laid every second.
  const minute = Math.floor(ctx.now / 60_000) * 60_000;
  const map = useMemo(
    () => (rig ? buildRigMap(ctx.allMachines, rig.key, minute) : null),
    [rig, ctx.allMachines, minute]
  );
  const chainOf = useCallback(
    (id: string) => {
      const fm = ctx.allMachines.find((m) => m.machine.id === rig?.machineId);
      return fm && rig ? followWork(fm, rig.name, id) : null;
    },
    [ctx.allMachines, rig]
  );
  return (
    <main className="view v2-rigmap" data-testid="v2-rig-map">
      <RigPicker
        rigs={ctx.rigs}
        selected={rig?.key ?? null}
        onSelect={ctx.chooseRig}
        onOpenFiles={(r) => ctx.onOpenFiles(r.machineId, r.name)}
        info={false}
      />
      <div className="v2rm-bar">
        <MockNote />
        {rig && (
          <p className="v2rm-controls" data-testid="v2rm-controls">
            <FakeControl
              label="Restore rig"
              question={`Restore ${rig.name} on ${rig.machineLabel}?`}
              result={`${rig.name} restored (pretend)`}
            />
            <FakeControl
              label="Stop rig"
              question={`Stop ${rig.name} on ${rig.machineLabel}?`}
              result={`${rig.name} stopped (pretend)`}
            />
          </p>
        )}
      </div>
      <RigMap
        map={map}
        onOpen={ctx.openAgentPage}
        onOpenSkills={ctx.onOpenSkills}
        socket={ctx.getSocket()}
        keys={ctx.keys}
        chainOf={chainOf}
      />
    </main>
  );
}

export const page: V2PageDef = {
  key: 'map',
  label: 'Rig Map',
  group: 'fleet',
  component: RigMapV2,
  blurb: 'One team, drawn wide: agents side by side, arcs with counts, planned lines.',
};
