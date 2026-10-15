# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Liebherr SmartDevice fridges, freezers and wine cabinets in Gladys, through the official
  Liebherr HomeAPI (cloud) and an API key of the SmartDevice app.
- One device per appliance: for each zone, the temperature and the setpoint (within the range of
  the appliance), SuperCool, SuperFrost, IceMaker, HydroBreeze, BioFresh-Plus and the AutoDoor
  state (read only); for the appliance, PartyMode, NightMode and the presentation light.
- Alarms worked out from the readings: a zone too warm for too long, an AutoDoor left open, an
  appliance offline, with their margin and delays in the configuration. Scene triggers
  "Liebherr alarm" and "Liebherr alarm over".
- A dashboard widget: zone temperatures, alarms, modes, and SuperCool, SuperFrost and PartyMode
  buttons.
- A "Test the connection" button, the cloud/unreachable badge of each appliance, and a refresh
  interval of 1 to 5 minutes that respects the limits of the Liebherr API.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-liebherr/commits/main
