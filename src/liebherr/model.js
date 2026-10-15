// -----------------------------------------------------------------------------
// The HomeAPI answers, read into one plain object per appliance.
//
// An appliance has one or more zones (zone 0 is the top one, the numbers grow
// downwards). A zone carries its temperature control (measured value,
// setpoint, the range the user may set) and the zone controls: SuperCool,
// SuperFrost, IceMaker, HydroBreeze, BioFresh-Plus, AutoDoor. PartyMode,
// NightMode and the presentation light belong to the whole appliance.
//
// The API writes its enums in capitals (`COMBI`, `MAX_ICE`, `OPEN`) where
// pyliebherrhomeapi and its tests use lowercase: both are accepted, and every
// value is lowercased here. A control type this module does not know is
// ignored: Liebherr can add one without breaking the integration.
// -----------------------------------------------------------------------------

export const APPLIANCE_TYPES = ['fridge', 'freezer', 'combi', 'wine'];
export const ZONE_KINDS = ['fridge', 'freezer', 'wine'];
export const ZONE_POSITIONS = ['top', 'middle', 'bottom'];
export const ICE_MAKER_MODES = ['off', 'on', 'max_ice'];
export const HYDRO_BREEZE_MODES = ['off', 'low', 'medium', 'high'];
export const BIOFRESH_PLUS_MODES = [
  'zero_zero',
  'zero_minus_two',
  'minus_two_minus_two',
  'minus_two_zero',
];
export const DOOR_STATES = ['closed', 'open', 'moving'];

// The toggles the integration knows, by API control name.
export const ZONE_TOGGLES = ['supercool', 'superfrost'];
export const APPLIANCE_TOGGLES = ['partymode', 'nightmode'];

const lower = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : null);
const integer = (value) => (Number.isFinite(value) ? Math.round(value) : null);
const oneOf = (value, list) => (list.includes(lower(value)) ? lower(value) : null);

/** `°C` or `°F` to the Gladys unit (Celsius when absent or unknown). */
export function unitOf(raw) {
  const text = lower(raw) ?? '';
  return text.includes('f') ? 'fahrenheit' : 'celsius';
}

function emptyZone(id) {
  return {
    id,
    position: null,
    kind: null,
    temperature: null,
    target: null,
    min: null,
    max: null,
    unit: 'celsius',
    steps: [],
    hasTemperature: false,
    supercool: undefined,
    superfrost: undefined,
    iceMaker: null,
    hydroBreeze: null,
    bioFreshPlus: null,
    door: undefined,
  };
}

/**
 * The kind of a zone, for its name. The API does not say it: it is read from
 * what the zone offers (SuperFrost, a setting range below 0 °C) and from the
 * appliance type.
 */
function zoneKind(applianceType, zone) {
  if (zone.superfrost !== undefined) {
    return 'freezer';
  }
  const freezing = zone.unit === 'fahrenheit' ? 32 : 0;
  const top = zone.max ?? zone.target;
  if (top !== null && top <= freezing) {
    return 'freezer';
  }
  if (applianceType === 'wine') {
    return 'wine';
  }
  if (applianceType === 'freezer' && zone.supercool === undefined) {
    return 'freezer';
  }
  return 'fridge';
}

/**
 * @param {object} device a raw Device of GET /v1/devices
 * @param {Array<object>} controls the raw controls of the appliance
 */
export function parseAppliance(device, controls = []) {
  const type = oneOf(device.deviceType, APPLIANCE_TYPES);
  const zones = new Map();
  const zoneOf = (control) => {
    const id = integer(control.zoneId);
    if (id === null) {
      return null;
    }
    if (!zones.has(id)) {
      zones.set(id, emptyZone(id));
    }
    const zone = zones.get(id);
    zone.position ??= oneOf(control.zonePosition, ZONE_POSITIONS);
    return zone;
  };

  const appliance = {
    id: device.deviceId,
    nickname: typeof device.nickname === 'string' ? device.nickname.trim() : '',
    model: typeof device.deviceName === 'string' ? device.deviceName.trim() : '',
    type,
    zones: [],
    partymode: undefined,
    nightmode: undefined,
    presentationLight: null,
  };

  for (const control of controls) {
    const name = lower(control.name);
    switch (control.type) {
      case 'TemperatureControl': {
        const zone = zoneOf(control);
        if (!zone) break;
        zone.hasTemperature = true;
        zone.temperature = integer(control.value);
        zone.target = integer(control.target);
        zone.min = integer(control.min);
        zone.max = integer(control.max);
        zone.unit = unitOf(control.unit);
        zone.steps =
          control.setTemperatureStepsEnabled === true && Array.isArray(control.setTemperatureSteps)
            ? [...new Set(control.setTemperatureSteps.filter(Number.isFinite))].sort(
                (a, b) => a - b,
              )
            : [];
        break;
      }
      case 'ToggleControl': {
        const value = typeof control.value === 'boolean' ? control.value : null;
        if (ZONE_TOGGLES.includes(name)) {
          const zone = zoneOf(control);
          if (zone) zone[name] = value;
        } else if (APPLIANCE_TOGGLES.includes(name)) {
          appliance[name] = value;
        }
        break;
      }
      case 'IceMakerControl': {
        const zone = zoneOf(control);
        if (zone) {
          zone.iceMaker = {
            mode: oneOf(control.iceMakerMode, ICE_MAKER_MODES),
            hasMaxIce: control.hasMaxIce === true,
          };
        }
        break;
      }
      case 'HydroBreezeControl': {
        const zone = zoneOf(control);
        if (zone) zone.hydroBreeze = { mode: oneOf(control.currentMode, HYDRO_BREEZE_MODES) };
        break;
      }
      case 'BioFreshPlusControl': {
        const zone = zoneOf(control);
        if (!zone) break;
        const supported = (Array.isArray(control.supportedModes) ? control.supportedModes : [])
          .map((mode) => oneOf(mode, BIOFRESH_PLUS_MODES))
          .filter(Boolean);
        zone.bioFreshPlus = {
          mode: oneOf(control.currentMode, BIOFRESH_PLUS_MODES),
          // Keep the canonical order, whatever order the API lists them in.
          supported: BIOFRESH_PLUS_MODES.filter((mode) => supported.includes(mode)),
          unit: unitOf(control.temperatureUnit),
        };
        break;
      }
      case 'AutoDoorControl': {
        const zone = zoneOf(control);
        if (zone) zone.door = oneOf(control.value, DOOR_STATES);
        break;
      }
      case 'PresentationLightControl': {
        const max = integer(control.max);
        appliance.presentationLight = {
          value: integer(control.value),
          max: max !== null && max > 0 ? max : 5,
        };
        break;
      }
      default:
        break;
    }
  }

  appliance.zones = [...zones.values()].sort((a, b) => a.id - b.id);
  for (const zone of appliance.zones) {
    zone.kind = zoneKind(type, zone);
  }
  return appliance;
}

/** What makes the Gladys device: zones and the controls they offer, not the values. */
export function structureOf(appliance) {
  return JSON.stringify({
    zones: appliance.zones.map((zone) => ({
      id: zone.id,
      kind: zone.kind,
      position: zone.position,
      temperature: zone.hasTemperature,
      range: [zone.min, zone.max, zone.unit, zone.steps],
      supercool: zone.supercool !== undefined,
      superfrost: zone.superfrost !== undefined,
      iceMaker: zone.iceMaker ? zone.iceMaker.hasMaxIce : null,
      hydroBreeze: zone.hydroBreeze !== null,
      bioFreshPlus: zone.bioFreshPlus
        ? [zone.bioFreshPlus.supported, zone.bioFreshPlus.unit]
        : null,
      door: zone.door !== undefined,
    })),
    partymode: appliance.partymode !== undefined,
    nightmode: appliance.nightmode !== undefined,
    light: appliance.presentationLight?.max ?? null,
  });
}
