# Liebherr SmartDevice

Connects the Liebherr fridges, freezers and wine cabinets of the SmartDevice app to Gladys, through
the official Liebherr cloud API (SmartDevice HomeAPI).

> **Developed without the hardware: feedback welcome.** This integration was written from the
> official API documentation and the test data of the Home Assistant integration, without a
> Liebherr appliance. Tell us what works and what does not on
> [GitHub](https://github.com/guim31/gladys-liebherr/issues) or on the Gladys forum.

This integration is not affiliated with Liebherr. Liebherr and SmartDevice are trademarks of their
owners.

## Overview

- One Gladys device per appliance, its features grouped by zone (fridge, freezer, wine cabinet).
- For each zone: the measured **temperature** and the **setpoint**, which you can change within the
  range the appliance accepts.
- The functions your appliance offers: SuperCool, SuperFrost, PartyMode, NightMode, IceMaker,
  HydroBreeze, BioFresh-Plus, the presentation light, and the door of the AutoDoor models (read
  only).
- **Alarms** worked out by the integration: a zone too warm for too long, an AutoDoor left open,
  an appliance offline. They start your scenes.
- A **dashboard widget**: the temperature of each zone, the alarms, and the SuperCool, SuperFrost
  and PartyMode buttons.

## Prerequisites

- Gladys 5.1 or later, with Internet access: the appliances are read through the Liebherr cloud.
- A Liebherr appliance with a SmartDevice box or built-in Wi-Fi, **connected** in the SmartDevice
  app. An appliance that is only registered, but not connected, is not visible to the API.
- An **API key** of the HomeAPI, generated in the SmartDevice app:
  1. open the SmartDevice app, then **Settings**;
  2. open **Become a beta tester** (in older versions: **Beta features**) and activate the
     **HomeAPI**;
  3. tap **Generate new key** and copy the key at once: it is shown only once. A new key replaces
     the previous one.

The names of the menus depend on the version and the language of the app.

## Configuration

In Gladys, go to **Integrations**, open **Liebherr SmartDevice**, then fill in:

- **API key**: the key copied from the SmartDevice app.
- **Refresh interval**: 1, 2 (default), 3 or 5 minutes. Liebherr does not publish its limits, but
  says it restricts the number of calls, and has blocked clients that called too often. With
  several appliances, stay at 2 minutes or more.
- **Temperature alarm margin**: how far above its setpoint a zone may stay (3 °C by default).
- **Alarm delay**: how long the temperature, or the appliance offline, must last before the
  alarm (30 minutes by default).
- **Door alarm delay (AutoDoor)**: how long an AutoDoor may stay open (5 minutes by default).
- **Language of the feature names**: the names given to the features when you add the devices
  (French by default).

Save, then open the **Discovery** tab of the integration and add your appliances. The
**Test the connection** button reads the appliances now and shows their temperatures.

What it costs the Liebherr API: one call per appliance at each interval, plus the list of
appliances every 5 minutes. A refused key is tried again after 30 minutes (or as soon as you save
a new one). An answer "too many requests" pauses the readings, longer each time, up to 30
minutes.

## Devices and features

The device takes the name of the appliance in the SmartDevice app (else its model). Only the
features your appliance offers are created.

### Each zone

| Feature       | In Gladys                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| Temperature   | The measured temperature (°C or °F, as set on the appliance).                                                       |
| Setpoint      | The target temperature, within the range of the appliance. A value outside it is refused, never brought into range. |
| SuperCool     | On/off: cools the fridge quickly, then switches off by itself.                                                      |
| SuperFrost    | On/off: freezes quickly, then switches off by itself.                                                               |
| IceMaker      | Off, On, MaxIce (when the appliance has it).                                                                        |
| HydroBreeze   | Off, Low, Medium, High.                                                                                             |
| BioFresh-Plus | The temperatures of the two drawers, among those the appliance offers (e.g. 0 °C / −2 °C).                          |
| Door          | AutoDoor models only: open or closed. Read only: Gladys never opens the door.                                       |

A zone is named after its kind: Fridge, Freezer or Wine cabinet, with its position (top, middle,
bottom) when the appliance has two zones of the same kind. The kind is worked out from the
appliance type and the setting range: the API does not give it.

### Each appliance

| Feature            | In Gladys                                                           |
| ------------------ | ------------------------------------------------------------------- |
| PartyMode          | On/off.                                                             |
| NightMode          | On/off.                                                             |
| Presentation light | Brightness, from 0 (off) to the maximum of the appliance (often 5). |

The badge of the device says **cloud** while the appliance answers, **unreachable** when it is
offline or when the Liebherr service does not answer.

## Alarms (scene triggers)

The Liebherr API reports no alarm: the integration works them out from the readings and fires
two scene triggers.

- **Liebherr alarm**: a problem lasted for the configured delay.
  - **Temperature too high**: a zone stayed above its setpoint plus the margin. When you lower a
    setpoint, the previous one stays the reference until the zone has cooled down: no false
    alarm.
  - **Door open too long (AutoDoor)**: only the AutoDoor models report their door.
  - **Appliance offline**: a power cut and a Wi-Fi loss look the same from the cloud. When the
    Liebherr service itself does not answer, nothing is known and no alarm moves.
- **Liebherr alarm over**: the zone cooled down, the door closed, the appliance is back.

Each alarm is fired once, and once when it is over, even if Gladys restarts in between. Both
triggers can be limited to one appliance and to some alarms. Their variables:
`{{triggerEvent.data.appliance}}`, `zone`, `kind` (temperature, door, offline), `temperature`,
`target`, `unit` and `minutes` (since the problem began).

## Widget

The **Liebherr** widget shows every appliance, or the one chosen in its settings:

- a tile per zone with its temperature, red during an alarm;
- the alarms in progress (or "No alarm"), the appliances offline, the modes switched on;
- with a single appliance: the **SuperCool**, **SuperFrost** and **PartyMode** buttons. A check
  mark tells a mode that is on; a tap switches it to the opposite.

## Configuration actions

- **Test the connection**: reads the appliances now and shows, for each one, the temperature and
  the setpoint of its zones, or that it is offline.

## Scene examples

- **Freezer alarm**: trigger **Liebherr alarm**, alarm **Temperature too high**; action: send a
  message "{{triggerEvent.data.appliance}} — {{triggerEvent.data.zone}}:
  {{triggerEvent.data.temperature}} {{triggerEvent.data.unit}} for
  {{triggerEvent.data.minutes}} min".
- **Power cut**: trigger **Liebherr alarm**, alarm **Appliance offline**; action: a notification,
  and another one on **Liebherr alarm over**.
- **Groceries**: on the "Back from shopping" scene, switch on the **SuperFrost** feature of the
  freezer; it switches off by itself.
- **Quiet nights**: every evening at 22:00, switch on **NightMode**; at 7:00, switch it off.

## Troubleshooting

- **"API key refused"**: the key was mistyped, or replaced by a new one. Generate a new key in the
  SmartDevice app and paste it in the configuration.
- **"Key accepted, but no connected appliance"**: the appliance is registered but not connected.
  Check its Wi-Fi in the SmartDevice app.
- **"Too many requests to Liebherr"**: lengthen the refresh interval. The integration pauses on
  its own and starts again.
- **An appliance stays "unreachable"**: check that it is connected in the SmartDevice app. It
  stays in Gladys with its last values.
- **A setpoint is refused**: the appliance only accepts its own range (shown in the message), and
  some models only some values (the + and − buttons follow them).
- More details in the logs of the integration, with `LOG_LEVEL=debug`. The API key is never
  written in the logs.

## Limits

- Developed without the hardware: the zone names, the AutoDoor and the Fahrenheit appliances are
  untested on a real appliance.
- The HomeAPI is a beta service of Liebherr: it may change or stop.
- No door contact except on the AutoDoor models, no Holiday mode, no power cut alarm from the
  appliance itself: the API does not expose them.
- The AutoDoor cannot be opened from Gladys, on purpose.
- The values are read every 1 to 5 minutes: a short change between two readings is not seen.
  Liebherr also offers a real-time stream (beta), not used here.
- Temperatures are whole degrees, as the API gives them.
- The names of the features are set when the device is added: changing the language later only
  renames new devices.
