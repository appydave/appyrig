/*
 * Vendored from @flivideo/core v0.23.0 (commit fc55518, src/openrpc.ts), MIT License,
 * Copyright (c) 2026 David Cruwys. Copied unchanged below this header (plan §0.2, review M10):
 * AppyRig does not depend on fli-core. To update, re-copy from a newer tag and re-run the tests.
 */
import { z } from 'zod';
import {
  describeCapabilities,
  type CapabilityContract,
  type CapabilityMeta,
} from './capability.js';
import { JSONRPC_CODES, failureCode, type Refusal } from './failure-codes.js';

/**
 * One OpenRPC generator for every Fli app (agent-drivable step 2), built from FliCast's `scripts/gen-openrpc.mjs`.
 * OpenRPC, not OpenAPI: the apps are verb-shaped — one seam, many named methods — so there is no resource tree to
 * model. What no stock spec carries rides under `x-`: principals, the ★ fence, side effects, failure modes.
 *
 * Also here: `answerJsonRpc`, the JSON-RPC 2.0 door every app would otherwise hand-roll. It maps a named refusal to
 * its stable code and always puts the name in `error.data.failureMode`.
 */

export const OpenRpcServer = z.object({
  name: z.string(),
  url: z.string(),
  summary: z.string().optional(),
  variables: z
    .record(z.string(), z.object({ default: z.string(), description: z.string().optional() }))
    .optional(),
});
export type OpenRpcServer = z.infer<typeof OpenRpcServer>;

/** The generated document, loosely typed: enough for the page renderer and tests to read. */
export const OpenRpcDocument = z.looseObject({
  openrpc: z.literal('1.3.2'),
  info: z.looseObject({
    title: z.string(),
    version: z.string(),
    description: z.string().optional(),
  }),
  servers: z.array(OpenRpcServer),
  methods: z.array(
    z.looseObject({
      name: z.string(),
      summary: z.string(),
      params: z.array(
        z.looseObject({ name: z.string(), required: z.boolean(), schema: z.unknown() }),
      ),
      errors: z.array(z.looseObject({ code: z.number(), message: z.string() })),
      'x-principals': z.array(z.string()),
      'x-human-only': z.union([z.boolean(), z.object({ when: z.string() })]),
    }),
  ),
});
export type OpenRpcDocument = z.infer<typeof OpenRpcDocument>;

export interface OpenRpcOptions {
  title: string;
  /** App version, and the API version when it moves separately (`0.3.1+api1`). */
  version: string;
  description?: string;
  servers: OpenRpcServer[];
  capabilities: Record<string, CapabilityContract>;
  /** The app's frozen name → code table (`defineFailureCodes`). */
  codes: Readonly<Record<string, number>>;
  /** Typed details per refusal name (zod), e.g. `{ ...SUITE_REFUSAL_DETAILS, overlap: OverlapDetails }`. */
  refusalDetails?: Readonly<Record<string, z.ZodType>>;
  /** Refusals ANY call can make (a bad principal, bad input, an unknown name, a fault) — listed on every method. */
  alwaysPossible?: readonly string[];
  /** Where the document came from, for `x-generated-by`. */
  generatedBy?: string;
}

const ENVELOPE = {
  name: 'result',
  description: 'The call envelope: `ok: true` with the value, or `ok: false` with a named refusal.',
  schema: {
    oneOf: [
      { type: 'object', required: ['ok', 'value'], properties: { ok: { const: true }, value: {} } },
      {
        type: 'object',
        required: ['ok', 'error'],
        properties: { ok: { const: false }, error: { type: 'object' } },
      },
    ],
  },
};

function paramsOf(meta: CapabilityMeta) {
  const schema = meta.input as {
    type?: string;
    properties?: Record<string, { description?: string }>;
    required?: string[];
  };
  if (schema?.type !== 'object' || !schema.properties) {
    return [{ name: 'input', required: true, schema }];
  }
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties).map(([name, s]) => ({
    name,
    required: required.has(name),
    ...(s.description ? { summary: s.description } : {}),
    schema: s,
  }));
}

/** Build the document. Deterministic: the same set gives byte-identical `openRpcText` output. */
export function toOpenRpc(options: OpenRpcOptions): OpenRpcDocument {
  const always = options.alwaysPossible ?? ['forbidden'];
  const detailSchemas = Object.fromEntries(
    Object.entries(options.refusalDetails ?? {}).map(([mode, schema]) => [
      mode,
      z.toJSONSchema(schema, { unrepresentable: 'any' }),
    ]),
  );
  const metas = describeCapabilities(options.capabilities);
  const methods = metas.map((meta) => {
    const modes = [...new Set([...meta.failureModes, ...always])];
    return {
      name: meta.name,
      summary: meta.description,
      tags: [{ name: meta.family }, ...(meta.humanOnly === true ? [{ name: 'human-only' }] : [])],
      paramStructure: 'by-name',
      params: paramsOf(meta),
      result: { ...ENVELOPE, schema: { ...ENVELOPE.schema, 'x-value': meta.output } },
      errors: modes
        .map((mode) => ({
          code: failureCode(options.codes, mode),
          message: mode,
          data: {
            type: 'object',
            required: ['failureMode'],
            properties: { failureMode: { const: mode }, details: detailSchemas[mode] ?? {} },
          },
        }))
        .sort((a, b) => b.code - a.code || a.message.localeCompare(b.message)),
      'x-kind': meta.kind,
      'x-family': meta.family,
      'x-principals': meta.principals,
      'x-human-only': meta.humanOnly,
      'x-side-effects': meta.sideEffects,
      'x-idempotent': meta.idempotent,
      'x-confirmation-required': meta.confirmationRequired,
      'x-expected-duration': meta.expectedDuration,
      'x-failure-modes': meta.failureModes,
      'x-required': meta.required,
    };
  });
  const fenced = methods.filter((m) => m['x-human-only'] !== false).length;
  return {
    openrpc: '1.3.2',
    info: {
      title: options.title,
      version: options.version,
      description: [
        options.description ?? '',
        `${methods.length} methods; ${fenced} are human-only in whole or in part (\`x-human-only\`) and refused with \`forbidden\` for agent and cli principals.`,
        'Every error carries `data.failureMode` (the canonical name) beside the integer code.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
    servers: options.servers,
    methods,
    'x-failure-codes': Object.fromEntries(
      Object.entries(options.codes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    ),
    ...(options.generatedBy ? { 'x-generated-by': options.generatedBy } : {}),
  };
}

/** The document as committed text (stable key order, trailing newline) — compare it for an `api:check`. */
export function openRpcText(doc: OpenRpcDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

// ── The JSON-RPC 2.0 door ────────────────────────────────────────────────────────────────────────────────────────────

export const JsonRpcRequest = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string().min(1),
  params: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).optional(),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
});
export type JsonRpcRequest = z.infer<typeof JsonRpcRequest>;

/** What an app's seam answers: the value, or a named refusal. */
export type CallAnswer = { ok: true; value: unknown } | { ok: false; error: Refusal };

export interface JsonRpcOptions {
  codes: Readonly<Record<string, number>>;
  /** The app's names for the three standard cases, when it does not use these. */
  names?: { unknownCapability?: string; invalidInput?: string; internal?: string };
  /**
   * Refuse a notification (a request with no `id`) instead of running it. JSON-RPC lets a server stay silent on one,
   * but on a seam whose verbs edit a document and mint undo entries, fire-and-forget means a write lands and its
   * refusal — or its success — is never heard. Off by default: the spec behaviour stays the default.
   */
  refuseNotifications?: boolean;
}

/**
 * Answer one JSON-RPC request (or a batch) through the app's seam. Returns `null` for a lone notification (no `id`),
 * per spec. `call` receives the method and by-name params; positional params are refused as invalid.
 */
export async function answerJsonRpc(
  body: unknown,
  call: (method: string, params: Record<string, unknown>) => Promise<CallAnswer>,
  options: JsonRpcOptions,
): Promise<unknown> {
  if (Array.isArray(body)) {
    if (body.length === 0) return invalidRequest(null);
    const answers = await Promise.all(body.map((one) => answerOne(one, call, options)));
    const kept = answers.filter((a) => a !== null);
    return kept.length > 0 ? kept : null;
  }
  return answerOne(body, call, options);
}

function invalidRequest(id: unknown) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code: JSONRPC_CODES.invalidRequest, message: 'Not a JSON-RPC 2.0 request.' },
  };
}

async function answerOne(
  raw: unknown,
  call: (method: string, params: Record<string, unknown>) => Promise<CallAnswer>,
  options: JsonRpcOptions,
): Promise<unknown> {
  const request = JsonRpcRequest.safeParse(raw);
  if (!request.success) {
    const id = typeof raw === 'object' && raw !== null ? (raw as { id?: unknown }).id : null;
    return invalidRequest(id);
  }
  const { method, params, id } = request.data;
  const invalidName = options.names?.invalidInput ?? 'invalid-input';
  if (id === undefined && options.refuseNotifications) {
    return {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: JSONRPC_CODES.invalidRequest,
        message: `${method}: notifications (no "id") are refused here — a write would land unheard. Send an "id".`,
        data: { failureMode: invalidName },
      },
    };
  }
  let answer: CallAnswer;
  if (Array.isArray(params)) {
    answer = {
      ok: false,
      error: { failureMode: invalidName, message: 'Params must be by name (an object).' },
    };
  } else {
    try {
      answer = await call(method, params ?? {});
    } catch (error) {
      answer = {
        ok: false,
        error: {
          failureMode: options.names?.internal ?? 'internal',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
  if (id === undefined) return null;
  if (answer.ok) return { jsonrpc: '2.0', id, result: answer.value };
  const { failureMode, message, details } = answer.error;
  const standard: Record<string, number> = {
    [options.names?.unknownCapability ?? 'unknown-capability']: JSONRPC_CODES.methodNotFound,
    [invalidName]: JSONRPC_CODES.invalidParams,
    [options.names?.internal ?? 'internal']: JSONRPC_CODES.internalError,
  };
  const code =
    options.codes[failureMode] ?? standard[failureMode] ?? failureCode(options.codes, failureMode);
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      data: details === undefined ? { failureMode } : { failureMode, details },
    },
  };
}
