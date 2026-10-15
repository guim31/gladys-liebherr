// -----------------------------------------------------------------------------
// Reading the HomeAPI answers: zones, their kind, the enums in capitals, the
// unknown controls ignored, Fahrenheit.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAppliance, structureOf } from '../src/liebherr/model.js';
import { fixture } from './helpers/fakeLiebherr.js';

const devices = fixture('devices');
const [combiDevice, wineDevice, fridgeDevice] = devices;

test('a combi: a fridge zone on top, a freezer zone below, every control read', () => {
  const appliance = parseAppliance(combiDevice, fixture('controls-combi'));
  assert.equal(appliance.type, 'combi');
  assert.equal(appliance.model, 'CBNbsd 578i-22 001');
  const [top, bottom] = appliance.zones;
  assert.deepEqual(
    {
      id: top.id,
      kind: top.kind,
      position: top.position,
      value: top.temperature,
      target: top.target,
    },
    { id: 0, kind: 'fridge', position: 'top', value: 5, target: 4 },
  );
  assert.deepEqual([top.min, top.max, top.unit], [2, 9, 'celsius']);
  assert.equal(top.supercool, false);
  assert.equal(top.superfrost, undefined);
  assert.deepEqual(top.hydroBreeze, { mode: 'low' });
  assert.deepEqual(top.bioFreshPlus, {
    mode: 'zero_zero',
    supported: ['zero_zero', 'zero_minus_two', 'minus_two_minus_two'],
    unit: 'celsius',
  });
  assert.equal(bottom.kind, 'freezer');
  assert.equal(bottom.superfrost, true);
  assert.deepEqual(bottom.iceMaker, { mode: 'off', hasMaxIce: true });
  assert.equal(appliance.partymode, false);
  assert.equal(appliance.nightmode, true);
  assert.deepEqual(appliance.presentationLight, { value: 3, max: 5 });
});

test('a wine cabinet with two zones, a fridge with steps and an AutoDoor', () => {
  const wine = parseAppliance(wineDevice, fixture('controls-wine'));
  assert.deepEqual(
    wine.zones.map((zone) => zone.kind),
    ['wine', 'wine'],
  );
  assert.equal(wine.partymode, undefined, 'absent, not unknown');

  const fridge = parseAppliance(fridgeDevice, fixture('controls-fridge'));
  assert.equal(fridge.nickname, '');
  assert.deepEqual(fridge.zones[0].steps, [2, 4, 6, 8]);
  assert.equal(fridge.zones[0].door, 'closed');
});

test('the lowercase enums of pyliebherrhomeapi are read too', () => {
  const appliance = parseAppliance({ deviceId: 'x', deviceType: 'freezer' }, [
    { type: 'IceMakerControl', name: 'icemaker', zoneId: 0, iceMakerMode: 'max_ice' },
    { type: 'AutoDoorControl', name: 'autodoor', zoneId: 0, value: 'open' },
  ]);
  assert.equal(appliance.type, 'freezer');
  assert.equal(appliance.zones[0].iceMaker.mode, 'max_ice');
  assert.equal(appliance.zones[0].door, 'open');
  assert.equal(appliance.zones[0].kind, 'freezer');
});

test('an unknown control or value is ignored, not a crash', () => {
  const appliance = parseAppliance({ deviceId: 'x', deviceType: 'TOASTER' }, [
    { type: 'SomethingNewControl', name: 'new', zoneId: 3 },
    { type: 'ToggleControl', name: 'holidaymode', value: true },
    { type: 'HydroBreezeControl', name: 'hydrobreeze', zoneId: 0, currentMode: 'TURBO' },
    { type: 'TemperatureControl', zoneId: 'one', value: 4 },
  ]);
  assert.equal(appliance.type, null);
  assert.deepEqual(
    appliance.zones.map((zone) => zone.id),
    [0],
  );
  assert.equal(appliance.zones[0].hydroBreeze.mode, null);
});

test('Fahrenheit zones, and a freezer told by its range', () => {
  const appliance = parseAppliance({ deviceId: 'x', deviceType: 'COMBI' }, [
    {
      type: 'TemperatureControl',
      name: 'temperature',
      zoneId: 0,
      value: 38,
      target: 37,
      min: 33,
      max: 46,
      unit: '°F',
    },
    {
      type: 'TemperatureControl',
      name: 'temperature',
      zoneId: 1,
      value: 0,
      target: 0,
      min: -14,
      max: 5,
      unit: '°F',
    },
  ]);
  assert.deepEqual(
    appliance.zones.map((zone) => [zone.kind, zone.unit]),
    [
      ['fridge', 'fahrenheit'],
      ['freezer', 'fahrenheit'],
    ],
  );
});

test('the structure ignores the values, not the controls', () => {
  const controls = fixture('controls-combi');
  const before = structureOf(parseAppliance(combiDevice, controls));
  controls[0].value = 9;
  controls[2].value = true;
  assert.equal(structureOf(parseAppliance(combiDevice, controls)), before);
  controls.push({ type: 'AutoDoorControl', name: 'autodoor', zoneId: 0, value: 'CLOSED' });
  assert.notEqual(structureOf(parseAppliance(combiDevice, controls)), before);
});
