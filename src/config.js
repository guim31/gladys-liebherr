// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds. One minute at
// the fastest: the HomeAPI limits the number of calls and Liebherr has blocked
// clients that called too often (see CLAUDE.md, "Liebherr HomeAPI").
export const POLL_INTERVALS = ['60', '120', '180', '300'];

// How far above its setpoint a zone may stay before the temperature alarm,
// in degrees Celsius (converted for a zone set in Fahrenheit).
export const ALARM_MARGINS = ['2', '3', '5', '8'];

// How long a problem must last before it is an alarm, in minutes: the
// temperature above the margin, or the appliance offline.
export const ALARM_DELAYS = ['15', '30', '60', '120'];

// How long an AutoDoor may stay open before the door alarm, in minutes.
export const DOOR_ALARM_DELAYS = ['2', '5', '10', '15'];

export const DEFAULT_CONFIG = {
  api_key: '',
  poll_interval: '120',
  alarm_margin: '3',
  alarm_delay: '30',
  door_alarm_delay: '5',
  language: 'fr',
};

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };
  // A key pasted from the app often carries a space or a line break around it.
  const apiKey = typeof source.api_key === 'string' ? source.api_key.trim() : '';
  return {
    apiKey,
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    alarmMarginCelsius: Number(pick('alarm_margin', ALARM_MARGINS)),
    alarmDelayMs: Number(pick('alarm_delay', ALARM_DELAYS)) * 60_000,
    doorAlarmDelayMs: Number(pick('door_alarm_delay', DOOR_ALARM_DELAYS)) * 60_000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
