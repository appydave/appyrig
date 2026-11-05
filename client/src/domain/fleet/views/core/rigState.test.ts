import { describe, expect, it } from 'vitest';
import { isLiveStatus, rigState } from './rigState.js';

describe('partial rigs are live', () => {
  const base = { liveness: 'live', attentionCount: 0, seatPips: [] as never[] };

  it('running and partial are live; anything else is stopped', () => {
    expect(isLiveStatus('running')).toBe(true);
    expect(isLiveStatus('partial')).toBe(true);
    expect(isLiveStatus('stopped')).toBe(false);
    expect(rigState({ ...base, status: 'partial', seatPips: ['working', 'stopped'] })).toBe(
      'working'
    );
    expect(rigState({ ...base, status: 'partial', seatPips: ['idle', 'stopped'] })).toBe('idle');
    expect(rigState({ ...base, status: 'partial', seatPips: ['blocked'] })).toBe('attention');
    expect(rigState({ ...base, status: 'stopped', seatPips: ['working'] })).toBe('stopped');
    expect(rigState({ ...base, status: 'partial', liveness: 'asleep' })).toBe('asleep');
  });
});
