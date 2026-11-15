import { useState } from 'react';
import { signInWithGoogle, type AuthState } from '../lib/auth';
import { ProfileMenu } from './profile/ProfileMenu';

interface AccountButtonProps {
  auth: AuthState;
  /** Called just before leaving for Google, e.g. to keep an unsaved run. */
  onBeforeSignIn?: () => void;
  /** Joins a doctor with their code, from the profile menu. Null or absent when the player cannot join one. */
  onJoin?: ((code: string) => Promise<void>) | null;
}

/** Sign-in with Google, or the signed-in player's avatar, which opens the profile menu. */
export function AccountButton({ auth, onBeforeSignIn, onJoin }: AccountButtonProps) {
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

  return <ProfileMenu auth={auth} onJoin={onJoin ?? null} />;
}
