# Tvheadend

[Tvheadend](https://tvheadend.org) is the free TV server and recorder of many
homes: it reads DVB tuners (DTT, satellite, cable) and IPTV lists, streams the
channels to Kodi, a browser or a TV app, and records programmes. This
integration brings your recorder into Gladys: what records now, what comes
next, the failed recordings, the free space, who watches what, and scenes that
react to a recording that starts, finishes or fails, to someone who starts
watching, or to a disk that fills up.

Looking for the TV guide? See the
[Programme Télé integration](https://github.com/prohand/gladys-programmetele):
this one does not repeat it.

Tested against a real Tvheadend 4.3 in Docker (image
`lscr.io/linuxserver/tvheadend`), with an IPTV network reading a test stream
served by ffmpeg: recordings scheduled, running, completed, failed, a stream
cut, a viewer, an admin account and a recorder-only one. Developed without a
DVB tuner: feedback welcome on
[the issues](https://github.com/guim31/gladys-tvheadend/issues).

## What you need

- Gladys Assistant 5.1.0 or later.
- Tvheadend 4.2 or later, reachable from Gladys (port 9981 by default).
- A Tvheadend user with a password, and an access entry with the **Web
  interface** and **Video recorder** rights (basic, all DVR, failed DVR). With
  the **Admin** right, the integration also shows the viewers and the tuners in
  use.

## Getting started

### 1. Create a user for Gladys

In Tvheadend, **Configuration → Users**:

- **Access entries → Add**: user name `gladys`, rights **Web interface** and
  **Video recorder** (tick "All DVR" and "Failed DVR" too), and **Admin** if you
  want the viewers and the tuners.
- **Passwords → Add**: the same user name and a password.

### 2. Configure the integration

In Gladys, open the integration and fill in:

- **Tvheadend address**: `http://192.168.1.2:9981` (an address without port
  gets 9981; a URL copied from the browser works too).
- **User name** and **Password**: the user created above. Digest and Basic
  authentication both work.
- **Refresh interval**: 30 seconds by default.
- **Language of the names**: the language of the feature names, of the dates
  and of the scene results.

Then use **Test the connection**: it reads Tvheadend and sums up what records,
what comes next and the free space.

### 3. Add the device

Open the **Discover** tab: the server is a device, named `Tvheadend`. Add it.

## The devices

| Feature                  | What it says                                                |
| ------------------------ | ----------------------------------------------------------- |
| Reachable                | Yes while Tvheadend answers                                 |
| Recordings in progress   | Recordings running now                                      |
| Scheduled recordings     | Recordings to come (enabled)                                |
| Failed recordings (24 h) | Recordings ended in error in the last 24 hours              |
| Now recording            | "Title (Channel)" of what records ("—" when nothing)        |
| Next recording           | "Title · Channel · Fri 20:30" ("—" when nothing is planned) |
| Free space               | Free space of the recording directory, in GB                |
| Free space (%)           | The same, in percent                                        |
| Viewers                  | People watching a channel (Kodi, browser…), admin account   |
| Tuners in use            | Tuners (inputs) busy, admin account                         |

There is no device per tuner: Tvheadend lists only the tuners in use.

## Dashboard

The **Tvheadend recordings** widget shows what records now (title, channel and
end), or the next recording; tiles for the scheduled recordings, the free space
and (admin account) the viewers; then one row per recording running and per
recording to come.

## Scenes

### Triggers

The recording triggers can be limited to one channel: type its name as
Tvheadend shows it (empty: any channel).

- **A recording starts**: Tvheadend starts recording, with the title, the
  channel, the end time and the planned duration.
- **A recording finishes**: a recording ended and its file is on the disk, with
  the title, the channel, the duration and the number of stream errors.
- **A recording fails**: a recording ended in error (no signal, no tuner free,
  file not created, time missed…), with Tvheadend's reason, in English.
- **Someone starts watching**: a client starts watching a channel, with the
  channel, the Tvheadend user and the client. Can be limited to a channel or a
  user. Needs an admin account.
- **Free space falls below a threshold**: choose 5, 10, 15, 20 or 25 %; fires
  once, and again only after the free space went back above it.

The integration keeps what it saw: a restart of Gladys does not announce a
recording twice, and a recording that ended meanwhile is announced once.

### Actions

- **Record a channel now**: records a channel (its name or number, as Tvheadend
  shows it) from now, for 1 to 720 minutes, with an optional title. Gives the
  title, the channel, the start and end times.
- **Recordings summary**: reads Tvheadend for the next actions: recordings in
  progress and scheduled, what records, the next recording (title, channel,
  time), the free space, and a ready-made sentence ("1 recording(s) in progress
  (News), next: Film · TF1 · Fri 20:30, 120 GB free (24 %)").

### Scene ideas

- **Failed recording alert**: "A recording fails" sends you a message with the
  title and the reason, so you can record it again.
- **Nobody home at 20:55**: when the alarm is on, "Record a channel now" records
  the news for 40 minutes.
- **Disk almost full**: "Free space falls below a threshold" (10 %) sends a
  notification; a morning scene says the sentence of "Recordings summary".
- **Cinema mode**: "Someone starts watching" on the living room account dims
  the lights.

## Troubleshooting

- **Tvheadend does not answer**: check the address and the port 9981 from the
  machine running Gladys.
- **User name or password refused (or no web interface right)**: Tvheadend
  answers the same to a wrong password and to an account without the **Web
  interface** right; check both.
- **The account has no video recorder right**: tick **Video recorder** in the
  access entry of the user.
- **No viewers nor tuners**: the account is not an administrator (the test of
  the connection says so); the rest works.
- **A recording cut in the middle "finishes"**: Tvheadend itself reports a
  stream lost during a recording as "Completed OK"; only a stream absent at the
  start fails.

## Limits

- One Tvheadend server per integration.
- Tvheadend is read at the interval chosen (30 seconds by default), not in real
  time: a viewer shorter than the interval may be missed.
- The failure reason is Tvheadend's, in English.
- No per-tuner device, no signal or SNR: Tvheadend lists only the tuners in use.
- The scene action schedules a recording; it neither cancels nor deletes one.
- Not affiliated with the Tvheadend project.
