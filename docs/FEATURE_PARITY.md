# Feature parity inventory

Reference = `claudemail605-creator/FamilyTree` (branch `master`), inspected in Phase 0.
Status values: **planned**, **in progress**, **done** (with the evidence in `docs/TESTING.md`),
**blocked** (with the reason).

This table is updated at the end of every phase — no row is marked done without a
test that exercised it.

## Authentication and accounts

| # | Feature | Reference behaviour (source) | Status |
| --- | --- | --- | --- |
| A1 | Sign in (email + password) | Gate blocks the app; friendly errors; show/hide password (`js/auth.js`) | **done** (Phase 2 — E2E success/failure/empty fields/retry, unit error mapping + controller lifecycle) |
| A2 | Forgot password → reset email | `resetPasswordForEmail` with redirect back to the app (`js/auth.js`) | **done** (Phase 2 — E2E: request confirmed, back to sign-in; the mock accepts `recover` and sends no mail, so real delivery is untested) |
| A3 | Invitation / recovery link → set password | `type=invite\|recovery` detected before supabase-js strips the URL; expired link message (`js/supabase.js`, `js/auth.js`) | **done** (Phase 2 — E2E invite-link flow + expired-link notice; unit: `PASSWORD_RECOVERY` event, URL strip, sentinels; the recovery e-mail round-trip itself is untested) |
| A4 | Sign out clears all data | `clearTree()` wipes model, panel, table, channel, photo cache (`js/app.js`) | **in progress** (Phases 2–3 — session, profile and chip cleared, and the tree workspace (model, renderer, panzoom) is disposed on sign-out; reload stays signed out (E2E). The photo cache arrives with photos in Phase 4) |
| A5 | Inactive account handling | Profile with `active=false` → signed out with explanation; invite links exempt until password set (`js/auth.js`) | **done** (Phase 2 — E2E: inactive + missing profile → quiet sign-out with notice, workspace hidden, survives reload; inactive invitee gets the notice after setting a password) |
| A6 | Own profile edit | Full name + language saved to `profiles` (`js/auth.js`) | **done** (Phase 2 — E2E: name + language persist, interface flips RTL, both survive reload) |
| A7 | No public sign-up | Supabase `disable_signup: true`, verified live in Phase 0 | n/a (config — re-checked in Phase 2: the gate offers no sign-up path) |

## Roles and permissions

| # | Feature | Reference behaviour (source) | Status |
| --- | --- | --- | --- |
| B1 | Admin role | Everything, incl. accounts, import, restore (`01_schema.sql`, UI in `js/admin.js`) | **in progress** (Phase 2 — role parsed from the profile, admin tag in the chip, admin-only copy in the profile dialog; the admin panel arrives in Phase 5) |
| B2 | Editor role, branch-limited | `branch_access` anchors; edit = anchor + descendants; mirrors DB `can_edit_person()` in UI (`js/auth.js`) | **in progress** (Phases 2–3 — `branch_access` loaded for editors, `canEditPerson()` mirrors the DB rule (unit-tested); the workspace renders role-appropriate controls (the editor never sees the deleted toggle, E2E); write flows arrive in Phase 4) |
| B3 | DB-enforced, not UI-only | All rules in RLS + triggers; UI only hides buttons | **in progress** (Phase 2 — the mock re-implements the RLS refusals the UI must handle; live enforcement is re-exercised in Phase 7) |

## Tree

| # | Feature | Reference behaviour (source) | Status |
| --- | --- | --- | --- |
| C1 | Live tree from Supabase, 1000-row paging | `fetchAllPeople` paged select (`js/app.js`) | **done** (Phase 3 — `src/data/people.ts` pages through 1000-row windows with a unique `dob`+`id` order (unit-tested with a stub builder); the workspace loads the fixtures and rebuilds on every visibility change; live-backend paging is re-exercised in Phase 7) |
| C2 | Subtree-width top-down layout | Deterministic layout function (`js/app.js` `layout()`) | **done** (Phase 3 — `src/features/tree/layout.ts`; unit tests cover couple widths, parent centring, band re-anchoring; the E2E fixture tree renders all 13 positions with connectors) |
| C3 | Collapse / expand with keep-position | Toggle keeps the clicked card stationary (`js/app.js`) | **done** (Phase 3 — collapsing hides the subtree and keeps the clicked card within 2 px of its screen position (E2E, desktop + mobile); the toggle shows the hidden direct-children count) |
| C4 | Spouse cards beside partner | Spouse text columns drawn as a card pair (`js/app.js`) | **done** (Phase 3 — dashed spouse card beside the partner, never a person row; E2E asserts the pair, unit layout tests widen the node) |
| C5 | Gender styling + deceased marker | Gender colour classes, † marker | **done** (Phase 3 — gender rail + initials classes (`pcard--male/female`) and the † marker; E2E snapshots + the light/dark visual review) |
| C6 | Generation bands | Background band per generation | **done** (Phase 3 — one band per generation, labelled on even generations; E2E counts 3 bands for the fixture tree) |
| C7 | Pan / pinch-zoom / wheel / double-tap / tap-select | Pointer-event handlers with drag threshold (historically patched 3×) | **done** (Phase 3 — one `PanZoomController`: drag-vs-tap threshold, pinch around the focal point, wheel, double-tap, tap-select — all unit-tested; E2E exercises tap-select and double-click zoom in Chromium desktop + Pixel 7 emulation. A physical-device gesture pass is still pending, L3) |
| C8 | Zoom controls + fit + reset | Buttons, fit-never-below-0.55 scale (`js/app.js`) | **done** (Phase 3 — toolbar − / + / fit wired to the controller; E2E: zoom-in raises, zoom-out restores; the fit clamps (never above 1, readable minimum) are unit-tested) |
| C9 | Expand all / collapse all | Buttons | **done** (Phase 3 — E2E: collapse-all leaves the two roots, expand-all restores all 13) |
| C10 | Hover tooltip (desktop) + spouse tooltip | `showTip`/`showSpouseTip` | **done** (Phase 3 — hover tooltip with the generation label and the spouse line; the mobile project skips hover by design) |
| C11 | Selection sync (tree ↔ panel ↔ table) | `select()` | **done** (Phase 3 — canvas, details sheet and table rows all share one selection; E2E: card → sheet, table row → sheet, relative button → canvas pulse) |
| C12 | Focus a person (expand ancestors, clear hiding filters, centre, pulse) | `focusPerson()` | **done** (Phase 3 — a hidden relative clears the hiding filters with the `generic.filtersCleared` toast, the person is centred at a readable scale and pulses; E2E end-to-end) |
| C13 | Soft-deleted visible only to admin, on request | `showDeleted` toggle | **done** (Phase 3 — soft-deleted rows never enter the model for members/editors; admins get `#show-deleted`, which rebuilds (14 ↔ 13, E2E both roles)) |
| C14 | Load-error banner with retry (not a vanishing toast) | `showLoadError()` | **done** (Phase 3 — a persistent `#load-error` banner with retry; E2E injects a one-shot failure and recovers) |

## Person profile (detail panel)

| # | Feature | Reference behaviour (source) | Status |
| --- | --- | --- | --- |
| D1 | Personal / Family / Passing / Record sections | `renderPanel()` (`js/app.js`) | **done** (Phase 3 — Personal / Family / Relatives / Record as bordered rows; E2E asserts name, age at death, children count and birthplace) |
| D2 | Relatives with navigation (parent, siblings, children) | `relBtns` → `select(goto)` | **done** (Phase 3 — a relative button moves the selection and pulses the target card (E2E); panels never render a whole list into the tree) |
| D3 | Localized-name sections (ur/hi) | panel sections | **done** (Phase 3 — every name goes through `getDisplayName()` (Urdu/Hindi preferred, never the wrong script); unit tests + the Urdu visual review) |
| D4 | Last edited + who (audit, admin) | `hydrateLastEdited()` | **done** (Phase 3 — admins get the newest `audit_log` row merged into the Record line; E2E asserts "by Family Admin"; non-admins keep the plain timestamp) |
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
| G1 | Search across English/Urdu/Hindi names + nick, spouse, places, dates (multi-term AND) | `_hay` haystack | **done** (Phase 3 — the haystack is built in the model and lower-cased with the query (a real case bug fixed); unit tests cover multi-term AND and cross-script queries; E2E: `gul` → 1 of 13 with the honest empty state for no matches) |
| G2 | Generation / gender chips, status, branch, pob, qual, has-* | sidebar | **done** (Phase 3 — chips + selects in the sidebar/mobile drawer; E2E: Gen 4 → 2, deceased → 4, branch → 7; the remaining predicates are unit-tested) |
| G3 | Filters re-attach matches to nearest visible ancestor | `computeVisibility()` | **done** (Phase 3 — unit-tested rules: matches re-attach upward unless an ancestor already matches, the branch person stays visible, soft-deleted stay out) |
| G4 | Result count + reset all | sidebar | **done** (Phase 3 — "Showing all N" / "X of N" updated on every change and asserted in each filter E2E; reset restores) |
| G5 | Table view: 23 columns, translated headers, sortable | `renderTable()` | **done** (Phase 3 — 23 headers, sort toggles with `aria-sort`, row selection synced with the sheet; E2E) |
| G6 | Table pagination | **absent in reference** (all rows rendered) | planned (new — Phase 5; the Phase 3 table renders every row like the reference and shows the filtered set only while filters are active) |

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
| J3 | RTL layout for Urdu; tree canvas stays LTR | `dir=rtl`, logical CSS | **in progress** (Phases 1–3 — the document, gate, header, toolbar, sidebar and details sheet flip RTL; the tree stage keeps `dir=ltr` so the genealogy stays left-to-right; boot specs assert the canvas direction and the Urdu workspace was confirmed in the visual review) |
| J4 | Lazy per-language fonts (Naskh/Nastaliq/Devanagari) | `loadFonts()` | **done** (Phase 1 — on-demand stylesheet loading, tested) |
| J5 | Language persisted in profile + localStorage; re-render on change | `setLanguage()` + `i18n:change` | **done** (Phases 1–2 — localStorage persistence + `i18n:change` re-render hook; a signed-in header choice is written to `profiles`, and the saved profile language wins at boot; E2E both directions) |

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
| M5 | Mobile filter drawer, 360 px usable | drawer | **done** (Phase 3 — the sidebar becomes a drawer under 980 px with a backdrop and a toolbar toggle; opened in E2E on the Pixel 7 project and reviewed as a screenshot; the 360 px worst case is swept in Phase 6) |
| M6 | Accessibility: focus rings, keyboard, aria labels, reduced motion | partly present | **in progress** (Phases 1–3 — focus-visible rings, modal focus trap + restore, gate keyboard chain (E2E); tree cards are keyboard-reachable and Enter opens the sheet (E2E), toggles and zoom buttons carry labels, reduced-motion CSS is in place; per-view work continues) |
| M7 | Toast + empty + loading + error states everywhere | yes | **in progress** (Phases 1–3 — toast host; gate loading/verifying/unavailable with a working retry; inline form messages; the tree has loading, an honest empty state, and a load-error banner with retry (E2E fault injection); view-level states continue in Phase 4) |

## Deliberately not carried over

| Item | Why |
| --- | --- |
| `js/New Text Document.txt` | stray empty file, nothing reads it |
| Embedded spreadsheet fallback | the app is Supabase-only by design |
| The reference's patched gesture code | replaced by one controller (see `docs/PLAN.md` §4) |
| Real family data files (`.xlsx`, seed SQL with names) | private data stays in Supabase / the owner's machine; never committed here |
