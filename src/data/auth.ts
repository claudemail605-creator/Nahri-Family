import type { Session, SupabaseClient } from '@supabase/supabase-js';

/**
 * Typed access to everything the app needs from Supabase Auth and the
 * `profiles` / `branch_access` tables. Every function translates the
 * supabase-js `{ data, error }` convention into a thrown error, so callers
 * can use plain try/catch. Every write maps failures faithfully — nothing
 * here reports success it did not receive.
 */

export interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string | null;
  active: boolean;
  language: string | null;
}

export interface ProfileUpdate {
  full_name?: string;
  language?: string;
}

export interface AuthData {
  getSession(): Promise<Session | null>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string, redirectTo: string): Promise<void>;
  setPassword(password: string): Promise<void>;
  /** null when there is no profile row for the user (PostgREST PGRST116). */
  loadProfile(userId: string): Promise<ProfileRow | null>;
  loadBranchAccess(userId: string): Promise<string[]>;
  updateProfile(userId: string, fields: ProfileUpdate): Promise<void>;
  onAuthStateChange(callback: (event: string, session: Session | null) => void): () => void;
}

export function createAuthData(client: SupabaseClient): AuthData {
  return {
    async getSession(): Promise<Session | null> {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      return data.session ?? null;
    },

    async signIn(email: string, password: string): Promise<void> {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },

    async signOut(): Promise<void> {
      const { error } = await client.auth.signOut();
      if (error) console.warn('sign-out failed:', error.message);
    },

    async requestPasswordReset(email: string, redirectTo: string): Promise<void> {
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
    },

    async setPassword(password: string): Promise<void> {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
    },

    async loadProfile(userId: string): Promise<ProfileRow | null> {
      const { data, error } = await client.from('profiles').select('*').eq('id', userId).single();
      if (error) {
        if (error.code === 'PGRST116') return null; // no row — caller decides what that means
        throw error;
      }
      return (data as ProfileRow | null) ?? null;
    },

    async loadBranchAccess(userId: string): Promise<string[]> {
      const { data, error } = await client.from('branch_access').select('person_id').eq('user_id', userId);
      if (error) throw error;
      const rows = (data ?? []) as Array<{ person_id: string }>;
      return rows.map((row) => row.person_id);
    },

    async updateProfile(userId: string, fields: ProfileUpdate): Promise<void> {
      const { error } = await client.from('profiles').update(fields).eq('id', userId);
      if (error) throw error;
    },

    onAuthStateChange(callback: (event: string, session: Session | null) => void): () => void {
      const { data } = client.auth.onAuthStateChange((event, session) => callback(event, session));
      return () => data.subscription.unsubscribe();
    },
  };
}
