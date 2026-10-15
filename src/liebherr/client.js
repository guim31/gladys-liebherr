// -----------------------------------------------------------------------------
// Client of the Liebherr SmartDevice HomeAPI (cloud), the official API of the
// SmartDevice app: https://developer.liebherr.com/apis/smartdevice-homeapi/
//
//   GET  /v1/devices                         the appliances connected to the account
//   GET  /v1/devices/{deviceId}/controls     every control of one appliance
//   POST /v1/devices/{deviceId}/controls/X   change one control
//
// Authentication: the `api-key` header, a key generated in the SmartDevice
// app. The key never leaves this module: no error message, no log line
// carries it (test/client.test.js).
//
// Every failure is a LiebherrError with a `kind` (ERROR_KINDS): the hub
// decides from it whether the appliance is offline, the key refused, the
// service down or the rate limit reached.
// -----------------------------------------------------------------------------

export const API_BASE_URL = 'https://home-api.smartdevice.liebherr.com';
const REQUEST_TIMEOUT_MS = 15_000;
// The HomeAPI has been seen answering a 401 to a valid key, then accepting it
// again a moment later (pyliebherrhomeapi retries for that reason): a refusal
// is only believed when it repeats.
const AUTH_RETRY_DELAY_MS = 2_000;

export const ERROR_KINDS = Object.freeze({
  AUTH: 'auth', // 401/403: the API key is refused
  RATE_LIMIT: 'rate_limit', // 429: too many calls
  NETWORK: 'network', // no answer: DNS, connection, timeout
  SERVER: 'server', // 5xx, or an answer that is not the expected JSON
  OFFLINE: 'offline', // 404: "Device is not reachable"
  NOT_ONBOARDED: 'not_onboarded', // 412: the appliance is not in the household
  UNSUPPORTED: 'unsupported', // 422: the appliance does not have this function
  BAD_REQUEST: 'bad_request', // 400: a value the appliance refuses
  HTTP: 'http', // any other status
});

export class LiebherrError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message never the API key
   * @param {{ status?: number, retryAfterMs?: number|null }} [details]
   */
  constructor(kind, message, { status, retryAfterMs = null } = {}) {
    super(message);
    this.name = 'LiebherrError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

const KIND_BY_STATUS = {
  400: ERROR_KINDS.BAD_REQUEST,
  401: ERROR_KINDS.AUTH,
  403: ERROR_KINDS.AUTH,
  404: ERROR_KINDS.OFFLINE,
  412: ERROR_KINDS.NOT_ONBOARDED,
  422: ERROR_KINDS.UNSUPPORTED,
  429: ERROR_KINDS.RATE_LIMIT,
};

/** `Retry-After` in milliseconds (seconds or an HTTP date), null when absent. */
function retryAfter(header, now) {
  if (!header) {
    return null;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - now());
}

/** The `message` of an ApiError body, cut short; never echoes a header. */
function apiMessage(text) {
  try {
    const body = JSON.parse(text);
    if (body && typeof body.message === 'string' && body.message.trim()) {
      return body.message.trim().slice(0, 200);
    }
  } catch {
    // Not JSON: the status says enough.
  }
  return '';
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class LiebherrClient {
  /**
   * @param {object} options
   * @param {string} options.apiKey
   * @param {typeof fetch} [options.fetch] network seam (tests)
   * @param {string} [options.baseUrl]
   * @param {() => number} [options.now]
   * @param {number} [options.authRetryDelayMs]
   */
  constructor({
    apiKey,
    fetch: fetchImpl = globalThis.fetch,
    baseUrl = API_BASE_URL,
    now = () => Date.now(),
    authRetryDelayMs = AUTH_RETRY_DELAY_MS,
  }) {
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.now = now;
    this.authRetryDelayMs = authRetryDelayMs;
    /** Calls made, for the probe and the tests. */
    this.calls = 0;
  }

  /** @returns {Promise<Array<object>>} the raw Device objects */
  async getDevices() {
    const body = await this.request('GET', '/v1/devices');
    if (!Array.isArray(body)) {
      throw new LiebherrError(ERROR_KINDS.SERVER, 'Unexpected answer to the device list');
    }
    return body.filter((device) => device && typeof device.deviceId === 'string');
  }

  /** @returns {Promise<Array<object>>} the raw controls of one appliance */
  async getControls(deviceId) {
    const body = await this.request('GET', `/v1/devices/${encodeURIComponent(deviceId)}/controls`);
    if (!Array.isArray(body)) {
      throw new LiebherrError(ERROR_KINDS.SERVER, 'Unexpected answer to the controls');
    }
    return body.filter((control) => control && typeof control.type === 'string');
  }

  /**
   * Change one control (POST, answered 204).
   * @param {string} deviceId
   * @param {string} control temperature, supercool, superfrost, partymode, nightmode,
   *   presentationlight, icemaker, hydrobreeze, biofreshplus
   * @param {object} body as the HomeAPI expects it
   */
  async setControl(deviceId, control, body) {
    await this.request(
      'POST',
      `/v1/devices/${encodeURIComponent(deviceId)}/controls/${encodeURIComponent(control)}`,
      body,
    );
  }

  async request(method, path, body) {
    try {
      return await this.requestOnce(method, path, body);
    } catch (err) {
      if (err.kind !== ERROR_KINDS.AUTH) {
        throw err;
      }
      await wait(this.authRetryDelayMs);
      return this.requestOnce(method, path, body);
    }
  }

  async requestOnce(method, path, body) {
    const headers = { 'api-key': this.apiKey, accept: 'application/json' };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    this.calls += 1;
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const reason =
        err?.name === 'TimeoutError' ? 'timeout' : (err?.cause?.code ?? err?.code ?? err?.name);
      throw new LiebherrError(ERROR_KINDS.NETWORK, `Liebherr HomeAPI unreachable (${reason})`);
    }
    const text = await response.text().catch(() => '');
    const { status } = response;
    if (status === 204) {
      return null;
    }
    if (status >= 200 && status < 300) {
      try {
        return JSON.parse(text);
      } catch {
        throw new LiebherrError(ERROR_KINDS.SERVER, `Unexpected answer (HTTP ${status})`, {
          status,
        });
      }
    }
    const kind = KIND_BY_STATUS[status] ?? (status >= 500 ? ERROR_KINDS.SERVER : ERROR_KINDS.HTTP);
    const detail = apiMessage(text);
    throw new LiebherrError(kind, `HTTP ${status}${detail ? `: ${detail}` : ''}`, {
      status,
      retryAfterMs: retryAfter(response.headers.get('retry-after'), this.now),
    });
  }
}
