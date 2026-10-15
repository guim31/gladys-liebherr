// -----------------------------------------------------------------------------
// One Gladys device per Liebherr appliance, its features grouped by zone.
//
// Identity: the deviceId of the HomeAPI, which is the serial number of the
// appliance (`gladys.externalIds('appliance', deviceId)`); a zone is its
// zoneId (0 is the top zone). Never the nickname, which the user renames.
//
// Features (category/type couples of the core table, see
// test/gladys-rules.test.js), only those the appliance offers:
//   per zone
//   - temperature: temperature-sensor/decimal, the measured value;
//   - setpoint: thermostat/target-temperature, within the range the
//     appliance gives (its `step` when it only takes some values);
//   - SuperCool, SuperFrost: switch/binary;
//   - IceMaker, HydroBreeze, BioFresh-Plus: text/select, the modes the
//     appliance offers (supported_options);
//   - door (AutoDoor): opening-sensor/binary, READ ONLY — 0 open, 1 closed,
//     as Gladys reads it. Opening the door from Gladys is not offered.
//   per appliance
//   - PartyMode, NightMode: switch/binary;
//   - presentation light: light/brightness, 0 (off) to the appliance maximum.
//
// The devices are published with should_poll: true and one minute, but the
// container reads the HomeAPI on its own timer (src/hub.js): the core only
// polls a device created that way, and not reliably (Gladys#3198).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import {
  FEATURE_NAMES,
  HYDRO_BREEZE_LABELS,
  ICE_MAKER_LABELS,
  POSITION_NAMES,
  ZONE_NAMES,
  pick,
} from './texts.js';

export const DEVICE_TYPE = 'appliance';
export const MODEL_PARAM = 'LIEBHERR_MODEL';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  TEMPERATURE: 'temperature',
  TARGET: 'target',
  SUPERCOOL: 'supercool',
  SUPERFROST: 'superfrost',
  ICE_MAKER: 'icemaker',
  HYDRO_BREEZE: 'hydrobreeze',
  BIOFRESH_PLUS: 'biofreshplus',
  DOOR: 'door',
  PARTY_MODE: 'party-mode',
  NIGHT_MODE: 'night-mode',
  LIGHT: 'presentation-light',
});

/** The key of a zone feature: `zone-<zoneId>-<feature>`. */
export const zoneKey = (zoneId, key) => `zone-${zoneId}-${key}`;

// Display bounds of a measured temperature (the core never applies them).
const SENSOR_RANGE = { celsius: [-40, 40], fahrenheit: [-40, 104] };
export const UNIT_SYMBOLS = { celsius: '°C', fahrenheit: '°F' };

/** External ids of an appliance and its features. */
export const deviceIds = (gladys, applianceId) => gladys.externalIds(DEVICE_TYPE, applianceId);

/** The name of an appliance: its nickname in the app, else its model. */
export function applianceName(appliance) {
  return appliance.nickname || appliance.model || `Liebherr ${appliance.id}`;
}

/** The name of a zone: its kind, and its position when the kind repeats. */
export function zoneName(appliance, zone, language) {
  const name = pick(ZONE_NAMES[zone.kind], language);
  const same = appliance.zones.filter((other) => other.kind === zone.kind);
  if (same.length < 2) {
    return name;
  }
  const where = zone.position
    ? pick(POSITION_NAMES[zone.position], language)
    : String(same.indexOf(zone) + 1);
  return `${name} (${where})`;
}

/** `0 °C / −2 °C`: the two drawer temperatures of a BioFresh-Plus mode. */
export function bioFreshLabel(mode, unit) {
  const degrees = {
    zero: unit === 'fahrenheit' ? 32 : 0,
    minus_two: unit === 'fahrenheit' ? 28 : -2,
  };
  const [first, second] = mode === 'zero_zero' ? ['zero', 'zero'] : mode.split(/_(?=minus|zero)/);
  const format = (part) => `${String(degrees[part]).replace('-', '−')} ${UNIT_SYMBOLS[unit]}`;
  return `${format(first)} / ${format(second)}`;
}

/** The setpoint step: the smallest gap between the allowed values, else 1. */
function setpointStep(zone) {
  let step = Infinity;
  for (let i = 1; i < zone.steps.length; i += 1) {
    step = Math.min(step, zone.steps[i] - zone.steps[i - 1]);
  }
  return Number.isFinite(step) && step > 0 ? step : 1;
}

const binary = (category, type, extra = {}) => ({
  category,
  type,
  read_only: false,
  has_feedback: true,
  keep_history: true,
  min: 0,
  max: 1,
  ...extra,
});

const select = (options) => ({
  category: DEVICE_FEATURE_CATEGORIES.TEXT,
  type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
  read_only: false,
  has_feedback: true,
  keep_history: false,
  min: 0,
  max: 0,
  supported_options: options.map(({ value, label }, index) => ({
    value,
    label,
    sort_order: index,
  })),
});

const onOff = (value) => (value === true ? { state: 1 } : value === false ? { state: 0 } : null);
const text = (value) => (typeof value === 'string' && value ? { text: value } : null);

/**
 * Every feature of an appliance, in display order, with how to read its value.
 * @returns {Array<{ key: string, zone: object|null, name: (language: string) => string,
 *   definition: (language: string) => object, value: (appliance: object) => object|null }>}
 */
export function featuresOf(appliance) {
  const features = [];
  for (const zone of appliance.zones) {
    const named = (key) => (language) =>
      `${zoneName(appliance, zone, language)} · ${pick(FEATURE_NAMES[key], language)}`;
    const current = (app) => app.zones.find((other) => other.id === zone.id);
    const add = (key, nameKey, definition, value) =>
      features.push({
        key: zoneKey(zone.id, key),
        zone,
        name: named(nameKey),
        definition: typeof definition === 'function' ? definition : () => definition,
        value: (app) => {
          const now = current(app);
          return now ? value(now) : null;
        },
      });

    if (zone.hasTemperature) {
      const unit = DEVICE_FEATURE_UNITS[zone.unit.toUpperCase()];
      const [low, high] = SENSOR_RANGE[zone.unit];
      add(
        FEATURE_KEYS.TEMPERATURE,
        'temperature',
        {
          category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
          type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
          unit,
          read_only: true,
          has_feedback: false,
          keep_history: true,
          min: low,
          max: high,
        },
        (z) => (z.temperature === null ? null : { state: z.temperature }),
      );
      add(
        FEATURE_KEYS.TARGET,
        'target',
        {
          category: DEVICE_FEATURE_CATEGORIES.THERMOSTAT,
          type: DEVICE_FEATURE_TYPES.THERMOSTAT.TARGET_TEMPERATURE,
          unit,
          read_only: false,
          has_feedback: true,
          keep_history: true,
          min: zone.min ?? low,
          max: zone.max ?? high,
          step: setpointStep(zone),
        },
        (z) => (z.target === null ? null : { state: z.target }),
      );
    }
    if (zone.supercool !== undefined) {
      add(
        FEATURE_KEYS.SUPERCOOL,
        'supercool',
        binary(DEVICE_FEATURE_CATEGORIES.SWITCH, DEVICE_FEATURE_TYPES.SWITCH.BINARY),
        (z) => onOff(z.supercool),
      );
    }
    if (zone.superfrost !== undefined) {
      add(
        FEATURE_KEYS.SUPERFROST,
        'superfrost',
        binary(DEVICE_FEATURE_CATEGORIES.SWITCH, DEVICE_FEATURE_TYPES.SWITCH.BINARY),
        (z) => onOff(z.superfrost),
      );
    }
    if (zone.iceMaker) {
      const modes = zone.iceMaker.hasMaxIce ? ['off', 'on', 'max_ice'] : ['off', 'on'];
      add(
        FEATURE_KEYS.ICE_MAKER,
        'icemaker',
        (language) =>
          select(
            modes.map((mode) => ({ value: mode, label: pick(ICE_MAKER_LABELS[mode], language) })),
          ),
        (z) => text(z.iceMaker?.mode),
      );
    }
    if (zone.hydroBreeze) {
      add(
        FEATURE_KEYS.HYDRO_BREEZE,
        'hydrobreeze',
        (language) =>
          select(
            Object.keys(HYDRO_BREEZE_LABELS).map((mode) => ({
              value: mode,
              label: pick(HYDRO_BREEZE_LABELS[mode], language),
            })),
          ),
        (z) => text(z.hydroBreeze?.mode),
      );
    }
    if (zone.bioFreshPlus && zone.bioFreshPlus.supported.length > 0) {
      const { supported, unit } = zone.bioFreshPlus;
      add(
        FEATURE_KEYS.BIOFRESH_PLUS,
        'biofreshplus',
        select(supported.map((mode) => ({ value: mode, label: bioFreshLabel(mode, unit) }))),
        (z) => text(z.bioFreshPlus?.mode),
      );
    }
    if (zone.door !== undefined) {
      add(
        FEATURE_KEYS.DOOR,
        'door',
        {
          category: DEVICE_FEATURE_CATEGORIES.OPENING_SENSOR,
          type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
          read_only: true,
          has_feedback: false,
          keep_history: true,
          min: 0,
          max: 1,
        },
        // Gladys reads an opening sensor as 0 = open, 1 = closed. A moving
        // door is not closed.
        (z) =>
          z.door === 'closed'
            ? { state: 1 }
            : z.door === 'open' || z.door === 'moving'
              ? { state: 0 }
              : null,
      );
    }
  }

  const applianceFeature = (key, nameKey, definition, value) =>
    features.push({
      key,
      zone: null,
      name: (language) => pick(FEATURE_NAMES[nameKey], language),
      definition: () => definition,
      value,
    });
  if (appliance.partymode !== undefined) {
    applianceFeature(
      FEATURE_KEYS.PARTY_MODE,
      'partymode',
      binary(DEVICE_FEATURE_CATEGORIES.SWITCH, DEVICE_FEATURE_TYPES.SWITCH.BINARY),
      (app) => onOff(app.partymode),
    );
  }
  if (appliance.nightmode !== undefined) {
    applianceFeature(
      FEATURE_KEYS.NIGHT_MODE,
      'nightmode',
      binary(DEVICE_FEATURE_CATEGORIES.SWITCH, DEVICE_FEATURE_TYPES.SWITCH.BINARY),
      (app) => onOff(app.nightmode),
    );
  }
  if (appliance.presentationLight) {
    applianceFeature(
      FEATURE_KEYS.LIGHT,
      'light',
      binary(DEVICE_FEATURE_CATEGORIES.LIGHT, DEVICE_FEATURE_TYPES.LIGHT.BRIGHTNESS, {
        max: appliance.presentationLight.max,
      }),
      (app) =>
        app.presentationLight?.value === null || !app.presentationLight
          ? null
          : { state: app.presentationLight.value },
    );
  }
  return features;
}

/**
 * The discovery payload of an appliance.
 * @param {object} gladys SDK client
 * @param {object} appliance src/liebherr/model.js
 * @param {string} language feature names language
 */
export function buildDevice(gladys, appliance, language) {
  const ids = deviceIds(gladys, appliance.id);
  return {
    name: applianceName(appliance),
    external_id: ids.device,
    should_poll: true,
    poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
    params: appliance.model ? [{ name: MODEL_PARAM, value: appliance.model }] : [],
    features: featuresOf(appliance).map((feature) => ({
      ...feature.definition(language),
      name: feature.name(language),
      external_id: ids.feature(feature.key),
    })),
  };
}

/**
 * The states of an appliance, for publishChangedStates.
 * @returns {Array<{ device_feature_external_id: string, state?: number, text?: string }>}
 */
export function statesOf(gladys, appliance) {
  const ids = deviceIds(gladys, appliance.id);
  const states = [];
  for (const feature of featuresOf(appliance)) {
    const value = feature.value(appliance);
    if (value) {
      states.push({ device_feature_external_id: ids.feature(feature.key), ...value });
    }
  }
  return states;
}

/** The feature an external id names on an appliance, null when none. */
export function findFeature(gladys, appliance, featureExternalId) {
  const ids = deviceIds(gladys, appliance.id);
  return (
    featuresOf(appliance).find((feature) => ids.feature(feature.key) === featureExternalId) ?? null
  );
}
