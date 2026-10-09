/*
 * Vendored from @flivideo/core v0.23.0 (commit fc55518, src/capability.ts), MIT License,
 * Copyright (c) 2026 David Cruwys. Copied unchanged below this header (plan §0.2, review M10):
 * AppyRig does not depend on fli-core. To update, re-copy from a newer tag and re-run the tests.
 */
import { z } from 'zod';
import type { ForbiddenDetails, Refusal } from './failure-codes.js';

/**
 * The capability contract (agent-drivable step 2, David 2026-09-23), modelled on FliCast's `defineCapability`
 * (flicast `src/core/capability.ts`). A capability is a named verb with zod input and output, a kind, a side-effect
 * class, the refusals it can make and the principals allowed to call it. The contract is DATA: the handler stays in
 * the app, so an app can declare its set in a shared package and bind the handlers on the server.
 *
 * THE ★ FENCE. A human-only capability is refused for `agent` and `cli` principals by `authorize`, which every
 * door's seam calls beneath its adapters — deleting a CLI or an MCP server changes nothing about who may call what.
 * The fence is a contract for cooperating agents on one person's machine, not a security boundary: the bearer token
 * keeps other machines and web pages out; nothing keeps out a local process that chooses to lie about who it is.
 */

/** Who is calling, by kind. The principal NAME is `human` or `human:<surface>`, `agent:<name>`, or `cli`. */
export const PrincipalKind = z.enum(['human', 'agent', 'cli']);
export type PrincipalKind = z.infer<typeof PrincipalKind>;

export const PrincipalName = z
  .string()
  .regex(/^(human(:[\w.-]+)?|cli|agent:[\w.-]+)$/, 'human[:surface], agent:<name> or cli');
export type PrincipalName = z.infer<typeof PrincipalName>;

/** The header a caller names itself in, on every Fli door. */
export const PRINCIPAL_HEADER = 'x-fli-principal';

/** The kind of a principal name, or null when it is not one. */
export function principalKind(name: string): PrincipalKind | null {
  if (!PrincipalName.safeParse(name).success) return null;
  if (name === 'cli') return 'cli';
  return name.startsWith('agent:') ? 'agent' : 'human';
}

export const CapabilityKind = z.enum(['query', 'command', 'task', 'event']);
export type CapabilityKind = z.infer<typeof CapabilityKind>;

/** What calling it does to the world: nothing, an edit that can be taken back, one that cannot, or something outside. */
export const SideEffects = z.enum([
  'read-only',
  'reversible-write',
  'destructive',
  'external-side-effect',
]);
export type SideEffects = z.infer<typeof SideEffects>;

export const ExpectedDuration = z.enum(['fast', 'slow']);
export type ExpectedDuration = z.infer<typeof ExpectedDuration>;

/** Capability names are `family.verb` (`project.create`, `app.stop`, `system.quit`). */
export const CapabilityName = z
  .string()
  .regex(/^[a-z][a-z0-9-]*(\.[a-z][a-zA-Z0-9-]*)+$/, 'family.verb');

/**
 * Human-only by input: the capability is open to agents, except when the input asks for the part only a person may
 * do (`project.migrate-layout` is a dry run for anyone; `{ apply: true }` is a person's). `note` says which, for docs.
 */
export type HumanOnlyWhen<I> = { when(input: I): boolean; note: string };

export type CapabilityContract<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> = {
  kind: CapabilityKind;
  description: string;
  input: I;
  output: O;
  sideEffects: SideEffects;
  idempotent: boolean;
  /** The UI asks a person before calling it. Metadata only — the fence is `humanOnly`. */
  confirmationRequired: boolean;
  expectedDuration: ExpectedDuration;
  /** The refusals this capability can make on top of the ones any call can. */
  failureModes: readonly string[];
  /** Who may call it. A human-only capability allows `human` alone. */
  principals: readonly PrincipalKind[];
  /** ★ `true`: never an agent or the CLI. An object: only for the inputs `when` picks out. */
  humanOnly: boolean | HumanOnlyWhen<z.infer<I>>;
};

type ContractInput<I extends z.ZodType, O extends z.ZodType> = Omit<
  CapabilityContract<I, O>,
  'principals' | 'humanOnly' | 'expectedDuration'
> &
  Partial<Pick<CapabilityContract<I, O>, 'principals' | 'humanOnly' | 'expectedDuration'>>;

/**
 * Declare one capability. Defaults: every principal, not human-only, fast. Throws when the declaration contradicts
 * itself — a human-only verb that lists agents, or no principals at all — so a bad one fails at import time.
 */
export function defineCapability<I extends z.ZodType, O extends z.ZodType>(
  contract: ContractInput<I, O>,
): CapabilityContract<I, O> {
  const humanOnly = contract.humanOnly ?? false;
  const principals =
    contract.principals ?? (humanOnly === true ? ['human'] : PrincipalKind.options);
  if (principals.length === 0) throw new Error(`${contract.description}: no principal may call it`);
  if (humanOnly === true && principals.some((p) => p !== 'human')) {
    throw new Error(`${contract.description}: human-only but allows ${principals.join(', ')}`);
  }
  return {
    ...contract,
    expectedDuration: contract.expectedDuration ?? 'fast',
    principals,
    humanOnly,
  };
}

/** Check a whole set's names once, where it is declared. Returns the set unchanged. */
export function defineCapabilities<S extends Record<string, CapabilityContract>>(set: S): S {
  const bad = Object.keys(set).filter((name) => !CapabilityName.safeParse(name).success);
  if (bad.length > 0) throw new Error(`Capability names must be family.verb: ${bad.join(', ')}`);
  return set;
}

/** Whether a call with this input is human-only. */
export function isHumanOnly(contract: CapabilityContract, input?: unknown): boolean {
  const { humanOnly } = contract;
  if (typeof humanOnly === 'boolean') return humanOnly;
  return input !== undefined && humanOnly.when(input);
}

/** The result of `authorize`: the caller's kind, or a `forbidden` refusal with typed details. */
export type Authorization = { ok: true; kind: PrincipalKind } | { ok: false; refusal: Refusal };

/**
 * The fence. Call it in the seam every door shares, after parsing the input (an input-dependent fence needs it).
 * Refuses an unknown principal name, a kind the capability does not allow, and an agent or CLI on a human-only call.
 */
export function authorize(
  name: string,
  contract: CapabilityContract,
  principal: string,
  input?: unknown,
): Authorization {
  const kind = principalKind(principal);
  const humanOnly = isHumanOnly(contract, input);
  const details = (): ForbiddenDetails => ({
    capability: name,
    principal,
    allowed: humanOnly ? ['human'] : [...contract.principals],
    humanOnly,
  });
  if (kind === null) {
    return {
      ok: false,
      refusal: {
        failureMode: 'forbidden',
        message: `"${principal}" is not a principal (human[:surface], agent:<name> or cli).`,
        details: details(),
      },
    };
  }
  if (humanOnly && kind !== 'human') {
    const why = typeof contract.humanOnly === 'object' ? ` (${contract.humanOnly.note})` : '';
    return {
      ok: false,
      refusal: {
        failureMode: 'forbidden',
        message: `${name} is human-only${why}; ${principal} may not call it.`,
        details: details(),
      },
    };
  }
  if (!contract.principals.includes(kind)) {
    return {
      ok: false,
      refusal: {
        failureMode: 'forbidden',
        message: `${name} allows ${contract.principals.join(', ')}; not ${principal}.`,
        details: details(),
      },
    };
  }
  return { ok: true, kind };
}

/** The fields an input object requires (each one missing can become a picker, or a `missing` refusal). */
export function requiredFields(contract: CapabilityContract): string[] {
  // By shape, not `instanceof`: a schema built with another copy of zod 4 is still an object schema.
  const shape = (contract.input as { shape?: unknown }).shape;
  if (typeof shape !== 'object' || shape === null) return [];
  return Object.entries(shape as Record<string, z.ZodType>)
    .filter(([, field]) => !field.safeParse(undefined).success)
    .map(([key]) => key);
}

/** One capability as data, for `GET …/capabilities`, a CLI's `list` and the OpenRPC generator. */
export const CapabilityMeta = z.object({
  name: z.string(),
  family: z.string(),
  kind: CapabilityKind,
  description: z.string(),
  sideEffects: SideEffects,
  idempotent: z.boolean(),
  confirmationRequired: z.boolean(),
  expectedDuration: ExpectedDuration,
  failureModes: z.array(z.string()),
  principals: z.array(PrincipalKind),
  /** `true`, `false`, or the note saying which inputs are human-only. */
  humanOnly: z.union([z.boolean(), z.object({ when: z.string() })]),
  required: z.array(z.string()),
  input: z.unknown(),
  output: z.unknown(),
});
export type CapabilityMeta = z.infer<typeof CapabilityMeta>;

export const familyOf = (name: string): string => name.split('.')[0] ?? name;

/** The set as data, with JSON Schemas for input and output, sorted by name. */
export function describeCapabilities(set: Record<string, CapabilityContract>): CapabilityMeta[] {
  return Object.entries(set)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, c]) => {
      return {
        name,
        family: familyOf(name),
        kind: c.kind,
        description: c.description,
        sideEffects: c.sideEffects,
        idempotent: c.idempotent,
        confirmationRequired: c.confirmationRequired,
        expectedDuration: c.expectedDuration,
        failureModes: [...c.failureModes],
        principals: [...c.principals],
        humanOnly: typeof c.humanOnly === 'boolean' ? c.humanOnly : { when: c.humanOnly.note },
        required: requiredFields(c),
        input: z.toJSONSchema(c.input, { unrepresentable: 'any' }),
        output: z.toJSONSchema(c.output, { unrepresentable: 'any', io: 'output' }),
      };
    });
}
