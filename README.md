# Tvheadend for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that brings your [Tvheadend](https://tvheadend.org) TV server and recorder
into Gladys:

- **one device for the server**: reachable, recordings in progress, scheduled
  and failed (24 h), what records now and the next recording (in text), free
  space of the recording directory (GB and %), and with an admin account the
  viewers and the tuners in use;
- **scene triggers**: a recording starts, finishes or fails, someone starts
  watching a channel, the free space falls below a threshold;
- **scene actions**: record a channel now for N minutes, and a summary of the
  recordings with a ready-made sentence;
- **a dashboard widget**: what records now and the next recordings, with the
  free space.

For the TV guide, see
[gladys-programmetele](https://github.com/prohand/gladys-programmetele): this
integration does not repeat it.

Tested against a real Tvheadend 4.3 in Docker (IPTV test streams served by
ffmpeg). **Developed without a DVB tuner: feedback welcome** in the
[issues](https://github.com/guim31/gladys-tvheadend/issues).

## Requirements

- Gladys Assistant 5.1.0 or later.
- Tvheadend 4.2 or later reachable from Gladys (port 9981 by default).
- A Tvheadend user with a password and the **Web interface** and **Video
  recorder** rights; the **Admin** right adds the viewers and the tuners.

## Installation

In Gladys, open **Integrations → Install from GitHub** and enter
`https://github.com/guim31/gladys-tvheadend`. Then open its configuration,
enter the address of Tvheadend (`http://192.168.1.2:9981`), the user name and
the password, and add the server from the Discover tab.

The full guide: [docs/en.md](docs/en.md) (also in [French](docs/fr.md),
[German](docs/de.md) and [Spanish](docs/es.md)).

## How it works

The integration reads Tvheadend's HTTP API every 30 seconds (15 s to 1 min,
configurable), with HTTP Digest (or Basic) authentication: the scheduled and
running recordings (`/api/dvr/entry/grid_upcoming`), the ones ended lately
(`/api/dvr/entry/grid`, newest first), the disk space (first message of
`/comet/poll`), and with an admin account the subscriptions and the inputs
(`/api/status/…`). It remembers in `/data` what each recording was, so that a
restart neither repeats nor misses a trigger. The scene action creates a
recording with `/api/dvr/entry/create`.

## Limits

- One Tvheadend server per integration.
- Read at an interval, not in real time.
- No device per tuner, no signal or SNR: Tvheadend lists only the tuners in use.
- A stream lost in the middle of a recording is reported by Tvheadend itself as
  "Completed OK": only a stream absent at the start counts as a failure.
- The action schedules recordings; it never cancels nor deletes one.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

See [CLAUDE.md](CLAUDE.md) for the project rules and the notes on the
Tvheadend API.

## Credits

- [Tvheadend](https://github.com/tvheadend/tvheadend) by its contributors
  (GPL-3.0): the answers in `test/fixtures/tvheadend` come from Tvheadend 4.3
  in Docker (`lscr.io/linuxserver/tvheadend` image, by
  [LinuxServer.io](https://www.linuxserver.io)).
- The Tvheadend logo on the cover: from the Tvheadend repository
  ([`src/webui/static/img/logobig.png`](https://github.com/tvheadend/tvheadend/blob/master/src/webui/static/img/logobig.png)).
- HTTP Digest code from
  [gladys-fritzbox](https://github.com/guim31/gladys-fritzbox); built from the
  official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js)
  and on the architecture of
  [gladys-icecast](https://github.com/guim31/gladys-icecast).

Not affiliated with the Tvheadend project.

## License

Apache-2.0, see [LICENSE](LICENSE).
