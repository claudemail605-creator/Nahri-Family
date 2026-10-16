# Testing

Every test that exists, how to run it, and what it proved — kept current after
every phase. Every claim in this file corresponds to a command that was really
run; outputs below were copied from the terminal on **2026-10-16**
(Phases 1–3).

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

## Phase 3 — Tree and profiles

### Gate commands and results

| Command | Result |
| --- | --- |
| `cmd /c "npm run typecheck"` | clean (strict TypeScript, no errors) |
| `cmd /c "npm test"` | **17 files, 164 tests, all passed** (Vitest 5.0.5, jsdom) |
| `cmd /c "npm run build"` | `index.html` 1.95 kB, CSS 26.98 kB (6.10 kB gzip), JS 395.10 kB (104.19 kB gzip) |
| `cmd /c "npx playwright test"` | **61 passed, 1 skipped** (31 tests × desktop + mobile projects, ~33 s) — the `vite build --mode e2e` bundle against the mock Supabase on `127.0.0.1:54321`; the skip is the desktop-only hover-tooltip test on the mobile project, by design |

### Unit tests added in Phase 3

| File | What it proves |
| --- | --- |
| `dates.test.ts` | archive date parsing (day-first `DD/MM/YYYY`, `-`/`.` separators, bare year → 1 January, ISO fallback, unusable → null), whole-year ages (living = to today, deceased = at death, unparseable death date → no invented age), timestamp formatting |
| `people.test.ts` | the paged read against a stub query builder: `select *` on `people`, unique `dob`+`id` ordering, 1000-row default pages, one extra request after an exact multiple, the explicit `is_deleted = false` filter for non-admins only, server errors thrown instead of partial data |
| `tree-model.test.ts` | model from raw rows: column mapping, parent/child wiring, generation depth, missing parent → root, rows without id/name dropped, a parent loop parked at the root instead of hanging, soft-deleted handling, stored Gender labels, the lower-cased three-script search haystack, ancestor-chain walk |
| `tree-filters.test.ts` | search (all whitespace-separated terms required, case-insensitive, cross-script queries), generation/gender/status/branch/place/qualification/has-* filters, `isAnyFilterActive`, and the visibility rules (a match re-attaches to the nearest visible ancestor, the branch person stays visible, soft-deleted people stay out). The case-insensitivity test caught a real bug: query terms were never lower-cased in `personMatches` |
| `tree-layout.test.ts` | subtree-width layout: lone card at the origin with PAD, spouse card widens the node, parents centred over their children, generations stacked by band height, bands re-anchored for filtered roots, collapsed subtrees hidden (node itself kept), multiple-root spacing, empty tree, determinism |
| `panzoom.test.ts` | scale clamps (readable minimum, max), zoom keeps the world point under the cursor fixed, out-and-back restores the transform, clamping still moves toward the cursor; tap detection (short still gesture accepted, moved-past-threshold and long-press rejected, mouse threshold tighter than touch); fit rules (never above 1 for a small tree, clamped minimum for a huge tree, first root centred when overflowing sideways, left edge for several roots, top margin for a tall tree) |

### End-to-end tests added in Phase 3 (`tests/e2e/tree.spec.ts`, desktop + mobile)

| Test | What it proves |
| --- | --- |
| renders the family tree with generation bands and spouse cards | 13 people, 3 bands (even generations only), spouse drawn as a card (`Amir`/`Fatima`), the soft-deleted fixture absent; the stage reaches the viewport edge (regression guard for the flex fix below) |
| admin can reveal soft-deleted people | `#show-deleted` → 14 people incl. `Kashif Fixture`; unchecking → 13 |
| editor never sees deleted people or the toggle | role-gated by the model, not by CSS |
| selecting a card opens the details sheet and relatives navigate | sheet shows name, age at death, children count, birthplace; a relative button moves the selection and pulses the card |
| search filters the tree; an impossible search shows the honest empty state | `gul` → 1 of 13, one node; `zzzz` → empty-state note and an empty canvas; clearing restores |
| generation chips and status filters narrow the tree, reset clears them | Gen 4 → 2, deceased → 4, branch `person-b` → 7, reset restores 13 |
| collapse hides a subtree, keeps the card anchored, and expands again | 3 children + 6 descendants hidden (4 nodes remain), toggle label `+ 3`, the clicked card stays within 2 px; re-expand → 13; collapse-all → 2 roots, expand-all → 13 |
| table view shows all 23 columns, sorts, and selects | 23 headers, 13 rows, generation sort ascending/descending (first row flips `person-a` → `person-h`), a row click opens the same sheet (`Saima Fixture`), back to the tree |
| zoom buttons change the scale | `#zoom-in` raises the scale; `#zoom-out` returns to the previous value |
| double-clicking the canvas zooms in | the `dblclick` handler raises the scale |
| hovering a card shows the tooltip (desktop) | Bahadur's tooltip with the generation label (skipped on the mobile project by design) |
| keyboard: a focused card opens on Enter | cards are keyboard-reachable; Enter opens the sheet |
| focusing a filtered-out relative clears the filters with a toast | a hidden relative from the sheet clears the filters, shows the toast, centres the person and pulses the card |
| a failed load shows the retry banner and recovers | injected fault → banner; retry → the tree renders |

### Updated E2E tests

`auth.spec.ts` now targets the workspace account chip (`#account-chip .account-chip__name`, admin tag) instead of the removed profile view; the profile-edit and session tests run against the workspace shell.

### Visual review (screenshots, not pass/fail)

A temporary capture script (deleted after review, deliberately not committed) captured desktop 1440×900 (tree light, details, table, dark, Urdu RTL) and Pixel 7 (tree, details sheet, filter drawer). Reviewed by eye: ledger cards, generation bands, elbow connectors, spouse cards, mobile toolbar wrapping, the drawer, RTL chrome with the canvas staying LTR, the dark palette. The review caught two real bugs, both fixed and re-verified:

1. **Collapse toggle mispositioned** — the node's world offset was counted twice; toggles floated near the wrong card and, on the narrow mobile viewport, sat off-screen (desktop had accidentally contained the wrong position, which is why E2E on desktop alone missed it).
2. **Canvas collapsed to its minimum height on mobile** — `.tree-workspace { height: 100% }` resolved to auto against a flex-sized parent, disabling cross-axis stretch; desktop only looked right because the sidebar's content height happened to fill the gap.

### Phase 3 mock additions (documented, not hidden)

- 14 fictional people (`person-a` … `person-n`, one soft-deleted) across 5 generations, two roots, several spouse pairs; `person-a` carries `updated_at` + one `audit_log` row for the admin "Last edited" line.
- `GET /rest/v1/people` supports `order`, `range` and `is_deleted`; `GET /rest/v1/audit_log` is admin-only — both reproduce the RLS refusals the UI must handle.
- `POST /__mock/fail-people` injects a one-shot read failure scoped per account (`fail@example.test`), so parallel workers cannot consume each other's fault.
- Pinch-zoom maths is unit-tested and tap/click/drag run in Chromium emulation; **no physical-device gesture run has happened** (L3).

## Phase 3.5 — Motion pass (post-Phase-3 polish)

Requested by the owner after Phase 3 ("try to add animations"). Everything is
CSS-driven except the canvas tweens, and everything collapses under
`prefers-reduced-motion: reduce`.

### Gate commands and results

| Command | Result |
| --- | --- |
| `cmd /c "npm run typecheck"` | clean (strict TypeScript, no errors) |
| `cmd /c "npm test"` | **17 files, 171 tests, all passed** (+7: tween maths and `animateTo` interruption/cancellation) |
| `cmd /c "npm run build"` | `index.html` 1.95 kB, CSS 28.18 kB (6.34 kB gzip), JS 396.87 kB (104.84 kB gzip) |
| `cmd /c "npx playwright test"` | **63 passed, 1 skipped** (32 tests × desktop + mobile, ~32 s) against the mock Supabase |

### What was added

| Piece | Where | Behaviour |
| --- | --- | --- |
| Card settle-in | `render.ts` (`previousIds` diff) + `.tree-node.node-in` | ids absent from the previous paint fade in with a 20 ms-staggered cascade; survivors of a repaint never flash. First paint animates the whole tree |
| Eased canvas transitions | `panzoom.ts` `animateTo()` + `tweenTransform()` | the fit button, the focus action and double-click zoom tween (~240–300 ms, ease-out); pan, pinch and wheel stay instant; any gesture, `set()` or newer animation cancels a running tween mid-flight. Target scale is clamped exactly as the instant path |
| Sheet enter/exit | `.details` / `.details--out` keyframes + a timer-driven teardown in `view.ts` | slide-in from the edge (bottom sheet on mobile); close plays 180 ms out, then hides and clears; a re-select during the exit cancels cleanly |
| Tooltip, view switches, hover | `.tooltip` keyframes, `.tree-stage`/`.tw-table` fade, hover-gated card lift, chip/button colour transitions | re-shown hosts re-fade; the card lift exists only where hover exists (`@media (hover: hover)`, so no sticky hover on touch) |
| Reduced motion | `base.css` global override + `core/motion.ts` | CSS animations/transitions collapse to ~0 ms; JS tweens apply instantly; the card stagger is switched off entirely (no content hidden behind a delay) |

### New/updated E2E tests

| Test | What it proves |
| --- | --- |
| motion: chrome animates, and reduced motion switches it off | the computed `animation-duration` of the sheet (240 ms) and a tree card (260 ms) is real; under `emulateMedia({ reducedMotion: 'reduce' })` both collapse (0 ms / ~0) |
| double-clicking the canvas zooms in (eased) | polls until the tween passes the pre-click scale (the previous version asserted the instant transform) |
| selecting a card opens the details sheet... (extended) | closing the sheet still tears it down (hidden + emptied) after the animated exit — guards the timer-driven finish path |

### Real bug found during the visual review (fixed)

Clicking a card while hovering it re-showed the hover tooltip **over the freshly
opened details sheet**: Chrome re-dispatches `mouseover` when the selection ring
repaints under a stationary cursor, and the tooltip handler re-bound it.
Reproduced with a DOM event trace (mouseover → pointerdown-hide → click → hide →
mouseover again), fixed by skipping the tooltip for the selected person
(`view.ts`), and re-verified with the same trace. This predates the motion
pass — the animation just made it visible in a screenshot.

### Visual review (screenshots, not pass/fail)

A temporary script (git-ignored under `test-results/`) captured the tree
mid-stagger, settled, the sheet mid-slide, mid-exit, gone, and a mid-tween zoom
at 1440×900. Reviewed by eye: the cascade is visible without hiding content,
the sheet fades and drifts out, the canvas reclaims the sheet's width cleanly,
and the zoom tween keeps the double-clicked point sensible. `pageerror` count: 0.

## Manual checks that were performed

- The security scan of the reference (`scan_security.cjs`, Phase 0) covered the
  old codebase; the new codebase grows its own scan in the security phase.
- `grep`-level check: no `.env` file exists in the repository and no service-role
  key or password string appears anywhere in `src/` or `dist/`.
