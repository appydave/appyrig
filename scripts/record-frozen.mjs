#!/usr/bin/env node
/**
 * v2 W0 · frozen-data mode, RECORD half.
 *
 * Connects to a hub exactly as a browser does (the `appyrig_session` cookie, the `/` namespace),
 * listens to `fleet:update` for a few seconds, folds the payloads into one full update, then asks
 * the read-only verbs the pages call (`core:call`) for every machine, rig and seat in it, and writes
 * one snapshot file the client replays with `?frozen=<name>`.
 *
 * Read-only: it only listens and calls read-only verbs. The token is read from a file and never
 * printed.
 *
 *   node scripts/record-frozen.mjs --name busy-2026-10-18 \
 *     [--hub http://100.126.70.25:7191] [--token-file ~/.config/appyrig/token] [--listen 6]
 *     [--handoffs 60] [--keep-tail 12]
 *
 * Size control (the file is committed): seat terminal tails are cut to the last --keep-tail lines,
 * `seat.get` / `seat.history` text is cut the same way, and `handoff.get` is recorded for the newest
 * --handoffs queue rows per machine. What was cut is written into the file's `stripped` field.
 */
import { createHmac } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'test', 'fixtures', 'frozen');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const name = arg('name');
if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error('usage: record-frozen.mjs --name <kebab-name> [--hub url] [--token-file path]');
  process.exit(2);
}
const hub = arg('hub', 'http://100.126.70.25:7191');
const tokenFile = arg('token-file', path.join(homedir(), '.config', 'appyrig', 'token'));
const listenMs = Number(arg('listen', '6')) * 1000;
const handoffCap = Number(arg('handoffs', '60'));
const keepTail = Number(arg('keep-tail', '12'));

const token = readFileSync(tokenFile, 'utf8').trim();
// The browser's session cookie is an HMAC of a fixed label keyed by the hub token (browserAuth.ts).
const cookie = `appyrig_session=${createHmac('sha256', token).update('appyrig_session:v1').digest('base64url')}`;

const socket = io(hub, {
  transports: ['polling', 'websocket'],
  extraHeaders: { cookie },
  reconnection: false,
  timeout: 8000,
});

const machines = new Map();
let updates = 0;
socket.on('fleet:update', (u) => {
  updates += 1;
  for (const m of u.machines ?? []) machines.set(m.machine.id, m);
});

const stripped = [];
function cutLines(lines, what) {
  if (!Array.isArray(lines) || lines.length <= keepTail) return lines;
  stripped.push(`${what}: ${lines.length - keepTail} older lines`);
  return lines.slice(-keepTail);
}

/** Cuts every `lines` array found anywhere in a verb answer (terminal text) to the last few. */
function cutDeep(value, where) {
  if (Array.isArray(value)) return value.map((v, i) => cutDeep(v, `${where}[${i}]`));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] =
        k === 'lines' && Array.isArray(v) && v.every((x) => typeof x === 'string')
          ? cutLines(v, `${where}.${k}`)
          : cutDeep(v, `${where}.${k}`);
    }
    return out;
  }
  return value;
}

const HISTORY_EVENTS = 30;
const TEXT_MAX = 400;
const LAYER_MAX = 2000;
const FILE_MAX = 8000;

/** Verb-specific cuts so the committed file stays small. Each cut is named in `stripped`. */
function shrink(verb, a) {
  if (!a?.ok) return a;
  const v = structuredClone(a.value);
  if (verb === 'seat.history' && Array.isArray(v.events)) {
    if (v.events.length > HISTORY_EVENTS) v.truncated = true;
    v.events = v.events
      .slice(-HISTORY_EVENTS)
      .map((e) =>
        typeof e.text === 'string' && e.text.length > TEXT_MAX
          ? { ...e, text: `${e.text.slice(0, TEXT_MAX)}…` }
          : e
      );
  }
  if (verb === 'seat.loadout' && Array.isArray(v.loadout?.layers)) {
    v.loadout.layers = v.loadout.layers.map((l) =>
      typeof l.content === 'string' && l.content.length > LAYER_MAX
        ? { ...l, content: l.content.slice(0, LAYER_MAX), truncated: true }
        : l
    );
  }
  if (
    verb === 'rig.file' &&
    typeof v.file?.content === 'string' &&
    v.file.content.length > FILE_MAX
  ) {
    v.file = {
      ...v.file,
      content: `${v.file.content.slice(0, FILE_MAX)}\n… (cut for the frozen snapshot)`,
    };
  }
  return { ok: true, value: v };
}

/**
 * Many answers repeat big sub-values (a machine's skill list is the same for every seat on it).
 * Each repeated subtree over 1 KB is stored once in `refs` and replaced by {"$frozenRef": "rN"};
 * the replay puts them back.
 */
function dedupe(calls) {
  const seen = new Map();
  const count = (v) => {
    if (!v || typeof v !== 'object') return;
    const s = JSON.stringify(v);
    if (s.length > 1024) seen.set(s, (seen.get(s) ?? 0) + 1);
    for (const x of Array.isArray(v) ? v : Object.values(v)) count(x);
  };
  for (const a of Object.values(calls)) count(a);
  const refs = {};
  const idOf = new Map();
  const swap = (v) => {
    if (!v || typeof v !== 'object') return v;
    const s = JSON.stringify(v);
    if (s.length > 1024 && (seen.get(s) ?? 0) > 1) {
      if (!idOf.has(s)) {
        const id = `r${idOf.size}`;
        idOf.set(s, id);
        refs[id] = Array.isArray(v)
          ? v.map(swap)
          : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]));
      }
      return { $frozenRef: idOf.get(s) };
    }
    return Array.isArray(v)
      ? v.map(swap)
      : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]));
  };
  const out = Object.fromEntries(Object.entries(calls).map(([k, a]) => [k, swap(a)]));
  return { calls: out, refs };
}

function call(verb, input) {
  return new Promise((resolve) => {
    socket.timeout(8000).emit('core:call', { verb, input }, (err, answer) =>
      resolve(
        err || !answer
          ? {
              ok: false,
              error: { failureMode: 'timeout', message: `${verb}: no answer while recording` },
            }
          : answer
      )
    );
  });
}

/** The key the replay looks answers up by: verb plus input with sorted keys. */
function callKey(verb, input) {
  const sorted = Object.fromEntries(
    Object.entries(input ?? {}).sort(([a], [b]) => a.localeCompare(b))
  );
  return `${verb} ${JSON.stringify(sorted)}`;
}

async function main() {
  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  });
  await new Promise((r) => setTimeout(r, listenMs));
  // Stop folding: the snapshot is the fleet as it stood at the end of the listen window.
  socket.off('fleet:update');
  if (machines.size === 0) throw new Error('no fleet:update received');

  const calls = {};
  const record = async (verb, input, cut = false) => {
    const a = await call(verb, input);
    calls[callKey(verb, input)] = shrink(
      verb,
      cut ? cutDeep(a, `${verb} ${input.machine}/${input.seat ?? input.rig ?? ''}`) : a
    );
    return a;
  };

  for (const fm of machines.values()) {
    const machine = fm.machine.id;
    const snap = fm.snapshot;
    await record('db.schema', { machine });
    for (const rig of snap.rigs ?? []) {
      const r = rig.name;
      const files = await record('rig.files', { machine, rig: r });
      await record('rig.entry', { machine, rig: r });
      await record('rig.waiting', { machine, rig: r });
      await record('rig.outputs', { machine, rig: r });
      if (files.ok && files.value.status === 'ok') {
        for (const f of files.value.files)
          await record('rig.file', { machine, rig: r, fileId: f.id });
      }
    }
    const running = new Set(
      (snap.rigs ?? []).filter((r) => r.status === 'running').map((r) => r.name)
    );
    for (const seat of snap.seats ?? []) {
      if (seat.tail?.lines)
        seat.tail.lines = cutLines(seat.tail.lines, `snapshot ${machine}/${seat.id} tail`);
      // Seat verbs only for seats of running rigs: a stopped rig's seats refuse as not_in_snapshot.
      if (!running.has(seat.rig)) continue;
      await record('seat.get', { machine, seat: seat.id }, true);
      await record('seat.loadout', { machine, seat: seat.id });
      await record('seat.history', { machine, seat: seat.id }, true);
    }
    const newest = [...(snap.queue ?? [])]
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
      .slice(0, handoffCap);
    if ((snap.queue ?? []).length > newest.length)
      stripped.push(
        `handoff.get on ${machine}: recorded the newest ${newest.length} of ${snap.queue.length} queue rows`
      );
    for (const q of newest) await record('handoff.get', { machine, id: q.id });
  }
  await record('feedback.list', { limit: 3 });

  const recordedAt = new Date().toISOString();
  const file = {
    format: 'appyrig-frozen/1',
    name,
    recordedAt,
    hub,
    updatesSeen: updates,
    note: 'One full fleet:update folded from the live payloads, plus read-only verb answers keyed "<verb> <input JSON, keys sorted>". Anything not here is refused as not_in_snapshot.',
    stripped: [
      `seat terminal text: kept the last ${keepTail} lines per seat (snapshot tails, seat.get)`,
      'seat.get / seat.loadout / seat.history: recorded only for seats of rigs running at record time',
      `seat.history: the newest ${HISTORY_EVENTS} events per seat, each text cut at ${TEXT_MAX} chars`,
      `seat.loadout: prompt-layer content cut at ${LAYER_MAX} chars (marked truncated)`,
      `rig.file: content cut at ${FILE_MAX} chars`,
      ...stripped.filter((s) => !s.includes('older lines')).slice(0, 50),
      'db.rows: not recorded (OpenRig DB row pages refuse frozen)',
    ],
    update: { generatedAt: recordedAt, full: true, machines: [...machines.values()] },
    ...dedupe(calls),
  };
  mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `${name}.json`);
  writeFileSync(out, `${JSON.stringify(file)}\n`);
  const kb = Math.round(Buffer.byteLength(JSON.stringify(file)) / 1024);
  console.log(
    `wrote ${path.relative(ROOT, out)} · ${kb} KB · ${machines.size} machines · ${Object.keys(file.calls).length} verb answers · ${updates} updates seen`
  );
}

main()
  .catch((e) => {
    console.error(`record-frozen: ${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => socket.close());
