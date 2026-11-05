import { describe, expect, it } from 'vitest';
import { fitText } from './boxText.js';

describe('fitText (a line inside a Handoff Flow box)', () => {
  it('keeps a line that fits and cuts one that does not, with an ellipsis', () => {
    expect(fitText('sonnet 5.5', 170)).toBe('sonnet 5.5');
    expect(fitText('orchestrator, David or another rig', 135)).toMatch(/…$/);
    expect(fitText('orchestrator, David or another rig', 135).length).toBeLessThanOrEqual(22);
    expect(fitText('orchestrator, David or another rig', 170)).toBe(
      'orchestrator, David or another rig'.slice(0, 28) + '…'
    );
  });
});
