// -----------------------------------------------------------------------------
// The Gladys device, proposed in the Discovery tab: the Tvheadend server.
//
//   online            input/binary                        1 Tvheadend answers
//   recording         counter-sensor/integer              recordings running now
//   scheduled         counter-sensor/integer              recordings scheduled (enabled)
//   failed            counter-sensor/integer              recordings failed in the last 24 h
//   current           text/text                           "Title (Channel)" running, "—" if none
//   next              text/text                           "Title · Channel · Fri 20:30", "—" if none
//   disk_free         data/size (gigabyte)                free space of the recording directory
//   disk_free_percent level-sensor/liquid-level-percent   the same, in percent
//   viewers           counter-sensor/integer              people watching (admin account)
//   tuners            counter-sensor/integer              tuners in use (admin account)
//
// One server per integration: its id does not depend on the address, so a
// new IP address (or a move behind a proxy) keeps the device, its history
// and its scenes. No per-tuner device: Tvheadend lists only the inputs in use
// (an idle tuner is absent), which cannot make a stable device.
//
// Published with should_poll: false: the integration reads Tvheadend on its
// own timer (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

export const DEVICE_TYPE = 'server';
export const SERVER_ID = 'tvheadend';
export const MODEL = 'Tvheadend';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  ONLINE: 'online',
  RECORDING: 'recording',
  SCHEDULED: 'scheduled',
  FAILED: 'failed',
  CURRENT: 'current',
  NEXT: 'next',
  DISK_FREE: 'disk_free',
  DISK_FREE_PERCENT: 'disk_free_percent',
  VIEWERS: 'viewers',
  TUNERS: 'tuners',
});

// A text state is never empty, or Gladys ignores it.
export const NONE = '—';

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.ONLINE]: 'Reachable',
    [FEATURE_KEYS.RECORDING]: 'Recordings in progress',
    [FEATURE_KEYS.SCHEDULED]: 'Scheduled recordings',
    [FEATURE_KEYS.FAILED]: 'Failed recordings (24 h)',
    [FEATURE_KEYS.CURRENT]: 'Now recording',
    [FEATURE_KEYS.NEXT]: 'Next recording',
    [FEATURE_KEYS.DISK_FREE]: 'Free space',
    [FEATURE_KEYS.DISK_FREE_PERCENT]: 'Free space (%)',
    [FEATURE_KEYS.VIEWERS]: 'Viewers',
    [FEATURE_KEYS.TUNERS]: 'Tuners in use',
  },
  fr: {
    [FEATURE_KEYS.ONLINE]: 'Joignable',
    [FEATURE_KEYS.RECORDING]: 'Enregistrements en cours',
    [FEATURE_KEYS.SCHEDULED]: 'Enregistrements programmés',
    [FEATURE_KEYS.FAILED]: 'Enregistrements en échec (24 h)',
    [FEATURE_KEYS.CURRENT]: 'En cours d’enregistrement',
    [FEATURE_KEYS.NEXT]: 'Prochain enregistrement',
    [FEATURE_KEYS.DISK_FREE]: 'Espace libre',
    [FEATURE_KEYS.DISK_FREE_PERCENT]: 'Espace libre (%)',
    [FEATURE_KEYS.VIEWERS]: 'Lectures en cours',
    [FEATURE_KEYS.TUNERS]: 'Tuners utilisés',
  },
  de: {
    [FEATURE_KEYS.ONLINE]: 'Erreichbar',
    [FEATURE_KEYS.RECORDING]: 'Laufende Aufnahmen',
    [FEATURE_KEYS.SCHEDULED]: 'Geplante Aufnahmen',
    [FEATURE_KEYS.FAILED]: 'Fehlgeschlagene Aufnahmen (24 h)',
    [FEATURE_KEYS.CURRENT]: 'Wird aufgenommen',
    [FEATURE_KEYS.NEXT]: 'Nächste Aufnahme',
    [FEATURE_KEYS.DISK_FREE]: 'Freier Speicher',
    [FEATURE_KEYS.DISK_FREE_PERCENT]: 'Freier Speicher (%)',
    [FEATURE_KEYS.VIEWERS]: 'Zuschauer',
    [FEATURE_KEYS.TUNERS]: 'Belegte Tuner',
  },
  es: {
    [FEATURE_KEYS.ONLINE]: 'Accesible',
    [FEATURE_KEYS.RECORDING]: 'Grabaciones en curso',
    [FEATURE_KEYS.SCHEDULED]: 'Grabaciones programadas',
    [FEATURE_KEYS.FAILED]: 'Grabaciones fallidas (24 h)',
    [FEATURE_KEYS.CURRENT]: 'Grabando ahora',
    [FEATURE_KEYS.NEXT]: 'Próxima grabación',
    [FEATURE_KEYS.DISK_FREE]: 'Espacio libre',
    [FEATURE_KEYS.DISK_FREE_PERCENT]: 'Espacio libre (%)',
    [FEATURE_KEYS.VIEWERS]: 'Reproducciones en curso',
    [FEATURE_KEYS.TUNERS]: 'Sintonizadores en uso',
  },
};

// Display bounds (the core never applies them on write).
export const MAX_COUNT = 10_000;
export const MAX_GIGABYTES = 1_000_000;

export const serverIds = (gladys) => gladys.externalIds(DEVICE_TYPE, SERVER_ID);

const sensor = (name, externalId, category, type, extra) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  has_feedback: false,
  ...extra,
});

const counter = (name, externalId, keepHistory = true) =>
  sensor(
    name,
    externalId,
    DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    { keep_history: keepHistory, min: 0, max: MAX_COUNT },
  );

const text = (name, externalId) =>
  sensor(name, externalId, DEVICE_FEATURE_CATEGORIES.TEXT, DEVICE_FEATURE_TYPES.TEXT.TEXT, {
    keep_history: false,
    // NOT NULL in the core, even for a text: 422 on "Add to Gladys" without them.
    min: 0,
    max: 0,
  });

/**
 * The discovery payload of the server.
 * @param {object} gladys
 * @param {{ name?: string, version?: string }} server
 * @param {string} [language]
 */
export function buildServerDevice(gladys, server = {}, language = 'en') {
  const ids = serverIds(gladys);
  const names = NAMES[language] ?? NAMES.en;
  const id = (key) => ids.feature(key);
  return {
    name: server.name && server.name !== MODEL ? `${MODEL} (${server.name})` : MODEL,
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params: server.version ? [{ name: 'VERSION', value: server.version.slice(0, 255) }] : [],
    features: [
      sensor(
        names[FEATURE_KEYS.ONLINE],
        id(FEATURE_KEYS.ONLINE),
        DEVICE_FEATURE_CATEGORIES.INPUT,
        DEVICE_FEATURE_TYPES.SENSOR.BINARY,
        { keep_history: true, min: 0, max: 1 },
      ),
      counter(names[FEATURE_KEYS.RECORDING], id(FEATURE_KEYS.RECORDING)),
      counter(names[FEATURE_KEYS.SCHEDULED], id(FEATURE_KEYS.SCHEDULED)),
      counter(names[FEATURE_KEYS.FAILED], id(FEATURE_KEYS.FAILED)),
      text(names[FEATURE_KEYS.CURRENT], id(FEATURE_KEYS.CURRENT)),
      text(names[FEATURE_KEYS.NEXT], id(FEATURE_KEYS.NEXT)),
      sensor(
        names[FEATURE_KEYS.DISK_FREE],
        id(FEATURE_KEYS.DISK_FREE),
        DEVICE_FEATURE_CATEGORIES.DATA,
        DEVICE_FEATURE_TYPES.DATA.SIZE,
        { keep_history: true, unit: 'gigabyte', min: 0, max: MAX_GIGABYTES },
      ),
      sensor(
        names[FEATURE_KEYS.DISK_FREE_PERCENT],
        id(FEATURE_KEYS.DISK_FREE_PERCENT),
        DEVICE_FEATURE_CATEGORIES.LEVEL_SENSOR,
        DEVICE_FEATURE_TYPES.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
        { keep_history: true, unit: 'percent', min: 0, max: 100 },
      ),
      counter(names[FEATURE_KEYS.VIEWERS], id(FEATURE_KEYS.VIEWERS)),
      counter(names[FEATURE_KEYS.TUNERS], id(FEATURE_KEYS.TUNERS)),
    ],
  };
}

/**
 * The value of every known feature of the server:
 * `{ key, device_feature_external_id, state | text }`.
 * @param {object} gladys
 * @param {object} view the server as the hub sees it (src/hub.js `serverView()`)
 * @param {(entry: object) => string} describeNext "Title · Channel · Fri 20:30"
 */
export function serverValues(gladys, view, describeNext) {
  const ids = serverIds(gladys);
  const values = [{ key: FEATURE_KEYS.ONLINE, state: view.online ? 1 : 0 }];
  if (view.online) {
    const cap = (value) => Math.min(value, MAX_COUNT);
    values.push(
      { key: FEATURE_KEYS.RECORDING, state: cap(view.recording.length) },
      { key: FEATURE_KEYS.SCHEDULED, state: cap(view.scheduled.length) },
      { key: FEATURE_KEYS.FAILED, state: cap(view.failedToday) },
      {
        key: FEATURE_KEYS.CURRENT,
        text:
          view.recording.map((e) => `${e.title || '?'} (${e.channel || '?'})`).join(', ') || NONE,
      },
      { key: FEATURE_KEYS.NEXT, text: view.scheduled[0] ? describeNext(view.scheduled[0]) : NONE },
    );
    if (view.disk) {
      values.push(
        { key: FEATURE_KEYS.DISK_FREE, state: Math.min(view.disk.freeGb, MAX_GIGABYTES) },
        { key: FEATURE_KEYS.DISK_FREE_PERCENT, state: view.disk.freePercent },
      );
    }
    // An account without the admin right cannot see them: no value, not a false 0.
    if (view.viewers !== null) {
      values.push({ key: FEATURE_KEYS.VIEWERS, state: cap(view.viewers.length) });
    }
    if (view.tuners !== null) {
      values.push({ key: FEATURE_KEYS.TUNERS, state: cap(view.tuners) });
    }
  }
  return values.map(({ key, ...value }) => ({
    key,
    device_feature_external_id: ids.feature(key),
    ...value,
  }));
}
