# Setup

How to install, configure and run the Nahri Family app on a development machine.

## Prerequisites

| Tool | Version used | Notes |
| --- | --- | --- |
| Node.js | 24.19.0 (tested) | `>=20.19` required by Vite 8 |
| npm | 11.17.0 (tested) | ships with Node |

On Windows PowerShell, if `npm` reports that `npm.ps1` cannot be loaded, run
commands through `cmd /c "npm ..."` (execution-policy guard) — this is what the
test logs in `docs/TESTING.md` do.

## Install

```sh
npm install
```

For the end-to-end tests, install the Playwright browser once:

```sh
npx playwright install chromium
```

## Configuration

Copy `.env.example` to `.env` only if you want to point the app at a different
Supabase project or keep environment values in a file:

```sh
cp .env.example .env    # then edit the two values
```

- `VITE_SUPABASE_URL` — project URL.
- `VITE_SUPABASE_ANON_KEY` — the **publishable** (anon) key.

Both values are public by design and are compile-safe to ship: they are
protected by Row Level Security, not by secrecy. Without a `.env` the app uses
the family project defaults compiled into `src/core/config.ts`. The
**service-role key must never appear in this repository or the bundle** — it
belongs only in the server-side environment of the `admin-users` Edge Function
(see `docs/SUPABASE.md`).

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on http://localhost:5173 |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build on http://localhost:4173 |
| `npm run typecheck` | `tsc --noEmit` over `src/` and `tests/` (strict) |
| `npm test` | Unit tests (Vitest + jsdom) |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run e2e` | End-to-end tests against the production build (Playwright, desktop + mobile Chrome) |
| `npm run e2e:server` | What Playwright starts: build + preview on :4173 |
| `npm run check` | typecheck + unit tests + build (the gate used before every commit) |
| `npm run extract:i18n` | Regenerate `src/core/i18n/dict.*.ts` from the reference app's `js/i18n.js` (see below) |
| `node scripts/screenshots.mjs` | Capture design-review screenshots of the running app (start `npm run e2e:server` first) |

## Project layout

```
index.html                  entry HTML (theme resolved before first paint)
src/
  main.ts                   bootstrap
  app.ts                    application shell (header, view host, toasts)
  core/
    config.ts               app name, Supabase endpoint defaults, storage keys
    types.ts                Lang, PersonNameFields
    storage.ts              localStorage access that never throws
    i18n/
      index.ts              i18n engine (port of the reference behaviour)
      display.ts            getDisplayName() shared by every view
      dict.en|ur|hi.ts      GENERATED dictionaries (617 keys each)
  shell/header.ts           brand, language switcher, theme toggle
  ui/
    dom.ts                  h()/svgIcon() helpers
    theme.ts                light/dark controller + persistence
    toast.ts                toast host
    modal.ts                modal dialog with focus trap
  styles/                   tokens.css, base.css, components.css, shell.css
scripts/
  extract-i18n.mjs          dictionary generator (runs against the reference clone)
  screenshots.mjs           design-review screenshots
tests/
  unit/                     Vitest (jsdom) — engine and component logic
  e2e/                      Playwright — real browser against the production build
```

## Regenerating the i18n dictionaries

The dictionaries are generated from the read-only reference clone so that the
translated copy ported in Phase 0 is reproducible rather than hand-copied:

```sh
npm run extract:i18n -- ../reference/js/i18n.js
```

The script validates key parity across `en`/`ur`/`hi` and fails loudly if the
source is corrupted. It also applies the new app's brand name (see the
`RENAMES` table in the script). **Do not edit `dict.*.ts` by hand.**

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Port already in use | Both dev (5173) and preview (4173) use `strictPort`; stop the other process or edit `vite.config.ts` |
| E2E hangs on start | The webServer runs `vite build` first — give the first run up to the 180 s timeout; later runs reuse the server if one is up |
| Blank page in dev | Check the browser console; the app throws a visible error if `#app` is missing from `index.html` |
| Urdu shows square boxes | The Naskh/Nastaliq fonts load from Google Fonts on demand; without network access the fallback system font is used |
