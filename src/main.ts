import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/shell.css';
import './styles/features.css';

import type { SupabaseClient } from '@supabase/supabase-js';
import { mountApp } from './app';
import { createSupabaseClient } from './core/supabase';
import { extractMessage } from './features/auth/errors';
import { readAuthLink } from './features/auth/link';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root element in index.html');

// Capture the invite / recovery parameters BEFORE the Supabase client consumes
// and strips them from the URL, so the gate can still show the set-password
// form afterwards (reference behaviour, see js/supabase.js in the reference).
const authLink = readAuthLink(window.location);

// A broken configuration must not blank the page: the gate explains the
// problem inside the app instead.
let client: SupabaseClient | null = null;
let clientError: string | null = null;
try {
  client = createSupabaseClient();
} catch (err) {
  clientError = extractMessage(err);
  console.warn('Supabase client could not be created:', clientError);
}

mountApp(root, { authLink, client, clientError });
