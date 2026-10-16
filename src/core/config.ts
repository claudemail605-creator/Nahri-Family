/**
 * Application configuration.
 *
 * The Supabase URL and publishable (anon) key are public by design: they ship
 * inside every browser bundle and are protected by Row Level Security. The
 * defaults below point at the family's existing project; `.env` values override
 * them so a fork can be pointed at its own project. NEVER put the service-role
 * key here — it belongs only in the server-side environment of the
 * `admin-users` Edge Function (see docs/PLAN.md).
 */
export const APP_NAME = 'Nahri Family';

export const SUPABASE_URL: string =
  import.meta.env.VITE_SUPABASE_URL || 'https://quszbgvdurbbotrnbuii.supabase.co';

export const SUPABASE_PUBLISHABLE_KEY: string =
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_Gtq-jfvkTK4Mp91NetL4RA_ew9mSja8';

/** True when the Supabase endpoint came from `.env` rather than the defaults. */
export const SUPABASE_URL_IS_DEFAULT = !import.meta.env.VITE_SUPABASE_URL;

export const STORAGE_KEYS = {
  theme: 'nahri.theme',
  lang: 'nahri.lang',
} as const;
