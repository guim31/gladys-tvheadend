// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One Tvheadend server: its address, the account the integration uses (user
// name and password, Digest or Basic), how often it is read, and the language
// of the names and messages.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['15', '30', '60'];

// The port of Tvheadend's web interface and API.
export const DEFAULT_PORT = 9981;

export const DEFAULT_CONFIG = {
  url: '',
  username: '',
  password: '',
  poll_interval: '30',
  language: 'fr',
};

// A URL copied from the browser points at a page of Tvheadend (its web
// interface, an API call, a stream or a playlist): the API lives at the root
// (or under the --http_root path).
const INTERFACE_PATH =
  /\/((extjs|index|simple)\.html|(api|stream|play|playlist|xmltv|tv)(\/.*)?)$/i;

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10`, port 9981 then, or `192.0.2.10:9981`), or a URL copied from
 * the browser (`http://192.0.2.10:9981/extjs.html`). HTTP by default for a
 * bare host. A path is kept (the --http_root option, a reverse proxy
 * sub-path), the interface pages dropped.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/path]`, null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const typedScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  const withScheme = typedScheme ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs: they have their fields.
  if (url.username || url.password) {
    return null;
  }
  if (!typedScheme && !url.port) {
    url.port = String(DEFAULT_PORT);
  }
  const path = url.pathname.replace(INTERFACE_PATH, '').replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

/**
 * Whether the address points to the local network (private or link-local IP,
 * `localhost`, a `.local`, `.lan` or `.home.arpa` name, a bare name): the
 * device badge says "local", else "cloud".
 */
export function isLocalAddress(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (!hostname.includes('.') && !hostname.includes(':')) {
    return true; // a bare name: resolved on the local network
  }
  if (/\.(local|lan|home|internal|home\.arpa)$/.test(hostname) || hostname === 'localhost') {
    return true;
  }
  const v4 = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT, also Tailscale
      // The documentation ranges (RFC 5737) are not routed either.
      (a === 192 && b === 0 && Number(v4[3]) === 2) ||
      (a === 198 && b === 51 && Number(v4[3]) === 100) ||
      (a === 203 && b === 0 && Number(v4[3]) === 113)
    );
  }
  return /^(::1|f[cd][0-9a-f]{2}:|fe80:)/.test(hostname);
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const choice = (key, options) =>
    options.includes(String(source[key])) ? String(source[key]) : DEFAULT_CONFIG[key];
  const typed = text('url');
  return {
    // Empty: not configured yet; null: typed but not understood.
    url: typed ? parseServerUrl(typed) : '',
    username: text('username'),
    // Kept as typed: a password may begin or end with a space.
    password: typeof source.password === 'string' ? source.password : '',
    pollIntervalMs: Number(choice('poll_interval', POLL_INTERVALS)) * 1000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
