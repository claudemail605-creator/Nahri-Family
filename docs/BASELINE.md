# Phase 0 — inspection and baseline

**Date:** 16 October 2026
**Purpose:** record exactly what was inspected in the reference application
(`github.com/claudemail605-creator/FamilyTree`, branch `master`) before any
implementation began, and the real state of the environment this project is
built and tested in. Every claim below is a command that was run or a file
that was read; nothing is assumed.

## 1. Repositories

| Repository | Role | Branches found | Files |
| --- | --- | --- | --- |
| `claudemail605-creator/FamilyTree` | read-only reference | `main` (README only), **`master`** (the application) | 39 tracked files |
| `claudemail605-creator/Nahri-Family` | target — all new development | `main` (README only) | 1 tracked file |

The reference application's real code lives on `master`; the repository URL in
the brief (`/tree/master`) matches that. The target repository had a single
"Initial commit" and a clean working tree before this work started; its history
is preserved.

Reference application anatomy (master, 39 files):

- **Frontend:** plain HTML/CSS/JS, no build step, no framework. `index.html`
  plus 10 scripts in `js/`: `config.js`, `supabase.js`, `auth.js`, `i18n.js`,
  `photos.js`, `personform.js`, `admin.js`, `extras.js`, `app.js`, `branch.js`.
- **Styles:** one `css/style.css` (812 lines) — a parchment/forest-green
  "Heritage" system.
- **Backend:** the family's live Supabase project — **`quszbgvdurbbotrnbuii`**
  (`https://quszbgvdurbbotrnbuii.supabase.co`), publishable key in
  `js/config.js` (by design; it is not a secret).
- **Database files:** `database/01_schema.sql` (tables, triggers, functions,
  all RLS), `02_seed.sql` (starter seed), `03_storage.sql` (private `photos`
  bucket), `04_seed_from_excel.sql` (family data — see §6), `04_privacy.sql`
  (unapplied proposal), `04_name_ur_hi.sql` (family data), `99_data_maintenance.sql`.
- **Edge Function:** `supabase/functions/admin-users/index.ts` — the only
  server-side component; holds the service-role key; manages accounts.
- **Docs:** `docs/PHASE7_SECURITY_REVIEW.md` (244 lines) — an unusually
  detailed, evidence-based security and quality review.
- **Data:** `data/*.xlsx` — the owner's real family spreadsheets (two
  conflicting versions, see §6).
- **Tools:** `tools/serve.cjs` (dev server), `make_icons.cjs`, `build_seed_sql.cjs`,
  `scan_security.cjs`, `scan_i18n_quality.cjs`, `i18n_review.cjs`.

## 2. Live Supabase checks performed (read-only)

| Check | Command | Result |
| --- | --- | --- |
| Project reachable | REST `GET /rest/v1/people?select=id&limit=1` with the publishable key, no session | **HTTP 401, `42501 permission denied for table people`** — the database refuses signed-out reads, exactly as documented. |
| Auth settings | `GET /auth/v1/settings` | `email` provider enabled, `disable_signup: true` (accounts are admin-created only), mailer confirmations on. |

No credentials existed in the environment for an *authenticated* live test
account, so authenticated flows were not exercised against the live database in
Phase 0. This is revisited in `docs/TESTING.md` and `docs/SECURITY.md`.

## 3. Baseline checks run against the reference (read-only clone)

```text
$ node --check js/*.js sw.js
OK admin.js  admin.js  app.js  auth.js  branch.js  config.js  extras.js
   i18n.js  photos.js  personform.js  supabase.js  sw.js

$ node tools/scan_security.cjs
scan finished: nothing flagged
  - js/config.js holds only SUPABASE_URL + publishable key
  - 10 interpolations inside HTML sinks, 0 without an obvious esc()
  - 18 write call sites, all through supabase-js with the user's token
  - tables referenced: people, profiles, branch_access, deletion_requests,
    audit_log (+ admin-users rpc)

$ node tools/scan_i18n_quality.cjs
keys: en=617 ur=617 hi=617
key parity: OK (no missing keys)
26 item(s) need attention — all listed; the notable ones are deliberate
(Supabase/JPG/brand words) or technician-facing format hints ("YYYY-MM-DD").
```

These are the pre-existing baseline results. They are re-run against the new
codebase after every phase (see `docs/TESTING.md`).

## 4. Environment

| Item | Value |
| --- | --- |
| OS | Windows (win32), PowerShell |
| Node / npm | Node v24.19.0 / npm 11.17.0 (npm scripts run via `cmd /c` — PowerShell execution policy blocks `npm.ps1`) |
| Git | 2.55.0, credential helper `manager` — **read access to both repositories confirmed; a real push is verified in this project's first commit** |
| `gh` CLI | not installed (not needed; plain git is used) |
| Playwright / Vitest / Vite | installable via npm (resolved: playwright 1.64.1, vitest 5.0.5, vite 8.3.4 at the time of writing) |

## 5. The security model as implemented by the reference schema

Read from `database/01_schema.sql` (not paraphrased — the file is the source):

- **Tables:** `profiles` (role `admin|editor`, `active`, `language`),
  `people` (family records, `parent_id` tree, `path uuid[]` ancestor chain
  maintained by trigger, `is_deleted` soft delete), `branch_access`
  (user → anchor person), `deletion_requests`, `audit_log` (insert/update/delete
  snapshots with `changed_by`).
- **Helper functions:** `is_admin()`, `is_active_user()`, `can_edit_person(id)`
  (= admin, or active user with a branch_access anchor in the person's `path`).
- **Guards:** `people_guard` (non-admins cannot move people, delete, restore,
  or change `legacy_id`/`created_by`), `people_set_path` (path recomputed,
  cycles refused), `profiles_guard` (non-admins cannot change their own
  role/active/email), audit trigger on every write.
- **RLS:** reads only for active users (soft-deleted hidden unless admin);
  inserts only under an editable parent (or admin); updates only where
  `can_edit_person`; deletes only admin; `branch_access` writable only by
  admins; `audit_log` read scoped to admins or editable branches.
- **Storage:** private `photos` bucket, `photos/<person-uuid>/<file>`,
  read for active users, write only where `can_edit_person(uuid)`.

Verified again in Phase 0: the signed-out REST probe returns `42501` — there is
no anonymous read path at all.

## 6. Pre-existing issues and open items carried over from the reference

These are recorded so the new project can either fix them or keep them
documented as known state:

1. **Two data sources disagree.** The live database holds a 32-person tree
   (starting *Syed Mazharuddin Nahri*); `data/Master_Family_Tree_Database.xlsx`
   and `04_seed_from_excel.sql` describe a different 38-person set (starting
   *Syed Azeemuddin Nahri*). The reference README warns about this. It is the
   owner's decision which source is authoritative; nothing in this project
   changes or imports family data.
2. **The privacy option is a proposal, not applied** (`04_privacy.sql`).
   It only works together with matching app changes. Not adopted here without
   the owner's decision; the file is carried over with its warnings intact.
3. **The `admin-users` Edge Function was not deployed** at the time of the
   reference review. Account creation/invites use it; everything else works
   without it.
4. **Spouses are text fields, not linked records.** `people.spouse_name` /
   `spouse_father_name` are free text; the tree draws a spouse card from that
   text. There is no person row for the spouse, so "the spouse's own profile"
   cannot exist until a schema change is made (see `docs/PLAN.md`, open
   question 2).
5. **The table view renders every row** (no pagination) — fine for 32 people,
   not for thousands.
6. **Gesture handling grew by patches** (three separate fix commits about tap
   vs drag, spouse selection and pinch zoom). The redesign replaces it with a
   single pointer-events controller (see `docs/PLAN.md` §4).
7. **i18n scan reports 26 Latin-leftover notes** — mostly intentional
   (brand names like "Supabase", file format hints). Urdu/Hindi copy remains
   marked for native-speaker review.
8. `js/New Text Document.txt` — an empty stray tracked file in the reference.

## 7. What cannot be tested in this environment (and why)

- **Authenticated live flows** (sign-in as a real family member, saving an
  edit, uploads to Storage, the Edge Function) — require the owner to provide
  test-account credentials or a staging project. Until then these are tested
  against a faithful in-browser mock of the Supabase API plus the
  unauthenticated live checks above; the distinction is kept explicit in
  `docs/TESTING.md`.
- **Invitation and password-recovery emails end-to-end** — require the Edge
  Function deployed and a mailbox.
- **Physical-device testing** — none is claimed anywhere unless it happened.
  Mobile behaviour is tested in browser emulation at 360/390/768/1440 px with
  touch emulation.
