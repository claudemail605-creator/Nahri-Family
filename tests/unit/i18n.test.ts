import { beforeEach, describe, expect, it } from 'vitest';
import { createI18n, type I18n, type MessageKey } from '../../src/core/i18n';
import { en } from '../../src/core/i18n/dict.en';
import { ur } from '../../src/core/i18n/dict.ur';

function freshI18n(): I18n {
  return createI18n({ loadScriptFonts: false });
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = 'en';
  document.documentElement.dir = 'ltr';
  document.body.replaceChildren();
});

describe('t() and fmt()', () => {
  it('returns the current-language string', () => {
    const i18n = freshI18n();
    expect(i18n.t('brand.title')).toBe(en['brand.title']);
  });

  it('returns the key itself for unknown keys', () => {
    const i18n = freshI18n();
    expect(i18n.t('does.not.exist' as MessageKey)).toBe('does.not.exist');
  });

  it('interpolates placeholders; null and missing variables become empty', () => {
    const i18n = freshI18n();
    expect(i18n.fmt('export.done', { n: 5 })).toBe('Exported 5 people.');
    expect(i18n.fmt('export.done', { n: null })).toBe('Exported  people.');
    // A parameter that the message does not mention is ignored…
    expect(i18n.fmt('export.done', { n: 1, other: 'x' })).toBe('Exported 1 people.');
    // …and a placeholder with no variable is left untouched.
    expect(i18n.fmt('export.done')).toBe('Exported {n} people.');
  });
});

describe('setLanguage()', () => {
  it('switches dictionaries, updates document direction and persists', () => {
    const i18n = freshI18n();
    i18n.setLanguage('ur');
    expect(i18n.currentLang()).toBe('ur');
    expect(i18n.t('brand.title')).toBe(ur['brand.title']);
    expect(document.documentElement.lang).toBe('ur');
    expect(document.documentElement.dir).toBe('rtl');
    expect(localStorage.getItem('nahri.lang')).toBe('ur');
  });

  it('falls back to English for unknown languages', () => {
    const i18n = freshI18n();
    i18n.setLanguage('de');
    expect(i18n.currentLang()).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('restores the stored language at creation', () => {
    localStorage.setItem('nahri.lang', 'hi');
    const i18n = freshI18n();
    expect(i18n.currentLang()).toBe('hi');
    expect(document.documentElement.lang).toBe('hi');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('notifies subscribers and stops after unsubscribe', () => {
    const i18n = freshI18n();
    const seen: string[] = [];
    const unsubscribe = i18n.onLanguageChange((lang) => seen.push(lang));
    i18n.setLanguage('ur');
    expect(seen).toEqual(['ur']);
    unsubscribe();
    i18n.setLanguage('en');
    expect(seen).toEqual(['ur']);
  });
});

describe('apply()', () => {
  it('translates attribute, valueless and placeholder forms', () => {
    document.body.innerHTML = `
      <h1 data-i18n="brand.title"></h1>
      <p data-i18n>generic.loading</p>
      <button data-i18n="btnTheme" data-i18n-attr="aria-label"></button>
      <input id="ph" data-i18n-placeholder="auth.email" />
      <input id="both" data-i18n="auth.email" data-i18n-placeholder="auth.email" />
      <input id="val" data-i18n="auth.email" />
    `;
    const i18n = freshI18n();
    i18n.apply();

    expect(document.querySelector('h1')!.textContent).toBe(en['brand.title']);
    const p = document.querySelector('p')!;
    expect(p.textContent).toBe(en['generic.loading']);
    expect(p.getAttribute('data-i18n-key')).toBe('generic.loading');
    expect(document.querySelector('button')!.getAttribute('aria-label')).toBe(en['btnTheme']);
    expect(document.querySelector<HTMLInputElement>('#ph')!.getAttribute('placeholder')).toBe(
      en['auth.email'],
    );
    expect(document.querySelector<HTMLInputElement>('#both')!.getAttribute('placeholder')).toBe(
      en['auth.email'],
    );
    expect(document.querySelector<HTMLInputElement>('#val')!.value).toBe(en['auth.email']);
  });

  it('re-translates after a language switch', () => {
    document.body.innerHTML = `<h1 data-i18n="brand.title"></h1>`;
    const i18n = freshI18n();
    i18n.apply();
    expect(document.querySelector('h1')!.textContent).toBe(en['brand.title']);
    i18n.setLanguage('ur');
    expect(document.querySelector('h1')!.textContent).toBe(ur['brand.title']);
  });

  it('loads the Urdu script font stylesheet on demand', () => {
    const i18n = createI18n({ loadScriptFonts: true });
    expect(document.getElementById('nahri-font-ur')).toBeNull();
    i18n.setLanguage('ur');
    const link = document.getElementById('nahri-font-ur');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toContain('Noto+Nastaliq+Urdu');
    // Switching to English does not remove it and does not add more.
    i18n.setLanguage('en');
    expect(document.querySelectorAll('link[id^="nahri-font-"]')).toHaveLength(1);
  });
});
