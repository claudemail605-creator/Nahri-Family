import { STORAGE_KEYS } from '../config';
import { safeStorage, type KeyValueStorage } from '../storage';
import type { Lang } from '../types';
import { en } from './dict.en';
import { hi } from './dict.hi';
import { ur } from './dict.ur';

/**
 * i18n engine — port of the reference app's js/i18n.js with the same external
 * behaviour:
 *   - `t(key)` resolves the current-language string, falls back to English,
 *     then to the key itself;
 *   - `fmt(key, vars)` interpolates `{name}` placeholders (missing variables
 *     become empty strings — unlike the reference, EVERY occurrence of a
 *     placeholder is replaced, which is equivalent for the shipped messages);
 *   - `setLanguage()` re-applies `[data-i18n]` attributes, loads the script
 *     web-font when needed, persists the choice and fires `i18n:change`;
 *   - digits stay in Western numerals in every language.
 *
 * The engine is created per application instance (or per test) via
 * `createI18n()` so nothing is hard-wired to globals.
 */

export type MessageKey = keyof typeof en;
export type MessageVars = Record<string, string | number | boolean | null | undefined>;

export const LANGUAGES: readonly Lang[] = ['en', 'ur', 'hi'];

/** Compile-time guarantee that ur/hi define every English key. */
function asDictionary<D extends Record<MessageKey, string>>(dict: D): Record<MessageKey, string> {
  return dict;
}

const DICTS: Record<Lang, Record<MessageKey, string>> = {
  en: asDictionary(en),
  ur: asDictionary(ur),
  hi: asDictionary(hi),
};

/** Extra web fonts per script, loaded on demand (reference behaviour). */
const SCRIPT_FONTS: Partial<Record<Lang, string>> = {
  ur: 'family=Noto+Naskh+Arabic:wght@400;600;700&family=Noto+Nastaliq+Urdu:wght@400;600;700&display=swap',
  hi: 'family=Noto+Sans+Devanagari:wght@400;600;700&display=swap',
};

export interface I18n {
  /** Current-language string for `key`; English then the key itself as fallback. */
  t(key: MessageKey): string;
  /** `t()` plus `{placeholder}` interpolation. */
  fmt(key: MessageKey, vars?: MessageVars): string;
  /** Switch language. Unknown values fall back to English. Fires `i18n:change`. */
  setLanguage(lang: string): void;
  /** Re-translate every `[data-i18n]` element in the document and update html[lang]/[dir]. */
  apply(): void;
  currentLang(): Lang;
  languages: readonly Lang[];
  /** Subscribe to language changes. Returns an unsubscribe function. */
  onLanguageChange(fn: (lang: Lang) => void): () => void;
}

export interface I18nOptions {
  doc?: Document;
  storage?: KeyValueStorage | null;
  /** Load script fonts from Google Fonts when switching to ur/hi (default true). */
  loadScriptFonts?: boolean;
}

function isLang(value: string): value is Lang {
  return (LANGUAGES as readonly string[]).includes(value);
}

export function createI18n(options: I18nOptions = {}): I18n {
  const doc = options.doc ?? document;
  const storage = options.storage === undefined ? safeStorage() : options.storage;
  const shouldLoadFonts = options.loadScriptFonts ?? true;

  let current: Lang = 'en';
  const stored = storage?.getItem(STORAGE_KEYS.lang);
  if (stored && isLang(stored)) current = stored;

  function t(key: MessageKey): string {
    return DICTS[current][key] ?? DICTS.en[key] ?? key;
  }

  function fmt(key: MessageKey, vars?: MessageVars): string {
    let value = t(key);
    if (vars) {
      for (const [name, raw] of Object.entries(vars)) {
        value = value.replaceAll(`{${name}}`, raw == null ? '' : String(raw));
      }
    }
    return value;
  }

  function loadScriptFont(lang: Lang): void {
    if (!shouldLoadFonts || lang === 'en' || !doc.head) return;
    const query = SCRIPT_FONTS[lang];
    if (!query) return;
    const id = `nahri-font-${lang}`;
    if (doc.getElementById(id)) return;
    const link = doc.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${query}`;
    doc.head.appendChild(link);
  }

  /**
   * The translation key of an element. The project convention is a VALUELESS
   * data-i18n attribute whose element text is the key, e.g.
   * `<h1 data-i18n>brand.title</h1>`; writing the key as the attribute value
   * also works. The resolved key is remembered in data-i18n-key so repeated
   * applies still find it after the text has been replaced.
   */
  function keyOf(el: Element): string {
    const attr = el.getAttribute('data-i18n');
    if (attr) return attr;
    const htmlEl = el as HTMLElement;
    if (htmlEl.dataset.i18nKey) return htmlEl.dataset.i18nKey;
    const text = (el.textContent ?? '').trim();
    if (text) htmlEl.dataset.i18nKey = text;
    return text;
  }

  function apply(): void {
    doc.querySelectorAll('[data-i18n]').forEach((el) => {
      // Elements that only want an attribute translated (e.g. an icon button's
      // aria-label) keep their inner markup untouched.
      if (el.hasAttribute('data-i18n-attr')) return;
      const key = keyOf(el);
      if (!key) return;
      const value = t(key as MessageKey);
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        const placeholderKey = el.getAttribute('data-i18n-placeholder');
        if (placeholderKey) el.setAttribute('placeholder', t(placeholderKey as MessageKey));
        else (el as HTMLInputElement).value = value;
      } else {
        el.textContent = value;
      }
    });
    doc.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder') as MessageKey));
    });
    doc.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      const attr = el.getAttribute('data-i18n-attr');
      const key = el.getAttribute('data-i18n');
      if (attr && key) el.setAttribute(attr, t(key as MessageKey));
    });
    const root = doc.documentElement;
    root.lang = current;
    root.dir = current === 'ur' ? 'rtl' : 'ltr';
  }

  function setLanguage(lang: string): void {
    current = isLang(lang) ? lang : 'en';
    apply();
    loadScriptFont(current);
    try {
      storage?.setItem(STORAGE_KEYS.lang, current);
    } catch {
      /* storage full or blocked — the choice just will not persist */
    }
    doc.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang: current } }));
  }

  function onLanguageChange(fn: (lang: Lang) => void): () => void {
    const handler = (event: Event): void => {
      fn((event as CustomEvent<{ lang: Lang }>).detail.lang);
    };
    doc.addEventListener('i18n:change', handler);
    return () => doc.removeEventListener('i18n:change', handler);
  }

  // Reflect the stored language immediately so the shell lays out with the
  // right direction from the first paint.
  apply();
  loadScriptFont(current);

  return {
    t,
    fmt,
    setLanguage,
    apply,
    currentLang: () => current,
    languages: LANGUAGES,
    onLanguageChange,
  };
}
