/**
 * The global version switch, Current or v2: kept in the URL (`?v=2`) and remembered per viewer.
 * The URL wins over the remembered choice, so a shared link opens in the version it names.
 */
export type Mode = 'current' | 'v2';

export const MODE_KEY = 'appyrig.v2.mode';
export const MODE_PARAM = 'v';

export function modeFromSearch(search: string): Mode | null {
  const v = new URLSearchParams(search).get(MODE_PARAM);
  if (v === '2') return 'v2';
  if (v === '1' || v === 'current') return 'current';
  return null;
}

function stored(): Mode | null {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === 'v2' || v === 'current' ? v : null;
  } catch {
    return null;
  }
}

export function readMode(search: string = location.search): Mode {
  return modeFromSearch(search) ?? stored() ?? 'current';
}

/** The same address with `v=2` set (v2) or removed (Current); other parameters kept. */
export function searchWithMode(search: string, mode: Mode): string {
  const p = new URLSearchParams(search);
  if (mode === 'v2') p.set(MODE_PARAM, '2');
  else p.delete(MODE_PARAM);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function writeMode(mode: Mode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // per-viewer convenience only
  }
  const next = searchWithMode(location.search, mode);
  if (next !== location.search) {
    history.replaceState(history.state, '', `${location.pathname}${next}${location.hash}`);
  }
}
