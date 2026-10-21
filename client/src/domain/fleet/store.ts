import { FleetUpdateSchema, TAIL_MAX_LINES, type FleetMachine } from '@appydave/shared';

/**
 * The browser's fleet store. `fleet:update` carries whole machines (contract D3): a `full` update
 * replaces everything, otherwise each listed machine is replaced by machine.id. No diffs.
 */
export interface FleetState {
  machines: Record<string, FleetMachine>;
  /** At least one update has arrived (an empty fleet is then a real answer, not "loading"). */
  received: boolean;
  /** Last refused update, in plain words. Kept until a valid update arrives. */
  error: string | null;
}

export const initialFleetState: FleetState = { machines: {}, received: false, error: null };

/**
 * AC 7: the store never holds more than TAIL_MAX_LINES lines per seat. Applied to the raw payload
 * before validation, so an over-long tail is trimmed (newest lines kept) rather than costing the
 * whole update.
 */
export function clampTails(raw: unknown): unknown {
  const machines = (raw as { machines?: unknown })?.machines;
  if (!Array.isArray(machines)) {
    return raw;
  }

  return {
    ...(raw as object),
    machines: machines.map((m) => {
      const seats = m?.snapshot?.seats;
      if (!Array.isArray(seats)) {
        return m;
      }

      return {
        ...m,
        snapshot: {
          ...m.snapshot,
          seats: seats.map((s: { tail?: { lines?: unknown } | null }) =>
            s?.tail && Array.isArray(s.tail.lines) && s.tail.lines.length > TAIL_MAX_LINES
              ? { ...s, tail: { ...s.tail, lines: s.tail.lines.slice(-TAIL_MAX_LINES) } }
              : s
          ),
        },
      };
    }),
  };
}

export function applyFleetUpdate(state: FleetState, raw: unknown): FleetState {
  const parsed = FleetUpdateSchema.safeParse(clampTails(raw));
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');

    // Honest error: keep the last good fleet on screen and say the update was refused.
    return { ...state, error: `refused a fleet update (${detail})` };
  }
  const update = parsed.data;
  const machines: Record<string, FleetMachine> = update.full ? {} : { ...state.machines };
  for (const m of update.machines) {
    machines[m.machine.id] = m;
  }

  return { machines, received: true, error: null };
}
