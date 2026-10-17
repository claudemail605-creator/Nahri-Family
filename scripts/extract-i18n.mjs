/*
 * Extract the i18n dictionaries from the reference app's js/i18n.js and emit
 * them as TypeScript modules under src/core/i18n/dict.<lang>.ts.
 *
 * The reference file defines one big object literal:
 *     const I18N = { en: { ... }, ur: { ... }, hi: { ... } };
 * inside an IIFE. We locate that literal with a string-aware brace scanner
 * (comments and quoted strings are skipped), evaluate it with node:vm and
 * validate key parity before writing anything.
 *
 * Usage:
 *   node scripts/extract-i18n.mjs [path/to/i18n.js]
 *
 * Default source path is ../../reference/js/i18n.js relative to this script
 * (the read-only reference clone next to the target repository).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(HERE, '..', '..', 'reference', 'js', 'i18n.js');
const OUT_DIR = resolve(HERE, '..', 'src', 'core', 'i18n');
const LANGS = ['en', 'ur', 'hi'];
const EXPECTED_KEY_COUNT = 623;

function extractObjectLiteral(text, declaration) {
  const declAt = text.indexOf(declaration);
  if (declAt === -1) throw new Error(`"${declaration}" not found in ${SOURCE}`);
  const openBrace = text.indexOf('{', declAt + declaration.length);
  if (openBrace === -1) throw new Error('opening brace not found');
  let depth = 0;
  let quote = null;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = openBrace; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === '\\') {
        escaped = true;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      continue;
    }
    if (c === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (c === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(openBrace, i + 1);
    }
  }
  throw new Error('unbalanced braces while scanning the dictionary literal');
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const raw = readFileSync(SOURCE, 'utf8');
if (raw.includes('\uFFFD')) fail('source contains U+FFFD replacement characters');
const literal = extractObjectLiteral(raw, 'const I18N =');

// The reference app's brand wording is replaced by this app's own name here so
// that regeneration reproduces the committed dictionaries exactly. The Urdu
// and Hindi spellings await native-speaker review (see docs/PLAN.md).
const RENAMES = {
  'brand.title': {
    en: 'Nahri Family',
    ur: 'نہری فیملی',
    hi: 'नहरी फैमिली',
  },
};

// Messages the new app adds that the reference dictionaries do not have.
// The Urdu and Hindi spellings await native-speaker review (see docs/PLAN.md).
const NEW_KEYS = {
  'generic.close': {
    en: 'Close',
    ur: 'بند کریں',
    hi: 'बंद करें',
  },
  'profile.edit': {
    en: 'Edit profile',
    ur: 'پروفائل میں ترمیم کریں',
    hi: 'प्रोफ़ाइल संपादित करें',
  },
  // Table pagination (Phase 5, G6) — new controls with no reference wording.
  // The Urdu/Hindi lines follow the existing table idiom and await the
  // native-speaker review (docs/PLAN.md).
  'table.pagerInfo': {
    en: '{from}–{to} of {total}',
    ur: '{from}–{to}، کل {total} میں سے',
    hi: '{from}–{to}, कुल {total} में से',
  },
  'table.prevPage': {
    en: 'Previous page',
    ur: 'پچھلا صفحہ',
    hi: 'पिछला पृष्ठ',
  },
  'table.nextPage': {
    en: 'Next page',
    ur: 'اگلا صفحہ',
    hi: 'अगला पृष्ठ',
  },
  'table.perPage': {
    en: 'Rows per page',
    ur: 'فی صفحہ قطاریں',
    hi: 'प्रति पृष्ठ पंक्तियाँ',
  },
};
if (literal.includes('`')) {
  console.warn('WARN: dictionary literal contains a backtick — verify the vm evaluation is faithful');
}
const I18N = vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 5000 });

for (const [key, perLang] of Object.entries(RENAMES)) {
  for (const lang of LANGS) {
    if (!(key in I18N[lang])) fail(`rename target "${key}" missing from ${lang}`);
    I18N[lang][key] = perLang[lang];
  }
  console.log(`renamed ${key}`);
}

for (const [key, perLang] of Object.entries(NEW_KEYS)) {
  for (const lang of LANGS) {
    if (key in I18N[lang]) fail(`new key "${key}" already exists in ${lang} — remove it from NEW_KEYS`);
    I18N[lang][key] = perLang[lang];
  }
  console.log(`added ${key}`);
}

for (const lang of LANGS) {
  if (!I18N[lang] || typeof I18N[lang] !== 'object') fail(`dictionary "${lang}" missing`);
}
const extraTop = Object.keys(I18N).filter((k) => !LANGS.includes(k));
if (extraTop.length) fail(`unexpected top-level keys: ${extraTop.join(', ')}`);

const enKeys = Object.keys(I18N.en);
if (enKeys.length !== EXPECTED_KEY_COUNT) {
  console.warn(`WARN: expected ${EXPECTED_KEY_COUNT} English keys, found ${enKeys.length}`);
}
for (const lang of LANGS) {
  const dict = I18N[lang];
  const keys = Object.keys(dict);
  for (const k of keys) {
    if (typeof dict[k] !== 'string') fail(`${lang}.${k} is not a string`);
    if (dict[k].length === 0) fail(`${lang}.${k} is empty`);
  }
  const missing = enKeys.filter((k) => !(k in dict));
  const extra = keys.filter((k) => !(k in I18N.en));
  if (missing.length) fail(`${lang} is missing ${missing.length} keys, e.g. ${missing.slice(0, 5).join(', ')}`);
  if (extra.length) fail(`${lang} has ${extra.length} keys not in en, e.g. ${extra.slice(0, 5).join(', ')}`);
}

// Placeholder audit — report duplicate placeholders (would be lossy under
// single-replace semantics) and unknown tokens for awareness.
let repeated = 0;
for (const lang of LANGS) {
  for (const [key, value] of Object.entries(I18N[lang])) {
    const placeholders = [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]);
    const seen = new Set();
    for (const p of placeholders) {
      if (seen.has(p)) {
        repeated++;
        console.warn(`WARN: ${lang}.${key} repeats placeholder {${p}}`);
      }
      seen.add(p);
    }
  }
}

mkdirSync(OUT_DIR, { recursive: true });
const header = `/**
 * GENERATED FILE — do not edit by hand.
 * Extracted from the reference application's js/i18n.js (${enKeys.length} messages per language).
 * Regenerate with: npm run extract:i18n
 */
`;
for (const lang of LANGS) {
  const body = `${header}export const ${lang} = ${JSON.stringify(I18N[lang], null, 2)} as const;\n`;
  const outPath = join(OUT_DIR, `dict.${lang}.ts`);
  writeFileSync(outPath, body, 'utf8');
  console.log(`wrote ${outPath} (${Object.keys(I18N[lang]).length} keys)`);
}
console.log(`OK — ${LANGS.length} languages, ${enKeys.length} keys each, ${repeated} repeated placeholders`);
