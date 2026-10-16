# Build plan

The agreed plan for the redesigned Nahri family application. It is deliberately
specific: what will be built, how it will be tested, and what decisions were
made. Open questions for the owner are at the end.

## 1. Objectives and hard constraints

Redesign the UI/UX completely while keeping every useful behaviour of the
reference application; keep the family's existing Supabase project as the only
backend; keep roles and branch limits enforced by the database; test after
every phase; commit and push to `claudemail605-creator/Nahri-Family` only.

Non-negotiables (condensed): no fake data or fake successes, no secrets in the
repo or the bundle, no destructive database operations, no force-push, no
deploying anywhere.

## 2. Architecture

**Stack:** Vite 8 + TypeScript (strict) + zero UI framework. `supabase-js` v2
and SheetJS are the only runtime dependencies; Excel is dynamically imported
only when the admin opens Import/Export.

**Why no framework:** the two heaviest parts of this app are a custom
interaction-driven tree canvas and a precise port of carefully-reviewed
business logic (RLS-respecting writes, audit diffing, import validation,
i18n). A direct-DOM architecture with typed modules ports that logic 1:1,
keeps the bundle small for family members' phones, and removes an entire class
of framework-integration regressions. The design system below gives the same
component discipline a framework would.

**Repository layout**

```text
index.html                  entry (minimal shell; all UI is rendered by src/)
src/
  main.ts                   bootstrap: config check → theme → auth → shell
  config.ts                 env-based config with documented publishable defaults
  core/                     framework-free foundation
    supabase.ts             single client (persistSession, autoRefresh, URL link detect)
    store.ts                observable app state + selectors (single source of truth)
    i18n/                   engine + en.ts / ur.ts / hi.ts dictionaries (ported, 617 keys + new)
    names.ts                getDisplayName(person, lang), initials, gender helpers
    dates.ts                parse/format (DD/MM/YYYY display, ISO for inputs, partial texts)
    dom.ts                  h(), esc(), delegate(), focus trap, dialog/sheet primitives
    theme.ts, toast.ts, modal.ts, events.ts
  data/
    types.ts                Person, Profile, BranchAccess, AuditRow, DeletionRequest, Settings
    people.ts               paged fetch, model build (byId/kids/roots/gen/path), visibility
    profiles.ts, branches.ts, requests.ts, audit.ts, backup.ts
    photos.ts               validate/resize/signed URLs (cache + batch)/upload/remove
    importer.ts             xlsx parse + preview problems + parents-first ordering
    exporter.ts             xlsx export + JSON backup
  features/
    auth/                   gate: sign-in, forgot, set-password, inactive, profile edit
    shell/                  header, command search, nav, drawers, language picker, theme
    tree/                   layout.ts (pure) · render.ts · panzoom.ts (pure-ish controller) ·
                            controls.ts · tooltip.ts · focus.ts
    table/                  sortable table + pagination
    person/                 profile sheet + person form (shared add/edit)
    branch/                 guided branch workspace
    admin/                  users, branch progress, requests, deleted, activity, import/backup
    tools/                  related, upcoming, stats, print/png
  styles/                   tokens.css · base.css · shell.css · tree.css · panel.css ·
                            forms.css · table.css · admin.css · branch.css · print.css
public/                     icons (generated), manifest.webmanifest
tests/
  unit/                     vitest: layout, panzoom math, model, names, dates, kinship,
                            i18n parity, importer validation, completeness
  e2e/                      playwright: full workflows on a mock Supabase + live smoke (gated)
  mocks/                    in-browser Supabase mock (PostgREST semantics subset + auth + storage)
tools/                      make-icons.cjs · scan-security.cjs · scan-i18n.cjs · i18n-extract.cjs
docs/                       this folder
database/                   schema/ storage/ privacy (copied, family data excluded) + migrations/README
supabase/functions/admin-users/   carried over, secrets stay server-side
```

**What is ported vs rewritten**

| Area | Fate |
| --- | --- |
| Supabase queries, write whitelists, paging, error mapping, realtime+poll | ported with the same semantics |
| RLS model, triggers, storage policies | untouched (same project, same schema) |
| Layout algorithm, fit/zoom mathematics, filters, search haystack | ported to typed pure functions with unit tests |
| Gesture handling (the patched part) | **rewritten** as one PanZoomController (see §4) |
| All rendering, CSS, layout, components | **rewritten from scratch** (new design system) |
| i18n dictionaries | extracted mechanically from the reference (script, not retyped), extended |
| Person form, admin, extras, branch workspace | ported logic, re-rendered with new components |
| Import/export | ported (validation rules and ordering kept; they were correct) |

## 3. Design direction — "Ink & Copper Archive"

The reference used warm parchment + forest green + Fraunces. The redesign is
deliberately a different identity:

- **Surfaces:** cool-warm ivory paper (`#f7f5f1`) and white; dark theme is deep
  ink blue-black, not brown. Grid-free, quieter.
- **Primary:** deep archival indigo (`#2b3a5c`-family) — ink-like, trustworthy,
  distinctly not the reference's green. **Accent:** muted copper `#a8623a`
  used sparingly (selection rings, active states, the spouse bond).
- **People colours:** slate-blue (male), dusty rose (female) — softer, higher
  contrast in both themes than the reference's.
- **Type:** `Newsreader` (display serif, literary, optical sizing) for headings
  and names where appropriate; `Public Sans` (neutral, government-grade
  legibility) for UI text. Urdu: Noto Naskh + Nastaliq; Hindi: Noto Sans
  Devanagari, loaded lazily per language as before.
- **Layout language:** an app workspace, not a dashboard. Desktop: slim left
  navigation rail; a centred command search in the header; the tree owns the
  viewport; details open as a right sheet; filters open in a left drawer.
  Mobile: compact top bar + bottom tab bar (Tree · Search · My branch · Tools ·
  More), sheets that respect the keyboard, no horizontal overflow.
- **Tree cards:** redesigned "ledger card" — 4 px gender rail, 40 px photo
  medallion or initials, localized name, secondary line (nick or spouse),
  subtle dates line, deceased dagger chip, dashed treatment for deleted;
  selected = copper ring + soft lift. Spouse pair joined by a slim bond
  capsule. **Connectors:** orthogonal elbows with rounded corners (new
  signature), 1.5 px, muted; hover of a card subtly emphasises its line.
- **Motion:** 120–220 ms, ease-out, never blocking; `prefers-reduced-motion`
  honoured everywhere. No animation on pan/zoom (transform only, GPU).
- **Components:** one implementation per concept — `Button` (5 variants ×
  3 sizes), `Field`, `Select`, `Chip`, `Tag`, `Modal`, `Sheet`, `Drawer`,
  `Toast`, `Banner`, `EmptyState`, `ProgressRing`, `Pager`, `Tooltip`,
  `SegmentedControl`, `Card`. All built on `dom.ts` helpers; tokens in
  `tokens.css` (colour roles, spacing scale 4→32, radii, shadows, z-index,
  durations, breakpoints as documented constants).

## 4. Tree interaction — one controller

`PanZoomController` (single owner of all pointer/wheel input on the stage):

- Pointer events with `setPointerCapture`; a map of active pointers.
- **1 pointer:** potential-drag → drag after an 8 px threshold (touch) / 4 px
  (mouse). Below threshold on pointerup and <500 ms: tap → select the card the
  gesture started on (`data-person-id` read from the element captured at
  pointerdown, so a spouse card always opens the record it represents).
- **2 pointers:** pinch — scale around the midpoint, pan with midpoint
  movement; recovering to one pointer rebases the drag without jumps.
- **Wheel:** zoom at cursor (`passive:false`). **Double-click/tap on empty
  space:** zoom in at point. **Keyboard:** +/-/arrows when the stage is
  focused.
- `pointercancel` and `lostpointercapture` fully reset state.
- Page scrolling outside the stage is untouched (`touch-action: none` only on
  the stage; controls are outside the pan layer).
- Collapse/expand re-anchors the clicked card (ported keep-position logic).
- Unit tests prove: zoom-at-point keeps the world point under the cursor
  fixed; scale clamps; drag thresholds; tap vs drag decision; pinch midpoint
  invariance; cancellation resets.

## 5. Data layer

One store (`core/store.ts`) holds: session, profile, branchAccess, people
model (byId/kids/roots/gens/path), filters, view state (tree/table/branch),
selection, drawers. Views subscribe; rendering is pull-based like the
reference (fewer surprises, easy to debug). All Supabase reads/writes live in
`src/data/*` — nothing else touches the client. Write whitelists and error
mapping are ported exactly; every write maps failures to friendly translated
messages and never claims success it did not receive.

Realtime: `people` channel → debounced refresh; 60 s poll fallback; skipped
while a form is open (ported). Photos: batch signed URLs for cards; per-person
signed URL with cache for the panel.

## 6. Phases and test gates

After **every** phase: `npm run check` (typecheck + lint + unit), `npm run
test:e2e` (all specs), re-run scanners (`tools/scan-*.cjs`), update
`docs/FEATURE_PARITY.md` + `docs/TESTING.md`, fix regressions before moving on.

| Phase | Deliverable | Gate (real commands) |
| --- | --- | --- |
| **0. Baseline** (done) | `docs/BASELINE.md`, this plan, full inventory | reference scans run; results recorded |
| **1. Foundation** | Vite+TS scaffold, tokens + base styles, shell (header/rail/mobile tab bar/drawers), i18n engine + dictionaries (extracted), theme, toasts/modals, test harness (vitest + playwright + mock backend), CI-style scripts | typecheck, unit (i18n parity, dom helpers), build, first E2E boot smoke, **first push verified** |
| **2. Auth & access** | Supabase client, auth gate flows (sign-in/forgot/set-password/inactive/profile), session store, permission helpers | E2E: sign-in success/failure, invite link, inactive, sign-out wipe; unit: error mapping |
| **3. Tree & profiles** | model build, layout, renderer, PanZoomController, selection, tooltips, profile sheet, search, filters, focus | unit: layout/panzoom/model/names; E2E: select person & spouse card, pan/pinch/tap (touch emulation), filters, zoom buttons, fit, RTL tree |
| **4. Editing & branch** | person form (add/edit/child/root), validation, duplicate warning, photos upload/remove/lightbox, deletion requests, soft delete/restore, history + restore version, branch workspace (guided completion, multi-branch) | E2E: add/edit person persists via mock, validation errors, photo flow, request→approve, restore version, branch workspace progress + save round-trip |
| **5. Admin & tools** | table pagination, admin tabs (users/invite/requests/deleted/activity/branch progress/import/backup), Excel import+export, JSON backup, tools (related/upcoming/stats/print/PNG) | unit: kinship cases, upcoming filter, importer problems, isoDate cases; E2E: import preview problems, backup payload shape, tools outputs, permission-gated admin UI |
| **6. Mobile, languages, a11y** | 360/390/768/1440 sweeps, bottom nav, sheets, RTL polish, keyboard focus management, reduced motion, i18n completeness for new keys | E2E at all 4 viewports × (en/ur ltr/rtl × light/dark) screenshots + overflow checks; keyboard-only pass |
| **7. Hardening & release** | perf pass (measured: large fixture render, rerender counts, lazy xlsx), security review docs, README/SETUP/SUPABASE docs, final report, final push | full suite green; scan output clean; live unauthenticated probe re-run; `git push` verified |

## 7. Testing strategy (explicit about what is real)

1. **Unit (Vitest):** pure logic only — layout math, pan/zoom math, date
   parsing, display-name rules, filter predicates, kinship terms, completeness
   scoring, importer validation/ordering, backup shape, i18n key parity.
2. **E2E (Playwright, Chromium):** the real application code against an
   in-browser **mock of the Supabase API** (auth, PostgREST subset, storage
   signed URLs) served by the real Vite build. This exercises genuine UI →
   data flows deterministically, including permission branches. It is browser
   simulation with fixture data — labelled as such in every report.
3. **Live read-only checks (real Supabase):** the signed-out probe (42501) and
   the sign-in screen against the production project. Re-run in Phase 7.
4. **Live authenticated checks:** blocked until the owner provides a test
   account (open question 1). If provided, a small gated spec runs: sign in,
   read the tree, open a person, and (only if the owner authorises writes on a
   test branch) create/save/remove one clearly-labelled test person.
5. **Not claimed anywhere:** physical-device testing, email delivery, iOS
   Safari specifics.

Fixtures use clearly fictional people (documented as fixtures); no real family
data is committed.

## 8. Security plan

- Same Supabase project, same schema — no destructive changes; any future
  migration ships as a new versioned file with instructions and is not applied
  here.
- Service-role key: never in this repo, the bundle, logs or docs — only in the
  Edge Function's server environment.
- `.env` ignored; the committed defaults are the project URL + publishable key
  (public by design, matching the reference) — overridable via `VITE_*` env.
- Ported scanners: secrets scan, HTML-sink escaping scan, write-site audit;
  plus RLS expectations asserted in the mock (deny by default) and documented.
- The mock backend reproduces RLS refusals so E2E can prove the UI handles
  them; real enforcement remains in Postgres and is exercised live only where
  authorised.

## 9. Open questions for the owner

1. **Live testing access** — provide a test account (which role?) or a staging
   Supabase project? Without one, authenticated flows are verified against the
   mock + documentation, not the live database.
2. **Spouse model** — keep the current text-based spouse (recommended for
   parity: spouse cards show spouse details, no person record) or plan a
   schema migration to linked spouse records (needs their authorisation to
   run SQL, and careful data decisions)?
3. **Brand copy** — proposed app name "Nahri Family Archive" (en) with
   `نہری خاندان` / `नहरी परिवार`; the owner may prefer simply "Nahri Family".
   All Urdu/Hindi copy is marked for native-speaker review, as in the
   reference.

## 10. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Porting subtly changes behaviour | Keep ported functions pure and unit-test them; keep names/semantics; diff reviews per phase |
| Gesture rewrite regresses touch | Single controller with unit-tested math + touch-emulated E2E (pan→pinch→pan sequences, cancellation) |
| i18n drift | Dictionaries extracted by script; scan enforces key parity + no missing keys every phase |
| Mock ≠ real Supabase | Queries are written against the documented PostgREST surface; live smoke checks run where possible; limitations documented honestly |
| Push blocked | First commit pushed early to verify credentials before bulk work |
