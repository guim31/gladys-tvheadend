// -----------------------------------------------------------------------------
// An in-memory Tvheadend, rendering its API like Tvheadend 4.3 in Docker
// (test/fixtures/tvheadend): HTTP Digest (a wrong password and a missing
// right are both a 403), the DVR grids built from a real entry, the comet
// `accessUpdate` with the disk space, the subscriptions and inputs (admin
// only), the channels, and the creation of a recording.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseChallenge } from '../../src/tvheadend/digest.js';

export const BASE = 'http://192.0.2.10:9981';
export const USER = 'gladys';
export const PASSWORD = 'secret-pass';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/tvheadend/${name}.json`, import.meta.url), 'utf8'));

const SERVERINFO = fixture('serverinfo');
const ENTRY = fixture('grid_upcoming').entries.find((e) => e.sched_status === 'scheduled');
const COMET = fixture('comet_poll');
const VIEWER = fixture('status_subscriptions').entries.find((e) => e.hostname);
const RECORDER = fixture('status_subscriptions').entries.find((e) => e.title.startsWith('DVR:'));
const INPUT = fixture('status_inputs').entries[0];
// [0] Chaine Coupee, [1] Mire Test (the default).
export const CHANNELS = fixture('channel_grid').entries;

const clone = (value) => JSON.parse(JSON.stringify(value));
const md5 = (text) => createHash('md5').update(text, 'utf8').digest('hex');
const json = (value, status = 200) => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(value),
});
const FORBIDDEN = { status: 403, headers: {}, body: '<HTML><TITLE>403 Forbidden</TITLE></HTML>' };

const STATUS_TEXT = {
  scheduled: 'Scheduled for recording',
  recording: 'Running',
  completed: 'Completed OK',
  completedError: 'File not created',
  completedWarning: 'Completed OK',
};

let counter = 0;

export class FakeTvheadend {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    /** @type {Map<string, object>} uuid → raw DVR entry */
    this.entries = new Map();
    this.viewers = [];
    this.admin = true;
    this.freeBytes = 120e9;
    this.totalBytes = 500e9;
    this.users = new Map([
      [USER, PASSWORD],
      ['admin', 'admin-pass'],
    ]);
    /** 'down': no answer; a number: that HTTP status for every request. */
    this.failure = null;
    this.requests = [];
    this.nonce = 'bm9uY2Ux';
    this.request = this.request.bind(this);
  }

  /** A recording, in a phase (`scheduled`, `recording`, `completed`, `completedError`…). */
  add({ title = 'News', channel = 1, start, minutes = 30, status = 'scheduled', ...extra } = {}) {
    counter += 1;
    const uuid = `${String(counter).padStart(4, '0')}${'a'.repeat(28)}`;
    const begin = start ?? this.now() + 3600_000;
    const raw = clone(ENTRY);
    Object.assign(raw, {
      uuid,
      disp_title: title,
      title: { fre: title },
      channel: CHANNELS[channel].uuid,
      channelname: CHANNELS[channel].name,
      start: Math.floor(begin / 1000),
      stop: Math.floor(begin / 1000) + minutes * 60,
      ...extra,
    });
    this.entries.set(uuid, raw);
    this.set(uuid, status);
    return uuid;
  }

  set(uuid, schedStatus, status = STATUS_TEXT[schedStatus]) {
    const raw = this.entries.get(uuid);
    raw.sched_status = schedStatus;
    raw.status = status;
  }

  remove(uuid) {
    this.entries.delete(uuid);
  }

  /** Someone starts watching a channel (an admin account sees it). */
  watch(channel = 1, user = 'alice') {
    counter += 1;
    const raw = { ...clone(VIEWER), id: 100 + counter, channel: CHANNELS[channel].name };
    raw.username = user;
    this.viewers.push(raw);
    return raw.id;
  }

  /** The user of a request, null when the Digest response is wrong. */
  authenticated(method, headers) {
    const header = headers.authorization ?? '';
    const params = parseChallenge(header);
    if (!params || params.nonce !== this.nonce || !this.users.has(params.username)) {
      return params ? null : undefined;
    }
    const ha1 = md5(`${params.username}:tvheadend:${this.users.get(params.username)}`);
    const ha2 = md5(`${method}:${params.uri}`);
    const expected = md5(`${ha1}:${params.nonce}:${params.nc}:${params.cnonce}:auth:${ha2}`);
    return params.response === expected ? params.username : null;
  }

  grid(filter) {
    let entries = [...this.entries.values()];
    if (filter === 'upcoming') {
      entries = entries.filter((e) => ['scheduled', 'recording'].includes(e.sched_status));
    } else {
      entries = entries
        .filter((e) => e.sched_status.includes('completed'))
        .sort((a, b) => b.stop - a.stop);
    }
    return { entries, total: entries.length };
  }

  async request({ method = 'GET', url, headers = {}, body }) {
    const target = new URL(url);
    this.requests.push({ method, path: target.pathname + target.search });
    if (this.failure === 'down') {
      const err = new Error('connect ECONNREFUSED');
      err.cause = { code: 'ECONNREFUSED' };
      throw err;
    }
    if (typeof this.failure === 'number') {
      return { status: this.failure, headers: {}, body: '' };
    }
    const user = this.authenticated(method, headers);
    if (user === undefined) {
      return {
        status: 401,
        headers: {
          'www-authenticate': `Digest realm="tvheadend", qop=auth, nonce="${this.nonce}", opaque="b3BhcXVl"`,
        },
        body: '',
      };
    }
    if (user === null) {
      return FORBIDDEN;
    }
    const isAdmin = user === 'admin' || this.admin;
    switch (target.pathname) {
      case '/api/serverinfo':
        return json(SERVERINFO);
      case '/api/dvr/entry/grid_upcoming':
        return json(this.grid('upcoming'));
      case '/api/dvr/entry/grid':
        return json(this.grid('recent'));
      case '/comet/poll': {
        const out = clone(COMET);
        Object.assign(out.messages[0], {
          freediskspace: this.freeBytes,
          totaldiskspace: this.totalBytes,
          username: user,
          admin: isAdmin ? 1 : 0,
        });
        return json(out);
      }
      case '/api/status/subscriptions':
        if (!isAdmin) {
          return FORBIDDEN;
        }
        return json({
          entries: [
            ...[...this.entries.values()]
              .filter((e) => e.sched_status === 'recording')
              .map((e, i) => ({ ...clone(RECORDER), id: i + 1, title: `DVR: ${e.disp_title}` })),
            ...this.viewers,
          ],
        });
      case '/api/status/inputs':
        return isAdmin ? json({ entries: [clone(INPUT)], totalCount: 1 }) : FORBIDDEN;
      case '/api/channel/grid':
        return json({ entries: CHANNELS, total: CHANNELS.length });
      case '/api/dvr/entry/create': {
        const conf = JSON.parse(new URLSearchParams(body).get('conf'));
        const channel = CHANNELS.findIndex((c) => c.uuid === conf.channel);
        if (channel < 0) {
          return json({}, 400);
        }
        this.created = conf;
        const uuid = this.add({
          title: conf.disp_title,
          channel,
          start: conf.start * 1000,
          minutes: Math.round((conf.stop - conf.start) / 60),
          status: conf.start * 1000 <= this.now() ? 'recording' : 'scheduled',
        });
        return json({ uuid });
      }
      default:
        return { status: 404, headers: {}, body: 'Not found' };
    }
  }
}
