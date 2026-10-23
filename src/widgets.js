// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `recordings`.
//
// The use case: a glance at the wall tablet tells what the recorder is doing
// and what comes next, and whether the disk will hold. The heading names what
// records now (or says nothing does), the caption its channel and end (or the
// next recording, or the error); tiles for the scheduled recordings, the free
// space and, with an admin account, the viewers; one row per recording
// running, then the next ones.
//
// Budget (8 components, 2 texts, 1 status of 10 rows): 2 texts, 3 tiles, 1
// status list.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './hub.js';
import {
  CONNECTION_TEXT,
  ERROR_TEXT,
  formatClock,
  formatNumber,
  formatWhen,
  labelled,
  pick,
} from './texts.js';

export const TEXT = {
  pick: {
    en: 'Enter the address of your Tvheadend server in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre serveur Tvheadend dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines Tvheadend-Servers in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su servidor Tvheadend en la configuración de la integración.',
  },
  idle: {
    en: 'Nothing recording',
    fr: 'Aucun enregistrement',
    de: 'Keine Aufnahme',
    es: 'Nada grabando',
  },
  until: { en: 'until', fr: "jusqu'à", de: 'bis', es: 'hasta' },
  next: { en: 'Next', fr: 'Prochain', de: 'Nächste', es: 'Próxima' },
  noNext: {
    en: 'No recording scheduled',
    fr: 'Aucun enregistrement programmé',
    de: 'Keine Aufnahme geplant',
    es: 'Ninguna grabación programada',
  },
  scheduled: { en: 'Scheduled', fr: 'Programmés', de: 'Geplant', es: 'Programadas' },
  free: { en: 'Free space', fr: 'Espace libre', de: 'Frei', es: 'Espacio libre' },
  viewers: { en: 'Viewers', fr: 'Lectures', de: 'Zuschauer', es: 'Reproducciones' },
  gb: { en: 'GB', fr: 'Go', de: 'GB', es: 'GB' },
};

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: pick(text, language) }],
  };
}

/** "→ 21:30 · Channel" for a recording running, "Fri 20:30 · Channel" for one to come. */
function rowValue(entry, running, language, now) {
  const when = running
    ? `${pick(TEXT.until, language)} ${formatClock(entry.stop, language)}`
    : formatWhen(entry.start, language, now);
  return fit([when, entry.channel].filter(Boolean).join(' · '), 40);
}

async function get(hub, { language = 'en' } = {}) {
  if (!hub.client) {
    return message(hub.config.url === null ? CONNECTION_TEXT.invalidUrl : TEXT.pick, language);
  }
  if (hub.readAt === 0 || !hub.server) {
    return message(hub.error ? ERROR_TEXT[hub.error.kind] : TEXT.idle, language);
  }
  const view = hub.serverView();
  const now = hub.now();
  const running = view.recording[0];
  const next = view.scheduled[0];
  const components = [
    {
      type: 'text',
      variant: 'heading',
      text: fit(running ? running.title || running.channel : pick(TEXT.idle, language), 40),
    },
  ];
  const caption = hub.error
    ? pick(ERROR_TEXT[hub.error.kind], language)
    : running
      ? rowValue(running, true, language, now)
      : next
        ? labelled(pick(TEXT.next, language), hub.describe(next, language), language)
        : pick(TEXT.noNext, language);
  components.push({ type: 'text', variant: 'caption', text: fit(caption, 80) });

  components.push({
    type: 'value',
    value: view.scheduled.length,
    label: pick(TEXT.scheduled, language),
    icon: 'calendar',
    color: WIDGET_COLORS.PRIMARY,
  });
  if (view.disk) {
    components.push({
      type: 'value',
      value: formatNumber(view.disk.freeGb, language),
      unit: pick(TEXT.gb, language),
      label: pick(TEXT.free, language),
      icon: 'hard-drive',
      color: view.disk.freePercent < 10 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (view.viewers !== null) {
    components.push({
      type: 'value',
      value: view.viewers.length,
      label: pick(TEXT.viewers, language),
      icon: 'tv',
      color: WIDGET_COLORS.NEUTRAL,
    });
  }

  // Running first, then the next ones; the core shows ten rows at most.
  const rows = [
    ...view.recording.map((entry) => ({
      label: fit(entry.title || entry.channel || '?', 40),
      value: rowValue(entry, true, language, now),
      icon: 'video',
      color: WIDGET_COLORS.DANGER,
    })),
    ...view.scheduled.map((entry) => ({
      label: fit(entry.title || entry.channel || '?', 40),
      value: rowValue(entry, false, language, now),
      icon: 'clock',
      color: WIDGET_COLORS.NEUTRAL,
    })),
  ].slice(0, 8);
  if (rows.length > 0) {
    components.push({ type: 'status', items: rows });
  }
  // A recording starts or ends at a minute: refresh soon (the hub also nudges on change).
  return { ttl_seconds: 60, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get },
};
