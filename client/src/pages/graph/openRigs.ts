import { useCallback, useState } from 'react';
import type { PageContext } from '../../app/types.js';

/**
 * Which rigs are open on the Graph, kept across visits to the page. The nav lane will expose this
 * through the URL (`open=`) as `ctx.openRigs` / `ctx.setOpenRigs`; until it does, the set lives in a
 * module-level store (survives leaving and returning to the page) mirrored to localStorage (survives
 * a reload). When the ctx provides them, they win and this store is not touched.
 */
export interface NavOpenRigs {
  openRigs?: string[];
  setOpenRigs?: (keys: string[]) => void;
}

const STORE_KEY = 'appyrig.v2.graph.open';
let memory: string[] | null = null;

function readStore(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');

    if (Array.isArray(v)) {
      return v.filter((x): x is string => typeof x === 'string');
    }

    return [];
  } catch {
    // storage blocked: the in-memory copy still survives leaving and returning to the page
    return memory ?? [];
  }
}

function writeStore(keys: string[]) {
  memory = keys;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(keys));
  } catch {
    /* private window: it just is not remembered across a reload */
  }
}

/** Test hook: forget the module-level copy (and the stored one). */
export function resetOpenRigs() {
  memory = null;
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}

type Open = Record<string, boolean>;

/** The open set as a record, and a setter that takes a record or an updater, like `useState`. */
export function useOpenRigs(ctx: PageContext): [Open, (u: Open | ((o: Open) => Open)) => void] {
  const nav = ctx as PageContext & NavOpenRigs;
  const navOwned = Array.isArray(nav.openRigs) && typeof nav.setOpenRigs === 'function';
  const [local, setLocal] = useState<string[]>(() => readStore());
  const keys = navOwned ? nav.openRigs! : local;
  const open: Open = Object.fromEntries(keys.map((k) => [k, true]));
  const setOpenRigs = nav.setOpenRigs;
  const set = useCallback(
    (u: Open | ((o: Open) => Open)) => {
      const base = Object.fromEntries(keys.map((k) => [k, true]));
      const next = typeof u === 'function' ? u(base) : u;
      const list = Object.keys(next).filter((k) => next[k]);

      if (navOwned) {
        setOpenRigs!(list);
      } else {
        writeStore(list);
        setLocal(list);
      }
    },
    [keys, navOwned, setOpenRigs]
  );

  return [open, set];
}
