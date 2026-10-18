import Wall from '../../../components/Wall.js';
import type { V2PageDef, V2PageProps } from '../../types.js';

/**
 * W0 demo: the v2 Wall is Current's Wall under a v2 banner. It proves the switch, the flip and
 * frozen mode end to end; W2 replaces it with the real v2 Wall.
 */
function WallV2({ ctx }: V2PageProps) {
  return (
    <>
      <p className="v2-banner" data-testid="v2-wall-banner">
        <b>v2 Wall</b> · placeholder for wave 2: this is Current&apos;s Wall in the v2 frame. Press{' '}
        <kbd>B</kbd> to flip to the old page.
      </p>
      <Wall
        machines={ctx.machines}
        groupBy={ctx.groupBy}
        now={ctx.now}
        hubConnected={ctx.hubConnected}
        received={ctx.received}
        onOpen={ctx.onOpenSeat}
        onOpenSkills={ctx.onOpenSkills}
        keys={ctx.keys}
        hidden={ctx.hidden}
        onShow={ctx.onShowMachine}
        pickedRig={ctx.pickedRig}
      />
    </>
  );
}

export const page: V2PageDef = {
  key: 'wall',
  label: 'Wall',
  group: 'fleet',
  component: WallV2,
  blurb: 'Every seat on every machine (W0: Current Wall in the v2 frame).',
};
