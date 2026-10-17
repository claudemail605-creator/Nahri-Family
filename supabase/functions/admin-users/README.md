# `admin-users` Edge Function

A faithful copy of the reference project's `supabase/functions/admin-users/` — the
only place that may create accounts. It runs on Supabase's servers and uses the
**service-role key**, which is read from the function's own environment and is
never sent to the browser. Without it the Admin screen's **Users** tab still
lists accounts and can still change roles, branches and the active flag (the
database allows an admin to do that), but the *Invite*, *Resend invite* and
*Set temporary password* buttons report "not deployed yet".

## Deploy it — an OWNER action, never from this repository

This source is vendored and versioned here so it travels with the app, but
**deploying (and linking) against the production Supabase project is the
owner's called action**, done from the owner's own linked checkout:

```bash
# 1. Install the CLI (skip if you already have it)
npm install -g supabase

# 2. Sign in and link this folder to your project
cd <the folder containing supabase/>
supabase login
supabase link --project-ref quszbgvdurbbotrnbuii

# 3. Tell the function where the website lives, so invitation and
#    password-reset links point at it. This is a SECRET (never commit it).
#    Use the address relatives open in a browser, e.g.
supabase secrets set SITE_URL="https://your-site.example.com"

# 4. Deploy (this is also the command to re-run after editing index.ts)
supabase functions deploy admin-users
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by
Supabase automatically — **do not** set them yourself and never put them in
`js/config.js`.

> Opening the site as a local file (`file://…`) means invitation links cannot come back
> to it. Serve it over http(s) — for example `python -m http.server`, the VS Code Live
> Server extension, or a real deployment — and set `SITE_URL` to that address.

## Calling it from the browser

```js
const { data, error } = await supabase.functions.invoke('admin-users', {
  body: { action: 'invite', email: 'aunt@example.com', full_name: 'Syeda Aunt',
          role: 'editor', branch_person_ids: ['<person-uuid>'], send_email: true }
});
```

`src/features/admin/` already does this through `invokeAdminUsers()` in
`src/data/admin.ts`. The actions are:

| action | body | what it does |
| --- | --- | --- |
| `list` | – | every account with `last_sign_in_at`, for the Users table |
| `invite` | `email`, `full_name`, `role`, `branch_person_ids[]`, `send_email` | creates the account, sets the profile, writes `branch_access`. With `send_email: false` it creates a password instead and returns it once as `temporary_password` |
| `update` | `user_id`, `full_name?`, `role?`, `branch_person_ids?` | changes the profile and replaces the branch list |
| `resend` | `user_id` | sends a fresh invitation, or a password-recovery email if they already signed in |
| `set_password` | `user_id`, `password` | for relatives who cannot receive email |
| `disable` / `enable` | `user_id` | flips `profiles.active` and bans/unbans the auth user |

Every call must carry the admin's own JWT (the browser sends it automatically).
The function loads that user's profile with the service client and answers **403**
unless `role = 'admin'` **and** `active = true`.

## Safety rules built in

- an admin cannot remove their own admin role, cannot deactivate themselves and
  cannot set their own password through this function;
- new accounts are created as `active = true` so an invited relative can use the tree
  straight away — use **Deactivate** to take someone's access away;
- the composer's error messages never contain the service key or a stack trace.
