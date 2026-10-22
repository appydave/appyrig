import { describe, expect, it } from 'vitest';
import { callKey, createFrozenSocket, type FrozenFile } from '@client/app/frozen/frozenSocket.js';
import { readRigFile, readRigFiles, readRigWaiting } from '@client/kit/data/rigReads.js';

const rig = { machine: 'm4', rig: 'spaghetti' };

/** A frozen socket that answers only the three exact verb + input pairs the reads should send. */
const socket = createFrozenSocket({
  format: 'appyrig-frozen/1',
  name: 'rig-reads',
  recordedAt: '2026-10-22T00:00:00.000Z',
  update: {},
  calls: {
    [callKey('rig.files', rig)]: { ok: true, value: { verb: 'rig.files' } },
    [callKey('rig.file', { ...rig, fileId: 'f-1' })]: { ok: true, value: { verb: 'rig.file' } },
    [callKey('rig.waiting', rig)]: { ok: true, value: { verb: 'rig.waiting' } },
  },
} satisfies FrozenFile);

describe('Feature: the rig read verbs name each verb once', () => {
  it('Scenario: given a rig, when its files are read, then rig.files is called with that machine and rig', async () => {
    expect(await readRigFiles(socket, rig)).toEqual({ ok: true, value: { verb: 'rig.files' } });
  });

  it('Scenario: given a file id, when one file is read, then rig.file is called with the id', async () => {
    expect(await readRigFile(socket, { ...rig, fileId: 'f-1' })).toEqual({
      ok: true,
      value: { verb: 'rig.file' },
    });
  });

  it('Scenario: given a rig, when what it waits on is read, then rig.waiting is called', async () => {
    expect(await readRigWaiting(socket, rig)).toEqual({
      ok: true,
      value: { verb: 'rig.waiting' },
    });
  });

  it('Scenario: given a different rig, when its files are read, then the input reached the hub unchanged and is refused as unrecorded', async () => {
    const answer = await readRigFiles(socket, { machine: 'm4', rig: 'other' });

    expect(answer.ok).toBe(false);
    expect(answer.ok === false && answer.error.failureMode).toBe('not_in_snapshot');
  });
});
