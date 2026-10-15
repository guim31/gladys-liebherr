// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `liebherr`.
//
// The use case: a glance from the kitchen tablet — is everything cold, is an
// alarm on? — and the SuperFrost button before the shopping goes in.
//
//   - one tile per zone (up to six): its temperature, red during an alarm;
//   - one status list: the alarms in progress (or "No alarm"), each
//     appliance offline, the modes switched on;
//   - with one appliance shown: SuperCool, SuperFrost and PartyMode buttons,
//     a check icon when the mode is on (the `primary` style does not show in
//     dark mode, Gladys#3153).
//
// Every appliance by default, or the one chosen in the widget settings. The
// figures are sent as values, not bound to device features: the widget works
// before the devices are added to Gladys. The core caches a content per
// language, so it is written in the language of the request.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { UNIT_SYMBOLS, applianceName, zoneName } from './devices.js';
import { TOGGLES, WIDGET_KEY } from './hub.js';
import {
  ALARM_NAMES,
  ERROR_TEXT,
  FEATURE_NAMES,
  POSITION_NAMES,
  WIDGET_TEXT,
  ZONE_SHORT_NAMES,
  pick,
  render,
} from './texts.js';

const MAX_TILES = 6;
const MAX_STATUS = 10;
const MAX_BUTTONS = 4;
const ON_ICON = 'check-circle';
const OFF_ICON = 'circle';

/** A text cut to a bound, with an ellipsis. */
export function fit(text, max) {
  const value = String(text ?? '').trim();
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The label of a zone tile: the zone name with one appliance shown; with
 * several, the appliance and a short zone name (`Kitchen · freezer`), or the
 * appliance alone when it has one zone.
 */
function tileLabel(appliance, zone, several, language) {
  if (!several) {
    return zoneName(appliance, zone, language);
  }
  const zones = appliance.zones.filter((z) => z.temperature !== null);
  if (zones.length < 2) {
    return applianceName(appliance);
  }
  const sameKind = zones.filter((z) => z.kind === zone.kind).length > 1;
  const short =
    sameKind && zone.position
      ? pick(POSITION_NAMES[zone.position], language)
      : pick(ZONE_SHORT_NAMES[zone.kind], language);
  return `${applianceName(appliance)} · ${short}`;
}

const message = (text, ttl = 300) => ({
  ttl_seconds: ttl,
  components: [{ type: 'text', variant: 'body', text: fit(text, 300) }],
});

/**
 * The content of the widget.
 * @param {ReturnType<import('./hub.js').LiebherrHub['view']>} view
 * @param {number} ttl seconds
 */
export function buildContent(view, ttl) {
  const { language } = view;
  const t = (text) => pick(text, language);
  if (!view.configured) {
    return message(t(WIDGET_TEXT.noKey));
  }
  if (view.unknown) {
    return message(t(WIDGET_TEXT.unknown));
  }
  if (view.records.length === 0) {
    return message(
      t(view.serviceError ? ERROR_TEXT[view.serviceError] : WIDGET_TEXT.noAppliance),
      ttl,
    );
  }

  const several = view.records.length > 1;
  const components = [];
  const alarmsOf = (record) => view.alarms.filter((a) => a.applianceId === record.appliance.id);

  // Tiles: the zone temperatures.
  for (const record of view.records) {
    const { appliance } = record;
    for (const zone of appliance.zones) {
      if (components.length >= MAX_TILES || zone.temperature === null) continue;
      const alarm = alarmsOf(record).some((a) => a.zoneId === zone.id);
      components.push({
        type: 'value',
        value: zone.temperature,
        unit: UNIT_SYMBOLS[zone.unit],
        label: fit(tileLabel(appliance, zone, several, language), 24),
        icon: 'thermometer',
        color: alarm
          ? WIDGET_COLORS.DANGER
          : record.online === true
            ? WIDGET_COLORS.INFO
            : WIDGET_COLORS.NEUTRAL,
      });
    }
  }

  // Status: alarms first, then what is off the nominal, then the modes on.
  const items = [];
  if (view.serviceError) {
    items.push({
      label: 'Liebherr',
      value: fit(t(ERROR_TEXT[view.serviceError]), 40),
      icon: 'cloud-off',
      color: WIDGET_COLORS.WARNING,
    });
  }
  for (const record of view.records) {
    const { appliance } = record;
    for (const alarm of alarmsOf(record)) {
      const zone = appliance.zones.find((z) => z.id === alarm.zoneId);
      const where = zone ? zoneName(appliance, zone, language) : applianceName(appliance);
      const minutes = Math.max(0, Math.round((view.now - alarm.since) / 60_000));
      items.push({
        label: fit(several && zone ? `${applianceName(appliance)} · ${where}` : where, 40),
        value: fit(`${t(ALARM_NAMES[alarm.kind])}, ${t(render(WIDGET_TEXT.since, minutes))}`, 40),
        icon: 'alert-triangle',
        color: WIDGET_COLORS.DANGER,
      });
    }
  }
  if (items.every((item) => item.color !== WIDGET_COLORS.DANGER)) {
    items.push({
      label: t(WIDGET_TEXT.alarms),
      value: t(WIDGET_TEXT.noAlarm),
      icon: 'check-circle',
      color: WIDGET_COLORS.SUCCESS,
    });
  }
  for (const record of view.records) {
    const { appliance } = record;
    if (record.online === false) {
      items.push({
        label: fit(applianceName(appliance), 40),
        value: t(WIDGET_TEXT.offline),
        icon: 'wifi-off',
        color: WIDGET_COLORS.WARNING,
      });
      continue;
    }
    const prefix = several ? `${applianceName(appliance)} · ` : '';
    for (const zone of appliance.zones) {
      for (const control of [TOGGLES.SUPERCOOL, TOGGLES.SUPERFROST]) {
        if (zone[control] === true) {
          items.push({
            label: fit(`${prefix}${pick(FEATURE_NAMES[control], language)}`, 40),
            value: fit(zoneName(appliance, zone, language), 40),
            icon: 'zap',
            color: WIDGET_COLORS.INFO,
          });
        }
      }
      if (zone.door === 'open' || zone.door === 'moving') {
        items.push({
          label: fit(`${prefix}${zoneName(appliance, zone, language)}`, 40),
          value: t(WIDGET_TEXT.doorOpen),
          icon: 'log-out',
          color: WIDGET_COLORS.WARNING,
        });
      }
    }
    for (const control of [TOGGLES.PARTYMODE, TOGGLES.NIGHTMODE]) {
      if (appliance[control] === true) {
        items.push({
          label: fit(`${prefix}${pick(FEATURE_NAMES[control], language)}`, 40),
          value: t(WIDGET_TEXT.on),
          icon: control === TOGGLES.NIGHTMODE ? 'moon' : 'star',
          color: WIDGET_COLORS.INFO,
        });
      }
    }
  }
  components.push({ type: 'status', items: items.slice(0, MAX_STATUS) });

  // Buttons: one appliance, reachable.
  const [only] = view.records;
  if (!several && only.online === true && !view.serviceError) {
    const appliance = only.appliance;
    const buttons = [];
    const button = (control, zone) => {
      const on = zone ? zone[control] === true : appliance[control] === true;
      const name = pick(FEATURE_NAMES[control], language);
      const sameKind = zone
        ? appliance.zones.filter((z) => z[control] !== undefined).length > 1
        : false;
      buttons.push({
        type: 'button',
        label: fit(sameKind ? `${name} ${zoneName(appliance, zone, language)}` : name, 24),
        icon: on ? ON_ICON : OFF_ICON,
        style: 'secondary',
        action: {
          // Unique per button: the core drops a button whose key is taken.
          key: zone ? `${control}_${zone.id}` : control,
          params: {
            appliance: appliance.id,
            control,
            zone: zone ? zone.id : null,
          },
        },
      });
    };
    for (const control of [TOGGLES.SUPERCOOL, TOGGLES.SUPERFROST]) {
      for (const zone of appliance.zones) {
        if (zone[control] !== undefined) button(control, zone);
      }
    }
    if (appliance.partymode !== undefined) {
      button(TOGGLES.PARTYMODE, null);
    }
    components.push(...buttons.slice(0, MAX_BUTTONS));
  }

  return { ttl_seconds: ttl, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    async get(hub, { settings = {}, language } = {}) {
      const view = hub.view(settings.appliance || null);
      if (language && ['en', 'fr', 'de', 'es'].includes(language)) {
        view.language = language;
      }
      const ttl = Math.min(
        3600,
        Math.max(10, Math.round((hub.config?.pollIntervalMs ?? 60_000) / 1000)),
      );
      return buildContent(view, ttl);
    },

    async action(hub, { actionKey, params = {} }) {
      const controls = Object.values(TOGGLES);
      if (!controls.includes(params.control) || typeof params.appliance !== 'string') {
        throw new Error(`Unknown widget action ${actionKey}`);
      }
      const zone = Number.isInteger(params.zone) ? params.zone : null;
      const toast = await hub.toggle(params.appliance, params.control, zone);
      return toast;
    },
  },
};
