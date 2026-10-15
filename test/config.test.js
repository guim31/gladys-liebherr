import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/config.js';

test('the defaults', () => {
  assert.deepEqual(normalizeConfig(), {
    apiKey: '',
    pollIntervalMs: 120_000,
    alarmMarginCelsius: 3,
    alarmDelayMs: 30 * 60_000,
    doorAlarmDelayMs: 5 * 60_000,
    language: 'fr',
  });
  assert.deepEqual(normalizeConfig(null), normalizeConfig(DEFAULT_CONFIG));
});

test('the key is trimmed: pasted from the app, it carries spaces or a line break', () => {
  assert.equal(normalizeConfig({ api_key: '  abc-123\n' }).apiKey, 'abc-123');
  assert.equal(normalizeConfig({ api_key: 42 }).apiKey, '');
});

test('values outside the lists fall back to the defaults', () => {
  const config = normalizeConfig({
    poll_interval: '5',
    alarm_margin: 'x',
    alarm_delay: 30,
    door_alarm_delay: '10',
    language: 'it',
  });
  assert.equal(config.pollIntervalMs, 120_000, 'never faster than a minute');
  assert.equal(config.alarmMarginCelsius, 3);
  assert.equal(config.alarmDelayMs, 30 * 60_000, 'a number is read like its string');
  assert.equal(config.doorAlarmDelayMs, 10 * 60_000);
  assert.equal(config.language, 'fr');
});
