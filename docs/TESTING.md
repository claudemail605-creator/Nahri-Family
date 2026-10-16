# Testing

Every test that exists, how to run it, and what it proved — kept current after
every phase. Every claim in this file corresponds to a command that was really
run; outputs below were copied from the terminal on **2026-10-16** (Phase 1).

## Test levels (what is verified where)

| Level | Tool | What it can prove | What it cannot prove |
| --- | --- | --- | --- |
| L1 — unit | Vitest + jsdom | Engine and controller logic: dictionaries, i18n behaviour, name display, theme resolution, toast lifecycle, modal focus/Escape/backdrop | Real layout, real fonts, real gestures |
| L2 — browser simulation | Playwright + Chromium (desktop and Pixel 7 emulation) against the **production build** | Boot, translations, RTL flip, theme persistence, keyboard reachability, console/page errors | Real phones, real touch hardware, real network |
| L3 — physical device | manual | Everything L2 cannot | (not done yet — see below) |
| L4 — live backend | manual / scripted against the real Supabase project | Auth, RLS behaviour, real data integrity | (blocked: needs the owner's test account) |

**Honesty rules we hold ourselves to:** emulated mobile is not a real device;
a mock is not the live backend; a green build is not a deployed app. Rows move
to "done" in `docs/FEATURE_PARITY.md` only when a test below exercised them.

## Phase 1 — Foundation

### Gate commands and results

| Command | Result |
| --- | --- |
| `cmd /c "npm run typecheck"` | clean (strict TypeScript, no errors) |
| `cmd /c "npm test"` | **6 files, 43 tests, all passed** (Vitest 5.0.5, jsdom) |
| `cmd /c "npm run build"` | built in 3.65 s — `index.html` 1.95 kB, CSS 10.23 kB (3.20 kB gzip), JS 129.67 kB (33.65 kB gzip, includes all three dictionaries) |
| `cmd /c "npx playwright test"` | **10 passed** (5 tests × desktop + mobile projects, 28.2 s) |

### Unit tests (`tests/unit/`)

| File | What it proves |
| --- | --- |
| `dicts.test.ts` | 617 keys in English; Urdu/Hindi key sets are **exactly** the English set; no empty values; brand name is the new app name in all three languages |
| `i18n.test.ts` | `t()` returns current language, falls back to the key; `fmt()` interpolation incl. null vars; `setLanguage()` updates `html[lang]`/`html[dir]`, persists, falls back to English for unknown codes; subscribers fire and unsubscribe; `apply()` translates attribute / valueless / placeholder / input-value forms; on-demand Urdu font `<link>` |
| `display.test.ts` | `getDisplayName()` — Urdu/Hindi spellings preferred, English fallback, never borrows the wrong script |
| `theme.test.ts` | Saved choice beats OS preference; first visit follows OS without writing storage; toggle flips and persists; works with storage unavailable |
| `modal.test.ts` | Dialog renders with `aria-modal`/`aria-labelledby`; focus restored to opener; Escape and backdrop close when dismissible; focus trap wraps Tab/Shift+Tab; `onClose` fires once; one dialog at a time |
| `toast.test.ts` | Message + role, auto-dismiss timing (success 4.2 s / error 7 s), sticky toasts, close button, stacking order |

### End-to-end tests (`tests/e2e/boot.spec.ts`, run in both projects)

| Test | What it proves |
| --- | --- |
| boots the shell in English | Brand renders, `html[lang=en][dir=ltr]`, boot state visible, language select and theme state correct, **tree canvas computed direction is LTR**, no uncaught page errors |
| language switcher | Urdu selected → brand and boot text in Urdu, `html[dir=rtl]`, canvas still computed LTR, choice survives a reload |
| theme toggle | Light → dark → persisted after reload → back to light |
| OS dark preference | Fresh browser context with `colorScheme: dark` boots dark on the first visit |
| keyboard reach | First two Tab stops are the language select and the theme toggle |

### Visual review (browser screenshots, not a pass/fail test)

`node scripts/screenshots.mjs` captured desktop and mobile screenshots in
English and Urdu, light and dark. Reviewed by eye: palette, brand mark, RTL
layout flip with the canvas host unaffected, mobile header fit. Screenshots are
kept out of the repository (`screenshots/` is git-ignored).

### Not yet tested (tracked, not hidden)

- **No physical-device run yet.** Mobile testing is Chromium emulation of a
  Pixel 7 viewport with touch events enabled.
- **No live Supabase interaction at all** — Phase 1 makes no backend calls
  (fonts are the only network request). Auth and data arrive in Phase 2 with
  the owner's test account.
- **No service-worker/PWA testing yet** (Phase 6).
- Urdu/Hindi copy is reviewed for key parity, not by a native speaker yet
  (flagged in `docs/PLAN.md`).

## Manual checks that were performed

- The security scan of the reference (`scan_security.cjs`, Phase 0) covered the
  old codebase; the new codebase grows its own scan in the security phase.
- `grep`-level check: no `.env` file exists in the repository and no service-role
  key or password string appears anywhere in `src/` or `dist/`.
