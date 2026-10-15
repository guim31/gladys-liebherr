// -----------------------------------------------------------------------------
// The hub against the fake HomeAPI: devices published, states sent once the
// device is added, commands within the appliance's bounds, appliances going
// offline and back, a new appliance, the cache under /data, the connection
// status and the pauses after a refused key or a 429.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_CONFIG,
  COMBI,
  FRIDGE,
  FakeLiebherr,
  WINE,
  createAll,
  createClock,
  createWorld,
  deviceId,
  discovered,
  featureId,
} from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const feature = (w, key, id = COMBI) =>
  discovered(w, id).features.find((f) => f.external_id === featureId(w.gladys, key, id));

const setValue = (w, key, value, id = COMBI) =>
  w.fake.setValue(discovered(w, id), feature(w, key, id), value);

test('every appliance is published, its states only once it is added to Gladys', async (t) => {
  const w = await world(t);
  assert.equal(w.fake.discoveredDevices.length, 3);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.equal(w.fake.states.length, 0, 'Gladys drops states of a device it does not have');

  await w.fake.deviceCreated(discovered(w));
  assert.equal(w.fake.lastState(featureId(w.gladys, 'zone-0-temperature')), 5);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'zone-1-target')), -18);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'zone-1-icemaker')), 'off');
  assert.equal(w.fake.lastState(featureId(w.gladys, 'zone-0-biofreshplus')), 'zero_zero');
  assert.equal(w.fake.lastState(featureId(w.gladys, 'night-mode')), 1);
  assert.ok(
    w.fake.states.every((s) => s.device_feature_external_id.startsWith(deviceId(w.gladys))),
    'only the added appliance',
  );
  assert.ok(w.fake.widgetRefreshes.length >= 1, 'the widget is told');
});

test('the device name is the nickname, else the model; the model is a param', async (t) => {
  const w = await world(t);
  assert.equal(discovered(w, COMBI).name, 'Kitchen');
  assert.equal(discovered(w, FRIDGE).name, 'IRBAd 5190-20 001');
  assert.deepEqual(discovered(w, COMBI).params, [
    { name: 'LIEBHERR_MODEL', value: 'CBNbsd 578i-22 001' },
  ]);
});

test('feature names follow the configured language, French by default', async (t) => {
  const w = await world(t, { config: { api_key: BASE_CONFIG.api_key } });
  const names = discovered(w, COMBI).features.map((f) => f.name);
  assert.ok(names.includes('Réfrigérateur · Température'));
  assert.ok(names.includes('Congélateur · Consigne'));
  assert.ok(names.includes('Éclairage de présentation'));
  const wine = discovered(w, WINE).features.map((f) => f.name);
  assert.ok(wine.includes('Cave à vin (haut) · Température'));
  assert.ok(wine.includes('Cave à vin (bas) · Température'));
});

test('a setpoint is sent within the bounds, and published at once', async (t) => {
  const w = await world(t);
  await createAll(w);
  const ack = await setValue(w, 'zone-1-target', -20);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(w.server.requests.at(-1).body, { zoneId: 1, target: -20, unit: '°C' });
  assert.equal(w.server.control(COMBI, 'temperature', 1).target, -20);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'zone-1-target')), -20);
});

test('a setpoint outside the bounds is refused, never brought back in range', async (t) => {
  const w = await world(t);
  await createAll(w);
  const before = w.server.count('command');
  for (const value of [20, -40, 'warm']) {
    const ack = await setValue(w, 'zone-0-target', value);
    assert.equal(ack.success, false, `${value} refused`);
    assert.match(ack.error, /2 to 9 °C/);
  }
  assert.equal(w.server.count('command'), before, 'nothing sent to the appliance');
  assert.equal(w.server.control(COMBI, 'temperature', 0).target, 4);
});

test('an appliance with setting steps gets the nearest step', async (t) => {
  const w = await world(t);
  await createAll(w);
  const target = feature(w, 'zone-0-target', FRIDGE);
  assert.equal(target.step, 2, 'the dashboard +/- follows the steps');
  const ack = await setValue(w, 'zone-0-target', 5.4, FRIDGE);
  assert.equal(ack.success, true, ack.error);
  assert.equal(w.server.requests.at(-1).body.target, 6);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'zone-0-target', FRIDGE)), 6);
});

test('the switches, the modes and the light', async (t) => {
  const w = await world(t);
  await createAll(w);
  const sent = () => w.server.requests.at(-1);

  assert.equal((await setValue(w, 'zone-0-supercool', 1)).success, true);
  assert.deepEqual(
    [sent().path, sent().body],
    ['/v1/devices/26.111.222.3/controls/supercool', { zoneId: 0, value: true }],
  );
  assert.equal(w.fake.lastState(featureId(w.gladys, 'zone-0-supercool')), 1);

  assert.equal((await setValue(w, 'zone-1-superfrost', 0)).success, true);
  assert.deepEqual(sent().body, { zoneId: 1, value: false });

  assert.equal((await setValue(w, 'party-mode', 1)).success, true);
  assert.deepEqual(
    [sent().path, sent().body],
    ['/v1/devices/26.111.222.3/controls/partymode', { value: true }],
  );

  assert.equal((await setValue(w, 'zone-1-icemaker', 'max_ice')).success, true);
  assert.deepEqual(sent().body, { zoneId: 1, iceMakerMode: 'MAX_ICE' });
  assert.equal(w.fake.lastState(featureId(w.gladys, 'zone-1-icemaker')), 'max_ice');

  assert.equal((await setValue(w, 'zone-0-hydrobreeze', 'high')).success, true);
  assert.deepEqual(sent().body, { zoneId: 0, hydroBreezeMode: 'HIGH' });

  assert.equal((await setValue(w, 'zone-0-biofreshplus', 'zero_minus_two')).success, true);
  assert.deepEqual(sent().body, { zoneId: 0, bioFreshPlusMode: 'ZERO_MINUS_TWO' });

  // Gladys sends a percentage to a light: kept within the appliance levels.
  assert.equal((await setValue(w, 'presentation-light', 80)).success, true);
  assert.deepEqual(sent().body, { target: 5 });
  assert.equal(w.fake.lastState(featureId(w.gladys, 'presentation-light')), 5);
});

test('a mode the appliance does not offer is refused before any call', async (t) => {
  const w = await world(t);
  await createAll(w);
  const before = w.server.count('command');
  const ack = await setValue(w, 'zone-0-biofreshplus', 'minus_two_zero');
  assert.equal(ack.success, false);
  assert.match(ack.error, /not offered/);
  assert.equal(w.server.count('command'), before);
});

test('read-only features cannot be set: temperature, door', async (t) => {
  const w = await world(t);
  await createAll(w);
  const before = w.server.count('command');
  assert.equal((await setValue(w, 'zone-0-temperature', 3)).success, false);
  assert.equal((await setValue(w, 'zone-0-door', 0, FRIDGE)).success, false);
  assert.equal(w.server.count('command'), before, 'the door is never opened from Gladys');
});

test('a command to an offline appliance says so', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.server.appliances.get(COMBI).online = false;
  const ack = await setValue(w, 'party-mode', 1);
  assert.equal(ack.success, false);
  assert.equal(ack.error, 'Kitchen: appliance offline');
});

test('an appliance offline: unreachable, kept in Discovery, back online later', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  await createAll(w);
  w.server.appliances.get(WINE).online = false;
  clock.advance(5 * 60_000);
  await w.hub.pollAll();
  assert.equal(w.fake.discoveredDevices.length, 3, 'still in Discovery');
  assert.deepEqual(w.fake.transports.at(-1), {
    device_external_id: deviceId(w.gladys, WINE),
    transport: 'unreachable',
  });

  w.server.appliances.get(WINE).online = true;
  w.server.control(WINE, 'temperature', 0).value = 13;
  clock.advance(5 * 60_000);
  await w.hub.pollAll();
  assert.deepEqual(w.fake.transports.at(-1), {
    device_external_id: deviceId(w.gladys, WINE),
    transport: 'cloud',
  });
  assert.equal(w.fake.lastState(featureId(w.gladys, 'zone-0-temperature', WINE)), 13);
});

test('an appliance offline at start is restored from /data', async (t) => {
  const clock = createClock();
  const first = await createWorld({ clock });
  await first.app.stop();

  const server = new FakeLiebherr();
  server.appliances.get(WINE).online = false;
  const w = await world(t, { clock, server, dataDir: first.dataDir });
  const wine = discovered(w, WINE);
  assert.ok(wine, 'the offline appliance stays in Discovery');
  assert.equal(wine.features.length, 5);
  assert.equal(server.count('controls'), 2, 'only the listed appliances are read');
});

test('a new appliance on the account appears at the next list', async (t) => {
  const clock = createClock();
  const server = new FakeLiebherr({ appliances: [COMBI] });
  const w = await world(t, { clock, server });
  assert.equal(w.fake.discoveredDevices.length, 1);
  const other = new FakeLiebherr();
  server.appliances.set(WINE, other.appliances.get(WINE));
  clock.advance(5 * 60_000);
  await w.hub.pollAll();
  assert.equal(w.fake.discoveredDevices.length, 2);
});

test('an appliance gone from the account for a week leaves Discovery, unless added', async (t) => {
  const clock = createClock();
  const server = new FakeLiebherr();
  const w = await world(t, { clock, server });
  await w.fake.deviceCreated(discovered(w, COMBI));
  server.appliances.delete(WINE);
  server.appliances.delete(COMBI);
  clock.advance(8 * 24 * 60 * 60_000);
  await w.hub.pollAll();
  assert.deepEqual(w.fake.discoveredDevices.map((device) => device.name).sort(), [
    'IRBAd 5190-20 001',
    'Kitchen',
  ]);
});

test('no API key: nothing is called, the status says what to do', async (t) => {
  const server = new FakeLiebherr();
  const w = await world(t, { server, config: { language: 'fr' } });
  assert.equal(server.requests.length, 0);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.fr, /clé d'API/);
  assert.deepEqual(w.fake.discoveredDevices, []);
});

test('a refused key: told once, then left alone for 30 minutes', async (t) => {
  const clock = createClock();
  const server = new FakeLiebherr();
  const w = await world(t, { clock, server, config: { ...BASE_CONFIG, api_key: 'old-key' } });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /API key refused/);
  const calls = server.requests.length;
  for (let i = 0; i < 10; i += 1) {
    clock.advance(2 * 60_000);
    await w.hub.pollAll();
  }
  assert.equal(server.requests.length, calls, 'no call while the key is refused');
  clock.advance(10 * 60_000);
  await w.hub.pollAll();
  assert.ok(server.requests.length > calls, 'tried again after 30 minutes');

  // A new key is tried at once.
  await w.fake.configUpdated({ ...BASE_CONFIG });
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('a 429 pauses the readings, longer each time', async (t) => {
  const clock = createClock();
  const server = new FakeLiebherr();
  const w = await world(t, { clock, server });
  server.rateLimited = true;
  clock.advance(2 * 60_000);
  await w.hub.pollAll();
  assert.equal(w.fake.connectionStatus.connected, false);
  const calls = server.requests.length;
  clock.advance(60_000);
  await w.hub.pollAll();
  assert.equal(server.requests.length, calls, 'paused');
  clock.advance(60_000);
  await w.hub.pollAll();
  assert.equal(server.requests.length, calls + 1, 'one try after the pause');
  clock.advance(2 * 60_000);
  await w.hub.pollAll();
  assert.equal(server.requests.length, calls + 1, 'the pause doubled');
  server.rateLimited = false;
  clock.advance(2 * 60_000);
  await w.hub.pollAll();
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('the Liebherr service down: unreachable, no appliance taken for offline', async (t) => {
  const clock = createClock();
  const server = new FakeLiebherr();
  const w = await world(t, { clock, server });
  await createAll(w);
  server.down = true;
  clock.advance(2 * 60_000);
  await w.hub.pollAll();
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /does not answer/);
  assert.ok(
    w.fake.transports.slice(-3).every((entry) => entry.transport === 'unreachable'),
    'every appliance unreachable',
  );
  assert.ok(
    [...w.hub.records.values()].every((record) => record.online === null),
    'unknown, not offline',
  );
});

test('a key accepted with no appliance says so', async (t) => {
  const w = await world(t, { server: new FakeLiebherr({ appliances: [] }) });
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.match(w.fake.connectionStatus.message.en, /no connected appliance/);
});

test('"Test the connection" reads now and reports each appliance', async (t) => {
  const w = await world(t);
  w.server.appliances.get(WINE).online = false;
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true, ack.error);
  const { en, fr } = ack.data.message;
  assert.match(en, /^2 appliance\(s\) on the Liebherr account\./);
  assert.match(en, /Kitchen: Fridge 5 °C \(setpoint 4 °C\), Freezer −18 °C/);
  assert.match(en, /Wine cellar: offline/);
  assert.match(fr, /Kitchen : Réfrigérateur 5 °C \(consigne 4 °C\)/);
});

test('"Search" in the Discovery tab reads the list again', async (t) => {
  const w = await world(t);
  const lists = w.server.count('list');
  await w.fake.scanRequest();
  assert.equal(w.server.count('list'), lists + 1);
});
