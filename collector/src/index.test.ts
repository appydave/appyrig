import { describe, it, expect } from 'vitest';
import { MachineSnapshotSchema } from '@appydave/shared';
import { COLLECTOR_CONTRACT } from './index.js';

describe('collector stub', () => {
  it('builds against the shared snapshot contract', () => {
    expect(COLLECTOR_CONTRACT.schemaVersion).toBe(1);
    expect(MachineSnapshotSchema.safeParse({}).success).toBe(false);
  });
});
