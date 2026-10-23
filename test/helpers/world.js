// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Tvheadend, a temporary
// /data and a manual clock, with the integration wired on top through
// registerHandlers. No timer runs: the tests read Tvheadend with
// `world.hub.pollNow()`. (Adapted from guim31/gladys-icecast.)
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { serverIds } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { BASE, FakeTvheadend, PASSWORD, USER } from './fakeTvheadend.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

/** A manual clock, shared by the hub, the fake Tvheadend and the tests. */
export function createClock(start = new Date(2026, 9, 23, 18, 0, 0).getTime()) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const CONFIG = { url: BASE, username: USER, password: PASSWORD, language: 'en' };

export async function createWorld({
  clock = createClock(),
  tvheadend,
  config = CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-tvheadend-')),
  timings = {},
  timers = false,
} = {}) {
  const server = tvheadend ?? new FakeTvheadend({ now: clock.now });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: server.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, tvh: server, app, hub: app.hub, clock, dataDir };
}

/** The external ids of the server device. */
export const idsOf = (world) => serverIds(world.gladys);

/** Add the discovered devices in Gladys, as the user would. */
export async function createDevices(world) {
  for (const device of world.fake.discoveredDevices) {
    if (!world.gladys.devices.some((d) => d.external_id === device.external_id)) {
      await world.fake.deviceCreated(device);
    }
  }
}

/** The last state published for a feature key. */
export function stateOf(world, key) {
  const id = idsOf(world).feature(key);
  const states = world.fake.states.filter((s) => s.device_feature_external_id === id);
  const last = states.at(-1);
  return last ? (last.text ?? last.state) : undefined;
}

export { BASE, FakeTvheadend, PASSWORD, USER };
