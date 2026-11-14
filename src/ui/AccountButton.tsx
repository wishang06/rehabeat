import { useState } from 'react';
import { signInWithGoogle, signOut, type AuthState } from '../lib/auth';
import { PlayerAvatar } from './PlayerAvatar';

interface AccountButtonProps {
  auth: AuthState;
  /** Called just before leaving for Google, e.g. to keep an unsaved run. */
  onBeforeSignIn?: () => void;
}

/** Sign-in with Google, or the signed-in player with a sign-out button. */
export function AccountButton({ auth, onBeforeSignIn }: AccountButtonProps) {
  const [busy, setBusy] = useState(false);
  if (!auth.ready) return null;

  if (!auth.user) {
    return (
      <button
        type="button"
        className="button button--quiet"
        disabled={busy}
        data-testid="sign-in"
        onClick={async () => {
          setBusy(true);
          onBeforeSignIn?.();
          try {
            await signInWithGoogle();
          } catch (cause) {
            console.error('Google sign-in failed', cause);
            setBusy(false);
          }
        }}
      >
        {busy ? 'Opening Google…' : 'Sign in with Google'}
      </button>
    );
  }

  const name = auth.profile?.displayName ?? 'Player';
  return (
    <span className="account" data-testid="account">
      <PlayerAvatar seed={auth.user.id} className="critter--small" />
      <span className="account__name">{name}</span>
      <button type="button" className="button button--quiet" onClick={() => void signOut()}>
        Sign out
      </button>
    </span>
  );
}
