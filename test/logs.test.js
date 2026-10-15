// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading cycle writes nothing, a failure that repeats is
// logged once, and its end once. Never the API key, at any level.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API_KEY, COMBI, WINE, createAll, createClock, createWorld } from './helpers/world.js';

/** Capture the lines of the SDK logger at the given LOG_LEVEL. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

async function world(t, options = {}) {
  const clock = createClock();
  const w = await createWorld({ clock, ...options });
  t.after(() => w.app.stop());
  const cycle = async (ms = 2 * 60_000) => {
    clock.advance(ms);
    await w.hub.pollAll();
  };
  return { ...w, cycle };
}

test('a normal reading cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  assert.ok(
    logs.texts().some((text) => /HomeAPI connected: 3 appliance\(s\)/.test(text)),
    'the start is logged',
  );
  await createAll(w);
  logs.clear();
  const fridge = w.server.control(COMBI, 'temperature', 0);
  for (let i = 0; i < 6; i += 1) {
    fridge.value = 4 + (i % 3);
    await w.cycle();
  }
  assert.deepEqual(logs.texts(), []);
});

test('the Liebherr service down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.server.down = true;
  for (let i = 0; i < 5; i += 1) {
    await w.cycle();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.equal(logs.lines[0].stream, 'err');
  assert.match(logs.lines[0].text, /HomeAPI unreachable/);

  logs.clear();
  w.server.down = false;
  await w.cycle();
  await w.cycle();
  assert.deepEqual(logs.texts().length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /answers again/);
});

test('an appliance lost and back: one line each', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.server.appliances.get(WINE).online = false;
  for (let i = 0; i < 4; i += 1) {
    await w.cycle(5 * 60_000);
  }
  w.server.appliances.get(WINE).online = true;
  await w.cycle(5 * 60_000);
  await w.cycle(5 * 60_000);
  assert.deepEqual(
    logs.texts().map((text) => text.replace(/^.*\] /, '')),
    ['Wine cellar is offline (offline)', 'Wine cellar is back online'],
  );
});

test('a user command is one line', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  logs.clear();
  const device = w.fake.discoveredDevices[0];
  const feature = device.features.find((f) => f.external_id.endsWith(':party-mode'));
  await w.fake.setValue(device, feature, 1);
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /Kitchen: partymode on/);
});

test('never the API key, even at debug and when it is refused', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t);
  await createAll(w);
  w.server.down = true;
  await w.cycle();
  w.server.down = false;
  w.server.apiKey = 'another-key';
  await w.cycle();
  await w.fake.configUpdated({ api_key: `  ${API_KEY}  `, language: 'en' });
  w.server.apiKey = API_KEY;
  await w.cycle(31 * 60_000);
  const text = logs.texts().join('\n');
  assert.ok(text.length > 0, 'debug writes something');
  assert.ok(!text.includes(API_KEY), 'never the key');
  assert.ok(!text.includes(API_KEY.slice(0, 12)), 'not even a part of it');
});
