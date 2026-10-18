import { useEffect, useMemo, useState } from 'react';
import { callVerb } from '../../fleet/coreCall.js';
import type { FleetSocket } from '../../fleet/useFleet.js';

/**
 * v2 data layer for the W5 pages: calls the read-only data verbs of
 * the `v2/data-channels` work and says, in words, when a verb is unknown, refused, pending or
 * unsupported, so a page can show labelled sample data instead of a blank or a false "none".
 *
 * The response types come from `@appydave/shared` (`shared/src/daemondata.ts`). Nothing here
 * writes: every call is a read verb.
 */

export type {
  DataMachine,
  DataStatus,
  HistoryTransitionRow,
  HistoryTransitionsOutput,
  LibraryGetOutput,
  LibraryGroup,
  LibraryItem,
  LibraryListOutput,
  WorkflowListOutput,
} from '@appydave/shared';
import type { DataMachine, DataStatus, WorkflowListOutput } from '@appydave/shared';

export type WorkflowSpec = WorkflowListOutput['specs'][number];
export type WorkflowInstance = WorkflowListOutput['instances'][number];

// ---------------------------------------------------------------- calling

export type VerbState<T> =
  { phase: 'loading' } | { phase: 'ok'; value: T } | { phase: 'refused'; message: string };

/** Asks one read verb once (again when its input changes); a null verb asks nothing. Never throws; a refusal is a state. */
export function useVerb<T>(
  getSocket: () => FleetSocket,
  verb: string | null,
  input: Record<string, unknown>
): VerbState<T> {
  const [state, setState] = useState<VerbState<T>>({ phase: 'loading' });
  const key = JSON.stringify(input);
  useEffect(() => {
    if (!verb) return;
    let live = true;
    setState({ phase: 'loading' });
    void callVerb<T>(getSocket(), verb, JSON.parse(key)).then((a) => {
      if (!live) return;
      setState(
        a.ok ? { phase: 'ok', value: a.value } : { phase: 'refused', message: a.error.message }
      );
    });
    return () => {
      live = false;
    };
  }, [getSocket, verb, key]);
  return state;
}

/** What to show for one verb: real data, or sample data and the reason why. */
export type Source<T> =
  | { kind: 'loading' }
  | { kind: 'live'; value: T; notes: string[] }
  | { kind: 'sample'; why: string };

const STATUS_WORD: Record<DataStatus, string> = {
  ok: 'ok',
  pending: 'has not sent this yet (older collector, or not collected yet)',
  unsupported: 'runs an OpenRig version without this',
};

/** One line per machine whose data is not `ok`, so a missing machine is never read as an empty one. */
export function machineNotes(machines: DataMachine[], label: (id: string) => string): string[] {
  return machines
    .filter((m) => m.status !== 'ok')
    .map((m) => `${label(m.machine)} ${STATUS_WORD[m.status]}${m.reason ? ` (${m.reason})` : ''}.`);
}

/**
 * Real data when the verb answered and at least one machine has data; otherwise sample, with the
 * reason: the verb is unknown or refused (it is not on `main` yet), or no machine has data.
 */
export function pick<T>(
  s: VerbState<T>,
  machines: (v: T) => DataMachine[],
  label: (id: string) => string
): Source<T> {
  if (s.phase === 'loading') return { kind: 'loading' };
  if (s.phase === 'refused')
    return { kind: 'sample', why: `the hub refused the read: ${s.message}` };
  const ms = machines(s.value);
  if (!ms.some((m) => m.status === 'ok')) {
    return {
      kind: 'sample',
      why: ms.length
        ? `no machine has sent this yet. ${machineNotes(ms, label).join(' ')}`
        : 'the hub reported no machines.',
    };
  }
  return { kind: 'live', value: s.value, notes: machineNotes(ms, label) };
}

export function useMachineLabel(machines: { machine: { id: string; label: string } }[]) {
  return useMemo(() => {
    const map = new Map(machines.map((m) => [m.machine.id, m.machine.label]));
    return (id: string) => map.get(id) ?? id;
  }, [machines]);
}

// ---------------------------------------------------------------- display

/** The banner a page puts above a section that is showing sample data instead of a real read. */
export function SampleWhy({ why }: { why: string }) {
  return (
    <p className="v2-note v2-note-warn" data-testid="sample-why">
      Showing sample data: {why}
    </p>
  );
}

export function DataNotes({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return (
    <ul className="quiet" data-testid="data-notes">
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

export function Loading({ what }: { what: string }) {
  return (
    <p className="quiet" data-testid="v2-loading">
      Reading {what}…
    </p>
  );
}

/** "3h 10m ago" style age from an ISO time ("unknown" when missing). */
export function agoFrom(iso: string | null, now: number): string {
  if (!iso) return 'unknown';
  const m = Math.floor((now - Date.parse(iso)) / 60_000);
  if (Number.isNaN(m)) return 'unknown';
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ${m % 60}m ago`;
  return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h ago`;
}
