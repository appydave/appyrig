import { z } from 'zod';

/**
 * v1.4 · S5: what the hub works out about a Claude account from what collectors report plus
 * AppyRig's own config. Everything here is derived on the hub; none of it is sent by a collector.
 *
 * A window is shown *against its reset*: how much is used, how much of the window has gone, and
 * where that is heading. Elapsed time is as of `asOf`; a UI that stays open should recompute it
 * from `resetsAt` and `windowMs` rather than trust it to be current.
 */

const isoDate = z.iso.datetime({ offset: true });

export const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
export const SEVEN_DAY_MS = 7 * 24 * 60 * 60 * 1000;
/** Below this share of the window gone, a projection would just be noise. */
export const PROJECTION_MIN_ELAPSED_PCT = 5;

/**
 * `reading`     a live window: used%, elapsed% and a projection.
 * `window-ended` the sampled reset time has passed, so the reading belongs to a window that is over;
 *               usedPct is the last value seen and says nothing about the current window.
 * `no-reading`  this machine has no sampler (or no reading yet). Never shown as 0%.
 */
export const WindowStatusSchema = z.enum(['reading', 'window-ended', 'no-reading']);

export const AccountWindowSchema = z.strictObject({
  status: WindowStatusSchema,
  /** Can exceed 100 once a window is spent. */
  usedPct: z.number().min(0).nullable(),
  resetsAt: isoDate.nullable(),
  windowMs: z.number().int().positive(),
  /** resetsAt − windowMs. */
  startsAt: isoDate.nullable(),
  /** Share of the window gone as of `asOf`, 0–100; null unless status is `reading`. */
  elapsedPct: z.number().min(0).max(100).nullable(),
  /** usedPct − elapsedPct: positive = burning faster than time passes. Null unless `reading`. */
  paceDeltaPct: z.number().nullable(),
  /** Where usedPct lands at the reset if the pace holds; null before PROJECTION_MIN_ELAPSED_PCT of the window. */
  projectedPct: z.number().min(0).nullable(),
});
export type AccountWindow = z.infer<typeof AccountWindowSchema>;

export const TierSourceSchema = z.enum(['reported', 'config', 'unknown']);

export const AccountTierSchema = z.strictObject({
  /** e.g. "Max $200". Null when the source is `unknown`. */
  label: z.string().nullable(),
  /** `reported` = the login record named it; `config` = AppyRig's config file; `unknown` = neither. */
  source: TierSourceSchema,
});
export type AccountTier = z.infer<typeof AccountTierSchema>;

/** The hub-derived part, laid on a machine's reported account and returned by account.list. */
export const AccountDerivedSchema = z.strictObject({
  tier: AccountTierSchema,
  /** When these windows were worked out; elapsed/pace are as of this moment. */
  asOf: isoDate,
  /** Age of the reading in ms (asOf − sampledAt); null with no reading. */
  sampleAgeMs: z.number().int().min(0).nullable(),
  fiveHour: AccountWindowSchema,
  sevenDay: AccountWindowSchema,
  /**
   * The login and status-line data carry no monthly window, and none is invented. `not-reported`
   * is the whole answer: it means "the source has nothing", not "zero".
   */
  monthly: z.strictObject({ status: z.literal('not-reported') }),
});
export type AccountDerived = z.infer<typeof AccountDerivedSchema>;
