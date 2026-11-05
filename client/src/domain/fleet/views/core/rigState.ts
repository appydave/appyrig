import { type PipKey } from '@client/domain/fleet/model.js';
import { type RigState } from '@client/domain/fleet/views/core/types.js';

export const RIG_STATE: Record<RigState, { glyph: string; label: string }> = {
  attention: { glyph: '▲', label: 'needs attention' },
  working: { glyph: '●', label: 'working' },
  idle: { glyph: '○', label: 'idle' },
  stopped: { glyph: '✕', label: 'stopped' },
  asleep: { glyph: '◌', label: 'machine asleep' },
};

/** OpenRig reports `running`, or `partial` when only some of a rig's seats run: both are live. */
export const isLiveStatus = (status: string): boolean =>
  status === 'running' || status === 'partial';

interface RigStateInput {
  liveness: string;
  status: string;
  attentionCount: number;
  seatPips: PipKey[];
}

/** asleep machine > stopped (not running or partial) > a seat blocked or OpenRig's attention count > a seat working > idle. */
export function rigState({ liveness, status, attentionCount, seatPips }: RigStateInput): RigState {
  if (liveness === 'asleep') {
    return 'asleep';
  }

  if (!isLiveStatus(status)) {
    return 'stopped';
  }

  if (attentionCount > 0 || seatPips.includes('blocked')) {
    return 'attention';
  }

  if (seatPips.includes('working')) {
    return 'working';
  }

  return 'idle';
}
