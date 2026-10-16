import { STORAGE_KEYS } from '../core/config';
import { safeStorage, type KeyValueStorage } from '../core/storage';

export type Theme = 'light' | 'dark';

/**
 * Decide the active theme. An explicit saved choice always wins; otherwise the
 * operating system preference decides. Kept pure so it is unit-testable and
 * mirrors the inline boot script in index.html (which prevents a flash of the
 * wrong palette before this module runs).
 */
export function resolveInitialTheme(saved: string | null, prefersDark: boolean): Theme {
  if (saved === 'light' || saved === 'dark') return saved;
  return prefersDark ? 'dark' : 'light';
}

export interface ThemeController {
  current(): Theme;
  set(theme: Theme, options?: { persist?: boolean }): void;
  toggle(): Theme;
}

export interface ThemeOptions {
  doc?: Document;
  storage?: KeyValueStorage | null;
  /** Override for tests; defaults to the `prefers-color-scheme` media query. */
  prefersDark?: () => boolean;
}

export function createThemeController(options: ThemeOptions = {}): ThemeController {
  const doc = options.doc ?? document;
  const storage = options.storage === undefined ? safeStorage() : options.storage;
  const prefersDark =
    options.prefersDark ??
    ((): boolean => doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);

  function readSaved(): string | null {
    try {
      return storage?.getItem(STORAGE_KEYS.theme) ?? null;
    } catch {
      return null;
    }
  }

  function current(): Theme {
    return doc.documentElement.dataset['theme'] === 'dark' ? 'dark' : 'light';
  }

  function set(theme: Theme, opts?: { persist?: boolean }): void {
    doc.documentElement.dataset['theme'] = theme;
    if (opts?.persist !== false) {
      try {
        storage?.setItem(STORAGE_KEYS.theme, theme);
      } catch {
        /* storage full or blocked — the choice just will not persist */
      }
    }
  }

  // Initialise from the saved choice, or the OS preference on a first visit.
  // Not persisted: following the system is the default, not a user choice.
  set(resolveInitialTheme(readSaved(), prefersDark()), { persist: false });

  return {
    current,
    set,
    toggle: () => {
      const next: Theme = current() === 'dark' ? 'light' : 'dark';
      set(next);
      return next;
    },
  };
}
