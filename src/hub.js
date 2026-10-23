// -----------------------------------------------------------------------------
// The Tvheadend hub: the server read on a timer of the container (the
// interval chosen in the configuration) — the recordings scheduled and
// running, the ones ended lately, the free space, and with an admin account
// the viewers and the tuners in use; the states of the server device
// published when they change, the scene events fired on transitions, and the
// views the widget and the scene actions read.
//
// Gladys never polls the device (should_poll: false, see the CLAUDE.md
// polling trap of the 5.2 core): the timer of the container does.
//
// What each recording was at the last read (scheduled, recording, finished,
// failed) is kept in /data (src/store.js), with the free-space thresholds
// already announced: a restart of the integration or of Gladys neither fires
// a transition twice nor misses one (a recording that ended while the
// integration was stopped is announced on its return). The first read of a
// server only sets the states, without events: its history is not news.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { buildServerDevice, serverIds, serverValues } from './devices.js';
import { ERROR_KINDS, TvheadendClient, TvheadendError } from './tvheadend/client.js';
import { hostOf, isLocalAddress, normalizeConfig as normalizeIntegrationConfig } from './config.js';
import { ProblemLog } from './problems.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  formatClock,
  formatNumber,
  formatWhen,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'tvheadend-hub' });

export const WIDGET_KEY = 'recordings';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  STARTED: 'recording_started',
  FINISHED: 'recording_finished',
  FAILED: 'recording_failed',
  VIEWER: 'viewer_started',
  DISK_LOW: 'disk_space_low',
});

// The free-space thresholds the "free space low" trigger offers (manifest
// options of its `threshold` field), in percent.
export const DISK_THRESHOLDS = [5, 10, 15, 20, 25];
// A threshold is announced again once the free space went back above it by this.
export const DISK_REARM_POINTS = 2;

// The longest recording the scene action schedules, in minutes (12 h).
export const MAX_RECORD_MINUTES = 720;

export const HUB_TIMINGS = {
  // An unchanged value is sent again this often: Gladys shows "no recent
  // value" after 48 hours.
  heartbeatMs: 12 * 3600_000,
  // A scene action reads Tvheadend again when the last read is older.
  freshMs: 5_000,
  // After a 403 on the admin pages, ask again this late (rights can change).
  adminRetryMs: 10 * 60_000,
  // What "recent failures" counts.
  failedWindowMs: 24 * 3600_000,
};

const MINUTE = 60_000;
const GB = 1e9;

const emptySaved = () => ({ known: false, recordings: {}, lowDisk: [] });

const byStart = (a, b) => (a.start ?? 0) - (b.start ?? 0) || a.title.localeCompare(b.title);

export class TvheadendHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/tvheadend/client.js)
   * @param {boolean} [options.timers] the reading timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    // Defaults until start(): a handler reached after a failed start still
    // answers with a readable message.
    this.config = normalizeIntegrationConfig({});
    this.client = null;
    this.signature = null;
    this.resetReadings();
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.saved = emptySaved();
    this.pollTimer = null;
    this.stopped = false;
    // What fails again at every cycle (Gladys refusing, the reading loop):
    // one line when it starts, one when it ends.
    this.problems = new ProblemLog(logger);
  }

  resetReadings() {
    this.server = null;
    this.upcoming = [];
    this.recent = [];
    this.disk = null;
    // null: unknown, or no admin right.
    this.viewers = null;
    this.tuners = null;
    this.adminRetryAt = 0;
    this.knownViewers = null;
    this.readAt = 0;
    this.error = null;
    this.polling = null;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved =
      saved && saved.known === true && saved.recordings && typeof saved.recordings === 'object'
        ? { ...saved, lowDisk: Array.isArray(saved.lowDisk) ? saved.lowDisk : [] }
        : emptySaved();
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    this.config = config;
    const signature = JSON.stringify([config.url, config.username, config.password]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.client = config.url
        ? new TvheadendClient({
            url: config.url,
            username: config.username,
            password: config.password,
            request: this.request,
          })
        : null;
      this.resetReadings();
      this.transports.clear();
    }
    // A new language: new names for Discovery.
    this.discovered = null;
    try {
      if (this.client) {
        await this.pollNow({ publish: true });
      } else {
        await this.afterChanges(true, { publish: true });
      }
    } finally {
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.store.flush();
  }

  /** The next read by the timer, after `delayMs` (the refresh interval by default). */
  schedulePoll(delayMs = this.config.pollIntervalMs) {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    const timer = setTimeout(async () => {
      try {
        await this.pollNow();
        this.problems.recover('poll', 'Reading Tvheadend works again');
      } catch (err) {
        this.problems.fail('poll', `Poll failed: ${err.message}`, 'error');
      }
      if (this.pollTimer === timer) {
        this.schedulePoll();
      }
    }, delayMs);
    this.pollTimer = timer;
  }

  // --- Reading Tvheadend -----------------------------------------------------

  /** Read the server now and publish what changed. */
  async pollNow({ publish = false } = {}) {
    const changed = await this.poll();
    await this.afterChanges(changed, { publish });
  }

  /** Read again when the last read is older than `freshMs` (scene actions). */
  async refreshIfStale() {
    if (this.client && this.now() - this.readAt >= this.timings.freshMs) {
      await this.pollNow();
    }
  }

  /**
   * Read the server and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll() {
    if (!this.client) {
      return Promise.resolve(false);
    }
    if (!this.polling) {
      const polling = this.read(this.client).finally(() => {
        // A read of a previous client must not drop the promise of the current one.
        if (this.polling === polling) {
          this.polling = null;
        }
      });
      this.polling = polling;
    }
    return this.polling;
  }

  async read(client) {
    let reading;
    try {
      reading = await this.fetchAll(client);
    } catch (err) {
      if (!(err instanceof TvheadendError)) {
        throw err;
      }
      // Checked after the await: a read of a previous client never lands.
      return client === this.client && this.applyFailure(err);
    }
    if (client !== this.client) {
      return false;
    }
    return this.applySuccess(reading);
  }

  /** Every request of a cycle; the admin pages only when the account may read them. */
  async fetchAll(client) {
    const server = !this.server || this.error ? await client.serverInfo() : this.server;
    const upcoming = await client.upcoming();
    const recent = await client.recent();
    const disk = await client.diskSpace();
    let admin = null;
    if (this.now() >= this.adminRetryAt) {
      try {
        admin = { viewers: await client.viewers(), tuners: await client.tunersInUse() };
      } catch (err) {
        if (!(err instanceof TvheadendError) || err.kind !== ERROR_KINDS.RIGHTS) {
          throw err;
        }
        admin = false;
      }
    }
    return { server, upcoming, recent, disk, admin };
  }

  async applySuccess({ server, upcoming, recent, disk, admin }) {
    if (this.error) {
      logger.info('Tvheadend answers again');
    }
    if (!this.server || this.server.version !== server.version) {
      logger.info(`Tvheadend ${server.version} (${hostOf(this.config.url)})`);
    }
    const before = JSON.stringify(this.widgetKey());
    const wasError = this.error !== null || this.readAt === 0;
    this.error = null;
    this.server = server;
    this.readAt = this.now();
    this.upcoming = upcoming;
    this.recent = recent;
    this.disk = disk;
    if (admin === false) {
      if (this.adminRetryAt === 0) {
        logger.info('The account is not an administrator: no viewers nor tuners');
      }
      this.viewers = null;
      this.tuners = null;
      this.knownViewers = null;
      this.adminRetryAt = this.now() + this.timings.adminRetryMs;
    } else if (admin) {
      this.viewers = admin.viewers;
      this.tuners = admin.tuners;
      this.adminRetryAt = 0;
    }
    await this.observe();
    return wasError || JSON.stringify(this.widgetKey()) !== before;
  }

  async applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`Tvheadend: ${err.message}`);
    }
    await this.publishStates();
    return wasError !== err.kind;
  }

  /** Compare every recording with what was saved; fire the events, publish the states. */
  async observe() {
    const events = [];
    let dirty = false;
    const firstRead = !this.saved.known || this.saved.url !== this.config.url;
    if (firstRead) {
      this.saved = { known: true, url: this.config.url, recordings: {}, lowDisk: [] };
      dirty = true;
    }
    const lastSeen = this.saved.readAt ?? 0;

    // One entry per recording: a running one is in both lists for a moment.
    const current = new Map();
    for (const entry of [...this.recent, ...this.upcoming]) {
      current.set(entry.uuid, entry);
    }
    for (const [uuid, entry] of current) {
      const before = this.saved.recordings[uuid];
      if (!firstRead) {
        this.transition(entry, before, lastSeen, events);
      }
      if (before !== entry.phase) {
        this.saved.recordings[uuid] = entry.phase;
        dirty = true;
      }
    }
    // Deleted, or ended long ago (out of the recent list): forgotten.
    for (const uuid of Object.keys(this.saved.recordings)) {
      if (!current.has(uuid)) {
        delete this.saved.recordings[uuid];
        dirty = true;
      }
    }
    dirty = this.observeDisk(firstRead, events) || dirty;
    this.observeViewers(events);
    if (dirty) {
      // The time of the read goes with the states it saw: a recording never
      // seen that ended after it is news after a restart.
      this.saved.readAt = this.readAt;
      this.store.save(this.saved);
    }
    for (const [key, data] of events) {
      await this.fire(key, data);
    }
    await this.publishStates();
  }

  /** One recording: its phase now against the saved one; queue the events. */
  transition(entry, before, lastSeen, events) {
    const base = { title: entry.title, channel: entry.channel };
    const minutes =
      entry.start && entry.stop ? Math.max(0, Math.round((entry.stop - entry.start) / MINUTE)) : 0;
    if (entry.phase === 'recording' && before !== 'recording') {
      logger.info(`Recording started: ${entry.title} (${entry.channel})`);
      events.push([
        TRIGGERS.STARTED,
        {
          ...base,
          stop_time: entry.stop ? formatClock(entry.stop, this.config.language) : '',
          duration_minutes: minutes,
        },
      ]);
      return;
    }
    if (entry.phase !== 'finished' && entry.phase !== 'failed') {
      return;
    }
    // Ended since the last read: it was known as coming, or it is new and
    // ended after the last read (created and ended in between).
    const news =
      before === 'scheduled' ||
      before === 'recording' ||
      (before === undefined && (entry.stop ?? 0) >= lastSeen && lastSeen > 0);
    if (!news) {
      return;
    }
    if (entry.phase === 'finished') {
      logger.info(`Recording finished: ${entry.title} (${entry.channel})`);
      events.push([
        TRIGGERS.FINISHED,
        { ...base, duration_minutes: minutes, errors: entry.errors },
      ]);
    } else {
      logger.info(`Recording failed: ${entry.title} (${entry.channel}): ${entry.status}`);
      events.push([TRIGGERS.FAILED, { ...base, reason: entry.status }]);
    }
  }

  /** The free-space thresholds crossed downwards (each once, re-armed above it). */
  observeDisk(firstRead, events) {
    const disk = this.diskView();
    if (!disk) {
      return false;
    }
    let dirty = false;
    for (const threshold of DISK_THRESHOLDS) {
      const announced = this.saved.lowDisk.includes(threshold);
      if (disk.freePercent < threshold && !announced) {
        this.saved.lowDisk.push(threshold);
        dirty = true;
        if (!firstRead) {
          logger.info(`Free space below ${threshold} %`);
          events.push([
            TRIGGERS.DISK_LOW,
            { threshold, free_percent: disk.freePercent, free_gb: disk.freeGb },
          ]);
        }
      } else if (announced && disk.freePercent >= threshold + DISK_REARM_POINTS) {
        this.saved.lowDisk = this.saved.lowDisk.filter((t) => t !== threshold);
        dirty = true;
      }
    }
    return dirty;
  }

  /** Someone starts watching: a subscription id not seen at the last read. */
  observeViewers(events) {
    if (this.viewers === null) {
      return;
    }
    const known = this.knownViewers;
    this.knownViewers = new Set(this.viewers.map((viewer) => viewer.id));
    if (known === null) {
      return;
    }
    for (const viewer of this.viewers) {
      if (!known.has(viewer.id)) {
        logger.debug(`New viewer on ${viewer.channel}`);
        events.push([
          TRIGGERS.VIEWER,
          { channel: viewer.channel, user: viewer.user, client: viewer.client },
        ]);
      }
    }
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Views -----------------------------------------------------------------

  /** Free space in GB (one decimal) and percent (one decimal), null when unknown. */
  diskView() {
    if (!this.disk) {
      return null;
    }
    const { freeBytes, totalBytes } = this.disk;
    return {
      freeGb: Math.round((freeBytes / GB) * 10) / 10,
      totalGb: Math.round((totalBytes / GB) * 10) / 10,
      freePercent: Math.round((freeBytes / totalBytes) * 1000) / 10,
    };
  }

  /** The server as the device, the widget and the scene actions see it. */
  serverView() {
    const online = this.error === null && this.readAt !== 0;
    const since = this.now() - this.timings.failedWindowMs;
    return {
      online,
      server: this.server,
      recording: this.upcoming.filter((e) => e.phase === 'recording').sort(byStart),
      scheduled: this.upcoming.filter((e) => e.phase === 'scheduled' && e.enabled).sort(byStart),
      failedToday: this.recent.filter((e) => e.phase === 'failed' && (e.stop ?? 0) >= since).length,
      disk: this.diskView(),
      viewers: this.viewers,
      tuners: this.tuners,
    };
  }

  /** What the widget shows, to know when to refresh it. */
  widgetKey() {
    const view = this.serverView();
    return [
      view.recording.map((e) => e.uuid),
      view.scheduled.slice(0, 10).map((e) => [e.uuid, e.start, e.title]),
      view.disk?.freePercent,
      view.viewers?.length,
    ];
  }

  /** "Title · Channel · Fri 20:30". */
  describe(entry, language = this.config.language) {
    return [
      entry.title || '?',
      entry.channel,
      entry.start && formatWhen(entry.start, language, this.now()),
    ]
      .filter(Boolean)
      .join(' · ');
  }

  // --- Publishing to Gladys --------------------------------------------------

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  discoveredDevices() {
    if (!this.client) {
      return [];
    }
    // Nothing read yet: keep the list Gladys has.
    if (!this.server) {
      return null;
    }
    return [buildServerDevice(this.gladys, this.server, this.config.language)];
  }

  /** Publish the Discovery list when it changed (a new name, a new version…). */
  async publishDevices({ force = false } = {}) {
    const devices = this.discoveredDevices();
    if (devices === null) {
      return;
    }
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.problems.recover('discovered', 'Discovered devices accepted again');
    } catch (err) {
      this.problems.fail('discovered', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read Tvheadend, publish the server again. */
  async rediscover() {
    await this.poll();
    await this.afterChanges(true, { publish: true });
  }

  /**
   * The user added (or updated) the device: its states sent before were
   * dropped by Gladys (the SDK already forgot them), and it needs its badge.
   */
  async onDeviceCreated() {
    this.transports.clear();
    await this.publishStates();
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Gladys asks for a refresh (onPoll, only if it polls anyway). */
  async pollDevice() {
    await this.pollNow();
  }

  /** The states of the device, once added. The SDK skips the unchanged values. */
  async publishStates() {
    if (this.readAt === 0 || !this.isCreated(serverIds(this.gladys).device)) {
      return;
    }
    const states = serverValues(this.gladys, this.serverView(), (entry) =>
      this.describe(entry),
    ).map(({ key: _key, ...state }) => state);
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.problems.recover('states', 'States accepted again');
    } catch (err) {
      this.problems.fail('states', `States refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the device: local or cloud (from the address), or unreachable. */
  async publishTransports() {
    const externalId = serverIds(this.gladys).device;
    if (!this.client || this.readAt === 0 || !this.isCreated(externalId)) {
      return;
    }
    const transport = this.error
      ? DEVICE_TRANSPORTS.UNREACHABLE
      : isLocalAddress(this.config.url)
        ? DEVICE_TRANSPORTS.LOCAL
        : DEVICE_TRANSPORTS.CLOUD;
    if (this.transports.get(externalId) === transport) {
      return;
    }
    try {
      await this.gladys.publishTransports([{ external_id: externalId, transport }]);
      this.transports.set(externalId, transport);
      this.problems.recover('transports', 'Transports accepted again');
    } catch (err) {
      this.problems.fail('transports', `Transports refused: ${err.message}`);
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (this.config.url === '') {
      return { connected: false, message: CONNECTION_TEXT.noUrl };
    }
    if (!this.config.url) {
      return { connected: false, message: CONNECTION_TEXT.invalidUrl };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
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
      this.problems.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.problems.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  // --- Commands (scene actions, report) --------------------------------------

  /** Throws the reason Tvheadend cannot answer, if any. */
  assertReadable() {
    if (!this.config.url || this.error) {
      throw new Error(pick(this.connectionStatus().message, this.config.language));
    }
  }

  /** The server read just now (scene actions). */
  async freshView() {
    if (!this.client) {
      this.assertReadable();
    }
    await this.refreshIfStale();
    this.assertReadable();
    return this.serverView();
  }

  /**
   * One line about the server, in a language: what records, what comes next,
   * the free space.
   */
  sentence(view, language) {
    const text = REPORT_TEXT[language] ?? REPORT_TEXT.en;
    const parts = [
      view.recording.length > 0
        ? `${text.recording(view.recording.length)} (${view.recording
            .map((e) => e.title || e.channel)
            .join(', ')})`
        : text.nothing,
      view.scheduled[0] ? text.next(this.describe(view.scheduled[0], language)) : text.noNext,
    ];
    if (view.disk) {
      parts.push(
        text.free(
          formatNumber(view.disk.freeGb, language),
          formatNumber(view.disk.freePercent, language),
        ),
      );
    }
    return parts.join(', ');
  }

  /**
   * "Record now": a channel (name or number), for N minutes, from now.
   * @returns {Promise<object>} the recording scheduled
   */
  async recordNow({ channel, duration, title }) {
    const language = this.config.language;
    const wanted = String(channel ?? '').trim();
    if (!wanted) {
      throw new Error(pick(ACTION_TEXT.noChannel, language));
    }
    const minutes = Number(duration);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_RECORD_MINUTES) {
      throw new Error(pick(ACTION_TEXT.badDuration, language));
    }
    if (!this.client) {
      this.assertReadable();
    }
    let channels;
    try {
      channels = await this.client.channels();
    } catch (err) {
      if (err instanceof TvheadendError) {
        throw new Error(pick(ERROR_TEXT[err.kind], language), { cause: err });
      }
      throw err;
    }
    const found = findChannel(channels, wanted);
    if (!found) {
      throw new Error(pick(ACTION_TEXT.unknownChannel, language));
    }
    const start = this.now();
    const stop = start + minutes * MINUTE;
    const name = String(title ?? '').trim() || `${found.name} (Gladys)`;
    try {
      await this.client.createRecording({ channelId: found.id, start, stop, title: name });
    } catch (err) {
      if (err instanceof TvheadendError) {
        throw new Error(pick(ERROR_TEXT[err.kind], language), { cause: err });
      }
      throw err;
    }
    logger.info(`Recording scheduled from a scene: ${found.name}, ${minutes} min`);
    // The new recording, its states and its "started" event, now.
    await this.pollNow().catch((err) => logger.warn(`Read after recording: ${err.message}`));
    return {
      title: name,
      channel: found.name,
      start_time: formatClock(start, language),
      stop_time: formatClock(stop, language),
      duration_minutes: minutes,
    };
  }

  /** "Test the connection": read Tvheadend now, one line. */
  async testConnection() {
    await this.pollNow({ publish: true });
    const status = this.connectionStatus();
    const message = {};
    const view = this.serverView();
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (!status.connected) {
        message[language] = pick(status.message, language);
        continue;
      }
      const parts = [text.ok, `${this.server.name} ${this.server.version}`];
      parts.push(this.sentence(view, language));
      if (view.viewers === null) {
        parts.push(text.noAdmin);
      }
      message[language] = parts.join(' · ');
    }
    return message;
  }
}

/** A channel by its name (any case) or its number. */
export function findChannel(channels, wanted) {
  const name = wanted.toLocaleLowerCase();
  const exact = channels.find((channel) => channel.name.toLocaleLowerCase() === name);
  if (exact) {
    return exact;
  }
  if (/^\d+$/.test(wanted)) {
    return channels.find((channel) => channel.number === Number(wanted)) ?? null;
  }
  return null;
}
