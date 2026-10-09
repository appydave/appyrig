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
 * --once pushes one snapshot per scenario, prints the acks and exits 1 if any was refused.
 * Stop it (Ctrl-C) to watch the hub mark the machine asleep after 15 s.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { io } from 'socket.io-client';

const here = dirname(fileURLToPath(import.meta.url));
const snapshotsDir = resolve(here, '../../test/fixtures/snapshots');

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
  return JSON.parse(readFileSync(resolve(snapshotsDir, `${scenario}.json`), 'utf8'));
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
    socket.on('connect', () => {
      console.log(`[${scenario}] connected to ${values.hub}/collector as ${machineId}`);
      push();
      if (!values.once) timer = setInterval(push, intervalMs);
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
if (values.once) process.exit(results.every(Boolean) ? 0 : 1);
