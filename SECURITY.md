# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration stores and sends:

- `/data/tvheadend-state.json` holds what the integration saw of each recent
  recording (its id and its phase: scheduled, recording, finished, failed)
  and the free-space thresholds already announced. No secret is written there.
- The Tvheadend user name and password are kept by Gladys in the integration
  configuration. They travel only to the Tvheadend address configured, with
  HTTP Digest (the password itself never travels) or, when Tvheadend only
  offers it, HTTP Basic: prefer an https:// address then. They are never
  logged. Redirects are not followed.
- An account with only the **Web interface** and **Video recorder** rights is
  enough; the **Admin** right only adds the viewers and the tuners.
- The only write is the "Record a channel now" scene action, which schedules a
  recording. The integration never deletes nor changes one.
- The container only talks to that Tvheadend server and to Gladys.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the third-party services and devices the integration talks to.
