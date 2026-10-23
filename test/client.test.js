// The Tvheadend client on the real answers of Tvheadend 4.3 in Docker
// (test/fixtures/tvheadend), and its errors.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ERROR_KINDS, TvheadendClient, isViewer, normalizeEntry } from '../src/tvheadend/client.js';
import { FakeTvheadend, PASSWORD, USER } from './helpers/fakeTvheadend.js';

const fixture = async (name) =>
  JSON.parse(await readFile(new URL(`./fixtures/tvheadend/${name}.json`, import.meta.url), 'utf8'));

const real = (body) => async () => ({ status: 200, headers: {}, body: JSON.stringify(body) });
const client = (request) => new TvheadendClient({ url: 'http://192.0.2.10:9981', request });

test('the real DVR grids: scheduled, recording, finished, failed (rerecord included)', async () => {
  const upcoming = (await fixture('grid_upcoming')).entries.map(normalizeEntry);
  assert.deepEqual(
    upcoming.map((e) => [e.title, e.channel, e.phase]),
    [
      ['Meteo test', 'Mire Test', 'recording'],
      ['Emission coupee', 'Chaine Coupee', 'recording'],
      ['Film du soir', 'Mire Test', 'scheduled'],
    ],
  );
  assert.equal(upcoming[2].stop - upcoming[2].start, 3600_000);
  const recent = (await fixture('grid_recent')).entries.map(normalizeEntry);
  assert.deepEqual(
    recent.slice(0, 4).map((e) => [e.title, e.phase, e.status]),
    [
      ['Meteo test', 'finished', 'Completed OK'],
      // No input at the start: Tvheadend says "File missing", rerecord pending.
      ['Sans signal', 'failed', 'File missing'],
      // The stream cut in the middle: Tvheadend calls it a success.
      ['Emission coupee', 'finished', 'Completed OK'],
      ['Emission coupee', 'failed', 'File not created'],
    ],
  );
  assert.equal(normalizeEntry({ uuid: 'x', sched_status: 'invalid' }), null);
});

test('viewers are the subscriptions of a client, not the recorder nor the EPG grabber', async () => {
  const { entries } = await fixture('status_subscriptions');
  assert.deepEqual(
    entries.map((e) => [e.title, isViewer(e)]),
    [
      ['DVR: Meteo test', false],
      ['DVR: Emission coupee', false],
      ['HTTP', true],
      ['epggrab', false],
    ],
  );
  const viewers = await client(real({ entries })).viewers();
  assert.deepEqual(viewers[0], {
    id: entries[2].id.toString(),
    channel: 'Mire Test',
    user: 'admin',
    client: 'curl/8.23.0',
    start: entries[2].start * 1000,
  });
});

test('the disk space comes from the first comet message', async () => {
  const comet = await fixture('comet_poll');
  const space = await client(real(comet)).diskSpace();
  assert.ok(space.totalBytes > space.freeBytes && space.freeBytes > 0);
  assert.equal(await client(real({ messages: [] })).diskSpace(), null);
});

test('tuners in use, channels', async () => {
  assert.equal(await client(real(await fixture('status_inputs'))).tunersInUse(), 2);
  const channels = await client(real(await fixture('channel_grid'))).channels();
  assert.deepEqual(
    channels.map((c) => c.name),
    ['Chaine Coupee', 'Mire Test'],
  );
});

test('errors by kind: down, wrong password, no right, not Tvheadend, certificate', async () => {
  const tvh = new FakeTvheadend();
  const ok = new TvheadendClient({
    url: 'http://192.0.2.10:9981',
    username: USER,
    password: PASSWORD,
    request: tvh.request,
  });
  assert.equal((await ok.serverInfo()).version, '4.3-2897~g8837853a6');

  const wrong = new TvheadendClient({
    url: 'http://192.0.2.10:9981',
    username: USER,
    password: 'nope',
    request: tvh.request,
  });
  await assert.rejects(wrong.serverInfo(), { kind: ERROR_KINDS.AUTH });
  await assert.rejects(wrong.upcoming(), { kind: ERROR_KINDS.RIGHTS });
  await assert.rejects(client(tvh.request).serverInfo(), { kind: ERROR_KINDS.AUTH });

  tvh.admin = false;
  await assert.rejects(ok.viewers(), { kind: ERROR_KINDS.RIGHTS });

  tvh.failure = 404;
  await assert.rejects(ok.upcoming(), { kind: ERROR_KINDS.NOT_TVHEADEND });
  tvh.failure = 'down';
  await assert.rejects(ok.upcoming(), { kind: ERROR_KINDS.UNREACHABLE });
  const tls = async () => {
    const err = new Error('fetch failed');
    err.cause = { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' };
    throw err;
  };
  await assert.rejects(client(tls).serverInfo(), { kind: ERROR_KINDS.TLS });
  await assert.rejects(client(real({ hello: 1 })).serverInfo(), {
    kind: ERROR_KINDS.NOT_TVHEADEND,
  });
});

test('Basic authentication when Tvheadend asks for it, path prefix in the Digest uri', async () => {
  const seen = [];
  const basic = async ({ headers, url }) => {
    seen.push({ url, authorization: headers.authorization });
    return headers.authorization
      ? { status: 200, headers: {}, body: '{"sw_version":"4.2.8","name":"Tvheadend"}' }
      : { status: 401, headers: { 'www-authenticate': 'Basic realm="tvheadend"' }, body: '' };
  };
  const c = new TvheadendClient({
    url: 'https://tv.example.org/tvh',
    username: 'u',
    password: 'p',
    request: basic,
  });
  await c.serverInfo();
  assert.equal(seen[1].authorization, `Basic ${Buffer.from('u:p').toString('base64')}`);
  assert.equal(seen[1].url, 'https://tv.example.org/tvh/api/serverinfo');
  c.challenge = { realm: 'tvheadend', nonce: 'n', qop: 'auth' };
  assert.match(
    c.credentials('GET', '/api/serverinfo').authorization,
    /uri="\/tvh\/api\/serverinfo"/,
  );
});

test('the recording created carries the channel, the times in seconds and a title', async () => {
  let body;
  const c = client(async (request) => {
    body = request.body;
    return { status: 200, headers: {}, body: '{"uuid":"abc"}' };
  });
  const uuid = await c.createRecording({
    channelId: 'chan',
    start: 1_792_761_054_500,
    stop: 1_792_761_654_500,
    title: 'JT',
  });
  assert.equal(uuid, 'abc');
  assert.deepEqual(JSON.parse(new URLSearchParams(body).get('conf')), {
    channel: 'chan',
    start: 1_792_761_054,
    stop: 1_792_761_655,
    disp_title: 'JT',
    comment: 'Gladys Assistant',
  });
});
