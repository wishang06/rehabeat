import type { User } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface Profile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface AuthState {
  /** False until the stored session (or the OAuth redirect) has been read. */
  ready: boolean;
  user: User | null;
  profile: Profile | null;
}

/** Tracks the signed-in player. Always signed out when Supabase isn't configured. */
export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ ready: supabase === null, user: null, profile: null });

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let cancelled = false;

    const apply = async (user: User | null) => {
      const profile = user ? await loadProfile(user) : null;
      if (!cancelled) setState({ ready: true, user, profile });
    };

    // Fires once with the current session, then on every sign-in and sign-out.
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      // Don't await Supabase calls inside this callback; it holds an auth lock.
      setTimeout(() => void apply(session?.user ?? null), 0);
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  return state;
}

async function loadProfile(user: User): Promise<Profile> {
  const fallback: Profile = {
    id: user.id,
    displayName: (user.user_metadata.full_name as string | undefined) ?? user.email ?? 'Player',
    avatarUrl: (user.user_metadata.avatar_url as string | undefined) ?? null,
  };
  if (!supabase) return fallback;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url')
    .eq('id', user.id)
    .maybeSingle();
  if (error || !data) return fallback;
  return { id: data.id, displayName: data.display_name, avatarUrl: data.avatar_url };
}

/** Sends the player to Google and back to this page. */
export async function signInWithGoogle(): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured');
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}
