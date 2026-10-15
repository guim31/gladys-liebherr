// -----------------------------------------------------------------------------
// The alarms the integration works out (the HomeAPI reports none): the
// temperature above the setpoint plus the margin, the AutoDoor open, the
// appliance offline — each after its delay, fired once as a scene event, and
// once more when it is over, even across a restart.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAlarms, marginIn } from '../src/alarms.js';
import { normalizeConfig } from '../src/config.js';
import { COMBI, FRIDGE, createClock, createWorld, deviceId } from './helpers/world.js';

const config = normalizeConfig({ alarm_margin: '3', alarm_delay: '30', door_alarm_delay: '5' });
const MINUTE = 60_000;

const zone = (fields) => ({
  id: 0,
  kind: 'freezer',
  unit: 'celsius',
  temperature: -18,
  target: -18,
  door: undefined,
  ...fields,
});
const appliance = (zones) => ({ id: 'A', zones });

/** Run readings through the evaluation, return every transition. */
function run(readings, start = 0) {
  let state = {};
  const transitions = [];
  for (const [minute, records] of readings) {
    const result = evaluateAlarms({ records, state, config, now: start + minute * MINUTE });
    state = result.state;
    transitions.push(...result.transitions.map((t) => ({ minute, ...t })));
  }
  return { state, transitions };
}

test('a zone above setpoint + margin for the delay raises one alarm, then clears it', () => {
  const warm = (temperature) => [{ appliance: appliance([zone({ temperature })]), online: true }];
  const { transitions } = run([
    [0, warm(-18)],
    [10, warm(-14)], // above -15: the clock starts
    [20, warm(-12)],
    [39, warm(-12)],
    [40, warm(-11)], // 30 minutes
    [50, warm(-10)],
    [70, warm(-15)], // back within the margin
  ]);
  assert.deepEqual(
    transitions.map((t) => [t.type, t.minute, t.kind, t.minutes, t.temperature]),
    [
      ['raised', 40, 'temperature', 30, -11],
      ['cleared', 70, 'temperature', 60, -15],
    ],
  );
});

test('a short opening of the door is not an alarm', () => {
  const warm = (temperature) => [{ appliance: appliance([zone({ temperature })]), online: true }];
  const { transitions } = run([
    [0, warm(-10)],
    [20, warm(-16)],
    [40, warm(-10)],
    [60, warm(-18)],
  ]);
  assert.deepEqual(transitions, []);
});

test('lowering the setpoint is not an alarm while the zone cools down', () => {
  const at = (temperature, target) => [
    { appliance: appliance([zone({ temperature, target })]), online: true },
  ];
  const { transitions } = run([
    [0, at(-16, -16)],
    [1, at(-16, -22)], // set lower: -16 is far above -22 + 3
    [60, at(-18, -22)],
    [120, at(-19, -22)], // within the margin of the new setpoint
    [130, at(-14, -22)], // now above it
    [160, at(-14, -22)],
  ]);
  assert.deepEqual(
    transitions.map((t) => [t.type, t.minute]),
    [['raised', 160]],
  );
});

test('the margin is converted for a Fahrenheit zone', () => {
  assert.equal(marginIn('fahrenheit', 3), 5);
  assert.equal(marginIn('celsius', 3), 3);
  const at = (temperature) => [
    {
      appliance: appliance([zone({ unit: 'fahrenheit', temperature, target: 0 })]),
      online: true,
    },
  ];
  assert.deepEqual(
    run([
      [0, at(5)],
      [40, at(5)],
    ]).transitions,
    [],
  );
  assert.equal(
    run([
      [0, at(6)],
      [40, at(6)],
    ]).transitions.length,
    1,
  );
});

test('an AutoDoor open for the door delay, and an appliance offline for the delay', () => {
  const door = (state) => [{ appliance: appliance([zone({ door: state })]), online: true }];
  const doors = run([
    [0, door('closed')],
    [1, door('open')],
    [6, door('moving')],
    [8, door('closed')],
  ]).transitions;
  assert.deepEqual(
    doors.map((t) => [t.type, t.kind, t.minute]),
    [
      ['raised', 'door', 6],
      ['cleared', 'door', 8],
    ],
  );

  const records = (online) => [{ appliance: appliance([zone({})]), online }];
  const offline = run([
    [0, records(true)],
    [5, records(false)],
    [30, records(false)],
    [35, records(false)],
    [50, records(true)],
  ]).transitions;
  assert.deepEqual(
    offline.map((t) => [t.type, t.kind, t.minute, t.minutes]),
    [
      ['raised', 'offline', 35, 30],
      ['cleared', 'offline', 50, 45],
    ],
  );
});

test('nothing known (the service down) moves no alarm', () => {
  const warm = [{ appliance: appliance([zone({ temperature: -5 })]), online: true }];
  const unknown = [{ appliance: appliance([zone({ temperature: -5 })]), online: null }];
  const { state, transitions } = run([
    [0, warm],
    [10, unknown],
    [60, unknown],
  ]);
  assert.deepEqual(transitions, []);
  assert.equal(state['A|temperature|0'].since, 0, 'the condition keeps its start');
});

test('the hub fires the scene events once, and not again after a restart', async (t) => {
  const clock = createClock();
  const config = {
    api_key: 'test-api-key-0123456789abcdef',
    language: 'fr',
    alarm_delay: '15',
  };
  const w = await createWorld({ clock, config });
  t.after(() => w.app.stop());
  const freezer = w.server.control(COMBI, 'temperature', 1);
  freezer.value = -9;
  for (let minute = 0; minute <= 30; minute += 2) {
    clock.advance(2 * 60_000);
    await w.hub.pollAll();
  }
  const raised = w.fake.sceneEvents.filter((event) => event.key === 'alarm_raised');
  assert.equal(raised.length, 1);
  assert.deepEqual(raised[0].data, {
    device: deviceId(w.gladys, COMBI),
    kind: 'temperature',
    appliance: 'Kitchen',
    zone: 'Congélateur',
    temperature: -9,
    target: -18,
    unit: '°C',
    minutes: 16,
  });
  await w.app.stop();

  // A restart while the alarm lasts: not announced again.
  const again = await createWorld({ clock, config, server: w.server, dataDir: w.dataDir });
  t.after(() => again.app.stop());
  clock.advance(2 * 60_000);
  await again.hub.pollAll();
  assert.equal(again.fake.sceneEvents.length, 0);

  freezer.value = -18;
  clock.advance(2 * 60_000);
  await again.hub.pollAll();
  assert.deepEqual(
    again.fake.sceneEvents.map((event) => [event.key, event.data.kind, event.data.zone]),
    [['alarm_cleared', 'temperature', 'Congélateur']],
  );
});

test('the AutoDoor alarm of the fridge, through the hub', async (t) => {
  const clock = createClock();
  const w = await createWorld({ clock });
  t.after(() => w.app.stop());
  w.server.control(FRIDGE, 'autodoor', 0).value = 'OPEN';
  for (let i = 0; i < 4; i += 1) {
    clock.advance(2 * 60_000);
    await w.hub.pollAll();
  }
  const [event] = w.fake.sceneEvents;
  assert.equal(event.key, 'alarm_raised');
  assert.equal(event.data.kind, 'door');
  assert.equal(event.data.appliance, 'IRBAd 5190-20 001');
});
