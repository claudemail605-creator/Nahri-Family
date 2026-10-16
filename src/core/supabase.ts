import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';

/**
 * Create THE Supabase client for the app. Session handling matches the
 * reference application:
 *   persistSession     — keep the session across reloads (localStorage)
 *   autoRefreshToken   — refresh the access token in the background
 *   detectSessionInUrl — parse invite / password-recovery links on load
 * Only the project URL and the publishable key are used here; the service-role
 * key must never appear in website code.
 */
export function createSupabaseClient(
  url: string = SUPABASE_URL,
  key: string = SUPABASE_PUBLISHABLE_KEY,
): SupabaseClient {
  if (/supabase\.com\/dashboard/.test(url)) {
    throw new Error(
      'SUPABASE_URL points at a dashboard page. Use the Project URL — https://<project-ref>.supabase.co',
    );
  }
  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}
