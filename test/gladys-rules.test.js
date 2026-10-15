// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures: a combi with every control, a two-zone wine cabinet, a fridge with
// setting steps and an AutoDoor, a Fahrenheit appliance — in every
// feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorld, BASE_CONFIG, FakeLiebherr, COMBI } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

/** A server whose combi is set in Fahrenheit (a US appliance). */
function fahrenheitServer() {
  const server = new FakeLiebherr();
  for (const control of server.controls(COMBI)) {
    if (control.type === 'TemperatureControl') {
      control.unit = '°F';
      control.value = Math.round(control.value * 1.8 + 32);
      control.target = Math.round(control.target * 1.8 + 32);
      control.min = Math.round(control.min * 1.8 + 32);
      control.max = Math.round(control.max * 1.8 + 32);
    }
    if (control.type === 'BioFreshPlusControl') {
      control.temperatureUnit = '°F';
    }
  }
  return server;
}

const scenarios = [
  { label: 'English names', config: { ...BASE_CONFIG, language: 'en' } },
  { label: 'French names', config: { ...BASE_CONFIG, language: 'fr' } },
  { label: 'German names', config: { ...BASE_CONFIG, language: 'de' } },
  { label: 'Spanish names', config: { ...BASE_CONFIG, language: 'es' } },
  { label: 'Fahrenheit', config: BASE_CONFIG, server: fahrenheitServer },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const world = await createWorld({
      config: scenario.config,
      server: scenario.server ? scenario.server() : undefined,
    });
    try {
      const devices = world.fake.discoveredDevices;
      assert.equal(devices.length, 3, 'the three fixture appliances');
      const deviceNames = new Set();

      for (const device of devices) {
        const where = device.name;
        assert.ok(!deviceNames.has(device.name), `${where}: duplicate device name`);
        deviceNames.add(device.name);

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
            const allowed = table.units_by_category[feature.category];
            if (allowed) {
              assert.ok(
                allowed.includes(feature.unit),
                `${at}: unit ${feature.unit} for ${feature.category}`,
              );
            }
          }
          if (feature.step !== undefined) {
            assert.ok(Number.isFinite(feature.step) && feature.step > 0, `${at}: step > 0`);
          }
          if (feature.supported_options !== undefined) {
            assert.equal(feature.type, 'select', `${at}: string options on a text/select only`);
            const values = feature.supported_options.map((option) => option.value);
            assert.equal(new Set(values).size, values.length, `${at}: duplicate option`);
            for (const option of feature.supported_options) {
              assert.ok(typeof option.label === 'string' && option.label, `${at}: option label`);
            }
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(
            feature.external_id.startsWith(`${device.external_id}:`),
            `${at}: id of the device`,
          );
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
        }
      }
    } finally {
      await world.app.stop();
    }
  });
}

test('an AutoDoor is a read-only opening sensor, never a command', async () => {
  const world = await createWorld();
  try {
    for (const device of world.fake.discoveredDevices) {
      for (const feature of device.features.filter((f) => f.external_id.endsWith('-door'))) {
        assert.equal(feature.category, 'opening-sensor');
        assert.equal(feature.read_only, true);
      }
    }
  } finally {
    await world.app.stop();
  }
});
