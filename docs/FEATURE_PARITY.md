# Feature parity inventory

Reference = `claudemail605-creator/FamilyTree` (branch `master`), inspected in Phase 0.
Status values: **planned**, **in progress**, **done** (with the evidence in `docs/TESTING.md`),
**blocked** (with the reason).

This table is updated at the end of every phase — no row is marked done without a
test that exercised it.

## Authentication and accounts

| # | Feature | Reference behaviour (source) | Status |
| --- | --- | --- | --- |
| A1 | Sign in (email + password) | Gate blocks the app; friendly errors; show/hide password (`js/auth.js`) | planned |
| A2 | Forgot password → reset email | `resetPasswordForEmail` with redirect back to the app (`js/auth.js`) | planned |
| A3 | Invitation / recovery link → set password | `type=invite\|recovery` detected before supabase-js strips the URL; expired link message (`js/supabase.js`, `js/auth.js`) | planned |
| A4 | Sign out clears all data | `clearTree()` wipes model, panel, table, channel, photo cache (`js/app.js`) | planned |
| A5 | Inactive account handling | Profile with `active=false` → signed out with explanation; invite links exempt until password set (`js/auth.js`) | planned |
| A6 | Own profile edit | Full name + language saved to `profiles` (`js/auth.js`) | planned |
| A7 | No public sign-up | Supabase `disable_signup: true`, verified live in Phase 0 | n/a (config) |

## Roles and permissions

| # | Feature | Reference behaviour (source) | Status |
| --- | --- | --- | --- |
| B1 | Admin role | Everything, incl. accounts, import, restore (`01_schema.sql`, UI in `js/admin.js`) | planned |
| B2 | Editor role, branch-limited | `branch_access` anchors; edit = anchor + descendants; mirrors DB `can_edit_person()` in UI (`js/auth.js`) | planned |
| B3 | DB-enforced, not UI-only | All rules in RLS + triggers; UI only hides buttons | planned |

## Tree

| # | Feature | Reference behaviour (source) | Status |
| --- | --- | --- | --- |
| C1 | Live tree from Supabase, 1000-row paging | `fetchAllPeople` paged select (`js/app.js`) | planned |
| C2 | Subtree-width top-down layout | Deterministic layout function (`js/app.js` `layout()`) | planned |
| C3 | Collapse / expand with keep-position | Toggle keeps the clicked card stationary (`js/app.js`) | planned |
| C4 | Spouse cards beside partner | Spouse text columns drawn as a card pair (`js/app.js`) | planned |
| C5 | Gender styling + deceased marker | Gender colour classes, † marker | planned |
| C6 | Generation bands | Background band per generation | planned |
| C7 | Pan / pinch-zoom / wheel / double-tap / tap-select | Pointer-event handlers with drag threshold (historically patched 3×) | planned |
| C8 | Zoom controls + fit + reset | Buttons, fit-never-below-0.55 scale (`js/app.js`) | planned |
| C9 | Expand all / collapse all | Buttons | planned |
| C10 | Hover tooltip (desktop) + spouse tooltip | `showTip`/`showSpouseTip` | planned |
| C11 | Selection sync (tree ↔ panel ↔ table) | `select()` | planned |
| C12 | Focus a person (expand ancestors, clear hiding filters, centre, pulse) | `focusPerson()` | planned |
| C13 | Soft-deleted visible only to admin, on request | `showDeleted` toggle | planned |
| C14 | Load-error banner with retry (not a vanishing toast) | `showLoadError()` | planned |

## Person profile (detail panel)

| # | Feature | Reference behaviour (source) | Status |
| --- | --- | --- | --- |
| D1 | Personal / Family / Passing / Record sections | `renderPanel()` (`js/app.js`) | planned |
| D2 | Relatives with navigation (parent, siblings, children) | `relBtns` → `select(goto)` | planned |
| D3 | Localized-name sections (ur/hi) | panel sections | planned |
| D4 | Last edited + who (audit, admin) | `hydrateLastEdited()` | planned |
| D5 | Photo view / upload / replace / remove / lightbox | panel + `js/photos.js` | planned |
| D6 | Actions: add child, edit, add root (admin), request deletion (editor), soft delete / restore (admin) | action bar | planned |

## Creating and editing

| # | Feature | Reference behaviour (source) | Status |
| --- | --- | --- | --- |
| E1 | One shared add/edit dialog, sectioned | `js/personform.js` | planned |
| E2 | Field whitelist on write; update sends only changed fields | `ALL_FIELDS` + diff | planned |
| E3 | Parent assignment: read-only for editors, searchable picker for admins | `parentBlockHtml()` | planned |
| E4 | Validation: name + gender required, future dates, death-before-birth | `validate()` | planned |
| E5 | Duplicate name+parent warning (warn, never block) | `duplicateOf()` | planned |
| E6 | New child defaults father/mother from parent + spouse | `valuesForNewChild()` | planned |
| E7 | Photo picked in form: 800 px resize, 3 MB limit, upload after save | `Photos.prepareFile` | planned |
| E8 | Remove stored photo (delete object after row updated) | `photos.js` `remove()` | planned |
| E9 | Add spouse (text fields through the same form) | branch tile action + form | planned |

## Deletion, history, restoration

| # | Feature | Reference behaviour (source) | Status |
| --- | --- | --- | --- |
| F1 | Editor files a deletion request with a reason | `deletion_requests` insert | planned |
| F2 | Admin queue approves/rejects; approve soft-deletes | admin tab | planned |
| F3 | Admin soft-delete / restore from the panel | `is_deleted` update | planned |
| F4 | Living-descendant guard on soft delete | client rule | planned |
| F5 | Change history with field diffs + restore a version | `audit_log` read + replay | planned |
| F6 | Recently deleted list + restore | admin tab | planned |

## Search, filters, table

| # | Feature | Reference behaviour (source) | Status |
| --- | --- | --- | --- |
| G1 | Search across English/Urdu/Hindi names + nick, spouse, places, dates (multi-term AND) | `_hay` haystack | planned |
| G2 | Generation / gender chips, status, branch, pob, qual, has-* | sidebar | planned |
| G3 | Filters re-attach matches to nearest visible ancestor | `computeVisibility()` | planned |
| G4 | Result count + reset all | sidebar | planned |
| G5 | Table view: 23 columns, translated headers, sortable | `renderTable()` | planned |
| G6 | Table pagination | **absent in reference** (all rows rendered) | planned (new) |

## Admin tools

| # | Feature | Reference behaviour (source) | Status |
| --- | --- | --- | --- |
| H1 | Users list + last sign-in (Edge Function) | `js/admin.js` + `admin-users` fn | planned |
| H2 | Invite: email, name, role, branch picker, send email or temp password | invite dialog | planned |
| H3 | Edit user, resend invite, set temp password, activate/deactivate | dialogs | planned |
| H4 | Branch progress per editor (anchor, counts, completeness, sign-in) | admin tab | planned |
| H5 | Activity feed (100 entries, field diffs) | admin tab | planned |
| H6 | Excel import: preview with problems (dup IDs, unknown parents, bad dates, gender, no name), parents-first, optional update-existing | `parseWorkbook` + `runImport` | planned |
| H7 | Excel export (original 16-column order) | `exportToExcel` | planned |
| H8 | Full JSON backup (people, profiles, branch_access, deletion_requests, audit_log) | `downloadBackup` | planned |

## Photos (Storage)

| # | Feature | Reference behaviour (source) | Status |
| --- | --- | --- | --- |
| I1 | Private bucket, per-person folder, signed URLs, cache, batch signing | `js/photos.js`, `03_storage.sql` | planned |

## Languages

| # | Feature | Reference behaviour (source) | Status |
| --- | --- | --- | --- |
| J1 | English / Urdu / Hindi, 617 keys each, English fallback | `js/i18n.js` | **done** (Phase 1 — engine + generated dictionaries, parity tests in `tests/unit/dicts.test.ts`, `i18n.test.ts`; views consume `t()` as they land) |
| J2 | Localized displayed names (ur/hi with English fallback) | `dispName()` | **done** (Phase 1 — shared `getDisplayName()` in `src/core/i18n/display.ts`, tested) |
| J3 | RTL layout for Urdu; tree canvas stays LTR | `dir=rtl`, logical CSS | **in progress** (Phase 1 — document direction flip and LTR canvas host verified in E2E; the real canvas arrives in Phase 3) |
| J4 | Lazy per-language fonts (Naskh/Nastaliq/Devanagari) | `loadFonts()` | **done** (Phase 1 — on-demand stylesheet loading, tested) |
| J5 | Language persisted in profile + localStorage; re-render on change | `setLanguage()` + `i18n:change` | **in progress** (Phase 1 — localStorage persistence + `i18n:change` re-render hook done and tested; profile-language sync lands with auth in Phase 2) |

## Branch workspace (guided completion)

| # | Feature | Reference behaviour (source) | Status |
| --- | --- | --- | --- |
| K1 | Editor lands in branch workspace after sign-in | `js/branch.js` | planned |
| K2 | Anchor shown; multi-branch chooser | workspace | planned |
| K3 | Completeness per person, live from saved fields | `completeness()` | planned |
| K4 | Progress bar, all/missing/done filters, next-incomplete | workspace | planned |
| K5 | Tile actions: edit details, add child, add spouse | workspace | planned |
| K6 | No valid assignment → clear message, never wider access | workspace | planned |

## Tools (Extras)

| # | Feature | Reference behaviour (source) | Status |
| --- | --- | --- | --- |
| L1 | How are we related (kinship terms, path chain) | `js/extras.js` | planned |
| L2 | Upcoming 30 days (birthdays + remembrances; year-only dates excluded) | `js/extras.js` | planned |
| L3 | Statistics (per generation, gender, oldest/youngest, places, most children) | `js/extras.js` | planned |
| L4 | Print view + PNG export of the tree | `printTree`/`exportPng` | planned |

## Platform

| # | Feature | Reference behaviour (source) | Status |
| --- | --- | --- | --- |
| M1 | Light/dark theme, remembered | `ft-theme` localStorage | **done** (Phase 1 — pre-paint resolution, saved choice beats OS, persistence; unit + E2E tests) |
| M2 | Installable PWA, offline app shell, Supabase/CDN never cached | `sw.js`, manifest | planned |
| M3 | Realtime updates (people channel) + 60 s poll fallback | `startLiveUpdates()` | planned |
| M4 | Manual refresh keeping selection | `syncFromServer()` | planned |
| M5 | Mobile filter drawer, 360 px usable | drawer | planned |
| M6 | Accessibility: focus rings, keyboard, aria labels, reduced motion | partly present | **in progress** (Phase 1 — focus-visible rings, modal focus trap + restore, labelled controls, reduced-motion CSS, keyboard E2E check; per-view work continues) |
| M7 | Toast + empty + loading + error states everywhere | yes | **in progress** (Phase 1 — toast host + boot/loading state; view-level empty/error states land with the views) |

## Deliberately not carried over

| Item | Why |
| --- | --- |
| `js/New Text Document.txt` | stray empty file, nothing reads it |
| Embedded spreadsheet fallback | the app is Supabase-only by design |
| The reference's patched gesture code | replaced by one controller (see `docs/PLAN.md` §4) |
| Real family data files (`.xlsx`, seed SQL with names) | private data stays in Supabase / the owner's machine; never committed here |
