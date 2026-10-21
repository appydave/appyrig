import type { FleetSocket } from '../../domain/fleet/useFleet.js';
import { createFrozenSocket, type FrozenFile, type FrozenMeta } from './frozenSocket.js';

export const FROZEN_PARAM = 'frozen';

/**
 * The committed snapshots (`test/fixtures/frozen/*.json`), each its own lazy chunk: nothing is
 * fetched unless the address names one with `?frozen=<name>`.
 */
const FILES: Record<string, () => Promise<FrozenFile>> = import.meta.env.DEV
  ? import.meta.glob<FrozenFile>('../../../../test/fixtures/frozen/*.json', { import: 'default' })
  : // Dev only: a production build ships no snapshot. Preview frozen data with the dev client.
    {};

export function frozenNames(): string[] {
  return Object.keys(FILES)
    .map((p) =>
      p
        .split('/')
        .pop()!
        .replace(/\.json$/, '')
    )
    .sort();
}

export function frozenFromSearch(search: string): string | null {
  const v = new URLSearchParams(search).get(FROZEN_PARAM);

  return v ? v : null;
}

export interface FrozenRun {
  getSocket: () => FleetSocket;
  meta: FrozenMeta;
}

function emptyFile(name: string): FrozenFile {
  return {
    format: 'appyrig-frozen/1',
    name,
    recordedAt: '',
    update: { generatedAt: new Date(0).toISOString(), full: true, machines: [] },
    calls: {},
  };
}

/** Loads a named snapshot. A missing or broken one still runs: an empty fleet, and the reason. */
export async function loadFrozen(
  name: string,
  files: Record<string, () => Promise<FrozenFile>> = FILES
): Promise<FrozenRun> {
  const entry = Object.entries(files).find(([p]) => p.endsWith(`/${name}.json`));
  let file: FrozenFile;
  let problem: string | undefined;
  if (!entry) {
    const known = Object.keys(files).map((p) =>
      p
        .split('/')
        .pop()!
        .replace(/\.json$/, '')
    );
    problem = `no snapshot named "${name}"${known.length ? ` (have: ${known.join(', ')})` : ''}`;
    file = emptyFile(name);
  } else {
    try {
      file = await entry[1]();
    } catch (e) {
      problem = `could not load "${name}": ${(e as Error).message}`;
      file = emptyFile(name);
    }
  }
  const socket = createFrozenSocket(file);

  return {
    getSocket: () => socket,
    meta: {
      name,
      recordedAt: file.recordedAt || null,
      loadedAt: Date.now(),
      ...(problem ? { problem } : {}),
      ...(file.stripped ? { stripped: file.stripped } : {}),
    },
  };
}
