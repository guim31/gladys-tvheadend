# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-10-23

### Added

- The Tvheadend server (4.2 or later) as a Gladys device: reachable,
  recordings in progress, scheduled and failed in the last 24 hours, what
  records now and the next recording (title, channel, time), free space of the
  recording directory (GB and %), and with an admin account the viewers and
  the tuners in use.
- Scene triggers: a recording starts, finishes (with its stream errors) or
  fails (with Tvheadend's reason), someone starts watching a channel, the free
  space falls below 5 to 25 %. The recording triggers can be limited to a
  channel.
- Scene actions: record a channel now (by name or number, 1 to 720 minutes),
  and a summary of the recordings with a ready-made sentence.
- Dashboard widget: what records now, the next recordings, the free space and
  the viewers.
- HTTP Digest and Basic authentication, a "Test the connection" action, texts
  in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-tvheadend/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-tvheadend/releases/tag/v1.0.0
