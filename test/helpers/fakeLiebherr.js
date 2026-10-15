// -----------------------------------------------------------------------------
// An in-memory Liebherr SmartDevice HomeAPI behind the `fetch` seam of the
// client (src/liebherr/client.js). Answers are built from the fixtures
// (test/fixtures/liebherr/, shaped after the official OpenAPI specification),
// with the behaviors that matter: the api-key header, an appliance offline
// (absent from the list, 404 on its controls), the commands applied to the
// controls with the API's own refusals (400, 422), a 429, a service down.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/liebherr/${name}.json`, import.meta.url), 'utf8'));

export const API_KEY = 'test-api-key-0123456789abcdef';
export const COMBI = '26.111.222.3';
export const WINE = '26.444.555.6';
export const FRIDGE = '26.777.888.9';

const CONTROLS = {
  [COMBI]: 'controls-combi',
  [WINE]: 'controls-wine',
  [FRIDGE]: 'controls-fridge',
};

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const apiError = (status, text, message, headers = {}) =>
  json(status, { status: `${status} ${text}`, message }, headers);

export class FakeLiebherr {
  /**
   * @param {object} [options]
   * @param {string[]} [options.appliances] deviceIds of the account (default: all three)
   * @param {string} [options.apiKey]
   */
  constructor({ appliances = [COMBI, WINE, FRIDGE], apiKey = API_KEY } = {}) {
    this.apiKey = apiKey;
    this.appliances = new Map();
    const devices = fixture('devices');
    for (const id of appliances) {
      this.appliances.set(id, {
        device: structuredClone(devices.find((device) => device.deviceId === id)),
        controls: fixture(CONTROLS[id]),
        online: true,
      });
    }
    this.requests = [];
    this.down = false; // no answer at all
    this.failNext = null; // e.g. 500, or 401 for a transient refusal
    this.rateLimited = false;
    this.retryAfter = null;
    this.fetch = (url, init) => this.handle(url, init);
  }

  /** The raw controls of an appliance, to change a value from "the appliance". */
  controls(id) {
    return this.appliances.get(id).controls;
  }

  control(id, name, zoneId) {
    return this.controls(id).find(
      (control) => control.name === name && (zoneId === undefined || control.zoneId === zoneId),
    );
  }

  /** Requests of one kind: 'list', 'controls' or 'command'. */
  count(kind) {
    return this.requests.filter((request) => request.kind === kind).length;
  }

  async handle(url, { method = 'GET', headers = {}, body } = {}) {
    const { pathname } = new URL(url);
    const parsed = body === undefined ? undefined : JSON.parse(body);
    const kind = method === 'POST' ? 'command' : pathname === '/v1/devices' ? 'list' : 'controls';
    this.requests.push({ method, path: pathname, body: parsed, kind, headers });
    if (this.down) {
      const error = new TypeError('fetch failed');
      error.cause = { code: 'ECONNREFUSED' };
      throw error;
    }
    if (this.failNext) {
      const status = this.failNext;
      this.failNext = null;
      return status === 401
        ? json(401, fixture('error-unauthorized'))
        : apiError(status, 'INTERNAL_SERVER_ERROR', 'Something went wrong');
    }
    if (headers['api-key'] !== this.apiKey) {
      return json(401, fixture('error-unauthorized'));
    }
    if (this.rateLimited) {
      return apiError(
        429,
        'TOO_MANY_REQUESTS',
        'Too many requests',
        this.retryAfter === null ? {} : { 'retry-after': String(this.retryAfter) },
      );
    }
    if (pathname === '/v1/devices' && method === 'GET') {
      return json(
        200,
        [...this.appliances.values()].filter((a) => a.online).map((a) => a.device),
      );
    }
    const match = pathname.match(/^\/v1\/devices\/([^/]+)\/controls(?:\/([a-z]+))?$/);
    if (!match) {
      return apiError(404, 'NOT_FOUND', 'Not found');
    }
    const id = decodeURIComponent(match[1]);
    const appliance = this.appliances.get(id);
    if (!appliance || !appliance.online) {
      return json(404, fixture('error-not-reachable'));
    }
    if (method === 'GET' && !match[2]) {
      return json(200, appliance.controls);
    }
    if (method === 'POST' && match[2]) {
      return this.command(id, match[2], parsed ?? {});
    }
    return apiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  }

  command(id, name, body) {
    const bad = (message) => apiError(400, 'BAD_REQUEST', message);
    const unsupported = () => apiError(422, 'UNPROCESSABLE_ENTITY', 'Operation not supported');
    const zoneControl = (controlName) => this.control(id, controlName, body.zoneId);
    switch (name) {
      case 'temperature': {
        const control = this.controls(id).find(
          (c) => c.type === 'TemperatureControl' && c.zoneId === body.zoneId,
        );
        if (!control) return bad('Unknown zone');
        if (
          !Number.isInteger(body.target) ||
          body.target < control.min ||
          body.target > control.max
        )
          return bad('Target out of range');
        if (
          control.setTemperatureStepsEnabled &&
          !control.setTemperatureSteps.includes(body.target)
        )
          return bad('Target is not a step');
        if (body.unit !== undefined && body.unit !== control.unit) return bad('Wrong unit');
        control.target = body.target;
        break;
      }
      case 'supercool':
      case 'superfrost': {
        const control = zoneControl(name);
        if (!control) return unsupported();
        if (typeof body.value !== 'boolean') return bad('value');
        control.value = body.value;
        break;
      }
      case 'partymode':
      case 'nightmode': {
        const control = this.control(id, name);
        if (!control) return unsupported();
        if (typeof body.value !== 'boolean') return bad('value');
        control.value = body.value;
        break;
      }
      case 'presentationlight': {
        const control = this.control(id, name);
        if (!control) return unsupported();
        if (!Number.isInteger(body.target) || body.target < 0 || body.target > control.max)
          return bad('target');
        control.value = body.target;
        break;
      }
      case 'icemaker': {
        const control = zoneControl(name);
        if (!control) return unsupported();
        const modes = control.hasMaxIce ? ['OFF', 'ON', 'MAX_ICE'] : ['OFF', 'ON'];
        if (!modes.includes(body.iceMakerMode)) return bad('iceMakerMode');
        control.iceMakerMode = body.iceMakerMode;
        break;
      }
      case 'hydrobreeze': {
        const control = zoneControl(name);
        if (!control) return unsupported();
        if (!['OFF', 'LOW', 'MEDIUM', 'HIGH'].includes(body.hydroBreezeMode)) return bad('mode');
        control.currentMode = body.hydroBreezeMode;
        break;
      }
      case 'biofreshplus': {
        const control = zoneControl(name);
        if (!control) return unsupported();
        if (!control.supportedModes.includes(body.bioFreshPlusMode)) return unsupported();
        control.currentMode = body.bioFreshPlusMode;
        break;
      }
      default:
        // autodoor included: the integration never sends it.
        return unsupported();
    }
    return new Response(null, { status: 204 });
  }
}
