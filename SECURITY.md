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

What the integration handles:

- **The Liebherr API key**, typed in the Gladys configuration (a secret field). It is sent only
  to `https://home-api.smartdevice.liebherr.com`, in the `api-key` header. It is never written to
  `/data` nor in the logs, at any level (`test/logs.test.js`).
- **`/data/liebherr-state.json`**: the appliances last read (serial number, nickname, model,
  controls) and the state of the alarms, so an offline appliance stays in Gladys and an alarm is
  not announced twice. No credential.
- **Network**: HTTPS to the Liebherr cloud only. Nothing listens in the container.
- **Commands**: setpoints, modes and the light, within the range the appliance gives. Opening the
  door of an AutoDoor appliance is not offered.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Liebherr SmartDevice app, cloud and appliances.
