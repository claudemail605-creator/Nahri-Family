/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL; falls back to the documented project default. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable (anon) key; public by design, never the service key. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
