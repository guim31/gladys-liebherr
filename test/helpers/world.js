// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Liebherr HomeAPI, a
// temporary /data and a manual clock, with the integration wired on top
// through registerHandlers. No timer runs unless `timers: true` (with
// node:test mock timers): the tests read with `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { API_KEY, COMBI, FRIDGE, FakeLiebherr, WINE, fixture } from './fakeLiebherr.js';

// The integration logs its lifecycle; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

/** A manual clock, shared by the hub and the tests. */
export function createClock(start = Date.UTC(2026, 9, 14, 10, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const BASE_CONFIG = { api_key: API_KEY, language: 'en', poll_interval: '120' };

/**
 * @param {object} [options]
 * @param {FakeLiebherr} [options.server]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.connect]
 */
export async function createWorld({
  clock = createClock(),
  server = new FakeLiebherr(),
  config = BASE_CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-liebherr-')),
  timings = {},
  timers = false,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    fetch: server.fetch,
    timers,
    timings,
    now: clock.now,
    authRetryDelayMs: 0,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, server, app, hub: app.hub, clock, dataDir };
}

/** External ids of an appliance and its features. */
export const deviceId = (gladys, id = COMBI) => gladys.externalIds('appliance', id).device;
export const featureId = (gladys, key, id = COMBI) =>
  gladys.externalIds('appliance', id).feature(key);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

/** The discovered device of an appliance. */
export const discovered = (world, id = COMBI) =>
  world.fake.discoveredDevices.find((device) => device.external_id === deviceId(world.gladys, id));

export { API_KEY, COMBI, FRIDGE, FakeLiebherr, WINE, fixture };
