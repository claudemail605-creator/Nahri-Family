# Testing

Every test that exists, how to run it, and what it proved — kept current after
every phase. Every claim in this file corresponds to a command that was really
run; outputs below were copied from the terminal on **2026-10-16**
(Phases 1–2).

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

### End-to-end tests (`tests/e2e/boot.spec.ts`, run in both projects — as of Phase 1; rewritten for the sign-in gate in Phase 2, see below)

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
- **No live Supabase interaction yet** — Phase 2 exercises auth entirely
  against the local mock; live sign-in is blocked until the owner provides a
  test account (`docs/PLAN.md` §9; writes need a separate OK).
- **No real email delivery anywhere** (invite/recovery emails are simulated by
  minting tokens from the mock).
- **No service-worker/PWA testing yet** (Phase 6).
- Urdu/Hindi copy is reviewed for key parity, not by a native speaker yet
  (flagged in `docs/PLAN.md`).

## Phase 2 — Authentication and access

### Gate commands and results

| Command | Result |
| --- | --- |
| `cmd /c "npm run typecheck"` | clean (strict TypeScript, no errors) |
| `cmd /c "npm test"` | **11 files, 94 tests, all passed** (Vitest 5.0.5, jsdom) |
| `cmd /c "npm run build"` | built in ~0.2 s — `index.html` 1.95 kB, CSS 15.22 kB (4.02 kB gzip), JS 363.25 kB (94.15 kB gzip; supabase-js accounts for most of the growth) |
| `cmd /c "npx playwright test"` | **34 passed** (17 tests × desktop + mobile, 19.0 s) — the production build (`vite build --mode e2e`) against the mock Supabase (`tests/mock/supabase-server.mjs` on `127.0.0.1:54321`) |

### Unit tests added in Phase 2

| File | What it proves |
| --- | --- |
| `names.test.ts` | `initials()` skips honorifics, takes two words, handles single names and falls back to `?` |
| `permissions.test.ts` | `canEditPerson()` mirrors the DB `can_edit_person()`: admins always; editors only when a branch anchor is in the ancestor-or-self chain; empty/unknown paths refused |
| `auth-link.test.ts` | Link capture before supabase-js consumes the URL: implicit-flow hash and PKCE query, hash wins, expired-link error codes, `stripAuthParams()` incl. the no-history fallback |
| `auth-errors.test.ts` | GoTrue error shapes → user-facing messages: invalid credentials, unconfirmed/rate-limit, network errors, inactive account, templated fallback |
| `auth-controller.test.ts` (23 tests) | Session lifecycle (loading→sign-in, getSession timeout, sign-in→ready, failed sign-in, inactive/missing profile → quiet sign-out + notice, profile read failure + working retry, stale profile read discarded, token refresh keeps the profile, sign-out clears), links (expired notice, invite keeps the set-password form, `PASSWORD_RECOVERY` event, sentinels + URL strip, inactive invitee), profile writes + branch access, unavailable bootstrap |
| `modal.test.ts` (extended) | Escape closes the dialog **even when focus has left it** (a disabled save button drops focus to the body) |

### End-to-end tests added in Phase 2 (`tests/e2e/auth.spec.ts`; `boot.spec.ts` rewritten for the gate shell)

| Test | What it proves |
| --- | --- |
| sign in → profile → sign out (admin) | Gate → account chip with name + admin tag + profile view; sign-out removes the chip; a reload stays on the gate |
| invalid credentials | Friendly message, button re-enabled, retry possible, workspace never appears |
| empty-field validation | Client-side messages before any server call |
| inactive account | Not-active notice, workspace hidden, a reload does not resurrect the session |
| account with no profile row | Same notice instead of a stuck spinner |
| forgot password | Confirmation shown, never reveals whether the address exists; back to sign-in |
| expired email link | `#error=otp_expired…` in the URL → expired-link notice |
| invite link | Set-password form; too-short and mismatch validation; success enters the app, the URL hash is stripped, and the new password signs in again |
| inactive invitee | Password is set first, then the not-active notice (invitees are exempt until then) |
| profile edit | Name + language written through to the fake database, interface switches direction (RTL), both survive a reload |
| header language choice | Stored on the profile; reload keeps it |
| keyboard through the gate | Email auto-focused; Tab chain email → password → show/hide → submit → forgot → back to the header language select |
| (boot.spec, rewritten) | Shell/gate boot, translations, RTL flip with the LTR canvas host, theme persistence — against the gate shell |

### Visual review (screenshots, not pass/fail)

`node scripts/screenshots.mjs` captured the gate in English and Urdu, light and
dark, desktop and mobile. A temporary signed-in capture script (deleted after
review, deliberately not committed) added the profile view (desktop en light,
Urdu RTL, Urdu dark, mobile) and the profile modal. Reviewed by eye: gate
centring, RTL flip incl. the header, account chip, modal framing. One capture
labelled "mobile en" shows Urdu because the mock keeps the language change made
earlier in the same process — a fixture quirk, not an app bug.

### Deliberate mock simplifications (documented, not hidden)

- Tokens are unsigned JWT-shaped strings and stay valid until the mock process
  restarts (so tests need no cleanup); real GoTrue rotates and expires them.
- `POST /auth/v1/recover` always answers 200 and sends no email.
- The mock re-implements the RLS rules for the two tables the app touches
  (`profiles`, `branch_access`); real enforcement stays in Postgres.

## Manual checks that were performed

- The security scan of the reference (`scan_security.cjs`, Phase 0) covered the
  old codebase; the new codebase grows its own scan in the security phase.
- `grep`-level check: no `.env` file exists in the repository and no service-role
  key or password string appears anywhere in `src/` or `dist/`.
