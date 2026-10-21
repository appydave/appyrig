#!/usr/bin/env node
/**
 * fake-collector — replays recorded snapshots into a hub, as a collector would.
 *
 * Reads AppyRig-shaped snapshots from test/fixtures/snapshots/<scenario>.json, stamps a fresh
 * collectedAt, and pushes each over the `/collector` Socket.IO namespace every --interval ms.
 * It never reads a live machine.
 *
 * Usage (from the repo root or server/):
 *   node server/scripts/fake-collector.mjs [--hub http://localhost:7191] [--token <t> | --token-file <path>]
 *        [--scenario roamy] [--scenario m2] [--interval 3000] [--once]
 *
 * Scenarios: roamy (live Roamy kernel + starter), m2 (6 stopped rigs), roamy--blocked (synthetic
 * permission prompt on dev-build@starter). Token falls back to $HUB_TOKEN.
 * The m2 scenario also replays the v1.4 channels (not with --once): rig files for fliedit-team
 * (test/fixtures/rigfiles/) and the OpenRig database shape (test/fixtures/openrig-schema-0.6.6.json),
 * first as a slightly older version (0.6.5) and then as 0.6.6, so the hub has a schema change to show.
 * --once pushes one snapshot per scenario, prints the acks and exits 1 if any was refused.
 * Stop it (Ctrl-C) to watch the hub mark the machine asleep after 15 s.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { io } from 'socket.io-client';

const here = dirname(fileURLToPath(import.meta.url));
const snapshotsDir = resolve(here, '../../test/fixtures/snapshots');
const fixturesDir = resolve(here, '../../test/fixtures');

const { values } = parseArgs({
  options: {
    hub: { type: 'string', default: process.env.HUB_URL ?? 'http://localhost:7191' },
    token: { type: 'string' },
    'token-file': { type: 'string' },
    scenario: { type: 'string', multiple: true },
    interval: { type: 'string', default: '3000' },
    once: { type: 'boolean', default: false },
  },
});

const token =
  values.token ??
  (values['token-file'] ? readFileSync(values['token-file'], 'utf8').trim() : undefined) ??
  process.env.HUB_TOKEN ??
  '';
const scenarios = values.scenario?.length ? values.scenario : ['roamy', 'm2'];
const intervalMs = Number(values.interval);

function load(scenario) {
  const snap = JSON.parse(readFileSync(resolve(snapshotsDir, `${scenario}.json`), 'utf8'));

  if (scenario === 'm2') {
    // v1.4 rig fields: one rig has a spec (its files are replayed below), the rest were looked for and not found.
    snap.rigs = snap.rigs.map((r) =>
      r.name === 'fliedit-team'
        ? {
            ...r,
            specStatus: 'found',
            specPath: '/fixtures/fliedit-team/rig.yaml',
            summary: 'FliEdit overlay gaps plus viewer verbs (fixture).',
          }
        : { ...r, specStatus: 'not-found', specPath: null, summary: null }
    );
  }

  return snap;
}

/** The fliedit-team fixture files, shaped as the collector sends them (one chunk, first replaces). */
function rigFilesPush(machineId) {
  const dir = resolve(fixturesDir, 'rigfiles/fliedit-team');
  const files = readdirSync(dir)
    .sort()
    .map((name) => {
      const content = readFileSync(resolve(dir, name), 'utf8');
      const cut = name.startsWith('LEARNED');

      return {
        id: `spec:${name}`,
        name,
        scope: 'spec',
        bytes: cut ? 900_000 : Buffer.byteLength(content),
        modifiedAt: statSync(resolve(dir, name)).mtime.toISOString(),
        truncated: cut, // the fixture pretends this one was cut, so the viewer's "cut" notice has something to show
        content,
      };
    });

  return {
    machineId,
    collectedAt: new Date().toISOString(),
    rig: 'fliedit-team',
    replace: true,
    files,
  };
}

/** The real OpenRig 0.6.6 shape, and an invented 0.6.5 that differs: one table fewer, one column fewer, one type. */
function schemaPushes(machineId) {
  const real = JSON.parse(readFileSync(resolve(fixturesDir, 'openrig-schema-0.6.6.json'), 'utf8'));
  const older = structuredClone(real.tables);

  older.pop();

  const first = older.find((t) => t.columns.length > 2);

  first.columns.pop();
  first.columns[0].type = 'INTEGER';

  const mk = (version, tables) => ({
    machineId,
    collectedAt: new Date().toISOString(),
    status: 'ok',
    reason: null,
    openrigVersion: version,
    tables,
  });

  return [mk('0.6.5 (fixture00)', older), mk(real.openrigVersion, real.tables)];
}

function run(scenario) {
  const base = load(scenario);
  const machineId = base.machine.id;
  const socket = io(`${values.hub}/collector`, {
    auth: { token, machineId },
    transports: ['websocket'],
    reconnection: !values.once,
  });

  return new Promise((resolveRun) => {
    let timer;
    const push = () => {
      const snapshot = { ...base, collectedAt: new Date().toISOString() };

      socket.timeout(5000).emit('collector:snapshot', snapshot, (err, ack) => {
        const result = err ? { ok: false, failureMode: 'timeout', message: String(err) } : ack;

        console.log(`[${scenario}] ${JSON.stringify(result)}`);
        if (values.once) {
          socket.close();
          resolveRun(result.ok);
        }
      });
    };

    const emitAcked = (event, payload) =>
      new Promise((r) =>
        socket
          .timeout(5000)
          .emit(event, payload, (err, ack) => r(err ? { ok: false, failureMode: 'timeout' } : ack))
      );

    socket.on('connect', () => {
      console.log(`[${scenario}] connected to ${values.hub}/collector as ${machineId}`);
      push();
      if (scenario === 'm2' && !values.once) {
        void (async () => {
          console.log(
            `[${scenario}] rig files ${JSON.stringify(await emitAcked('collector:rigfiles', rigFilesPush(machineId)))}`
          );
          for (const s of schemaPushes(machineId)) {
            console.log(
              `[${scenario}] schema ${s.openrigVersion} ${JSON.stringify(await emitAcked('collector:schema', s))}`
            );
            await new Promise((r) => setTimeout(r, 300));
          }
        })();
      }

      if (!values.once) {
        timer = setInterval(push, intervalMs);
      }
    });
    socket.on('connect_error', (err) => {
      console.error(`[${scenario}] refused: ${err.message}`);
      if (values.once) {
        socket.close();
        resolveRun(false);
      }
    });
    socket.on('disconnect', () => clearInterval(timer));
  });
}

const results = await Promise.all(scenarios.map(run));

if (values.once) {
  process.exit(results.every(Boolean) ? 0 : 1);
}
