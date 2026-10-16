# Nahri Family — project documentation index

This repository holds the redesigned Nahri family tree application: a private,
sign-in-only web app for browsing the family tree, editing authorised branches
and looking up how two people are related. The data lives in the family's
existing Supabase project — nothing is bundled into the website.

| Document | What it contains |
| --- | --- |
| [`docs/BASELINE.md`](docs/BASELINE.md) | What was inspected in the reference application, with the exact commands and their real output. |
| [`docs/FEATURE_PARITY.md`](docs/FEATURE_PARITY.md) | The complete feature inventory of the reference application and its implementation status in this project. |
| [`docs/PLAN.md`](docs/PLAN.md) | The agreed build plan: phases, architecture, design direction and decisions. |
| [`docs/SETUP.md`](docs/SETUP.md) | How to install, configure and run the application (written during Phase 1). |
| [`docs/TESTING.md`](docs/TESTING.md) | Every test that exists, how to run it and what it proved (kept current after every phase). |
| [`docs/SECURITY.md`](docs/SECURITY.md) | The security model, what was verified and what could not be verified without live credentials. |
| [`docs/SUPABASE.md`](docs/SUPABASE.md) | The database schema, policies, storage and Edge Function notes. |

## Status

Phase 0 (inspection and baseline) is complete. Implementation follows the
phases in `docs/PLAN.md`.
