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
| A4 | Sign out clears all data | `clearTree()` wipes model, panel, table, channel, photo cache (`js/app.js`) | **in progress** (Phases 2–4 — session, profile and chip cleared, the tree workspace (model, renderer, panzoom) is disposed on sign-out, and the photo URL cache is keyed to the session user and dropped when the user changes; reload stays signed out (E2E). The realtime channel does not exist yet — it arrives with realtime in Phase 5 and must be disposed too) |
| A5 | Inactive account handling | Profile with `active=false` → signed out with explanation; invite links exempt until password set (`js/auth.js`) | **done** (Phase 2 — E2E: inactive + missing profile → quiet sign-out with notice, workspace hidden, survives reload; inactive invitee gets the notice after setting a password) |
| A6 | Own profile edit | Full name + language saved to `profiles` (`js/auth.js`) | **done** (Phase 2 — E2E: name + language persist, interface flips RTL, both survive reload) |
| A7 | No public sign-up | Supabase `disable_signup: true`, verified live in Phase 0 | n/a (config — re-checked in Phase 2: the gate offers no sign-up path) |

## Roles and permissions

| # | Feature | Reference behaviour (source) | Status |
| --- | --- | --- | --- |
| B1 | Admin role | Everything, incl. accounts, import, restore (`01_schema.sql`, UI in `js/admin.js`) | **in progress** (Phase 2 — role parsed from the profile, admin tag in the chip, admin-only copy in the profile dialog; the admin panel arrives in Phase 5) |
| B2 | Editor role, branch-limited | `branch_access` anchors; edit = anchor + descendants; mirrors DB `can_edit_person()` in UI (`js/auth.js`) | **in progress** (Phases 2–4 — `branch_access` loaded for editors, `canEditPerson()` mirrors the DB rule (unit-tested); the workspace renders role-appropriate controls (the editor never sees the deleted toggle, E2E); editor write flows are live: add child / edit / add spouse from the branch workspace and a deletion request from the sheet (E2E, mock). Reaching outside the branch is prevented by rendering and enforced by the mock's RLS; a live refusal check awaits Phase 7) |
| B3 | DB-enforced, not UI-only | All rules in RLS + triggers; UI only hides buttons | **in progress** (Phases 2–4 — the mock re-implements the RLS refusals and the Phase 4 write triggers (whitelist, admin-only guard, path cascade, audit) the UI must handle; the E2E write assertions check the raw request bodies the client sent; live enforcement is re-exercised in Phase 7) |

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
| D5 | Photo view / upload / replace / remove / lightbox | panel + `js/photos.js` | **done** (Phase 4 — signed thumbnail in the sheet, upload / replace / remove, zoom lightbox (Escape or backdrop closes); E2E: the upload reaches the card (batch signer) and the panel, remove clears the row reference and deletes the object, the form's own picker/Remove control works through the same save; unit tests cover validation, the signing cache, upload/remove ordering and rollback) |
| D6 | Actions: add child, edit, add root (admin), request deletion (editor), soft delete / restore (admin) | action bar | **done** (Phase 4 — role-gated action bar; every action has an E2E: add child (editor tile + admin sheet), edit, add root, request deletion, soft delete with the living-descendant refusal, restore, show history) |

## Creating and editing

| # | Feature | Reference behaviour (source) | Status |
| --- | --- | --- | --- |
| E1 | One shared add/edit dialog, sectioned | `js/personform.js` | **done** (Phase 4 — one dialog for add child / add root / edit with sections Names / Parents / Spouse / Life events / Notes + photo; the E2E drives all three modes and the duplicate warning stacking over it) |
| E2 | Field whitelist on write; update sends only changed fields | `ALL_FIELDS` + diff | **done** (Phase 4 — a 17-column whitelist in `people.ts`; UPDATE bodies are asserted exactly in E2E (e.g. `{ nick_name, qualification }`); the mock refuses unknown columns like PostgREST does; `parent_id` changes only through an admin move) |
| E3 | Parent assignment: read-only for editors, searchable picker for admins | `parentBlockHtml()` | **done** (Phase 4 — editors see the parent read-only, admins get a searchable picker whose choice writes `parent_id`; E2E: the move patch is exactly `{ parent_id }`) |
| E4 | Validation: name + gender required, future dates, death-before-birth | `validate()` | **done** (Phase 4 — inline field errors + one toast and nothing written (E2E); the date rules are unit-tested) |
| E5 | Duplicate name+parent warning (warn, never block) | `duplicateOf()` | **done** (Phase 4 — the warning stacks over the still-open form; cancel keeps everything, confirm saves (E2E both ways); the finder is unit-tested) |
| E6 | New child defaults father/mother from parent + spouse | `valuesForNewChild()` | **done** (Phase 4 — unit-tested, including the unknown-gender guess; the editor E2E asserts the defaults reach the insert) |
| E7 | Photo picked in form: 800 px resize, 3 MB limit, upload after save | `Photos.prepareFile` | **done** (Phase 4 — picker with preview inside the dialog; the file is downscaled to 800 px, capped at 3 MB and uploaded after the row is saved; E2E: choose → save → re-open → remove) |
| E8 | Remove stored photo (delete object after row updated) | `photos.js` `remove()` | **done** (Phase 4 — the row is cleared first, the object second (best effort); E2E records both the `{ photo_path: null }` patch and the object deletion) |
| E9 | Add spouse (text fields through the same form) | branch tile action + form | **done** (Phase 4 — "Add a spouse" opens the same form; E2E writes exactly `{ spouse_name }`; the button hides when a spouse exists) |

## Deletion, history, restoration

| # | Feature | Reference behaviour (source) | Status |
| --- | --- | --- | --- |
| F1 | Editor files a deletion request with a reason | `deletion_requests` insert | **done** (Phase 4 — the dialog requires the reason; E2E asserts the row shape `{ person_id, reason, status: 'pending' }`; the admin queue is F2, Phase 5) |
| F2 | Admin queue approves/rejects; approve soft-deletes | admin tab | planned |
| F3 | Admin soft-delete / restore from the panel | `is_deleted` update | **done** (Phase 4 — E2E: a childless person is deleted and restored, the patch log is exactly `is_deleted` true → false; the buttons are admin-only even with `#show-deleted` on) |
| F4 | Living-descendant guard on soft delete | client rule | **done** (Phase 4 — the refusal dialog carries the computed descendant / living counts (E2E: 9 / 8) and nothing is written; it walks the visible model exactly like the reference — a documented simplification) |
| F5 | Change history with field diffs + restore a version | `audit_log` read + replay | **done** (Phase 4 — newest-first (limit 200), rows expand to labelled field diffs, "Restore this version" only on update rows that carry `old_data`; the E2E restores and asserts the exact write; `restorePayloadFromAudit` is unit-tested including the admin-only parent) |
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
| I1 | Private bucket, per-person folder, signed URLs, cache, batch signing | `js/photos.js`, `03_storage.sql` | **done** (Phase 4 — private `photos` bucket, keys `<person-uuid>/<file>`, signed URLs (TTL 3600 s) with an in-memory cache and a batch signer for tree cards, 3 MB cap + 800 px downscale before upload; E2E: upload → card + panel, lightbox, remove; the mock mirrors object presence on signed reads) |

## Languages

| # | Feature | Reference behaviour (source) | Status |
| --- | --- | --- | --- |
| J1 | English / Urdu / Hindi, 617 keys each, English fallback | `js/i18n.js` | **done** (Phase 1 — engine + generated dictionaries, parity tests in `tests/unit/dicts.test.ts`, `i18n.test.ts`; views consume `t()` as they land) |
| J2 | Localized displayed names (ur/hi with English fallback) | `dispName()` | **done** (Phase 1 — shared `getDisplayName()` in `src/core/i18n/display.ts`, tested) |
| J3 | RTL layout for Urdu; tree canvas stays LTR | `dir=rtl`, logical CSS | **in progress** (Phases 1–4 — the document, gate, header, toolbar, sidebar and details sheet flip RTL; the tree stage keeps `dir=ltr` so the genealogy stays left-to-right; boot specs assert the canvas direction, the Urdu workspace was confirmed in the visual review, and a Phase 4 RTL pass spot-checked the new form, history box and branch workspace (screenshot review; a native-speaker copy review is still pending)) |
| J4 | Lazy per-language fonts (Naskh/Nastaliq/Devanagari) | `loadFonts()` | **done** (Phase 1 — on-demand stylesheet loading, tested) |
| J5 | Language persisted in profile + localStorage; re-render on change | `setLanguage()` + `i18n:change` | **done** (Phases 1–2 — localStorage persistence + `i18n:change` re-render hook; a signed-in header choice is written to `profiles`, and the saved profile language wins at boot; E2E both directions) |

## Branch workspace (guided completion)

| # | Feature | Reference behaviour (source) | Status |
| --- | --- | --- | --- |
| K1 | Editor lands in branch workspace after sign-in | `js/branch.js` | **done** (Phase 4 — an active editor lands in the branch workspace at sign-in (E2E); admins always land in the tree and never see the branch tab) |
| K2 | Anchor shown; multi-branch chooser | workspace | **done** (Phase 4 — the hero shows the assigned anchor (name + birth date, E2E); several assignments render a chooser that switches the grid (E2E with a two-branch fixture)) |
| K3 | Completeness per person, live from saved fields | `completeness()` | **done** (Phase 4 — counts only really-saved fields (unit-tested); the E2E stats read 10 / 0 / 10 for the fixture branch) |
| K4 | Progress bar, all/missing/done filters, next-incomplete | workspace | **done** (Phase 4 — progress bar with the "N of M people look complete" line, All / Needs details / Complete segment counts, "Next person with gaps" jumps and toasts; E2E) |
| K5 | Tile actions: edit details, add child, add spouse | workspace | **done** (Phase 4 — Add details (edit), Add child and Add a spouse when there is none; all three E2E-exercised and gated by `canEdit`) |
| K6 | No valid assignment → clear message, never wider access | workspace | **done** (Phase 4 — an active editor with no assignment sees the honest hero and can open the tree (E2E); stale anchor ids are dropped quietly) |

## Tools (Extras)

| # | Feature | Reference behaviour (source) | Status |
| --- | --- | --- | --- |
| L1 | How are we related (kinship terms, path chain) | `js/extras.js` | **done** (Phase 5 - pure walker in `src/features/extra/kinship.ts` (`chainOf` prefers the database `path`, falls back to the parent walk; structured `RelationResult` with term + common ancestor + spoken-around-the-loop chain + one-distance sentence), rendered by the tabs in `src/features/extra/modal.ts` with the same pick persistence across opens as the reference singleton. One documented correction: the ancestor-side branch of the reference gendered father/mother/dada by the *picked first* person's sex (a woman picking her grandfather got "Dadi"); this port keys the word on the person being named, like every other branch. Unit-tested term by term (dada/nana split, chacha/phupho, cousins, honest approximates) |
| L2 | Upcoming 30 days (birthdays + remembrances; year-only dates excluded) | `js/extras.js` | **done** (Phase 5 - pure `buildUpcoming(model, today)` takes today as a parameter; full `dob_iso` only (year-only dates excluded as in the reference), the deceased's birthday skips, remembrance years counted from `dod`, window rolls the year when the date has passed; the names are goto-person buttons that select the person on the tree and close the tools. One deliberate divergence: the list is rebuilt on every open (a pure model walk) instead of the reference's page-life cache that went silently stale after edits. E2E pins the clock to prove the window is date-deterministic) |
| L3 | Statistics (per generation, gender, oldest/youngest, places, most children) | `js/extras.js` | **done** (Phase 5 - pure `buildStats(model, now?)`: visible people only, generation + gender counts as bars, oldest/youngest living people by full dates only (ages honest, partial dates excluded), top-5 birthplaces and most-children with the reference's alphabetical tiebreak. Every stat asserted against the fixture in unit and E2E tests) |
| L4 | Print view + PNG export of the tree | `printTree`/`exportPng` | **done** (Phase 5 - print: the tools fill a `#print-head` line (brand title, date, the same member/generation/source subtitle as the header), then close and call `window.print` 60 ms later; the print stylesheet (`src/styles/print.css`) hides the app chrome and prints the laid-out tree exactly as rendered, pan/zoom cancelled. The PNG redraws the workspace's **live layout** (collapse state and filters included, as the reference: "the picture matches what is on screen") at 2x scale on a canvas with the same fonts/tokens, edges drawn with the interactive view's own elbow geometry, and downloads `Nahri_Family_Tree_<date>.png` (the reference's `Family_Tree_<date>.png` adapted to this brand). Empty trees toast honestly; both actions close the modal only on success, as the reference does) |

## Platform

| # | Feature | Reference behaviour (source) | Status |
| --- | --- | --- | --- |
| M1 | Light/dark theme, remembered | `ft-theme` localStorage | **done** (Phase 1 — pre-paint resolution, saved choice beats OS, persistence; unit + E2E tests) |
| M2 | Installable PWA, offline app shell, Supabase/CDN never cached | `sw.js`, manifest | planned |
| M3 | Realtime updates (people channel) + 60 s poll fallback | `startLiveUpdates()` | planned |
| M4 | Manual refresh keeping selection | `syncFromServer()` | planned |
| M5 | Mobile filter drawer, 360 px usable | drawer | **done** (Phase 3 — the sidebar becomes a drawer under 980 px with a backdrop and a toolbar toggle; opened in E2E on the Pixel 7 project and reviewed as a screenshot; the 360 px worst case is swept in Phase 6) |
| M6 | Accessibility: focus rings, keyboard, aria labels, reduced motion | partly present | **in progress** (Phases 1–4 — focus-visible rings, modal focus trap + restore, gate keyboard chain (E2E); tree cards are keyboard-reachable and Enter opens the sheet (E2E), toggles and zoom buttons carry labels, reduced-motion CSS is in place and the Phase 3.5 canvas tweens check the same preference in JS (`core/motion.ts`, unit-tested); Phase 4 adds the dialog stack (lower dialogs `inert`, focus restored per dialog, unit-tested) and labelled form + photo controls; per-view work continues) |
| M7 | Toast + empty + loading + error states everywhere | yes | **in progress** (Phases 1–4 — toast host; gate loading/verifying/unavailable with a working retry; inline form messages; the tree has loading, an honest empty state, and a load-error banner with retry (E2E fault injection); Phase 4 adds form validation messages, save / photo / restore toasts, the branch loading + no-assignment states and photo empty states (E2E); view-level states continue in Phase 5) |

## Deliberately not carried over

| Item | Why |
| --- | --- |
| `js/New Text Document.txt` | stray empty file, nothing reads it |
| Embedded spreadsheet fallback | the app is Supabase-only by design |
| The reference's patched gesture code | replaced by one controller (see `docs/PLAN.md` §4) |
| Real family data files (`.xlsx`, seed SQL with names) | private data stays in Supabase / the owner's machine; never committed here |
