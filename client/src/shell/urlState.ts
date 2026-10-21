import { useCallback, useEffect, useState } from 'react';

/**
 * v2 shell · the URL is the state.
 *
 *   ?v=2&page=<key>&rig=<rig>@<machine>&agent=<seat>@<machine>&job=<slice>&open=<rig,...>
 *
 * - `page`   the page on screen. Page changes use pushState, so Back returns to the page before.
 * - `rig`    the chosen rig, `d09-crew@m2` (a rig key is `m2:d09-crew`). Picks use replaceState.
 * - `agent`  the agent the panel (or, on the Agent page, the page) is open on, `<seatId>@<machineId>`.
 *            A seat id is already `<name>@<rig>` for rig members, so this reads `<seat>@<rig>@<machine>`.
 *            Opening the panel uses pushState (Back closes it); closing it replaces when it can't go back.
 * - `job`, `open`  owned by pages (the Run board's job, the Graph's open rigs): use `useUrlParam`.
 *
 * Every other parameter (`v`, `frozen`, ...) is kept as it is. Reload restores the state; a copied
 * address is a working deep link.
 */

export interface UrlState {
  page: string | null;
  /** A rig key, `m2:d09-crew`. */
  rig: string | null;
  /** A fleet tile key, `m2/dev-build@d09-crew`. */
  agent: string | null;
}

/** `m2:d09-crew` to `d09-crew@m2`. */
export function rigToParam(key: string): string {
  const i = key.indexOf(':');
  return i < 0 ? key : `${key.slice(i + 1)}@${key.slice(0, i)}`;
}
/** `d09-crew@m2` to `m2:d09-crew`; null when it has no machine. */
export function rigFromParam(p: string): string | null {
  const i = p.lastIndexOf('@');
  return i <= 0 ? null : `${p.slice(i + 1)}:${p.slice(0, i)}`;
}
/** `m2/dev-build@d09-crew` to `dev-build@d09-crew@m2`. */
export function agentToParam(tile: string): string {
  const i = tile.indexOf('/');
  return i < 0 ? tile : `${tile.slice(i + 1)}@${tile.slice(0, i)}`;
}
/** `dev-build@d09-crew@m2` to `m2/dev-build@d09-crew`; null when it has no machine. */
export function agentFromParam(p: string): string | null {
  const i = p.lastIndexOf('@');
  return i <= 0 ? null : `${p.slice(i + 1)}/${p.slice(0, i)}`;
}

export function readUrlState(search: string = window.location.search): UrlState {
  const p = new URLSearchParams(search);
  const rig = p.get('rig');
  const agent = p.get('agent');
  return {
    page: p.get('page'),
    rig: rig ? rigFromParam(rig) : null,
    agent: agent ? agentFromParam(agent) : null,
  };
}

/** Fired after the address is rewritten by this module, so `useUrlParam` readers update. */
export const URL_EVENT = 'appyrig:url';

/** Marks a history entry as the one opening the Agent panel, so closing it can go Back. */
export const PANEL_ENTRY = 'agent-panel';

type Params = Record<string, string | null | undefined>;

/**
 * Rewrites the given parameters (null removes one) and keeps the rest. `push` adds a history entry,
 * `replace` edits the current one. Does nothing when the address would not change.
 */
export function writeParams(params: Params, how: 'push' | 'replace', marker?: string): void {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') p.delete(k);
    else p.set(k, v);
  }
  const s = p.toString();
  const next = s ? `?${s}` : '';
  if (next === window.location.search && how === 'replace' && !marker) return;
  if (next === window.location.search && how === 'push') return;
  const url = `${window.location.pathname}${next}${window.location.hash}`;
  const state = marker ? { ...(window.history.state ?? {}), ar: marker } : window.history.state;
  if (how === 'push') window.history.pushState(state, '', url);
  else window.history.replaceState(state, '', url);
  window.dispatchEvent(new Event(URL_EVENT));
}

/** A URL parameter a page owns (the Graph's `open`, the Run board's `job`): value and setter. */
export function useUrlParam(name: string): [string | null, (v: string | null) => void] {
  const read = () => new URLSearchParams(window.location.search).get(name);
  const [value, setValue] = useState<string | null>(read);
  useEffect(() => {
    const sync = () => setValue(read());
    window.addEventListener('popstate', sync);
    window.addEventListener(URL_EVENT, sync);
    sync();
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(URL_EVENT, sync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
  const set = useCallback(
    (v: string | null) => {
      writeParams({ [name]: v }, 'replace');
    },
    [name]
  );
  return [value, set];
}
