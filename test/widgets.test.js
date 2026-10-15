// -----------------------------------------------------------------------------
// The dashboard widget: every content is checked with the SDK's own validator
// (the core's vocabulary and budget), and its buttons switch the modes.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import {
  BASE_CONFIG,
  COMBI,
  FakeLiebherr,
  WINE,
  createClock,
  createWorld,
  deviceId,
  featureId,
} from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  const get = async (settings = {}, language = 'en') => {
    const ack = await w.fake.widgetGet(WIDGET_KEY, { settings, language });
    assert.equal(ack.success, true, ack.error);
    const { content } = ack.data;
    assert.deepEqual(validateWidgetContent(content), [], 'rendered exactly as sent');
    return content;
  };
  return { ...w, get };
}

const ofType = (content, type) => content.components.filter((c) => c.type === type);

test('every appliance: one tile per zone, the alarms, no buttons', async (t) => {
  const w = await world(t);
  const content = await w.get();
  const tiles = ofType(content, 'value');
  assert.deepEqual(
    tiles.map((tile) => [tile.label, tile.value, tile.unit]),
    [
      ['Kitchen · fridge', 5, '°C'],
      ['Kitchen · freezer', -18, '°C'],
      ['Wine cellar · top', 12, '°C'],
      ['Wine cellar · bottom', 17, '°C'],
      ['IRBAd 5190-20 001', 4, '°C'],
    ],
  );
  const [status] = ofType(content, 'status');
  assert.deepEqual(status.items[0], {
    label: 'Alarms',
    value: 'No alarm',
    icon: 'check-circle',
    color: 'success',
  });
  assert.deepEqual(ofType(content, 'button'), []);
  assert.equal(content.ttl_seconds, 120);
});

test('one appliance: its zones, its modes, the SuperCool, SuperFrost and PartyMode buttons', async (t) => {
  const w = await world(t);
  const content = await w.get({ appliance: deviceId(w.gladys, COMBI) }, 'fr');
  assert.deepEqual(
    ofType(content, 'value').map((tile) => tile.label),
    ['Réfrigérateur', 'Congélateur'],
  );
  const buttons = ofType(content, 'button');
  assert.deepEqual(
    buttons.map((b) => [b.label, b.icon, b.action.key]),
    [
      ['SuperCool', 'circle', 'supercool_0'],
      ['SuperFrost', 'check-circle', 'superfrost_1'],
      ['PartyMode', 'circle', 'partymode'],
    ],
  );
  const [status] = ofType(content, 'status');
  assert.ok(
    status.items.some((item) => item.label === 'SuperFrost' && item.value === 'Congélateur'),
  );
  assert.ok(status.items.some((item) => item.label === 'NightMode' && item.value === 'Actif'));
});

test('a button switches the mode to the opposite, and Gladys is told', async (t) => {
  const w = await world(t);
  await w.fake.deviceCreated(w.fake.discoveredDevices[0]);
  const content = await w.get({ appliance: deviceId(w.gladys, COMBI) });
  const superfrost = ofType(content, 'button').find((b) => b.action.key === 'superfrost_1');
  const ack = await w.fake.widgetAction(
    WIDGET_KEY,
    superfrost.action.key,
    superfrost.action.params,
    {
      settings: { appliance: deviceId(w.gladys, COMBI) },
    },
  );
  assert.equal(ack.success, true, ack.error);
  assert.equal(ack.data.message.en, 'SuperFrost switched off.');
  assert.equal(w.server.control(COMBI, 'superfrost', 1).value, false);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'zone-1-superfrost')), 0);

  const after = await w.get({ appliance: deviceId(w.gladys, COMBI) });
  const again = ofType(after, 'button').find((b) => b.action.key === 'superfrost_1');
  assert.equal(again.icon, 'circle');
});

test('an alarm turns its tile red and heads the status list', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock, config: { ...BASE_CONFIG, alarm_delay: '15' } });
  w.server.control(COMBI, 'temperature', 1).value = -8;
  for (let i = 0; i < 9; i += 1) {
    clock.advance(2 * 60_000);
    await w.hub.pollAll();
  }
  const content = await w.get({ appliance: deviceId(w.gladys, COMBI) });
  const freezer = ofType(content, 'value').find((tile) => tile.label === 'Freezer');
  assert.equal(freezer.color, 'danger');
  const [status] = ofType(content, 'status');
  assert.deepEqual(status.items[0], {
    label: 'Freezer',
    value: 'Temperature too high, for 16 min',
    icon: 'alert-triangle',
    color: 'danger',
  });
});

test('an offline appliance shows in the status, without buttons', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  w.server.appliances.get(WINE).online = false;
  clock.advance(5 * 60_000);
  await w.hub.pollAll();
  const content = await w.get({ appliance: deviceId(w.gladys, WINE) }, 'de');
  const [status] = ofType(content, 'status');
  assert.ok(status.items.some((item) => item.label === 'Wine cellar' && item.value === 'Offline'));
  assert.deepEqual(ofType(content, 'button'), []);
});

test('the states the widget cannot show its data in: one sentence', async (t) => {
  const noKey = await world(t, { config: { language: 'en' } });
  const content = await noKey.get({}, 'es');
  assert.match(content.components[0].text, /clave de API/);

  const w = await world(t);
  const unknown = await w.get({ appliance: 'ext:test-integration:appliance:gone' });
  assert.match(unknown.components[0].text, /no longer on the Liebherr account/);

  const empty = await world(t, { server: new FakeLiebherr({ appliances: [] }) });
  const none = await empty.get();
  assert.match(none.components[0].text, /no connected appliance/);
});

test('an unknown widget action is refused', async (t) => {
  const w = await world(t);
  const ack = await w.fake.widgetAction(WIDGET_KEY, 'open_door', {
    appliance: COMBI,
    control: 'autodoor',
  });
  assert.equal(ack.success, false);
  assert.equal(w.server.count('command'), 0);
});
