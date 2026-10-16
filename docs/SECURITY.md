# Security model

What protects the family's data, what has been verified, and what still needs
verification. Kept honest: things that could not be tested yet say so.

## Model in one paragraph

The app is a public static website with no server of its own. It authenticates
users with Supabase Auth and reads/writes the database directly through
PostgREST. The **publishable (anon) key is public by design** — it is shipped to
every browser and grants nothing by itself. Every rule that matters is enforced
by the database: Row Level Security plus triggers. The browser UI only hides
buttons; it is never trusted. There is exactly one privileged surface, the
`admin-users` Edge Function, which keeps the service-role key server-side (see
`docs/SUPABASE.md`).

## Database-enforced rules (from the reference schema, unchanged)

| Rule | Where it lives |
| --- | --- |
| You must be an active profile (`profiles.active`) to read anything | `is_active_user()` in every policy |
| Editors only touch their branch: an assigned anchor person or their descendants | `can_edit_person()` — the caller's `branch_access.person_id` must appear in the person's stored `path` |
| Editors cannot move people, delete/restore, or change `legacy_id`, `created_by`, `created_at` | `people_guard` trigger (raises an exception, not just UI hiding) |
| `path` is always recomputed from the parent; cycles impossible | `people_set_path` trigger |
| A person can never be placed under their own descendant | `people_set_path` |
| Soft-deleted people are invisible to everyone but admins | `people_select` policy |
| Deletion is a request/approve flow for editors | `deletion_requests` policies + admin-only resolve |
| Users cannot edit profile `role`/`active`/`email` (or `id`) — even through the API | `profiles_guard` trigger |
| Only admins manage `branch_access` | `branch_*` policies |
| Audit trail: who changed what, old and new row, with actor name | `people_audit` trigger writing `audit_log` |
| Editors see the audit history of their own branch only | `audit_select` policy |
| Photos: private bucket, read for active users, write only where you can edit the person | `03_storage.sql` policies keyed on `storage.foldername(name)[1]::uuid` |

The schema file also removes Supabase's broad default grants and re-grants only
what the site needs (`revoke all … from anon, authenticated` then column-scoped
grants) — `anon` has no table access at all.

## Verified so far (with evidence)

| Date | Check | Result |
| --- | --- | --- |
| Phase 0 (2026-10) | `GET /rest/v1/people` without a session | `401` — `permission denied for table people` (42501). Anonymous access really is closed; this matches the `anon` grant removal. |
| Phase 0 | `GET /auth/v1/settings` | email sign-in enabled, **`disable_signup: true`** — the public cannot create accounts; admins invite. |
| Phase 1 | Repository scan for `service_role` outside docs | Only the warning text in `.env.example`. No `.env` file exists in the repo. |
| Phase 1 | Secret review of what the bundle contains | The built app contains only the Supabase URL and the publishable key (public by design), the app code, and fonts loaded from Google. No other endpoint, key or token. |
| Phase 1 | `npm audit` | 0 vulnerabilities at install time (77 packages). |
| Phase 1 | Phase 1 code makes no backend calls | The only network requests a fresh boot makes are the Google Fonts stylesheets. Nothing touches the Supabase project yet. |

## Known risks and open items

1. **RLS behaviour is verified by reading the SQL, not by running it against
   the live project with a real editor account.** This needs the owner's test
   account; it is the first live-security task of Phase 2 (attempt a write
   outside the branch, expect refusal; attempt a delete, expect refusal).
2. **XSS discipline.** All rendering code must escape family data before it
   reaches `innerHTML`. The reference ported an `esc()` helper; this codebase
   re-implements the same rule and unit-tests rendering of hostile strings as
   views land. The `svgIcon()` helper only ever receives static markup compiled
   into the app, never data.
3. **Password flows** (reset, invite) are re-implemented in Phase 2 with the
   same Supabase methods as the reference; they will be tested against the live
   project with the owner's account.
4. **Urdu/Hindi and family names are personal data.** The repository must never
   contain real family records: fixtures in tests are fictional, and the seed
   spreadsheets stay out of the repo (`.gitignore` covers `data/*.xlsx` and the
   name-bearing seed SQL).
5. **The `admin-users` Edge Function was never deployed** in the reference
   project (invitations report a not-deployed error). Deployment steps live in
   `docs/SUPABASE.md`; until it is deployed, the admin user-management screen
   will show a clear "not available" state rather than fake success.

## Rules for this repository

- No secret ever enters the repo, the bundle, logs or test fixtures.
- Schema changes only as versioned migration proposals, applied by the owner
  (or with explicit owner authorization). No reset/drop/seed of production.
- The publishable key may appear in code and docs (public by design); the
  service-role key may appear nowhere.
