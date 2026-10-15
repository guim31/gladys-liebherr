// -----------------------------------------------------------------------------
// The alarms, worked out by the integration: the HomeAPI exposes none (no
// door contact, no "temperature too high", no power cut), only the values.
//
//   - temperature: a zone stays above its setpoint plus the margin chosen in
//     the configuration, for the alarm delay. When the setpoint is lowered,
//     the previous one stays the reference until the zone has cooled down to
//     the new one: lowering the freezer from −16 to −22 °C is not an alarm.
//   - door: an AutoDoor stays open (or moving) for the door delay. Only the
//     AutoDoor models report their door.
//   - offline: the appliance is not reachable for the alarm delay — a power
//     cut and a Wi-Fi loss look the same from the cloud. A failing Liebherr
//     service or Internet access is not an appliance offline: nothing is
//     known then, and the alarms keep their state.
//
// Pure: the hub (src/hub.js) passes the readings, the state saved under /data
// and the clock; the transitions come back, each fired once as a scene event.
// -----------------------------------------------------------------------------

export const ALARM_KINDS = Object.freeze({
  TEMPERATURE: 'temperature',
  DOOR: 'door',
  OFFLINE: 'offline',
});

const keyOf = (applianceId, kind, zoneId) =>
  zoneId === null ? `${applianceId}|${kind}` : `${applianceId}|${kind}|${zoneId}`;

/** The margin in the unit of the zone (the configuration gives Celsius degrees). */
export const marginIn = (unit, celsius) =>
  unit === 'fahrenheit' ? Math.round(celsius * 1.8) : celsius;

/**
 * @param {object} input
 * @param {Array<{ appliance: object, online: boolean|null }>} input.records
 *   `online` null: unknown (the service did not answer), nothing changes
 * @param {Record<string, object>} input.state the alarm state saved so far
 * @param {{ alarmMarginCelsius: number, alarmDelayMs: number, doorAlarmDelayMs: number }} input.config
 * @param {number} input.now
 * @returns {{ state: Record<string, object>, transitions: Array<object> }}
 */
export function evaluateAlarms({ records, state, config, now }) {
  const next = {};
  const transitions = [];
  const minutesSince = (since) => Math.max(0, Math.round((now - since) / 60_000));

  /** One condition: true while the problem lasts. */
  const track = ({ appliance, kind, zone, active, delay, details, extra = {} }) => {
    const key = keyOf(appliance.id, kind, zone ? zone.id : null);
    const previous = state[key] ?? { since: null, raised: false };
    const entry = { ...previous, ...extra };
    const base = {
      kind,
      applianceId: appliance.id,
      zoneId: zone ? zone.id : null,
      ...details,
    };
    if (active) {
      entry.since ??= now;
      if (!entry.raised && now - entry.since >= delay) {
        entry.raised = true;
        transitions.push({ type: 'raised', ...base, minutes: minutesSince(entry.since) });
      }
    } else {
      if (entry.raised) {
        transitions.push({ type: 'cleared', ...base, minutes: minutesSince(entry.since) });
      }
      entry.since = null;
      entry.raised = false;
    }
    next[key] = entry;
  };

  /** Keep the alarms of an appliance as they are (nothing known). */
  const keep = (appliance) => {
    const prefix = `${appliance.id}|`;
    for (const [key, entry] of Object.entries(state)) {
      if (key.startsWith(prefix)) {
        next[key] = entry;
      }
    }
  };

  for (const { appliance, online } of records) {
    if (online === null) {
      keep(appliance);
      continue;
    }
    track({
      appliance,
      kind: ALARM_KINDS.OFFLINE,
      zone: null,
      active: online === false,
      delay: config.alarmDelayMs,
      details: { temperature: null, target: null, unit: null },
    });
    if (online === false) {
      // The values are the last ones read: the zone alarms wait.
      for (const [key, entry] of Object.entries(state)) {
        if (key.startsWith(`${appliance.id}|`) && !(key in next)) {
          next[key] = entry;
        }
      }
      continue;
    }

    for (const zone of appliance.zones) {
      if (zone.temperature !== null && zone.target !== null) {
        const key = keyOf(appliance.id, ALARM_KINDS.TEMPERATURE, zone.id);
        const margin = marginIn(zone.unit, config.alarmMarginCelsius);
        let reference = state[key]?.reference ?? zone.target;
        if (zone.target >= reference || zone.temperature <= zone.target + margin) {
          reference = zone.target;
        }
        track({
          appliance,
          kind: ALARM_KINDS.TEMPERATURE,
          zone,
          active: zone.temperature > reference + margin,
          delay: config.alarmDelayMs,
          details: { temperature: zone.temperature, target: zone.target, unit: zone.unit },
          extra: { reference },
        });
      }
      if (zone.door !== undefined && zone.door !== null) {
        track({
          appliance,
          kind: ALARM_KINDS.DOOR,
          zone,
          active: zone.door === 'open' || zone.door === 'moving',
          delay: config.doorAlarmDelayMs,
          details: { temperature: zone.temperature, target: zone.target, unit: zone.unit },
        });
      }
    }
  }
  return { state: next, transitions };
}

/**
 * The alarms raised now, for the widget and the report.
 * @returns {Array<{ applianceId: string, kind: string, zoneId: number|null, since: number }>}
 */
export function activeAlarms(state) {
  return Object.entries(state)
    .filter(([, entry]) => entry.raised)
    .map(([key, entry]) => {
      const [applianceId, kind, zoneId] = key.split('|');
      return {
        applianceId,
        kind,
        zoneId: zoneId === undefined ? null : Number(zoneId),
        since: entry.since,
      };
    });
}
