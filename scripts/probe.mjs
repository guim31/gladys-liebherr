#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe of the real Liebherr SmartDevice HomeAPI, READ ONLY (GET requests
// only, never a command). Run it from a machine that reaches the Internet:
//
//   node scripts/probe.mjs                 # a fake key: the API must refuse it
//   LIEBHERR_API_KEY=... node scripts/probe.mjs   # a real key: what the account has
//
// It prints nothing sensitive: never the key, never a nickname, the serial
// numbers masked to their last 4 characters. What it tells:
//   - whether the HomeAPI answers, and how it refuses a wrong key (status,
//     body shape) — the integration reads 401/403 as "key refused";
//   - the rate-limit headers it sends, if any (Liebherr publishes no limit);
//   - with a real key: per appliance, its type, model, zones and the control
//     types, as src/liebherr/model.js reads them — to check the zone names
//     and the features the integration would create.
// -----------------------------------------------------------------------------

import { API_BASE_URL, LiebherrClient } from '../src/liebherr/client.js';
import { parseAppliance } from '../src/liebherr/model.js';

const FAKE_KEY = 'gladys-probe-not-a-real-key-0000';
const key = process.env.LIEBHERR_API_KEY?.trim() || FAKE_KEY;
const real = key !== FAKE_KEY;
const mask = (id) => `***${String(id).slice(-4)}`;

const RATE_HEADERS = /rate|limit|retry|quota|throttl/i;

/** One raw GET, to see the status, the headers and the shape of the body. */
async function rawGet(path) {
  const started = Date.now();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'api-key': key, accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  const headers = [...response.headers.entries()].filter(([name]) => RATE_HEADERS.test(name));
  let shape;
  try {
    const body = JSON.parse(text);
    shape = Array.isArray(body)
      ? `array of ${body.length}`
      : body && typeof body === 'object'
        ? `object {${Object.keys(body).join(', ')}}${typeof body.status === 'string' ? ` status="${body.status}"` : ''}`
        : typeof body;
  } catch {
    shape = `not JSON (${text.length} bytes)`;
  }
  console.log(
    `GET ${path} -> HTTP ${response.status} in ${Date.now() - started} ms, body: ${shape}`,
  );
  console.log(
    `  rate-limit headers: ${headers.length ? headers.map(([n, v]) => `${n}=${v}`).join(', ') : 'none'}`,
  );
  return response.status;
}

console.log(`Liebherr HomeAPI probe (${real ? 'key from LIEBHERR_API_KEY' : 'fake key'})`);
try {
  const status = await rawGet('/v1/devices');
  if (!real) {
    const refused = status === 401 || status === 403;
    console.log(
      refused
        ? `OK: the fake key is refused with HTTP ${status}, as the integration expects.`
        : `UNEXPECTED: HTTP ${status} for a fake key (the integration expects 401 or 403).`,
    );
    process.exit(refused ? 0 : 1);
  }
  if (status !== 200) {
    console.log('The key is refused or the service fails: nothing more to read.');
    process.exit(1);
  }
  const client = new LiebherrClient({ apiKey: key });
  const devices = await client.getDevices();
  for (const device of devices) {
    const controls = await client.getControls(device.deviceId);
    const appliance = parseAppliance(device, controls);
    console.log(
      `\nAppliance ${mask(device.deviceId)}: type=${device.deviceType} model=${device.deviceName ?? '?'}`,
    );
    console.log(
      `  control types: ${[...new Set(controls.map((c) => `${c.type}:${c.name}`))].join(', ')}`,
    );
    for (const zone of appliance.zones) {
      console.log(
        `  zone ${zone.id} (${zone.position ?? '?'}) -> ${zone.kind}: ${zone.temperature} / setpoint ${zone.target} ` +
          `[${zone.min}..${zone.max}] ${zone.unit}${zone.steps.length ? ` steps ${zone.steps}` : ''}`,
      );
    }
  }
  console.log(`\n${client.calls} call(s) made, all GET.`);
} catch (err) {
  console.log(`The HomeAPI could not be reached: ${err.message}`);
  process.exit(1);
}
