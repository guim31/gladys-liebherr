// -----------------------------------------------------------------------------
// The reading timer of the container. Gladys never polls a device created
// without should_poll, and not reliably otherwise (GladysAssistant/Gladys#3198):
// the HomeAPI is read by the hub's own timer, with no onPoll at all; the
// core's onPoll is a fallback that does nothing while the timer keeps up.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_CONFIG,
  COMBI,
  createAll,
  createClock,
  createWorld,
  discovered,
  featureId,
} from './helpers/world.js';

/** Let the timer callback and the fake network settle. */
const settle = async () => {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

async function timedWorld(t, config = BASE_CONFIG) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock();
  const w = await createWorld({ clock, config, timers: true });
  t.after(() => w.app.stop());
  const tick = async (ms) => {
    clock.advance(ms);
    t.mock.timers.tick(ms);
    await settle();
  };
  return { ...w, tick };
}

test('the internal timer refreshes the states without any onPoll from Gladys', async (t) => {
  const w = await timedWorld(t);
  const polled = t.mock.method(w.hub, 'pollDevice');
  await createAll(w);
  const fridge = w.server.control(COMBI, 'temperature', 0);
  for (const value of [6, 7, 5]) {
    fridge.value = value;
    await w.tick(120_000);
    assert.equal(w.fake.lastState(featureId(w.gladys, 'zone-0-temperature')), value);
  }
  assert.equal(polled.mock.callCount(), 0, 'no onPoll involved');
});

test('the call budget: N controls per interval, the list every 5 minutes', async (t) => {
  const w = await timedWorld(t);
  const start = { list: w.server.count('list'), controls: w.server.count('controls') };
  for (let i = 0; i < 6; i += 1) {
    await w.tick(120_000); // 12 minutes
  }
  assert.equal(w.server.count('controls') - start.controls, 18, '3 appliances × 6 readings');
  // Due 5 minutes after the last one, read at the next cycle: minutes 6 and 12.
  assert.equal(w.server.count('list') - start.list, 2, 'the list twice in 12 minutes');
});

test('the interval follows the configuration', async (t) => {
  const w = await timedWorld(t, { ...BASE_CONFIG, poll_interval: '300' });
  const start = w.server.count('controls');
  await w.tick(120_000);
  await w.tick(120_000);
  assert.equal(w.server.count('controls'), start, 'nothing before 5 minutes');
  await w.tick(60_000);
  assert.equal(w.server.count('controls'), start + 3);
});

test("the core's onPoll reads nothing while the timer keeps up", async (t) => {
  const w = await timedWorld(t);
  await createAll(w);
  const device = discovered(w);
  const start = w.server.requests.length;
  for (let i = 0; i < 5; i += 1) {
    w.clock.advance(20_000);
    assert.deepEqual(await w.fake.poll(device), { success: true });
  }
  assert.equal(w.server.requests.length, start, 'the timer read 100 s ago: nothing');
});

test("the core's onPoll reads when the timer stalls", async (t) => {
  const clock = createClock();
  const w = await createWorld({ clock });
  t.after(() => w.app.stop());
  await createAll(w);
  const start = w.server.count('controls');
  clock.advance(110_000);
  await w.fake.poll(discovered(w));
  assert.equal(w.server.count('controls'), start + 3);
});

test('the timer stops with the integration', async (t) => {
  const w = await timedWorld(t);
  await w.app.stop();
  const before = w.server.requests.length;
  await w.tick(30 * 60_000);
  assert.equal(w.server.requests.length, before);
});

test('unchanged values are sent again every 12 hours (no "no recent value")', async (t) => {
  // The SDK dates its heartbeat with Date.now(): both clocks move together.
  const clock = createClock();
  t.mock.timers.enable({ apis: ['Date'], now: clock.time });
  const advance = (ms) => {
    clock.advance(ms);
    t.mock.timers.tick(ms);
  };
  const w = await createWorld({ clock });
  t.after(() => w.app.stop());
  await createAll(w);
  const first = w.fake.states.length;
  advance(2 * 60_000);
  await w.hub.pollAll();
  assert.equal(w.fake.states.length, first, 'nothing changed, nothing sent');
  advance(12 * 60 * 60_000);
  await w.hub.pollAll();
  assert.equal(w.fake.states.length, first * 2, 'everything again after 12 h');
});
