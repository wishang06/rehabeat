import type { User } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import { pickRandomAvatar, type AvatarId } from '../ui/avatars/avatars';
import { supabase } from './supabase';

export interface Profile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  /** The avatar picked in the profile menu (src/ui/avatars). A new account is given a random one. */
  avatarId: string | null;
}

/** What the profile menu can change. */
export interface ProfilePatch {
  displayName?: string;
  avatarId?: AvatarId;
}

export interface AuthState {
  /** False until the stored session (or the OAuth redirect) has been read. */
  ready: boolean;
  user: User | null;
  profile: Profile | null;
  /** Saves a change to the signed-in player's profile, then shows it. Throws if it could not be saved. */
  updateProfile: (patch: ProfilePatch) => Promise<void>;
}

type Signed = Omit<AuthState, 'updateProfile'>;

/** Tracks the signed-in player. Always signed out when Supabase isn't configured. */
export function useAuth(): AuthState {
  const [state, setState] = useState<Signed>({ ready: supabase === null, user: null, profile: null });

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

  const userId = state.user?.id ?? null;
  const updateProfile = useCallback(
    async (patch: ProfilePatch) => {
      if (!supabase || !userId) throw new Error('Sign in first');
      await saveProfile(userId, patch);
      setState((current) =>
        current.user?.id === userId && current.profile ? { ...current, profile: { ...current.profile, ...patch } } : current,
      );
    },
    [userId],
  );

  return { ...state, updateProfile };
}

async function saveProfile(userId: string, patch: ProfilePatch): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured');
  const { error } = await supabase
    .from('profiles')
    .update({
      ...(patch.displayName !== undefined && { display_name: patch.displayName }),
      ...(patch.avatarId !== undefined && { avatar_id: patch.avatarId }),
    })
    .eq('id', userId);
  if (error) throw error;
}

async function loadProfile(user: User): Promise<Profile> {
  const fallback: Profile = {
    id: user.id,
    displayName: (user.user_metadata.full_name as string | undefined) ?? user.email ?? 'Player',
    avatarUrl: (user.user_metadata.avatar_url as string | undefined) ?? null,
    avatarId: null,
  };
  if (!supabase) return fallback;
  const client = supabase;
  const read = (columns: string) => client.from('profiles').select(columns).eq('id', user.id).maybeSingle();
  let { data, error } = await read('id, display_name, avatar_url, avatar_id');
  // Before the avatar migration (20261116090000) there is no avatar_id column: read without it.
  const migrated = !error;
  if (error) ({ data, error } = await read('id, display_name, avatar_url'));
  if (error || !data) return fallback;
  const row = data as unknown as { id: string; display_name: string; avatar_url: string | null; avatar_id?: string | null };
  const profile: Profile = {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    avatarId: row.avatar_id ?? null,
  };
  // A new account (or one from before avatars) is dealt a random avatar, once.
  if (migrated && profile.avatarId === null) {
    const avatarId = pickRandomAvatar();
    try {
      await saveProfile(user.id, { avatarId });
      profile.avatarId = avatarId;
    } catch (cause) {
      console.warn('Could not save a starting avatar', cause);
    }
  }
  return profile;
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
