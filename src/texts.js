// -----------------------------------------------------------------------------
// Every text the integration shows: feature names, connection status, errors,
// the "Test the connection" report, the widget, the toasts. Four languages,
// the four of the Gladys interface; German says "du", Spanish "usted".
// Brand and function names (Liebherr, SmartDevice, SuperCool, SuperFrost,
// PartyMode, NightMode, IceMaker, HydroBreeze, BioFresh-Plus, AutoDoor) are
// not translated. test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './liebherr/client.js';

export const LANGUAGE_FALLBACK = 'en';

/** The text of a language, the English one when it is missing. */
export const pick = (text, language) => text?.[language] ?? text?.[LANGUAGE_FALLBACK] ?? '';

/** `Name: text`, with the space French puts before the colon. */
export const labelled = (name, text, language) =>
  language === 'fr' ? `${name} : ${text}` : `${name}: ${text}`;

// --- Feature names (frozen in Gladys when the device is created) -------------

export const ZONE_NAMES = {
  fridge: { en: 'Fridge', fr: 'Réfrigérateur', de: 'Kühlteil', es: 'Frigorífico' },
  freezer: { en: 'Freezer', fr: 'Congélateur', de: 'Gefrierteil', es: 'Congelador' },
  wine: { en: 'Wine cabinet', fr: 'Cave à vin', de: 'Weinfach', es: 'Vinoteca' },
};

// Short zone names, for the widget tiles of several appliances (24 characters).
export const ZONE_SHORT_NAMES = {
  fridge: { en: 'fridge', fr: 'frigo', de: 'Kühlen', es: 'frigo' },
  freezer: { en: 'freezer', fr: 'congél.', de: 'Gefrieren', es: 'congel.' },
  wine: { en: 'wine', fr: 'cave', de: 'Wein', es: 'vino' },
};

export const POSITION_NAMES = {
  top: { en: 'top', fr: 'haut', de: 'oben', es: 'arriba' },
  middle: { en: 'middle', fr: 'milieu', de: 'Mitte', es: 'centro' },
  bottom: { en: 'bottom', fr: 'bas', de: 'unten', es: 'abajo' },
};

export const FEATURE_NAMES = {
  temperature: { en: 'Temperature', fr: 'Température', de: 'Temperatur', es: 'Temperatura' },
  target: { en: 'Setpoint', fr: 'Consigne', de: 'Solltemperatur', es: 'Consigna' },
  supercool: { en: 'SuperCool', fr: 'SuperCool', de: 'SuperCool', es: 'SuperCool' },
  superfrost: { en: 'SuperFrost', fr: 'SuperFrost', de: 'SuperFrost', es: 'SuperFrost' },
  icemaker: { en: 'IceMaker', fr: 'IceMaker', de: 'IceMaker', es: 'IceMaker' },
  hydrobreeze: { en: 'HydroBreeze', fr: 'HydroBreeze', de: 'HydroBreeze', es: 'HydroBreeze' },
  biofreshplus: {
    en: 'BioFresh-Plus',
    fr: 'BioFresh-Plus',
    de: 'BioFresh-Plus',
    es: 'BioFresh-Plus',
  },
  door: { en: 'Door', fr: 'Porte', de: 'Tür', es: 'Puerta' },
  partymode: { en: 'PartyMode', fr: 'PartyMode', de: 'PartyMode', es: 'PartyMode' },
  nightmode: { en: 'NightMode', fr: 'NightMode', de: 'NightMode', es: 'NightMode' },
  light: {
    en: 'Presentation light',
    fr: 'Éclairage de présentation',
    de: 'Präsentationslicht',
    es: 'Luz de presentación',
  },
};

// Options of the select features (text/select): the label shown in Gladys.
export const ICE_MAKER_LABELS = {
  off: { en: 'Off', fr: 'Arrêt', de: 'Aus', es: 'Apagado' },
  on: { en: 'On', fr: 'Marche', de: 'An', es: 'Encendido' },
  max_ice: { en: 'MaxIce', fr: 'MaxIce', de: 'MaxIce', es: 'MaxIce' },
};

export const HYDRO_BREEZE_LABELS = {
  off: { en: 'Off', fr: 'Arrêt', de: 'Aus', es: 'Apagado' },
  low: { en: 'Low', fr: 'Faible', de: 'Niedrig', es: 'Bajo' },
  medium: { en: 'Medium', fr: 'Moyen', de: 'Mittel', es: 'Medio' },
  high: { en: 'High', fr: 'Fort', de: 'Hoch', es: 'Alto' },
};

// --- Connection status and errors ---------------------------------------------

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noKey: {
    en: 'Enter the API key of the SmartDevice app in the configuration.',
    fr: "Saisissez la clé d'API de l'application SmartDevice dans la configuration.",
    de: 'Gib den API-Schlüssel der SmartDevice-App in der Konfiguration ein.',
    es: 'Introduzca la clave de API de la aplicación SmartDevice en la configuración.',
  },
  noAppliance: {
    en: 'Key accepted, but no connected appliance: check the SmartDevice app.',
    fr: "Clé acceptée, mais aucun appareil connecté : vérifiez l'application SmartDevice.",
    de: 'Schlüssel akzeptiert, aber kein verbundenes Gerät: Prüfe die SmartDevice-App.',
    es: 'Clave aceptada, pero ningún aparato conectado: compruebe la aplicación SmartDevice.',
  },
};

// One short explanation per error kind (src/liebherr/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.AUTH]: {
    en: 'API key refused: generate a new one in the SmartDevice app',
    fr: "clé d'API refusée : générez-en une nouvelle dans l'application SmartDevice",
    de: 'API-Schlüssel abgelehnt: Erzeuge einen neuen in der SmartDevice-App',
    es: 'clave de API rechazada: genere una nueva en la aplicación SmartDevice',
  },
  [ERROR_KINDS.RATE_LIMIT]: {
    en: 'too many requests to Liebherr, retrying later',
    fr: 'trop de requêtes vers Liebherr, nouvel essai plus tard',
    de: 'zu viele Anfragen an Liebherr, neuer Versuch später',
    es: 'demasiadas solicitudes a Liebherr, se reintentará más tarde',
  },
  [ERROR_KINDS.NETWORK]: {
    en: 'the Liebherr service does not answer',
    fr: 'le service Liebherr ne répond pas',
    de: 'der Liebherr-Dienst antwortet nicht',
    es: 'el servicio de Liebherr no responde',
  },
  [ERROR_KINDS.SERVER]: {
    en: 'the Liebherr service is failing, retrying later',
    fr: 'le service Liebherr est en panne, nouvel essai plus tard',
    de: 'der Liebherr-Dienst hat eine Störung, neuer Versuch später',
    es: 'el servicio de Liebherr falla, se reintentará más tarde',
  },
  [ERROR_KINDS.OFFLINE]: {
    en: 'appliance offline',
    fr: 'appareil hors ligne',
    de: 'Gerät offline',
    es: 'aparato sin conexión',
  },
  [ERROR_KINDS.NOT_ONBOARDED]: {
    en: 'appliance not in your SmartDevice household',
    fr: 'appareil absent de votre foyer SmartDevice',
    de: 'Gerät nicht in deinem SmartDevice-Haushalt',
    es: 'aparato fuera de su hogar SmartDevice',
  },
  [ERROR_KINDS.UNSUPPORTED]: {
    en: 'the appliance refuses this function right now',
    fr: "l'appareil refuse cette fonction pour le moment",
    de: 'das Gerät lehnt diese Funktion gerade ab',
    es: 'el aparato rechaza esta función por ahora',
  },
  [ERROR_KINDS.BAD_REQUEST]: {
    en: 'value refused by the appliance',
    fr: "valeur refusée par l'appareil",
    de: 'Wert vom Gerät abgelehnt',
    es: 'valor rechazado por el aparato',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer from Liebherr, see the logs',
    fr: 'réponse inattendue de Liebherr, voir les logs',
    de: 'unerwartete Antwort von Liebherr, sieh in den Protokollen nach',
    es: 'respuesta inesperada de Liebherr, consulte los registros',
  },
};

// Errors of a command (a feature, a widget button): shown in Gladys.
export const COMMAND_TEXT = {
  unknownAppliance: {
    en: 'This appliance is no longer on the Liebherr account.',
    fr: "Cet appareil n'est plus sur le compte Liebherr.",
    de: 'Dieses Gerät ist nicht mehr im Liebherr-Konto.',
    es: 'Este aparato ya no está en la cuenta de Liebherr.',
  },
  outOfRange: {
    en: (min, max, unit) => `Setpoint refused: the appliance accepts ${min} to ${max} ${unit}.`,
    fr: (min, max, unit) => `Consigne refusée : l'appareil accepte de ${min} à ${max} ${unit}.`,
    de: (min, max, unit) => `Solltemperatur abgelehnt: Das Gerät nimmt ${min} bis ${max} ${unit}.`,
    es: (min, max, unit) => `Consigna rechazada: el aparato acepta de ${min} a ${max} ${unit}.`,
  },
  unknownOption: {
    en: 'This option is not offered by the appliance.',
    fr: "Cette option n'est pas proposée par l'appareil.",
    de: 'Diese Option bietet das Gerät nicht an.',
    es: 'El aparato no ofrece esta opción.',
  },
  readOnly: {
    en: 'This value can only be read.',
    fr: 'Cette valeur se lit seulement.',
    de: 'Dieser Wert kann nur gelesen werden.',
    es: 'Este valor solo se puede leer.',
  },
};

// --- "Test the connection" report ------------------------------------------------

export const REPORT_TEXT = {
  en: {
    found: (count) => `${count} appliance(s) on the Liebherr account.`,
    offline: 'offline',
    alarm: 'alarm',
  },
  fr: {
    found: (count) => `${count} appareil(s) sur le compte Liebherr.`,
    offline: 'hors ligne',
    alarm: 'alarme',
  },
  de: {
    found: (count) => `${count} Gerät(e) im Liebherr-Konto.`,
    offline: 'offline',
    alarm: 'Alarm',
  },
  es: {
    found: (count) => `${count} aparato(s) en la cuenta de Liebherr.`,
    offline: 'sin conexión',
    alarm: 'alarma',
  },
};

// --- Alarms (scene triggers and widget) ---------------------------------------------

export const ALARM_NAMES = {
  temperature: {
    en: 'Temperature too high',
    fr: 'Température trop haute',
    de: 'Temperatur zu hoch',
    es: 'Temperatura demasiado alta',
  },
  door: {
    en: 'Door open too long',
    fr: 'Porte ouverte trop longtemps',
    de: 'Tür zu lange offen',
    es: 'Puerta abierta demasiado tiempo',
  },
  offline: {
    en: 'Appliance offline',
    fr: 'Appareil hors ligne',
    de: 'Gerät offline',
    es: 'Aparato sin conexión',
  },
};

// --- Widget ----------------------------------------------------------------------------------

export const WIDGET_TEXT = {
  noKey: CONNECTION_TEXT.noKey,
  noAppliance: CONNECTION_TEXT.noAppliance,
  unknown: {
    en: 'This appliance is no longer on the Liebherr account: choose another one in the widget settings.',
    fr: "Cet appareil n'est plus sur le compte Liebherr : choisissez-en un autre dans les réglages du widget.",
    de: 'Dieses Gerät ist nicht mehr im Liebherr-Konto: Wähle ein anderes in den Widget-Einstellungen.',
    es: 'Este aparato ya no está en la cuenta de Liebherr: elija otro en la configuración del widget.',
  },
  waiting: {
    en: 'Waiting for the first reading from Liebherr.',
    fr: 'En attente de la première lecture chez Liebherr.',
    de: 'Warte auf die erste Abfrage bei Liebherr.',
    es: 'Esperando la primera lectura de Liebherr.',
  },
  noAlarm: { en: 'No alarm', fr: 'Aucune alarme', de: 'Kein Alarm', es: 'Sin alarmas' },
  alarms: { en: 'Alarms', fr: 'Alarmes', de: 'Alarme', es: 'Alarmas' },
  online: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'Conectado' },
  offline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
  on: { en: 'On', fr: 'Actif', de: 'An', es: 'Activo' },
  doorOpen: { en: 'Door open', fr: 'Porte ouverte', de: 'Tür offen', es: 'Puerta abierta' },
  since: {
    en: (minutes) => `for ${minutes} min`,
    fr: (minutes) => `depuis ${minutes} min`,
    de: (minutes) => `seit ${minutes} min`,
    es: (minutes) => `desde hace ${minutes} min`,
  },
  setpoint: {
    en: (value) => `setpoint ${value}`,
    fr: (value) => `consigne ${value}`,
    de: (value) => `Soll ${value}`,
    es: (value) => `consigna ${value}`,
  },
};

// Toasts of the widget buttons (200 characters at most).
export const TOAST_TEXT = {
  switchedOn: {
    en: (name) => `${name} switched on.`,
    fr: (name) => `${name} activé.`,
    de: (name) => `${name} eingeschaltet.`,
    es: (name) => `${name} activado.`,
  },
  switchedOff: {
    en: (name) => `${name} switched off.`,
    fr: (name) => `${name} désactivé.`,
    de: (name) => `${name} ausgeschaltet.`,
    es: (name) => `${name} desactivado.`,
  },
};

/**
 * A multi-language text built from a table of functions.
 * @param {Record<string, Function>} table
 * @param {...unknown} args
 */
export const render = (table, ...args) =>
  Object.fromEntries(Object.entries(table).map(([language, build]) => [language, build(...args)]));
