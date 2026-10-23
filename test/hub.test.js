import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { FEATURE_KEYS, NONE } from '../src/devices.js';
import { TRIGGERS, WIDGET_KEY, findChannel } from '../src/hub.js';
import { Store } from '../src/store.js';
import { TvheadendClient } from '../src/tvheadend/client.js';
import { captureLogs } from './helpers/logs.js';
import {
  CONFIG,
  FakeTvheadend,
  createClock,
  createDevices,
  createWorld,
  idsOf,
  stateOf,
} from './helpers/world.js';

const MINUTE = 60_000;
const keys = (world) => world.fake.sceneEvents.map((event) => event.key);

test('the server is discovered, and its states published once added', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.tvh.add({ title: 'Film', start: world.clock.now() + 2 * 3600_000 });
  world.tvh.add({ title: 'News', start: world.clock.now() - MINUTE, status: 'recording' });
  await world.hub.pollNow();
  assert.equal(world.fake.discoveredDevices.length, 1);
  const device = world.fake.discoveredDevices[0];
  assert.equal(device.external_id, idsOf(world).device);
  assert.equal(device.should_poll, false);
  assert.equal(world.fake.states.length, 0, 'nothing before the device is added');

  await createDevices(world);
  assert.equal(stateOf(world, FEATURE_KEYS.ONLINE), 1);
  assert.equal(stateOf(world, FEATURE_KEYS.RECORDING), 1);
  assert.equal(stateOf(world, FEATURE_KEYS.SCHEDULED), 1);
  assert.equal(stateOf(world, FEATURE_KEYS.CURRENT), 'News (Mire Test)');
  assert.equal(stateOf(world, FEATURE_KEYS.NEXT), 'Film · Mire Test · 20:00');
  assert.equal(stateOf(world, FEATURE_KEYS.DISK_FREE), 120);
  assert.equal(stateOf(world, FEATURE_KEYS.DISK_FREE_PERCENT), 24);
  assert.equal(stateOf(world, FEATURE_KEYS.VIEWERS), 0);
  assert.equal(stateOf(world, FEATURE_KEYS.TUNERS), 1);
  assert.deepEqual(world.fake.transports.at(-1), {
    device_external_id: idsOf(world).device,
    transport: 'local',
  });
  assert.ok(world.fake.widgetRefreshes.includes(WIDGET_KEY));
});

test('a recording that starts, then finishes, fires its two triggers once', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const uuid = world.tvh.add({ title: 'Match', channel: 0, start: world.clock.now() + MINUTE });
  await world.hub.pollNow();
  assert.deepEqual(keys(world), []);

  world.clock.advance(MINUTE);
  world.tvh.set(uuid, 'recording');
  await world.hub.pollNow();
  await world.hub.pollNow();
  assert.deepEqual(world.fake.sceneEvents, [
    {
      key: TRIGGERS.STARTED,
      data: { title: 'Match', channel: 'Chaine Coupee', stop_time: '18:31', duration_minutes: 30 },
    },
  ]);

  world.clock.advance(30 * MINUTE);
  world.tvh.set(uuid, 'completed');
  await world.hub.pollNow();
  await world.hub.pollNow();
  assert.deepEqual(world.fake.sceneEvents.at(-1), {
    key: TRIGGERS.FINISHED,
    data: { title: 'Match', channel: 'Chaine Coupee', duration_minutes: 30, errors: 0 },
  });
  assert.equal(world.fake.sceneEvents.length, 2);
});

test('a failure is announced, even one that never wrote a file', async (t) => {
  const world = await createWorld();
  await createDevices(world);
  t.after(() => world.app.stop());
  const uuid = world.tvh.add({ title: 'Doc', start: world.clock.now() + MINUTE });
  await world.hub.pollNow();
  world.clock.advance(2 * MINUTE);
  world.tvh.set(uuid, 'completedError', 'File not created');
  await world.hub.pollNow();
  assert.deepEqual(world.fake.sceneEvents, [
    {
      key: TRIGGERS.FAILED,
      data: { title: 'Doc', channel: 'Mire Test', reason: 'File not created' },
    },
  ]);
  assert.equal(stateOf(world, FEATURE_KEYS.FAILED), 1);
  // A day later it is no longer recent.
  world.clock.advance(25 * 3600_000);
  await world.hub.pollNow();
  assert.equal(stateOf(world, FEATURE_KEYS.FAILED), 0);
});

test('the first read only sets the states: the history is not news', async (t) => {
  const clock = createClock();
  const tvheadend = new FakeTvheadend({ now: clock.now });
  tvheadend.add({ title: 'Old', start: clock.now() - 3600_000, status: 'completed' });
  tvheadend.add({ title: 'Live', start: clock.now() - MINUTE, status: 'recording' });
  tvheadend.freeBytes = 10e9; // 2 %: below every threshold
  const world = await createWorld({ clock, tvheadend });
  t.after(() => world.app.stop());
  await world.hub.pollNow();
  assert.deepEqual(keys(world), []);
});

test('a recording created and ended between two reads is still announced', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.clock.advance(5 * MINUTE);
  world.tvh.add({ title: 'Flash', start: world.clock.now() - 3 * MINUTE, minutes: 2 });
  const [uuid] = [...world.tvh.entries.keys()].slice(-1);
  world.tvh.set(uuid, 'completed');
  await world.hub.pollNow();
  assert.deepEqual(keys(world), [TRIGGERS.FINISHED]);
});

test('a restart neither repeats nor misses a transition', async (t) => {
  const clock = createClock();
  const tvheadend = new FakeTvheadend({ now: clock.now });
  const uuid = tvheadend.add({ title: 'Film', start: clock.now() - MINUTE, status: 'recording' });
  const first = await createWorld({ clock, tvheadend });
  await first.app.stop();

  // The integration was stopped while the film ended.
  clock.advance(40 * MINUTE);
  tvheadend.set(uuid, 'completed');
  const second = await createWorld({ clock, tvheadend, dataDir: first.dataDir });
  t.after(() => second.app.stop());
  assert.deepEqual(keys(second), [TRIGGERS.FINISHED]);
  await second.app.stop();

  const third = await createWorld({ clock, tvheadend, dataDir: first.dataDir });
  t.after(() => third.app.stop());
  assert.deepEqual(keys(third), [], 'announced once');
});

test('free space below a threshold fires once, and again after it went back up', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.tvh.freeBytes = 60e9; // 12 %
  await world.hub.pollNow();
  assert.deepEqual(world.fake.sceneEvents, [
    { key: TRIGGERS.DISK_LOW, data: { threshold: 15, free_percent: 12, free_gb: 60 } },
    { key: TRIGGERS.DISK_LOW, data: { threshold: 20, free_percent: 12, free_gb: 60 } },
  ]);
  await world.hub.pollNow();
  assert.equal(world.fake.sceneEvents.length, 2, 'once');
  world.tvh.freeBytes = 77e9; // 15.4 %: not enough above 15 to re-arm it
  await world.hub.pollNow();
  world.tvh.freeBytes = 60e9;
  await world.hub.pollNow();
  assert.equal(world.fake.sceneEvents.length, 2);
  world.tvh.freeBytes = 90e9; // 18 %: re-armed
  await world.hub.pollNow();
  world.tvh.freeBytes = 60e9;
  await world.hub.pollNow();
  assert.deepEqual(
    world.fake.sceneEvents.slice(2).map((e) => e.data.threshold),
    [15],
  );
});

test('a new viewer fires its trigger; the recorder and the EPG grabber are not viewers', async (t) => {
  const clock = createClock();
  const tvheadend = new FakeTvheadend({ now: clock.now });
  tvheadend.add({ title: 'Rec', start: clock.now() - MINUTE, status: 'recording' });
  tvheadend.watch(1, 'alice');
  const world = await createWorld({ clock, tvheadend });
  t.after(() => world.app.stop());
  await world.hub.pollNow();
  assert.deepEqual(keys(world), [], 'the viewer already there is not news');
  world.tvh.watch(0, 'bob');
  await world.hub.pollNow();
  assert.deepEqual(world.fake.sceneEvents.at(-1), {
    key: TRIGGERS.VIEWER,
    data: { channel: 'Chaine Coupee', user: 'bob', client: 'curl/8.23.0' },
  });
  await createDevices(world);
  assert.equal(stateOf(world, FEATURE_KEYS.VIEWERS), 2);
});

test('a recorder-only account: no viewers nor tuners, everything else works', async (t) => {
  const clock = createClock();
  const tvheadend = new FakeTvheadend({ now: clock.now });
  tvheadend.admin = false;
  const world = await createWorld({ clock, tvheadend });
  t.after(() => world.app.stop());
  await createDevices(world);
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.equal(stateOf(world, FEATURE_KEYS.VIEWERS), undefined, 'no false 0');
  assert.equal(stateOf(world, FEATURE_KEYS.TUNERS), undefined);
  assert.equal(stateOf(world, FEATURE_KEYS.SCHEDULED), 0);
  // The admin pages are asked again 10 minutes later only.
  const before = tvheadend.requests.filter((r) => r.path.startsWith('/api/status/')).length;
  await world.hub.pollNow();
  const after = tvheadend.requests.filter((r) => r.path.startsWith('/api/status/')).length;
  assert.equal(after, before);
  const report = await world.fake.action('test_connection');
  assert.match(report.data.message?.en ?? JSON.stringify(report), /admin account/);
});

test('wrong credentials, then Tvheadend down: clear statuses, the device unreachable', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, password: 'nope' } });
  t.after(() => world.app.stop());
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /password refused/);

  await world.fake.configUpdated(CONFIG);
  await createDevices(world);
  assert.equal(world.fake.connectionStatus.connected, true);
  world.tvh.failure = 'down';
  await world.hub.pollNow();
  assert.equal(world.fake.connectionStatus.message.en, 'Tvheadend does not answer');
  assert.equal(world.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(stateOf(world, FEATURE_KEYS.ONLINE), 0);
  world.tvh.failure = null;
  await world.hub.pollNow();
  assert.equal(stateOf(world, FEATURE_KEYS.ONLINE), 1);
  assert.equal(world.fake.transports.at(-1).transport, 'local');
});

test('the digest nonce is reused, and a fresh one asked when Tvheadend forgot it', async () => {
  const tvheadend = new FakeTvheadend();
  const client = new TvheadendClient({ ...CONFIG, request: tvheadend.request });
  await client.serverInfo();
  await client.upcoming();
  assert.equal(tvheadend.requests.length, 3, 'one challenge, then two requests');
  tvheadend.nonce = 'bmV3';
  await client.upcoming();
  assert.equal(tvheadend.requests.length, 6, 'a 403, a challenge, the request');
});

test('a normal reading cycle writes nothing at the info level', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  world.tvh.add({ title: 'Film' });
  const logs = captureLogs(t);
  await world.hub.pollNow();
  await world.hub.pollNow();
  assert.deepEqual(logs.loud(), []);
  assert.ok(logs.lines.length >= 0);
});

test('the container reads Tvheadend on its own timer, without onPoll', async (t) => {
  const world = await createWorld({ timers: true, config: { ...CONFIG } });
  t.after(() => world.app.stop());
  world.hub.config.pollIntervalMs = 20;
  world.hub.schedulePoll(5);
  const before = world.tvh.requests.length;
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.ok(world.tvh.requests.length > before);
});

test('"Record a channel now" schedules from now, by name or number', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.sceneAction('record_now', { channel: 'mire test', duration: 45 });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, {
    title: 'Mire Test (Gladys)',
    channel: 'Mire Test',
    start_time: '18:00',
    stop_time: '18:45',
    duration_minutes: 45,
  });
  assert.equal(world.tvh.created.stop - world.tvh.created.start, 45 * 60);
  assert.deepEqual(keys(world), [TRIGGERS.STARTED], 'read again at once');

  const bad = await world.fake.sceneAction('record_now', { channel: 'Nope', duration: 10 });
  assert.equal(bad.success, false);
  assert.match(bad.error, /Channel unknown/);
  const long = await world.fake.sceneAction('record_now', { channel: 'Mire Test', duration: 721 });
  assert.equal(long.success, false);
  assert.match(long.error, /from 1 to 720/);
});

test('channels are found by name (any case) or number, never by a part of the name', () => {
  const channels = [
    { id: 'a', name: 'France 2', number: 2 },
    { id: 'b', name: 'Arte', number: 7 },
  ];
  assert.equal(findChannel(channels, 'ARTE').id, 'b');
  assert.equal(findChannel(channels, '2').id, 'a');
  assert.equal(findChannel(channels, 'France'), null);
});

test('"Recordings summary" gives the figures and a sentence', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, language: 'fr' } });
  t.after(() => world.app.stop());
  world.tvh.add({ title: 'Film', start: world.clock.now() + 26 * 3600_000 });
  world.tvh.add({ title: 'JT', start: world.clock.now() - MINUTE, status: 'recording' });
  world.clock.advance(10_000);
  const ack = await world.fake.sceneAction('get_recordings');
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, {
    recording_count: 1,
    scheduled_count: 1,
    current: 'JT',
    next_title: 'Film',
    next_channel: 'Mire Test',
    next_time: 'sam. 20:00',
    free_gb: 120,
    free_percent: 24,
    sentence:
      '1 enregistrement(s) en cours (JT), prochain : Film · Mire Test · sam. 20:00, 120 Go libres (24 %)',
  });
});

test('the widget is valid, in every language and every state', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const check = async (language) => {
    const ack = await world.fake.widgetGet(WIDGET_KEY, { language });
    assert.equal(ack.success, true, ack.error);
    validateWidgetContent(ack.data.content);
    return ack.data.content;
  };
  for (const language of ['en', 'fr', 'de', 'es']) {
    await check(language);
  }
  for (let i = 0; i < 12; i += 1) {
    world.tvh.add({ title: `Programme with a very long title number ${i}`, minutes: 60 + i });
  }
  world.tvh.add({ title: 'Live', start: world.clock.now() - MINUTE, status: 'recording' });
  await world.hub.pollNow();
  for (const language of ['en', 'fr', 'de', 'es']) {
    const content = await check(language);
    assert.equal(content.components.find((c) => c.type === 'status').items.length, 8);
  }
  const fr = await check('fr');
  assert.equal(fr.components[0].text, 'Live');
  assert.equal(fr.components[1].text, "jusqu'à 18:29 · Mire Test");
  world.tvh.failure = 'down';
  await world.hub.pollNow();
  const down = await check('en');
  assert.equal(down.components[1].text, 'Tvheadend does not answer');
});

test('without address, the widget and the status say what to do', async (t) => {
  const world = await createWorld({ config: {} });
  t.after(() => world.app.stop());
  assert.match(world.fake.connectionStatus.message.en, /Enter the address/);
  const ack = await world.fake.widgetGet(WIDGET_KEY, { language: 'en' });
  validateWidgetContent(ack.data.content);
  assert.match(ack.data.content.components[0].text, /Enter the address/);
  assert.equal(world.fake.discoveredDevices.length, 0);
});

test('the store survives a lost file', async () => {
  const store = new Store('/nonexistent-dir-for-test');
  assert.deepEqual(await store.load(), {});
  assert.equal(NONE, '—');
});
