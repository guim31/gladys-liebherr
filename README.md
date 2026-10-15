# Liebherr SmartDevice for Gladys Assistant

External integration for [Gladys Assistant](https://gladysassistant.com) that connects the
**Liebherr fridges, freezers and wine cabinets** of the SmartDevice app, through the official
[Liebherr SmartDevice HomeAPI](https://developer.liebherr.com/apis/smartdevice-homeapi/) (cloud).

> **Developed without the hardware: feedback welcome.** Written from the official API
> specification and the test data of the Home Assistant integration, without a Liebherr appliance
> or account. Please report what works and what does not in the
> [issues](https://github.com/guim31/gladys-liebherr/issues).

This project is **not affiliated with Liebherr**. Liebherr and SmartDevice are trademarks of their
owners.

Requires **Gladys 5.1.0** or later.

## What it does

- **One Gladys device per appliance**, its features grouped by zone (fridge, freezer, wine
  cabinet):
  - per zone: measured **temperature** and **setpoint** (within the range the appliance gives,
    out-of-range values refused), **SuperCool**, **SuperFrost**, **IceMaker**, **HydroBreeze**,
    **BioFresh-Plus**, and the **door** of the AutoDoor models (read only);
  - per appliance: **PartyMode**, **NightMode**, **presentation light**.
- **Alarms** worked out by the integration (the API reports none): a zone above its setpoint plus
  a margin for a delay, an AutoDoor left open, an appliance offline. Two scene triggers,
  `alarm_raised` and `alarm_cleared`, fired once per alarm, even across restarts.
- A **dashboard widget**: zone temperatures, alarms, modes, and SuperCool / SuperFrost / PartyMode
  buttons.
- A **Test the connection** button in the configuration screen.
- The transport badge of each device says **cloud** or **unreachable**.

User documentation, in four languages: [`docs/en.md`](docs/en.md), [`docs/fr.md`](docs/fr.md),
[`docs/de.md`](docs/de.md), [`docs/es.md`](docs/es.md) — Gladys shows it from the configuration
screen.

## Prerequisites

- The appliance is **connected** in the Liebherr SmartDevice app (SmartDeviceBox or built-in
  Wi-Fi).
- An **API key**: in the SmartDevice app, Settings → Become a beta tester (older versions: Beta
  features) → activate the HomeAPI → Generate new key. The key is shown only once.
- Gladys must reach `https://home-api.smartdevice.liebherr.com`.

## Installation

In Gladys: **Integrations → Install from GitHub**, then `https://github.com/guim31/gladys-liebherr`
(or install it from the store once listed). Open the integration, paste the API key, save, then
add the appliances from the **Discovery** tab.

## Limits

- Developed without the hardware or an account: only the test suite, the linter and the store
  validator ran. `scripts/probe.mjs` checks the real API in read-only mode.
- The HomeAPI is a **beta** service of Liebherr. Its rate limits are not published; the
  integration reads one call per appliance per interval (1 to 5 minutes, 2 by default) plus the
  appliance list every 5 minutes, pauses after a `429` (doubling up to 30 minutes) and waits 30
  minutes after a refused key.
- Not exposed by the API, so not offered: a door contact (except AutoDoor), a Holiday mode, a
  power-cut alarm from the appliance. "Offline" covers a power cut and a Wi-Fi loss alike.
- Opening or closing an AutoDoor from Gladys is not offered, on purpose.
- Polling only: the real-time SSE stream of the API (beta) is not used.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
node scripts/probe.mjs                         # real API, fake key: must be refused
LIEBHERR_API_KEY=... node scripts/probe.mjs    # real API, read only, nothing sensitive printed
```

```
index.js            SDK wiring only
src/app.js          handlers registered on the SDK client
src/hub.js          timer, publication, alarms, commands, connection status
src/devices.js      the Gladys device of an appliance, its features and states
src/alarms.js       the alarms worked out from the readings (pure)
src/widgets.js      the dashboard widget (pure content builder)
src/liebherr/       HomeAPI client and the reading of its answers
src/texts.js        every user-facing text, in en, fr, de, es
src/store.js        /data persistence (appliance cache, alarm state)
scripts/probe.mjs   read-only probe of the real API
test/               node --test, with the SDK's fake Gladys and a fake HomeAPI
```

Releases are made by the Release workflow (Actions → Release); see [`CLAUDE.md`](CLAUDE.md).

## Credits

- The **Home Assistant** [`liebherr` integration](https://github.com/home-assistant/core/tree/dev/homeassistant/components/liebherr)
  by [@mettolen](https://github.com/mettolen) (Apache-2.0): entity model, test data, documentation
  of the API key path.
- [**pyliebherrhomeapi**](https://github.com/mettolen/pyliebherrhomeapi) by @mettolen (MIT): the
  official OpenAPI specification it ships, the enums, the transient 401 it retries.
- Built from the official [Gladys integration template](https://github.com/GladysAssistant/integration-template-js)
  and SDK [`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

## License

[Apache-2.0](LICENSE).
