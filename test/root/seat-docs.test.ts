import { describe, expect, it } from 'vitest';
import * as shared from '../../shared/src/index.js';

/**
 * Goal 5 of the bottom-up refactor: AppyRig's own "loadout layers" (file-presence checks) are not
 * OpenRig's startup layers, so they are named seat documents. The old names stay as aliases until
 * the client moves, and the wire key stays `layers`.
 */
describe('seat documents (were "loadout layers")', () => {
  it('has the new names, with the old ones as exact aliases for the client', () => {
    expect(shared.SeatDocSchema).toBeDefined();
    expect(shared.LoadoutLayerSchema).toBe(shared.SeatDocSchema);
    expect(shared.LoadoutLayerIdSchema).toBe(shared.SeatDocIdSchema);
    expect(shared.LOADOUT_LAYER_MAX_BYTES).toBe(shared.SEAT_DOC_MAX_BYTES);
  });

  it('shares no name with OpenRig startup layers except culture, which really is the same file', () => {
    const docs: readonly string[] = shared.SeatDocIdSchema.options;
    const clash = shared.OpenRig.STARTUP_LAYERS.filter((l) => docs.includes(l));

    // `culture` is the rig's culture_file (OpenRig's culture layer); every other id is AppyRig's own
    expect(clash).toEqual(['culture']);
  });
});
