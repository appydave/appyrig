import { z } from 'zod';

/**
 * v1.4 · S6: machine health, sampled by the collector and read-only. Every reading is either a
 * value or an explicit `unavailable` with a reason, so a reading that could not be taken never
 * shows as 0 (nor as "fine"). The whole object is optional on a snapshot: an older collector
 * sends none, and the hub then says "no health data from this collector yet". Hub first.
 */

const isoDate = z.iso.datetime({ offset: true });

/** A value, or why there is none. */
export const reading = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('ok'), value }),
    z.strictObject({ status: z.literal('unavailable'), reason: z.string().min(1).max(200) }),
  ]);
export type Reading<T> = { status: 'ok'; value: T } | { status: 'unavailable'; reason: string };

/** macOS memory-pressure level (kern.memorystatus_vm_pressure_level: 1, 2, 4). */
export const MemoryPressureLevelSchema = z.enum(['normal', 'warn', 'critical']);
export type MemoryPressureLevel = z.infer<typeof MemoryPressureLevelSchema>;

/** One terminal app and what its processes hold, summed. Resident memory, not a footprint. */
export const TerminalAppSchema = z.strictObject({
  app: z.string().min(1).max(40),
  processes: z.number().int().nonnegative(),
  rssBytes: z.number().int().nonnegative(),
});
export type TerminalApp = z.infer<typeof TerminalAppSchema>;

export const MachineHealthSchema = z.strictObject({
  /** When the collector took these readings (they are re-sampled on a slower cadence than the fleet push). */
  sampledAt: isoDate,
  memory: z.strictObject({
    totalBytes: reading(z.number().int().positive()),
    /**
     * Used = anonymous (app) memory − purgeable + wired + compressor-occupied pages: the same sum
     * Activity Monitor's "Memory Used" is made of. Not total − free.
     */
    usedBytes: reading(z.number().int().nonnegative()),
    pressureLevel: reading(MemoryPressureLevelSchema),
    /** `memory_pressure`'s "system-wide memory free percentage", 0–100. */
    freePct: reading(z.number().min(0).max(100)),
    swapUsedBytes: reading(z.number().int().nonnegative()),
    swapTotalBytes: reading(z.number().int().nonnegative()),
  }),
  processes: z.strictObject({
    /** Running Claude Code processes (the `claude` binary, any version). */
    claude: reading(z.number().int().nonnegative()),
    /** tmux sessions, from the pane list the collector already reads. */
    tmuxSessions: reading(z.number().int().nonnegative()),
    /**
     * Interactive shells attached to a terminal device (zsh/bash/fish with a tty; plain `sh` wrappers excluded). A count of
     * terminal sessions in practice, not of windows: window counts need Accessibility access.
     */
    terminalShells: reading(z.number().int().nonnegative()),
    /** Terminal apps that are running (iTerm, Terminal, Ghostty, kitty, WezTerm, Alacritty, Warp, Hyper, cmux, tmux and similar multiplexers), biggest first. */
    terminalApps: reading(z.array(TerminalAppSchema).max(20)),
  }),
});
export type MachineHealth = z.infer<typeof MachineHealthSchema>;

// ── the health.get verb ────────────────────────────────────────────────────────────────────────

export const HealthGetInputSchema = z.strictObject({
  machine: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional()
    .describe('only this machine'),
});
export type HealthGetInput = z.infer<typeof HealthGetInputSchema>;

export const HealthRowSchema = z.strictObject({
  machine: z.string(),
  liveness: z.enum(['live', 'asleep']),
  /** `no-data` = this machine's collector sends no health (older than v1.4): not an error, not "healthy". */
  status: z.enum(['ok', 'no-data']),
  reason: z.string().nullable(),
  /** Age of the readings in ms as of this call; null with no data. A sleeping machine's readings are as old as its last push. */
  sampleAgeMs: z.number().int().min(0).nullable(),
  health: MachineHealthSchema.nullable(),
});
export type HealthRow = z.infer<typeof HealthRowSchema>;

export const HealthGetOutputSchema = z.array(HealthRowSchema);
export type HealthGetOutput = z.infer<typeof HealthGetOutputSchema>;
