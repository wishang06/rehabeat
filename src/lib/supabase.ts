import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The Supabase client, or null when the app was built without
 * VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY. The game runs fine
 * without it; anything that saves data should check for null first.
 *
 * The publishable key is meant to ship to the browser. What it may read or
 * write is decided by Row Level Security policies on each table.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;
