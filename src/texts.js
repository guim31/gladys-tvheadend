// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, scene outputs
// and errors, and the dates. Four languages, the four of the Gladys
// interface; German says "du", Spanish "usted". test/i18n.test.js checks
// every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './tvheadend/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of your Tvheadend server in the configuration.',
    fr: "Saisissez l'adresse de votre serveur Tvheadend dans la configuration.",
    de: 'Gib die Adresse deines Tvheadend-Servers in der Konfiguration ein.',
    es: 'Introduzca la dirección de su servidor Tvheadend en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.2:9981',
    fr: 'Adresse incomprise, ex. http://192.168.1.2:9981',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.2:9981',
    es: 'Dirección no válida, p. ej. http://192.168.1.2:9981',
  },
};

// One short explanation per error kind (src/tvheadend/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'Tvheadend does not answer',
    fr: 'Tvheadend ne répond pas',
    de: 'Tvheadend antwortet nicht',
    es: 'Tvheadend no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: use an http:// address or a trusted certificate',
    fr: 'certificat refusé : utilisez une adresse http:// ou un certificat reconnu',
    de: 'Zertifikat abgelehnt: Nutze eine http://-Adresse oder ein vertrauenswürdiges Zertifikat',
    es: 'certificado rechazado: use una dirección http:// o un certificado reconocido',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'user name or password refused (or no web interface right)',
    fr: "identifiant ou mot de passe refusé (ou pas de droit d'interface web)",
    de: 'Benutzername oder Passwort abgelehnt (oder kein Recht auf die Weboberfläche)',
    es: 'usuario o contraseña rechazados (o sin derecho a la interfaz web)',
  },
  [ERROR_KINDS.RIGHTS]: {
    en: 'the account has no video recorder right',
    fr: "le compte n'a pas le droit d'enregistrement",
    de: 'das Konto hat kein Aufnahmerecht',
    es: 'la cuenta no tiene derecho de grabación',
  },
  [ERROR_KINDS.NOT_TVHEADEND]: {
    en: 'no Tvheadend at this address',
    fr: 'aucun Tvheadend à cette adresse',
    de: 'kein Tvheadend unter dieser Adresse',
    es: 'no hay ningún Tvheadend en esta dirección',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The "Test the connection" report, and the `sentence` output of "Recordings".
export const REPORT_TEXT = {
  en: {
    ok: 'Connected',
    noAdmin: 'viewers and tuners need an admin account',
    recording: (count) => `${count} recording(s) in progress`,
    scheduled: (count) => `${count} scheduled`,
    nothing: 'Nothing is being recorded',
    next: (text) => `next: ${text}`,
    noNext: 'no recording scheduled',
    free: (gb, percent) => `${gb} GB free (${percent} %)`,
  },
  fr: {
    ok: 'Connecté',
    noAdmin: 'lectures et tuners demandent un compte administrateur',
    recording: (count) => `${count} enregistrement(s) en cours`,
    scheduled: (count) => `${count} programmé(s)`,
    nothing: "Rien n'est en cours d'enregistrement",
    next: (text) => `prochain : ${text}`,
    noNext: 'aucun enregistrement programmé',
    free: (gb, percent) => `${gb} Go libres (${percent} %)`,
  },
  de: {
    ok: 'Verbunden',
    noAdmin: 'Zuschauer und Tuner brauchen ein Administratorkonto',
    recording: (count) => `${count} laufende Aufnahme(n)`,
    scheduled: (count) => `${count} geplant`,
    nothing: 'Es wird gerade nichts aufgenommen',
    next: (text) => `nächste: ${text}`,
    noNext: 'keine Aufnahme geplant',
    free: (gb, percent) => `${gb} GB frei (${percent} %)`,
  },
  es: {
    ok: 'Conectado',
    noAdmin: 'reproducciones y sintonizadores requieren una cuenta de administrador',
    recording: (count) => `${count} grabación(es) en curso`,
    scheduled: (count) => `${count} programada(s)`,
    nothing: 'No se está grabando nada',
    next: (text) => `próxima: ${text}`,
    noNext: 'ninguna grabación programada',
    free: (gb, percent) => `${gb} GB libres (${percent} %)`,
  },
};

// Errors of the scene actions.
export const ACTION_TEXT = {
  noChannel: {
    en: 'Enter the name or the number of a channel.',
    fr: "Saisissez le nom ou le numéro d'une chaîne.",
    de: 'Gib den Namen oder die Nummer eines Senders ein.',
    es: 'Introduzca el nombre o el número de un canal.',
  },
  unknownChannel: {
    en: 'Channel unknown to Tvheadend: check its name or number.',
    fr: 'Chaîne inconnue de Tvheadend : vérifiez son nom ou son numéro.',
    de: 'Sender ist Tvheadend unbekannt: Prüfe seinen Namen oder seine Nummer.',
    es: 'Canal desconocido para Tvheadend: compruebe su nombre o su número.',
  },
  badDuration: {
    en: 'The duration must be a whole number of minutes, from 1 to 720.',
    fr: 'La durée doit être un nombre entier de minutes, de 1 à 720.',
    de: 'Die Dauer muss eine ganze Zahl von Minuten sein, von 1 bis 720.',
    es: 'La duración debe ser un número entero de minutos, de 1 a 720.',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

// 24-hour clocks everywhere (en-GB rather than en-US).
const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

/** The local day of a time (the supervisor sets TZ to the time zone of Gladys). */
const dayKey = (time) => new Date(time).toDateString();

/**
 * A time as people say it: "20:30" today, "Fri 20:30" within the week,
 * "Fri 31/10 20:30" further.
 */
export function formatWhen(time, language, now = Date.now()) {
  const locale = LOCALES[language] ?? LOCALES.en;
  const clock = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(
    time,
  );
  if (dayKey(time) === dayKey(now)) {
    return clock;
  }
  const options =
    Math.abs(time - now) < 6 * 24 * 3600_000
      ? { weekday: 'short' }
      : { weekday: 'short', day: '2-digit', month: '2-digit' };
  return `${new Intl.DateTimeFormat(locale, options).format(time)} ${clock}`;
}

/** The clock alone: "20:30". */
export const formatClock = (time, language) =>
  new Intl.DateTimeFormat(LOCALES[language] ?? LOCALES.en, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(time);

/** A number with one decimal at most, with the decimal separator of the language. */
export const formatNumber = (gb, language) =>
  new Intl.NumberFormat(LOCALES[language] ?? LOCALES.en, { maximumFractionDigits: 1 }).format(gb);
