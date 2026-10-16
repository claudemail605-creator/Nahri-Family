import { describe, expect, it } from 'vitest';
import { createThemeController, resolveInitialTheme } from '../../src/ui/theme';

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string): string | null => map.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      map.set(key, value);
    },
    _map: map,
  };
}

describe('resolveInitialTheme', () => {
  it('lets an explicit saved choice win over the OS preference', () => {
    expect(resolveInitialTheme('dark', false)).toBe('dark');
    expect(resolveInitialTheme('light', true)).toBe('light');
  });

  it('follows the OS preference without a saved choice', () => {
    expect(resolveInitialTheme(null, true)).toBe('dark');
    expect(resolveInitialTheme(null, false)).toBe('light');
  });

  it('ignores invalid saved values', () => {
    expect(resolveInitialTheme('chartreuse', true)).toBe('dark');
  });
});

describe('createThemeController', () => {
  it('initialises from a saved choice', () => {
    const storage = fakeStorage({ 'nahri.theme': 'dark' });
    createThemeController({ storage, prefersDark: () => false });
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('follows the OS preference on a first visit without writing storage', () => {
    const storage = fakeStorage();
    createThemeController({ storage, prefersDark: () => true });
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(storage._map.has('nahri.theme')).toBe(false);
  });

  it('toggle flips the palette and persists the explicit choice', () => {
    const storage = fakeStorage();
    const theme = createThemeController({ storage, prefersDark: () => false });
    expect(theme.current()).toBe('light');
    expect(theme.toggle()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(storage._map.get('nahri.theme')).toBe('dark');
    expect(theme.toggle()).toBe('light');
    expect(storage._map.get('nahri.theme')).toBe('light');
  });

  it('works without any storage', () => {
    const theme = createThemeController({ storage: null, prefersDark: () => false });
    expect(theme.current()).toBe('light');
    expect(() => theme.toggle()).not.toThrow();
    expect(theme.current()).toBe('dark');
  });
});
