// -----------------------------------------------------------------------------
// The HomeAPI client against the fake HomeAPI: the api-key header, the error
// kinds the hub relies on, the transient 401 tried twice, and the key never
// written in an error message.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS, LiebherrClient } from '../src/liebherr/client.js';
import { API_KEY, COMBI, FakeLiebherr } from './helpers/fakeLiebherr.js';

const clientOf = (server, apiKey = API_KEY) =>
  new LiebherrClient({ apiKey, fetch: server.fetch, authRetryDelayMs: 0 });

const kindOf = async (promise) => {
  try {
    await promise;
  } catch (err) {
    assert.ok(!err.message.includes(API_KEY), 'never the key in a message');
    return err.kind;
  }
  return null;
};

test('lists the appliances and reads their controls with the api-key header', async () => {
  const server = new FakeLiebherr();
  const client = clientOf(server);
  const devices = await client.getDevices();
  assert.deepEqual(
    devices.map((device) => device.deviceId),
    ['26.111.222.3', '26.444.555.6', '26.777.888.9'],
  );
  const controls = await client.getControls(COMBI);
  assert.ok(controls.some((control) => control.type === 'TemperatureControl'));
  assert.deepEqual(
    server.requests.map((request) => [request.method, request.path, request.headers['api-key']]),
    [
      ['GET', '/v1/devices', API_KEY],
      ['GET', '/v1/devices/26.111.222.3/controls', API_KEY],
    ],
  );
});

test('a command is a POST with the JSON body, answered 204', async () => {
  const server = new FakeLiebherr();
  await clientOf(server).setControl(COMBI, 'temperature', { zoneId: 0, target: 5, unit: '°C' });
  const [request] = server.requests;
  assert.equal(request.method, 'POST');
  assert.equal(request.path, '/v1/devices/26.111.222.3/controls/temperature');
  assert.deepEqual(request.body, { zoneId: 0, target: 5, unit: '°C' });
  assert.equal(request.headers['content-type'], 'application/json');
  assert.equal(server.control(COMBI, 'temperature', 0).target, 5);
});

test('every failure has a kind', async () => {
  const server = new FakeLiebherr();
  assert.equal(await kindOf(clientOf(server, 'wrong-key').getDevices()), ERROR_KINDS.AUTH);

  server.appliances.get(COMBI).online = false;
  assert.equal(await kindOf(clientOf(server).getControls(COMBI)), ERROR_KINDS.OFFLINE);
  server.appliances.get(COMBI).online = true;

  assert.equal(
    await kindOf(clientOf(server).setControl(COMBI, 'temperature', { zoneId: 0, target: 40 })),
    ERROR_KINDS.BAD_REQUEST,
  );
  assert.equal(
    await kindOf(clientOf(server).setControl(COMBI, 'autodoor', { zoneId: 0, value: true })),
    ERROR_KINDS.UNSUPPORTED,
  );

  server.failNext = 503;
  assert.equal(await kindOf(clientOf(server).getDevices()), ERROR_KINDS.SERVER);

  server.down = true;
  assert.equal(await kindOf(clientOf(server).getDevices()), ERROR_KINDS.NETWORK);
});

test('a 429 carries its Retry-After', async () => {
  const server = new FakeLiebherr();
  server.rateLimited = true;
  server.retryAfter = 600;
  try {
    await clientOf(server).getDevices();
    assert.fail('should throw');
  } catch (err) {
    assert.equal(err.kind, ERROR_KINDS.RATE_LIMIT);
    assert.equal(err.retryAfterMs, 600_000);
  }
});

test('a lone 401 is tried again, two in a row are a refused key', async () => {
  const server = new FakeLiebherr();
  server.failNext = 401;
  const devices = await clientOf(server).getDevices();
  assert.equal(devices.length, 3, 'the second try passes');
  assert.equal(server.count('list'), 2);

  const refused = new FakeLiebherr({ apiKey: 'another-key' });
  assert.equal(await kindOf(clientOf(refused).getDevices()), ERROR_KINDS.AUTH);
  assert.equal(refused.count('list'), 2, 'one retry, not more');
});

test('an answer that is not the expected JSON is a server error', async () => {
  const fetch = async () => new Response('<html>maintenance</html>', { status: 200 });
  const client = new LiebherrClient({ apiKey: API_KEY, fetch });
  assert.equal(await kindOf(client.getDevices()), ERROR_KINDS.SERVER);
  const object = async () => Response.json({ devices: [] });
  assert.equal(
    await kindOf(new LiebherrClient({ apiKey: API_KEY, fetch: object }).getDevices()),
    ERROR_KINDS.SERVER,
  );
});
