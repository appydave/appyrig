import { ASLEEP_AFTER_MS, type AppConfig, type CallAnswer } from '@appydave/shared';
import { authorize } from './vendor/capability.js';
import { CapabilityRefusal } from './vendor/failure-codes.js';
import { VERB_REGISTRY } from './verbs.js';
import type { FleetStore } from '../hub/fleetStore.js';
import type { AppIdentity } from './identity.js';

/**
 * The one seam (B1): `core.call(principal, verb, input, { dryRun })`. Every door (the browser
 * socket, POST /v1/rpc, POST /v1/call, the CLI, the console page) calls this and nothing else,
 * so a verb added to the registry exists on every door at once.
 *
 * Order: verb → dryRun shape (B4) → input (Zod) → principal (the fli-core fence) → handler →
 * output (Zod). Every refusal is data with a named failureMode (B7); nothing throws to a door.
 */

export interface CallOptions {
  /** Boolean or absent (B4). Every v1 verb is read-only, so a dry run answers exactly as a real call. */
  dryRun?: unknown;
}

export interface Core {
  call: (principal: string, verb: string, input: unknown, opts?: CallOptions) => CallAnswer;
  verbs: () => string[];
}

export interface CoreOptions {
  store: FleetStore;
  identity: AppIdentity;
  now?: () => Date;
  asleepAfterMs?: number;
  /** Told about handler faults (answered as `internal`). */
  onFault?: (verb: string, err: unknown) => void;
  /** AppyRig's own config, read per call (run card R2). */
  config?: () => AppConfig;
}

const refuse = (failureMode: string, message: string, details?: unknown): CallAnswer => ({
  ok: false,
  error: details === undefined ? { failureMode, message } : { failureMode, message, details },
});

const issuesOf = (error: {
  issues: { path: PropertyKey[]; message: string }[];
}): { path: string; message: string }[] =>
  error.issues.map((i) => ({
    path: i.path.map(String).join('.') || '(input)',
    message: i.message,
  }));

export function createCore(opts: CoreOptions): Core {
  const now = opts.now ?? (() => new Date());
  const startedAt = now();
  const names = Object.keys(VERB_REGISTRY).sort();

  return {
    verbs: () => [...names],
    call(principal, verbName, input, callOpts = {}) {
      const verb = Object.hasOwn(VERB_REGISTRY, verbName) ? VERB_REGISTRY[verbName] : undefined;
      if (!verb) {
        return refuse('unknown-capability', `No verb "${verbName}".`, { known: names });
      }
      if (callOpts.dryRun !== undefined && typeof callOpts.dryRun !== 'boolean') {
        return refuse('invalid-input', 'dryRun must be true, false or absent.', {
          issues: [{ path: 'dryRun', message: `expected boolean, got ${typeof callOpts.dryRun}` }],
        });
      }
      const parsed = verb.contract.input.safeParse(input ?? {});
      if (!parsed.success) {
        return refuse('invalid-input', `${verbName}: input does not match.`, {
          issues: issuesOf(parsed.error),
        });
      }
      const allowed = authorize(verbName, verb.contract, principal, parsed.data);
      if (!allowed.ok) {
        return { ok: false, error: allowed.refusal };
      }
      try {
        const value = verb.handle(parsed.data, {
          store: opts.store,
          now,
          identity: opts.identity,
          startedAt,
          asleepAfterMs: opts.asleepAfterMs ?? ASLEEP_AFTER_MS,
          principal,
          verbCount: names.length,
          dryRun: callOpts.dryRun === true,
          config: opts.config,
        });
        const out = verb.contract.output.safeParse(value);
        if (!out.success) {
          opts.onFault?.(verbName, out.error);

          return refuse('internal', `${verbName} produced an answer outside its contract.`);
        }

        return { ok: true, value: out.data };
      } catch (err) {
        if (err instanceof CapabilityRefusal) {
          return { ok: false, error: err.toRefusal() };
        }
        opts.onFault?.(verbName, err);

        return refuse(
          'internal',
          `${verbName} failed: ${err instanceof Error ? err.message : err}`
        );
      }
    },
  };
}
