# Supabase backend notes

The app uses the family's **existing** Supabase project (`quszbgvdurbbotrnbuii`)
— there is no second backend. This document records the contract the frontend
is written against, so the redesign never fights the database. All of it comes
from inspecting the reference repository in Phase 0 (`database/*.sql`,
`supabase/functions/admin-users/`).

## Tables (public schema)

| Table | Columns | Purpose |
| --- | --- | --- |
| `profiles` | `id`, `email`, `full_name`, `role` (`admin`/`editor`), `active`, `language`, `created_at` | One row per user, auto-created by the `on_auth_user_created` trigger; **inactive until an admin activates**. `language` remembers the user's interface language. |
| `people` | `id`, `legacy_id`, `parent_id`, `gender`, `full_name`, `nick_name`, `fathers_name`, `mothers_name`, `spouse_name`, `spouse_father_name`, `dob`, `dob_text`, `place_of_birth`, `qualification`, `dod`, `dod_text`, `place_of_burial`, `name_ur`, `name_hi`, `notes`, `photo_path`, `source`, `path`, `is_deleted`, `created_by`, `updated_by`, `created_at`, `updated_at` | The family. `path` is the stored ancestry chain (uuid array) that branch permissions key on. Spouses are **not** rows: they are the free-text `spouse_name`/`spouse_father_name` columns (owner decision: keep it this way). |
| `branch_access` | `user_id`, `person_id`, `primary` | Which editor may edit which anchor person (and the whole subtree under it). |
| `deletion_requests` | `id`, `person_id`, `requested_by`, `reason`, `status`, `created_at`, `resolved_by`, `resolved_at` | Editors request deletions; admins resolve. |
| `audit_log` | `id`, `person_id`, `action`, `changed_by`, `changed_by_name`, `old_data`, `new_data`, `changed_at` | Who changed what (full row JSON), written by trigger — read-only for the app. |

Triggers on `people`: guard (see `docs/SECURITY.md`), path recomputation,
timestamps, descendant path fix-up after a move, audit. Where dates are
unknown, the `*_text` columns hold the human text ("around 1920") while
`dob`/`dod` hold real dates when known.

## Row Level Security

Full detail with the exact policies lives in `docs/SECURITY.md`. Summary:
`anon` has no access at all; every read requires an active profile; writes go
through `can_edit_person()` (admin, or anchor found in the person's `path`);
soft deletes are admin-only and invisible to everyone else; the UI is never the
enforcement point.

## Storage

- Private bucket **`photos`**, object key `photos/<person-uuid>/<file>`.
- Read: any active user. Write: only where `can_edit_person(<folder uuid>)`.
- The client uploads the original file, resized to max 800 px and capped at
  3 MB; views use **signed URLs** with batching (`createSignedUrls`).
- `people.photo_path` stores the object key.

## Auth

- Email + password; sign-up disabled (`disable_signup: true`, verified live).
- Invitation and password-recovery links are handled client-side
  (`type=invite|recovery` in the URL hash, detected before the SDK strips it);
  the user sets a password, which activates the flow — but the profile still
  becomes usable only once `active = true`.
- Inactive profiles are signed out with an explanation.

## The `admin-users` Edge Function

Server-side only; holds the service-role key in its own environment. Used by
the admin screen for: list users with last sign-in, invite (email or temporary
password), edit role/branch, resend invite, activate/deactivate.

**Deployment status: not deployed** in the reference project (historical fact —
invitations there reported "not deployed yet"). Steps to deploy live in
`reference/supabase/functions/admin-users/README.md` (owner action; requires
the service-role key and `supabase` CLI). Until then the redesigned admin screen
must surface a clear "not available" state and never fake success.

## Working rules for this repository

1. **Read-only against production while developing.** The new app is built and
   tested against a mock for E2E; the live project is touched only for verified
   read checks and, later, with an owner-provided test account.
2. **Schema changes only as versioned migration proposals.** If a redesign need
   demands a schema change, it is written as `migrations/NNNN_*.sql` with an
   explanation and is applied only with explicit owner authorization — never as
   an edit to existing SQL, never as a reset, never as a seed of real data.
3. The existing `04_privacy.sql` (hide living people's exact dates) remains an
   **unapplied proposal** — the app must work with or without it. Do not apply
   it without owner sign-off.
4. Real family data (`.xlsx`, name-bearing seed SQL) never enters the repo.
