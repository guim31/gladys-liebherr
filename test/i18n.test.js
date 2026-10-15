// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the text tables of the
// code, the feature names, and the four documentation files, with the same
// sections. German says "du", never the polite "Sie"; Spanish says "usted".
// (Adapted from guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { buildDevice } from '../src/devices.js';
import { parseAppliance } from '../src/liebherr/model.js';
import {
  ALARM_NAMES,
  COMMAND_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  FEATURE_NAMES,
  HYDRO_BREEZE_LABELS,
  ICE_MAKER_LABELS,
  INIT_FAILED,
  POSITION_NAMES,
  REPORT_TEXT,
  TOAST_TEXT,
  WIDGET_TEXT,
  ZONE_NAMES,
  ZONE_SHORT_NAMES,
  render,
} from '../src/texts.js';
import { ERROR_KINDS } from '../src/liebherr/client.js';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { fixture } from './helpers/fakeLiebherr.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen)(?!\p{L})/u;
// Spanish says "usted": never the familiar imperatives or "tu/tus".
const FAMILIAR_SPANISH = /(?<!\p{L})(tu|tus|elige|introduce|comprueba|añade|pulsa)(?!\p{L})/iu;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 300,
  message: 200,
  short: 24,
  status: 40,
  featureName: 50,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  if (lang === 'es' && FAMILIAR_SPANISH.test(text)) {
    found.push(`${path} uses the familiar form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

/** A multi-language object whose entries may be functions, rendered with samples. */
const rendered = (value, ...samples) =>
  Object.values(value).some((entry) => typeof entry === 'function')
    ? render(value, ...samples)
    : value;

const tableOf = (name, table, max, samples = []) =>
  Object.entries(table).flatMap(([key, value]) =>
    problems(rendered(value, ...samples), `${name}.${key}`, max),
  );

test('the configuration offers the four languages', () => {
  assert.deepEqual(LANGUAGES, LANGS);
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 60, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the catalog description holds 10 characters at least in every language', () => {
  for (const lang of LANGS) {
    assert.ok(manifest.description[lang].length >= 10, `description.${lang} is too short`);
  }
});

test('every text table of the code has the four languages', () => {
  const found = [
    ...problems(INIT_FAILED, 'INIT_FAILED', MAX.message),
    ...tableOf('CONNECTION_TEXT', CONNECTION_TEXT, MAX.message),
    ...tableOf('ERROR_TEXT', ERROR_TEXT, 100),
    ...tableOf('COMMAND_TEXT', COMMAND_TEXT, MAX.message, [-26, -15, '°C']),
    ...tableOf('ALARM_NAMES', ALARM_NAMES, MAX.status),
    ...tableOf('TOAST_TEXT', TOAST_TEXT, MAX.message, ['BioFresh-Plus']),
    ...tableOf('ZONE_NAMES', ZONE_NAMES, MAX.short),
    ...tableOf('ZONE_SHORT_NAMES', ZONE_SHORT_NAMES, 10),
    ...tableOf('POSITION_NAMES', POSITION_NAMES, 10),
    ...tableOf('FEATURE_NAMES', FEATURE_NAMES, 30),
    ...tableOf('ICE_MAKER_LABELS', ICE_MAKER_LABELS, MAX.short),
    ...tableOf('HYDRO_BREEZE_LABELS', HYDRO_BREEZE_LABELS, MAX.short),
  ];
  // Widget texts: messages, status values, tile and button labels.
  const longWidgetTexts = new Set(['noKey', 'noAppliance', 'unknown', 'waiting']);
  for (const [key, value] of Object.entries(WIDGET_TEXT)) {
    const max = longWidgetTexts.has(key) ? 300 : MAX.short;
    found.push(...problems(rendered(value, 120), `WIDGET_TEXT.${key}`, max));
  }
  assert.deepEqual(found, []);
  assert.deepEqual(sorted(Object.keys(ERROR_TEXT)), sorted(Object.values(ERROR_KINDS)));
  assert.deepEqual(sorted(Object.keys(ZONE_NAMES)), sorted(Object.keys(ZONE_SHORT_NAMES)));
});

test('the report table exists in every language', () => {
  assert.deepEqual(sorted(Object.keys(REPORT_TEXT)), sorted(LANGS));
  for (const lang of LANGS) {
    assert.deepEqual(sorted(Object.keys(REPORT_TEXT[lang])), sorted(Object.keys(REPORT_TEXT.en)));
    for (const [key, value] of Object.entries(REPORT_TEXT[lang])) {
      const text = typeof value === 'function' ? value(3) : value;
      assert.deepEqual(textProblems(text, `REPORT_TEXT.${lang}.${key}`, lang, 100), []);
    }
  }
});

test('the feature names fit, in every language, even with three zones of a kind', () => {
  const gladys = createFakeGladys();
  const controls = ['top', 'middle', 'bottom'].map((position, zoneId) => ({
    ...fixture('controls-combi')[0],
    zoneId,
    zonePosition: position,
  }));
  const appliances = [
    parseAppliance(fixture('devices')[0], [...controls, ...fixture('controls-combi').slice(2)]),
    parseAppliance(fixture('devices')[1], fixture('controls-wine')),
  ];
  for (const lang of LANGS) {
    for (const appliance of appliances) {
      for (const feature of buildDevice(gladys, appliance, lang).features) {
        assert.deepEqual(
          textProblems(feature.name, feature.external_id, lang, MAX.featureName),
          [],
        );
      }
    }
  }
});

test('no multi-language text is written outside src/texts.js', async () => {
  const sources = ['../index.js'];
  for (const dir of ['../src/', '../src/liebherr/']) {
    for (const entry of await readdir(new URL(dir, import.meta.url), { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.js') && entry.name !== 'texts.js') {
        sources.push(`${dir}${entry.name}`);
      }
    }
  }
  assert.ok(sources.length >= 10, 'every source file is scanned');
  for (const path of sources) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(
      source,
      /\b(fr|de|es)\s*:\s*['"`]/,
      `${path} writes a text by hand: move it to src/texts.js`,
    );
  }
});

test('the guard catches a missing language, an empty text and the wrong address', () => {
  assert.equal(problems({ en: 'Door', fr: 'Porte', de: 'Tür' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'Door', fr: 'Porte', de: '', es: 'Puerta' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of ['Wählen Sie', 'Ihr Gerät', 'Ihre Variablen', 'mit Ihrem', 'Ihnen']) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  assert.deepEqual(problems({ en: 'a', fr: 'a', de: 'sie schaltet, ihre', es: 'a' }, 'x', 60), []);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'Elige tu aparato' }, 'x', 60).length, 1);
  const forgotten = structuredClone(manifest);
  delete forgotten.scene_triggers[0].fields[1].label.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.scene_triggers[0].fields[1].label has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});

// --- Documentation -------------------------------------------------------------

const docs = Object.fromEntries(
  await Promise.all(
    LANGS.map(async (lang) => [
      lang,
      await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8'),
    ]),
  ),
);

const headings = (markdown) =>
  markdown
    .split('\n')
    .filter((line) => /^#{1,3} /.test(line))
    .map((line) => line.match(/^#+/)[0].length);

test('the four documentation files exist, with the same sections', () => {
  for (const lang of LANGS) {
    assert.ok(docs[lang].length >= 300, `docs/${lang}.md is too short for the store`);
    assert.deepEqual(headings(docs[lang]), headings(docs.en), `docs/${lang}.md sections`);
  }
  assert.ok(headings(docs.en).length >= 12);
});

test('the documentation names every trigger, action, widget button and feature', () => {
  for (const lang of LANGS) {
    const doc = docs[lang];
    for (const item of [...manifest.scene_triggers, ...manifest.actions]) {
      assert.ok(doc.includes(item.label[lang]), `docs/${lang}.md: "${item.label[lang]}"`);
    }
    for (const option of manifest.scene_triggers[0].fields[1].options) {
      const label = option.label[lang].replace(/ \(AutoDoor\)$/, '');
      assert.ok(doc.includes(label), `docs/${lang}.md: alarm "${label}"`);
    }
    for (const field of manifest.config_schema.filter((f) => f.type !== 'section')) {
      assert.ok(doc.includes(field.label[lang]), `docs/${lang}.md: setting "${field.label[lang]}"`);
    }
    for (const key of ['temperature', 'target', 'door', 'light']) {
      const name = FEATURE_NAMES[key][lang];
      assert.ok(doc.includes(name), `docs/${lang}.md: feature "${name}"`);
    }
  }
});

test('the German documentation says "du", the Spanish one "usted"', () => {
  const polite = docs.de
    .split('\n')
    .filter((line) => !line.startsWith('`') && POLITE_GERMAN.test(line));
  assert.deepEqual(polite, []);
  const familiar = docs.es.split('\n').filter((line) => FAMILIAR_SPANISH.test(line));
  assert.deepEqual(familiar, []);
});

test('the documentation says it was developed without the hardware, and not affiliated', () => {
  assert.match(docs.en, /Developed without the hardware: feedback welcome/);
  assert.match(docs.en, /not affiliated with Liebherr/);
  for (const lang of LANGS) {
    assert.match(docs[lang], /github\.com\/guim31\/gladys-liebherr\/issues/);
  }
});
