// -----------------------------------------------------------------------------
// Tvheadend client (GPL-3.0, https://tvheadend.org), checked against
// Tvheadend 4.3 (image lscr.io/linuxserver/tvheadend) in Docker, answers in
// test/fixtures/tvheadend:
//
//   GET  /api/serverinfo                  name, sw_version, api_version
//   GET  /api/dvr/entry/grid_upcoming     scheduled AND running recordings
//   GET  /api/dvr/entry/grid?filter=…     the recordings ended lately (every
//        sched_status containing "completed", newest stop first): grid_failed
//        misses a failure that never wrote a file (it lands in grid_removed)
//   GET  /comet/poll                      first message `accessUpdate`:
//        freediskspace / totaldiskspace (bytes) of the recording directory
//   GET  /api/status/subscriptions        who reads what (admin only)
//   GET  /api/status/inputs               the tuners in use (admin only)
//   GET  /api/channel/grid                the channels (record action)
//   POST /api/dvr/entry/create            conf={channel,start,stop,disp_title}
//
// Tvheadend asks for HTTP Digest by default (a "plain" setting adds Basic). A
// wrong password is answered 403, not 401, like a missing right.
// -----------------------------------------------------------------------------

import { authorization, parseChallenge } from './digest.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify
  AUTH: 'auth', // credentials refused (or no web interface right)
  RIGHTS: 'rights', // the account has no video recorder right
  NOT_TVHEADEND: 'not_tvheadend', // something answers, not Tvheadend
  HTTP: 'http', // any other HTTP error
});

export class TvheadendError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'TvheadendError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

// A recording entry is about 1.5 KB: 4 MB is far more than the lists asked.
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

// How many ended recordings are read at each cycle (newest first).
export const RECENT_LIMIT = 50;
// More scheduled recordings than this is not a household.
export const UPCOMING_LIMIT = 500;

/**
 * The one function that talks to the network (fetch). The client takes it as
 * a parameter: the tests replace it with an in-memory Tvheadend
 * (test/helpers/fakeTvheadend.js).
 * @returns {Promise<{ status: number, headers: object, body: string }>}
 */
export async function httpRequest({ method = 'GET', url, headers = {}, body, timeoutMs }) {
  const response = await fetch(url, {
    method,
    headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs ?? 10_000),
  });
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) {
    await response.body?.cancel();
    throw new Error('Response too large');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_BODY_BYTES) {
    throw new Error('Response too large');
  }
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: bytes.toString('utf8'),
  };
}

const clean = (value, max) =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, max)
    : '';

const count = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
};

/** Seconds since the epoch → milliseconds, null when absent. */
const time = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number * 1000 : null;
};

/** A localized title (`{ "eng": "…" }`): its first value. */
const localized = (value) =>
  value && typeof value === 'object' ? (Object.values(value).find((v) => clean(v, 200)) ?? '') : '';

/** What a recording became, from its `sched_status`. */
export function phaseOf(schedStatus) {
  switch (schedStatus) {
    case 'scheduled':
      return 'scheduled';
    case 'recording':
      return 'recording';
    case 'completed':
    case 'completedWarning':
      return 'finished';
    case 'completedError':
    case 'completedRerecord':
      return 'failed';
    default:
      return null;
  }
}

/**
 * One DVR entry, normalized; null without a uuid or a known status.
 * @returns {{ uuid: string, title: string, channel: string, channelId: string,
 *   start: number|null, stop: number|null, phase: string, status: string,
 *   errors: number, enabled: boolean }|null}
 */
export function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.uuid !== 'string' || !raw.uuid) {
    return null;
  }
  const phase = phaseOf(raw.sched_status);
  if (!phase) {
    return null;
  }
  return {
    uuid: raw.uuid.slice(0, 64),
    title: clean(raw.disp_title, 200) || clean(localized(raw.title), 200),
    channel: clean(raw.channelname, 100),
    channelId: clean(raw.channel, 64),
    // The planned times; `start_real` / `stop_real` add the padding.
    start: time(raw.start),
    stop: time(raw.stop),
    phase,
    // Tvheadend's own words ("File not created", "Time missed"…), English.
    status: clean(raw.status, 100),
    errors: count(raw.errors) + count(raw.data_errors),
    enabled: raw.enabled !== false,
  };
}

const entriesOf = (raw) =>
  (Array.isArray(raw?.entries) ? raw.entries : []).map(normalizeEntry).filter(Boolean);

/**
 * A subscription that is someone watching: it has a client address (a DVR
 * recording, the EPG grabber and the scanner have none), and is not the
 * recorder's.
 */
export function isViewer(raw) {
  return (
    Boolean(raw && typeof raw === 'object' && (raw.hostname || raw.client)) &&
    !String(raw.title ?? '').startsWith('DVR:')
  );
}

export function normalizeSubscription(raw) {
  return {
    id: String(raw.id ?? ''),
    channel: clean(raw.channel, 100),
    user: clean(raw.username, 100),
    client: clean(raw.client, 100) || clean(raw.title, 100),
    start: time(raw.start),
  };
}

export class TvheadendClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, `http(s)://host[:port][/path]`
   * @param {string} [options.username]
   * @param {string} [options.password]
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   */
  constructor({ url, username = '', password = '', request = httpRequest, timeoutMs }) {
    this.url = url;
    this.username = username;
    this.password = password;
    this.request = request;
    this.timeoutMs = timeoutMs ?? 10_000;
    this.challenge = null;
    this.nc = 0;
    this.basePath = new URL(url).pathname.replace(/\/+$/, '');
  }

  /** The Authorization header for a request, from the last challenge. */
  credentials(method, path) {
    if (!this.username || !this.challenge) {
      return {};
    }
    if (this.challenge.basic) {
      const token = Buffer.from(`${this.username}:${this.password}`, 'utf8').toString('base64');
      return { authorization: `Basic ${token}` };
    }
    this.nc += 1;
    return {
      authorization: authorization({
        challenge: this.challenge,
        username: this.username,
        password: this.password,
        method,
        uri: `${this.basePath}${path}`,
        nc: this.nc,
      }),
    };
  }

  /**
   * One request, authenticated when Tvheadend asks: sent with the last
   * challenge when there is one, and once more with a fresh challenge on a
   * 401 (an expired nonce) or on a 403 answered to an old challenge.
   * @returns {Promise<{ status: number, body: string }>}
   */
  async send(method, path, { body, headers = {} } = {}) {
    // Whether the challenge in use was received during this request.
    let fresh = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const authenticated = this.credentials(method, path);
      let response;
      try {
        response = await this.request({
          method,
          url: `${this.url}${path}`,
          headers: { accept: 'application/json', ...headers, ...authenticated },
          body,
          timeoutMs: this.timeoutMs,
        });
      } catch (err) {
        const code = err.cause?.code ?? err.code;
        if (TLS_CODES.has(code)) {
          throw new TvheadendError(ERROR_KINDS.TLS, `Certificate refused (${code})`);
        }
        const reason = code ?? (/too large/i.test(err.message) ? 'Response too large' : err.name);
        throw new TvheadendError(ERROR_KINDS.UNREACHABLE, reason || 'Request failed');
      }
      const { status } = response;
      const sentCredentials = Boolean(authenticated.authorization);
      if (status === 401) {
        const header = response.headers?.['www-authenticate'] ?? '';
        const digest = parseChallenge(header);
        if (!this.username || (!digest && !/^Basic/i.test(header))) {
          throw new TvheadendError(ERROR_KINDS.AUTH, 'A user name and password are needed', {
            status,
          });
        }
        if (fresh && sentCredentials) {
          break;
        }
        this.challenge = digest ?? { basic: true };
        this.nc = 0;
        fresh = true;
        continue;
      }
      // A 403 to a reused challenge may be a nonce Tvheadend forgot: one try
      // with a fresh one. A 403 to a fresh one is the answer.
      if (status === 403 && sentCredentials && !fresh && this.challenge?.nonce) {
        this.challenge = null;
        continue;
      }
      return response;
    }
    this.challenge = null;
    throw new TvheadendError(ERROR_KINDS.AUTH, 'User name or password refused', { status: 401 });
  }

  /**
   * A JSON answer. `forbidden`: what a 403 means for this path.
   * @throws {TvheadendError}
   */
  async json(path, { method = 'GET', body, forbidden = ERROR_KINDS.RIGHTS } = {}) {
    const headers = body ? { 'content-type': 'application/x-www-form-urlencoded' } : {};
    const response = await this.send(method, path, { body, headers });
    const { status } = response;
    if (status === 403) {
      throw new TvheadendError(forbidden, `Forbidden: ${path.split('?')[0]} (HTTP 403)`, {
        status,
      });
    }
    if (status >= 300 && status < 400) {
      throw new TvheadendError(ERROR_KINDS.HTTP, `Redirected (HTTP ${status})`, { status });
    }
    if (status === 404) {
      throw new TvheadendError(
        ERROR_KINDS.NOT_TVHEADEND,
        `Not found: ${path.split('?')[0]} (HTTP 404)`,
        { status },
      );
    }
    if (status < 200 || status >= 300) {
      throw new TvheadendError(ERROR_KINDS.HTTP, `Unexpected answer (HTTP ${status})`, { status });
    }
    try {
      return JSON.parse(response.body);
    } catch {
      throw new TvheadendError(ERROR_KINDS.NOT_TVHEADEND, `The answer of ${path} is not JSON`);
    }
  }

  /** The name and version; a 403 here is the credentials (or no web right). */
  async serverInfo() {
    const raw = await this.json('/api/serverinfo', { forbidden: ERROR_KINDS.AUTH });
    if (!raw || typeof raw !== 'object' || !('sw_version' in raw)) {
      throw new TvheadendError(ERROR_KINDS.NOT_TVHEADEND, 'The answer is not Tvheadend');
    }
    return { name: clean(raw.name, 100) || 'Tvheadend', version: clean(raw.sw_version, 60) };
  }

  /** Scheduled and running recordings. */
  async upcoming() {
    return entriesOf(await this.json(`/api/dvr/entry/grid_upcoming?limit=${UPCOMING_LIMIT}`));
  }

  /** The recordings ended lately, newest first (succeeded or failed). */
  async recent() {
    const filter = JSON.stringify([{ field: 'sched_status', type: 'string', value: 'completed' }]);
    const query = new URLSearchParams({
      filter,
      sort: 'stop',
      dir: 'DESC',
      limit: String(RECENT_LIMIT),
    });
    return entriesOf(await this.json(`/api/dvr/entry/grid?${query}`));
  }

  /**
   * The space of the recording directory, from the first comet message.
   * @returns {Promise<{ freeBytes: number, totalBytes: number }|null>}
   */
  async diskSpace() {
    const raw = await this.json('/comet/poll');
    const update = (Array.isArray(raw?.messages) ? raw.messages : []).find(
      (message) => message?.notificationClass === 'accessUpdate',
    );
    const free = Number(update?.freediskspace);
    const total = Number(update?.totaldiskspace);
    if (!Number.isFinite(free) || !Number.isFinite(total) || total <= 0 || free < 0) {
      return null;
    }
    return { freeBytes: free, totalBytes: total };
  }

  /** Who watches what (admin right). */
  async viewers() {
    const raw = await this.json('/api/status/subscriptions');
    return (Array.isArray(raw?.entries) ? raw.entries : [])
      .filter(isViewer)
      .map(normalizeSubscription);
  }

  /** The tuners (inputs) in use (admin right). */
  async tunersInUse() {
    const raw = await this.json('/api/status/inputs');
    return (Array.isArray(raw?.entries) ? raw.entries : []).filter(
      (input) => count(input?.subs) > 0,
    ).length;
  }

  /** The enabled channels: `{ id, name, number }`. */
  async channels() {
    const raw = await this.json('/api/channel/grid?limit=5000');
    return (Array.isArray(raw?.entries) ? raw.entries : [])
      .filter((channel) => channel && channel.enabled !== false && typeof channel.uuid === 'string')
      .map((channel) => ({
        id: channel.uuid,
        name: clean(channel.name, 100),
        number: Number(channel.number) || 0,
      }));
  }

  /**
   * Schedule a recording (times in milliseconds).
   * @returns {Promise<string>} the uuid of the new entry
   */
  async createRecording({ channelId, start, stop, title }) {
    const conf = {
      channel: channelId,
      start: Math.floor(start / 1000),
      stop: Math.ceil(stop / 1000),
      disp_title: title,
      comment: 'Gladys Assistant',
    };
    const raw = await this.json('/api/dvr/entry/create', {
      method: 'POST',
      body: new URLSearchParams({ conf: JSON.stringify(conf) }).toString(),
    });
    if (typeof raw?.uuid !== 'string') {
      throw new TvheadendError(ERROR_KINDS.HTTP, 'Recording not created');
    }
    return raw.uuid;
  }
}
