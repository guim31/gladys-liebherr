// -----------------------------------------------------------------------------
// The Liebherr hub: the appliances of the account, read from the HomeAPI on
// a timer of the container (the interval chosen in the configuration), their
// states published to Gladys when they change, the alarms worked out and
// fired as scene events, and the commands of the features and the widget.
//
// The core is not trusted to poll (Gladys#3198): the timer does the work, the
// core's onPoll only reads when the timer is late. One cycle is:
//   - the appliance list (GET /v1/devices), every 5 minutes at most: it
//     tells new, removed and renamed appliances, and drops the ones that are
//     not connected;
//   - the controls of each listed appliance (GET /v1/devices/{id}/controls).
// So N + 1 calls every 5 minutes and N calls per interval otherwise. A 429
// doubles the pause between cycles (up to 30 min), a refused key waits 30 min
// or a new key: Liebherr limits the calls and has blocked insistent clients.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { ALARM_KINDS, activeAlarms, evaluateAlarms } from './alarms.js';
import {
  FEATURE_KEYS,
  UNIT_SYMBOLS,
  applianceName,
  buildDevice,
  deviceIds,
  findFeature,
  statesOf,
  zoneKey,
  zoneName,
} from './devices.js';
import { ERROR_KINDS, LiebherrClient, LiebherrError } from './liebherr/client.js';
import { parseAppliance, structureOf } from './liebherr/model.js';
import {
  ALARM_NAMES,
  COMMAND_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  FEATURE_NAMES,
  REPORT_TEXT,
  TOAST_TEXT,
  WIDGET_TEXT,
  labelled,
  pick,
  render,
} from './texts.js';

const logger = createLogger({ name: 'liebherr-hub' });

export const WIDGET_KEY = 'liebherr';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  RAISED: 'alarm_raised',
  CLEARED: 'alarm_cleared',
});

export const HUB_TIMINGS = {
  // The appliance list: new, removed, renamed or disconnected appliances.
  deviceListMs: 5 * 60_000,
  // An unchanged value is sent again this often: past 48 h without a value,
  // Gladys shows "no recent value".
  heartbeatMs: 12 * 60 * 60_000,
  // A refused key is tried again this late (or as soon as the key changes).
  authRetryMs: 30 * 60_000,
  // The longest pause after repeated 429 answers.
  maxBackoffMs: 30 * 60_000,
  // An appliance gone from the account this long leaves the Discovery tab
  // (unless it was added to Gladys).
  forgetAfterMs: 7 * 24 * 60 * 60_000,
};

// Errors about the service or the account, not about one appliance.
const SERVICE_ERRORS = new Set([
  ERROR_KINDS.AUTH,
  ERROR_KINDS.RATE_LIMIT,
  ERROR_KINDS.NETWORK,
  ERROR_KINDS.SERVER,
  ERROR_KINDS.HTTP,
]);

// Controls of the widget buttons and of the switch features.
export const TOGGLES = Object.freeze({
  SUPERCOOL: 'supercool',
  SUPERFROST: 'superfrost',
  PARTYMODE: 'partymode',
  NIGHTMODE: 'nightmode',
});

export class LiebherrHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {typeof fetch} [options.fetch] network seam (tests)
   * @param {boolean} [options.timers] periodic timer (off in most tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   * @param {number} [options.authRetryDelayMs] the client's second try on a 401
   */
  constructor({ gladys, store, fetch, timers = true, timings, now, authRetryDelayMs }) {
    this.gladys = gladys;
    this.store = store;
    this.fetch = fetch;
    this.authRetryDelayMs = authRetryDelayMs;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.client = null;
    /**
     * The appliances, by HomeAPI deviceId: `{ device, controls, appliance,
     * listed, online, error, lastSeen }`. `online` is null while unknown.
     * @type {Map<string, object>}
     */
    this.records = new Map();
    this.alarms = {};
    this.serviceError = null;
    this.backoffUntil = 0;
    this.backoffMs = 0;
    this.lastListAt = 0;
    this.lastCycleAt = null;
    this.cycling = null;
    this.timer = null;
    this.stopped = false;
    this.listedOnce = false;
    this.devicesKey = null;
    this.transports = new Map();
    this.connection = null;
    this.widgetKey = null;
    this.savedKey = null;
    /** Problems already logged, by key: their repeats go to debug. */
    this.warned = new Set();
  }

  // --- Logs ------------------------------------------------------------------
  // Info keeps the lifecycle only (start, appliances found, lost and back,
  // alarms, user commands). A problem that repeats every cycle is logged once,
  // then at debug until it clears. LOG_LEVEL=debug shows everything.

  /** Log a problem once (`level` warn or error), its repeats at debug. */
  problem(key, message, level = 'warn') {
    if (this.warned.has(key)) {
      logger.debug(`${message} (again)`);
      return;
    }
    this.warned.add(key);
    logger[level](message);
  }

  /** The problem `key` is gone: say it once (when it was said). */
  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    for (const [id, entry] of Object.entries(saved.appliances ?? {})) {
      if (!entry?.device || !Array.isArray(entry.controls)) {
        continue;
      }
      this.records.set(id, {
        device: entry.device,
        controls: entry.controls,
        appliance: parseAppliance(entry.device, entry.controls),
        listed: false,
        online: null,
        error: null,
        lastSeen: Number(entry.lastSeen) || this.now(),
      });
    }
    this.alarms = saved.alarms && typeof saved.alarms === 'object' ? saved.alarms : {};
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.devicesKey = null;
    this.transports.clear();
    this.connection = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const keyChanged = config.apiKey !== this.config?.apiKey;
    const languageChanged = config.language !== this.config?.language;
    this.config = config;
    if (keyChanged) {
      this.client = config.apiKey
        ? new LiebherrClient({
            apiKey: config.apiKey,
            fetch: this.fetch,
            now: this.now,
            authRetryDelayMs: this.authRetryDelayMs,
          })
        : null;
      this.serviceError = null;
      this.backoffUntil = 0;
      this.backoffMs = 0;
      this.lastListAt = 0;
      this.listedOnce = false;
      for (const key of [...this.warned]) {
        if (key.startsWith('service')) {
          this.warned.delete(key);
        }
      }
    }
    if (languageChanged) {
      this.devicesKey = null;
      this.widgetKey = null;
    }
    if (!this.client) {
      logger.info('No API key yet: waiting for the configuration');
      clearTimeout(this.timer);
      await this.publishDevices();
      await this.publishConnectionStatus();
      return;
    }
    await this.pollAll({ list: true });
    this.schedule();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.cycling?.catch(() => {});
    await this.store.flush();
  }

  schedule() {
    clearTimeout(this.timer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.timer = setTimeout(async () => {
      try {
        await this.pollAll();
        this.resolved('cycle');
      } catch (err) {
        this.problem('cycle', `Reading cycle failed: ${err.message}`, 'error');
      }
      this.schedule();
    }, this.config.pollIntervalMs);
  }

  // --- Reading the HomeAPI ------------------------------------------------------

  /**
   * One cycle (shared by concurrent callers): the list when due, the controls
   * of every listed appliance, then everything Gladys must know.
   */
  pollAll({ list = false } = {}) {
    this.cycling ??= this.cycle({ list }).finally(() => {
      this.cycling = null;
    });
    return this.cycling;
  }

  /** The core's onPoll: a fallback, it only reads when the timer is late. */
  async pollDevice() {
    const late =
      this.lastCycleAt === null ||
      this.now() - this.lastCycleAt >= this.config.pollIntervalMs * 0.9;
    if (late && this.client) {
      await this.pollAll();
    }
  }

  async cycle({ list }) {
    if (!this.client) {
      return;
    }
    const now = this.now();
    if (now < this.backoffUntil) {
      logger.debug(`HomeAPI paused for ${Math.ceil((this.backoffUntil - now) / 1000)} s more`);
      return;
    }
    try {
      if (list || this.records.size === 0 || now - this.lastListAt >= this.timings.deviceListMs) {
        await this.readList();
      }
      for (const record of this.records.values()) {
        if (record.listed) {
          await this.readControls(record);
        }
      }
      this.serviceAnswers();
    } catch (err) {
      if (!(err instanceof LiebherrError) || !SERVICE_ERRORS.has(err.kind)) {
        throw err;
      }
      this.serviceFails(err);
    }
    this.lastCycleAt = this.now();
    await this.afterCycle();
  }

  async readList() {
    const devices = await this.client.getDevices();
    const now = this.now();
    this.lastListAt = now;
    const listed = new Set();
    for (const device of devices) {
      listed.add(device.deviceId);
      const record = this.records.get(device.deviceId);
      if (record) {
        record.device = device;
        record.listed = true;
        record.lastSeen = now;
        continue;
      }
      this.records.set(device.deviceId, {
        device,
        controls: null,
        appliance: parseAppliance(device, []),
        listed: true,
        online: null,
        error: null,
        lastSeen: now,
      });
      if (this.listedOnce) {
        logger.info(`New appliance on the account: ${applianceName(parseAppliance(device))}`);
      }
    }
    const created = this.createdIds();
    for (const [id, record] of this.records) {
      if (listed.has(id)) {
        continue;
      }
      record.listed = false;
      // Not connected: the HomeAPI only lists the appliances online.
      this.setOnline(record, false, ERROR_KINDS.OFFLINE);
      const gone = now - record.lastSeen >= this.timings.forgetAfterMs;
      if (gone && !created.has(deviceIds(this.gladys, id).device)) {
        logger.info(`${applianceName(record.appliance)} left the account: removed from Discovery`);
        this.records.delete(id);
      }
    }
    if (!this.listedOnce) {
      this.listedOnce = true;
      const names = devices.map((device) => applianceName(parseAppliance(device)));
      logger.info(
        `Liebherr HomeAPI connected: ${devices.length} appliance(s)${names.length ? ` (${names.join(', ')})` : ''}`,
      );
    }
  }

  async readControls(record) {
    try {
      const controls = await this.client.getControls(record.device.deviceId);
      record.controls = controls;
      record.appliance = parseAppliance(record.device, controls);
      this.setOnline(record, true, null);
    } catch (err) {
      if (err.kind === ERROR_KINDS.OFFLINE || err.kind === ERROR_KINDS.NOT_ONBOARDED) {
        this.setOnline(record, false, err.kind);
        return;
      }
      throw err;
    }
  }

  setOnline(record, online, error) {
    const name = applianceName(record.appliance);
    if (online && record.online === false) {
      logger.info(`${name} is back online`);
    } else if (!online && record.online === true) {
      logger.info(`${name} is offline (${error})`);
    }
    record.online = online;
    record.error = error;
  }

  serviceAnswers() {
    if (this.serviceError) {
      logger.info('Liebherr HomeAPI answers again');
    }
    for (const key of [...this.warned]) {
      if (key.startsWith('service:')) {
        this.warned.delete(key);
      }
    }
    this.serviceError = null;
    this.backoffMs = 0;
  }

  serviceFails(err) {
    this.serviceError = { kind: err.kind, message: err.message };
    // Nothing is known about the appliances now: no alarm moves.
    for (const record of this.records.values()) {
      if (record.online !== false || record.listed) {
        record.online = null;
      }
    }
    if (err.kind === ERROR_KINDS.AUTH) {
      this.backoffUntil = this.now() + this.timings.authRetryMs;
    } else if (err.kind === ERROR_KINDS.RATE_LIMIT) {
      this.backoffMs = Math.min(
        this.timings.maxBackoffMs,
        Math.max(
          err.retryAfterMs ?? 0,
          this.backoffMs ? this.backoffMs * 2 : this.config.pollIntervalMs,
        ),
      );
      this.backoffUntil = this.now() + this.backoffMs;
    }
    this.problem(`service:${err.kind}`, `Liebherr HomeAPI: ${err.message}`);
  }

  /** Everything Gladys must know after a cycle. */
  async afterCycle() {
    await this.updateAlarms();
    await this.publishDevices();
    for (const record of this.records.values()) {
      await this.publishStates(record);
    }
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.refreshWidget();
    this.save();
  }

  // --- Alarms ----------------------------------------------------------------------

  async updateAlarms() {
    const records = [...this.records.values()].map((record) => ({
      appliance: record.appliance,
      online: record.online,
    }));
    const { state, transitions } = evaluateAlarms({
      records,
      state: this.alarms,
      config: this.config,
      now: this.now(),
    });
    this.alarms = state;
    for (const transition of transitions) {
      const record = this.records.get(transition.applianceId);
      if (!record) continue;
      const appliance = record.appliance;
      const zone = appliance.zones.find((z) => z.id === transition.zoneId) ?? null;
      const where = zone
        ? `${applianceName(appliance)} · ${zoneName(appliance, zone, 'en')}`
        : applianceName(appliance);
      logger.info(
        `${where}: ${pick(ALARM_NAMES[transition.kind], 'en').toLowerCase()} ${transition.type === 'raised' ? 'raised' : 'cleared'} (${transition.minutes} min)`,
      );
      await this.fire(transition.type === 'raised' ? TRIGGERS.RAISED : TRIGGERS.CLEARED, {
        device: deviceIds(this.gladys, appliance.id).device,
        kind: transition.kind,
        appliance: applianceName(appliance),
        zone: zone ? zoneName(appliance, zone, this.config.language) : '',
        temperature: transition.temperature ?? null,
        target: transition.target ?? null,
        unit: transition.unit ? UNIT_SYMBOLS[transition.unit] : '',
        minutes: transition.minutes,
      });
    }
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.resolved('scene-event');
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  /** The devices a reading has given a structure to. */
  publishable() {
    return [...this.records.values()].filter((record) => record.controls !== null);
  }

  createdIds() {
    return new Set((this.gladys.devices ?? []).map((device) => device.external_id));
  }

  async publishDevices() {
    const devices = this.client
      ? this.publishable().map((record) =>
          buildDevice(this.gladys, record.appliance, this.config.language),
        )
      : [];
    const key = JSON.stringify(devices);
    if (key === this.devicesKey) {
      return;
    }
    try {
      // Even an empty list: the Discovery tab then shows no stale appliance.
      await this.gladys.publishDiscoveredDevices(devices);
      this.devicesKey = key;
      this.resolved('devices');
    } catch (err) {
      this.problem('devices', `Devices refused by Gladys: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read the list again and publish. */
  async rediscover() {
    this.devicesKey = null;
    if (this.client) {
      await this.pollAll({ list: true });
    } else {
      await this.publishDevices();
    }
  }

  async publishStates(record) {
    if (record.online !== true) {
      return;
    }
    const ids = deviceIds(this.gladys, record.appliance.id);
    if (!this.createdIds().has(ids.device)) {
      // Gladys drops the states of a device it does not have: they are sent
      // when the user adds it (onDeviceCreated).
      return;
    }
    try {
      await this.gladys.publishChangedStates(statesOf(this.gladys, record.appliance), {
        heartbeat: this.timings.heartbeatMs,
      });
      this.resolved('states');
    } catch (err) {
      this.problem(
        'states',
        `States of ${applianceName(record.appliance)} refused: ${err.message}`,
      );
    }
  }

  /** The user added a device: send its states now, not at the next cycle. */
  async onDeviceCreated(device) {
    const record = this.recordOf(device.external_id);
    if (!record) {
      return;
    }
    this.transports.delete(device.external_id);
    await this.publishStates(record);
    await this.publishTransports();
    this.refreshWidget(true);
  }

  async publishTransports() {
    const entries = [];
    for (const record of this.publishable()) {
      const externalId = deviceIds(this.gladys, record.appliance.id).device;
      const transport =
        record.online === true ? DEVICE_TRANSPORTS.CLOUD : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transports refused: ${err.message}`);
    }
  }

  connectionStatus() {
    if (!this.client) {
      return { connected: false, message: CONNECTION_TEXT.noKey };
    }
    if (this.serviceError) {
      return { connected: false, message: ERROR_TEXT[this.serviceError.kind] };
    }
    if (![...this.records.values()].some((record) => record.listed)) {
      return this.listedOnce
        ? { connected: true, message: CONNECTION_TEXT.noAppliance }
        : { connected: false, message: ERROR_TEXT[ERROR_KINDS.NETWORK] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  /** Ask the dashboard to pull the widget again when what it shows changed. */
  refreshWidget(force = false) {
    const key = JSON.stringify([
      [...this.records.values()].map((record) => [
        record.online,
        statesOf(this.gladys, record.appliance),
      ]),
      activeAlarms(this.alarms),
      this.serviceError?.kind ?? null,
    ]);
    if (!force && key === this.widgetKey) {
      return;
    }
    const first = this.widgetKey === null;
    this.widgetKey = key;
    if (first && !force) {
      return;
    }
    Promise.resolve()
      .then(() => this.gladys.requestWidgetRefresh(WIDGET_KEY))
      .then(() => this.resolved('widget-refresh'))
      .catch((err) => this.problem('widget-refresh', `Widget refresh refused: ${err.message}`));
  }

  /** Save what must survive a restart, only when it changed (the SD card). */
  save() {
    const appliances = {};
    for (const [id, record] of this.records) {
      if (record.controls !== null) {
        appliances[id] = {
          structure: structureOf(record.appliance),
          name: applianceName(record.appliance),
          lastSeen: Math.floor(record.lastSeen / 86_400_000),
        };
      }
    }
    const key = JSON.stringify([appliances, this.alarms]);
    if (key === this.savedKey) {
      return;
    }
    this.savedKey = key;
    const data = { appliances: {}, alarms: this.alarms };
    for (const [id, record] of this.records) {
      if (record.controls !== null) {
        data.appliances[id] = {
          device: record.device,
          controls: record.controls,
          lastSeen: record.lastSeen,
        };
      }
    }
    this.store.save(data);
  }

  // --- Commands --------------------------------------------------------------------------

  recordOf(deviceExternalId) {
    for (const [id, record] of this.records) {
      if (deviceIds(this.gladys, id).device === deviceExternalId) {
        return record;
      }
    }
    return null;
  }

  /** A Liebherr error, told to the user in the configured language. */
  commandError(record, err) {
    if (!(err instanceof LiebherrError)) {
      return err;
    }
    const text = pick(ERROR_TEXT[err.kind], this.config.language);
    return new Error(labelled(applianceName(record.appliance), text, this.config.language));
  }

  /** Send one command; the answer is a 204, the new value is ours to publish. */
  async send(record, control, body, describe) {
    if (!this.client) {
      throw new Error(pick(CONNECTION_TEXT.noKey, this.config.language));
    }
    try {
      await this.client.setControl(record.appliance.id, control, body);
    } catch (err) {
      logger.warn(`${applianceName(record.appliance)}: ${describe} refused (${err.message})`);
      throw this.commandError(record, err);
    }
    logger.info(`${applianceName(record.appliance)}: ${describe}`);
  }

  /** A feature of a device (onSetValue). */
  async setValue(device, feature, value) {
    const record = this.recordOf(device.external_id);
    if (!record) {
      throw new Error(pick(COMMAND_TEXT.unknownAppliance, this.config.language));
    }
    const found = findFeature(this.gladys, record.appliance, feature.external_id);
    if (!found) {
      throw new Error(`Feature ${feature.external_id} cannot be controlled`);
    }
    const appliance = record.appliance;
    const zone = found.zone ? appliance.zones.find((z) => z.id === found.zone.id) : null;
    const key = zone ? found.key.slice(zoneKey(zone.id, '').length) : found.key;

    switch (key) {
      case FEATURE_KEYS.TARGET:
        await this.setTarget(record, zone, value);
        break;
      case FEATURE_KEYS.SUPERCOOL:
      case FEATURE_KEYS.SUPERFROST:
        await this.setToggle(record, key, zone.id, Number(value) === 1);
        break;
      case FEATURE_KEYS.PARTY_MODE:
        await this.setToggle(record, TOGGLES.PARTYMODE, null, Number(value) === 1);
        break;
      case FEATURE_KEYS.NIGHT_MODE:
        await this.setToggle(record, TOGGLES.NIGHTMODE, null, Number(value) === 1);
        break;
      case FEATURE_KEYS.LIGHT: {
        const max = appliance.presentationLight.max;
        const target = Math.min(max, Math.max(0, Math.round(Number(value) || 0)));
        await this.send(
          record,
          'presentationlight',
          { target },
          `presentation light set to ${target}`,
        );
        appliance.presentationLight.value = target;
        break;
      }
      case FEATURE_KEYS.ICE_MAKER:
        await this.setMode(record, zone, 'icemaker', 'iceMakerMode', String(value));
        break;
      case FEATURE_KEYS.HYDRO_BREEZE:
        await this.setMode(record, zone, 'hydrobreeze', 'hydroBreezeMode', String(value));
        break;
      case FEATURE_KEYS.BIOFRESH_PLUS:
        await this.setMode(record, zone, 'biofreshplus', 'bioFreshPlusMode', String(value));
        break;
      default:
        throw new Error(pick(COMMAND_TEXT.readOnly, this.config.language));
    }
    await this.publishStates(record);
    this.refreshWidget();
  }

  /**
   * A setpoint, within the range the appliance gives. A value outside it is
   * refused, never brought back in range: a scene that would set the fridge
   * to 20 °C is a mistake to report, not a fridge to warm up to 8 °C.
   */
  async setTarget(record, zone, value) {
    const number = Number(value);
    const { min, max, unit, steps } = zone;
    const symbol = UNIT_SYMBOLS[unit];
    const outOfRange = () =>
      new Error(pick(render(COMMAND_TEXT.outOfRange, min, max, symbol), this.config.language));
    if (!Number.isFinite(number) || min === null || max === null) {
      throw outOfRange();
    }
    let target = Math.round(number);
    if (target < min || target > max) {
      throw outOfRange();
    }
    if (steps.length > 0) {
      // Appliances with setting steps only take these values: the nearest one.
      // Measured from the value asked, not its rounding: 5.4 is nearer 6.
      target = steps.reduce((best, step) =>
        Math.abs(step - number) < Math.abs(best - number) ? step : best,
      );
    }
    const name = `${zoneName(record.appliance, zone, 'en')} setpoint`;
    await this.send(
      record,
      'temperature',
      { zoneId: zone.id, target, unit: symbol },
      `${name} set to ${target} ${symbol}`,
    );
    zone.target = target;
  }

  async setToggle(record, control, zoneId, on) {
    const appliance = record.appliance;
    const body = zoneId === null ? { value: on } : { zoneId, value: on };
    await this.send(record, control, body, `${control} ${on ? 'on' : 'off'}`);
    if (zoneId === null) {
      appliance[control] = on;
    } else {
      const zone = appliance.zones.find((z) => z.id === zoneId);
      if (zone) zone[control] = on;
    }
  }

  async setMode(record, zone, control, field, mode) {
    const offered =
      control === 'icemaker'
        ? ['off', 'on', ...(zone.iceMaker.hasMaxIce ? ['max_ice'] : [])]
        : control === 'hydrobreeze'
          ? ['off', 'low', 'medium', 'high']
          : zone.bioFreshPlus.supported;
    if (!offered.includes(mode)) {
      throw new Error(pick(COMMAND_TEXT.unknownOption, this.config.language));
    }
    await this.send(
      record,
      control,
      { zoneId: zone.id, [field]: mode.toUpperCase() },
      `${control} set to ${mode}`,
    );
    if (control === 'icemaker') zone.iceMaker.mode = mode;
    else if (control === 'hydrobreeze') zone.hydroBreeze.mode = mode;
    else zone.bioFreshPlus.mode = mode;
  }

  /**
   * A widget button: switch a mode to the opposite of what it is now.
   * @returns {Promise<object>} the toast
   */
  async toggle(applianceId, control, zoneId) {
    const record = this.records.get(applianceId);
    if (!record) {
      throw new Error(pick(COMMAND_TEXT.unknownAppliance, this.config.language));
    }
    const appliance = record.appliance;
    const zone = zoneId === null ? null : appliance.zones.find((z) => z.id === zoneId);
    const current = zone ? zone[control] : appliance[control];
    if (current === undefined || (zoneId !== null && !zone)) {
      throw new Error(pick(COMMAND_TEXT.unknownOption, this.config.language));
    }
    const on = current !== true;
    await this.setToggle(record, control, zoneId, on);
    await this.publishStates(record);
    const name = pick(FEATURE_NAMES[control], 'en');
    return render(on ? TOAST_TEXT.switchedOn : TOAST_TEXT.switchedOff, name);
  }

  // --- Reports -------------------------------------------------------------------------------

  /** "Test the connection": read everything now, one line per appliance. */
  async testConnection() {
    if (!this.client) {
      return CONNECTION_TEXT.noKey;
    }
    if (this.now() >= this.backoffUntil || this.serviceError?.kind !== ERROR_KINDS.RATE_LIMIT) {
      // A refused key is tried again: the user may have just fixed it.
      this.backoffUntil = 0;
      await this.pollAll({ list: true });
    }
    const message = {};
    for (const language of Object.keys(REPORT_TEXT)) {
      if (this.serviceError) {
        message[language] = pick(ERROR_TEXT[this.serviceError.kind], language);
        continue;
      }
      const listed = [...this.records.values()].filter((record) => record.listed || record.online);
      const lines = [REPORT_TEXT[language].found(listed.length)];
      for (const record of this.records.values()) {
        lines.push(
          labelled(applianceName(record.appliance), this.describe(record, language), language),
        );
      }
      message[language] = lines.join('\n');
    }
    return message;
  }

  /** `Fridge 5 °C (setpoint 4 °C), Freezer −18 °C`, or offline. */
  describe(record, language) {
    if (record.online !== true) {
      return REPORT_TEXT[language].offline;
    }
    const appliance = record.appliance;
    const alarms = activeAlarms(this.alarms).filter((alarm) => alarm.applianceId === appliance.id);
    const parts = appliance.zones
      .filter((zone) => zone.temperature !== null)
      .map((zone) => {
        const symbol = UNIT_SYMBOLS[zone.unit];
        const setpoint =
          zone.target === null
            ? ''
            : ` (${pick(render(WIDGET_TEXT.setpoint, `${formatNumber(zone.target)} ${symbol}`), language)})`;
        return `${zoneName(appliance, zone, language)} ${formatNumber(zone.temperature)} ${symbol}${setpoint}`;
      });
    if (alarms.length) {
      parts.push(
        `${REPORT_TEXT[language].alarm}: ${alarms.map((a) => pick(ALARM_NAMES[a.kind], language)).join(', ')}`,
      );
    }
    return parts.join(', ') || pick(WIDGET_TEXT.waiting, language);
  }

  /** What the widget shows: the appliances, and the alarms in progress. */
  view(applianceExternalId) {
    const records = [...this.records.values()].filter((record) => record.controls !== null);
    const chosen = applianceExternalId
      ? records.filter(
          (record) => deviceIds(this.gladys, record.appliance.id).device === applianceExternalId,
        )
      : records;
    return {
      configured: Boolean(this.client),
      serviceError: this.serviceError?.kind ?? null,
      unknown: Boolean(applianceExternalId) && chosen.length === 0,
      records: chosen,
      alarms: activeAlarms(this.alarms),
      language: this.config?.language ?? 'en',
      now: this.now(),
    };
  }
}

/** A temperature as people write it: the minus sign, not the hyphen. */
export const formatNumber = (value) => String(value).replace('-', '−');

export { ALARM_KINDS };
