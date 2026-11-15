import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { signOut, type AuthState } from '../../lib/auth';
import { Avatar } from '../avatars/Avatar';
import { AVATAR_IDS, AVATAR_NAMES, resolveAvatar, type AvatarId } from '../avatars/avatars';
import { MAX_DISPLAY_NAME, validateDisplayName } from './displayName';
import './profile.css';

type View = 'main' | 'rename' | 'avatar';

const SAVE_FAILED = "Couldn't save. Check your connection and try again.";

/**
 * The signed-in player's avatar in the marquee. It opens a small panel: who
 * is signed in, Rename, Change avatar and Sign out. Esc steps back a view,
 * then closes; a click outside closes it.
 */
export function ProfileMenu({ auth }: { auth: AuthState }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('main');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const viewRef = useRef(view);
  viewRef.current = view;
  const previousView = useRef<View>('main');

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    // Esc belongs to the menu while it is open, wherever focus is: App would otherwise take it as
    // "back to the songs". Caught on the way down, before App's listener on window hears it.
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.preventDefault();
      if (viewRef.current === 'main') {
        setOpen(false);
        trigger.current?.focus();
      } else setView('main');
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  // Back from Rename or Change avatar, focus returns to the button that opened it.
  useEffect(() => {
    const from = previousView.current;
    previousView.current = view;
    if (open && view === 'main' && from !== 'main') {
      root.current?.querySelector<HTMLElement>(`[data-testid="profile-${from === 'rename' ? 'rename' : 'avatar'}"]`)?.focus();
    }
  }, [open, view]);

  if (!auth.user) return null;
  const userId = auth.user.id;
  const name = auth.profile?.displayName ?? 'Player';
  const avatarId = auth.profile?.avatarId ?? null;

  return (
    <div className="profile" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="profile__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Profile: ${name}`}
        data-testid="profile-button"
        onClick={() => {
          setView('main');
          setOpen((shown) => !shown);
        }}
      >
        <Avatar id={avatarId} seed={userId} />
      </button>

      {open && (
        <div className="profile__panel" id={panelId} data-testid="profile-menu" data-view={view}>
          <div className="profile__who">
            <Avatar id={avatarId} seed={userId} className="avatar--large" />
            <div className="profile__id">
              <span className="profile__label">Signed in as</span>
              <span className="profile__name" data-testid="profile-name">
                {name}
              </span>
            </div>
          </div>

          {view === 'main' && (
            <div className="profile__actions">
              <button type="button" className="profile__item" onClick={() => setView('rename')} data-testid="profile-rename">
                Rename
              </button>
              <button type="button" className="profile__item" onClick={() => setView('avatar')} data-testid="profile-avatar">
                Change avatar
              </button>
              <button
                type="button"
                className="profile__item profile__item--quiet"
                data-testid="sign-out"
                onClick={() => {
                  setOpen(false);
                  void signOut();
                }}
              >
                Sign out
              </button>
            </div>
          )}

          {view === 'rename' && <RenameForm name={name} auth={auth} onDone={() => setView('main')} />}

          {view === 'avatar' && (
            <AvatarPicker current={resolveAvatar(avatarId, userId)} auth={auth} onDone={() => setView('main')} />
          )}
        </div>
      )}
    </div>
  );
}

function RenameForm({ name, auth, onDone }: { name: string; auth: AuthState; onDone: () => void }) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldId = useId();
  const length = [...value.trim().replace(/\s+/g, ' ')].length;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const checked = validateDisplayName(value);
    if (!checked.ok) return setError(checked.error);
    if (checked.name === name) return onDone();
    setBusy(true);
    setError(null);
    try {
      await auth.updateProfile({ displayName: checked.name });
      onDone();
    } catch (cause) {
      console.error('Could not rename', cause);
      setError(SAVE_FAILED);
      setBusy(false);
    }
  };

  return (
    <form className="profile__form" onSubmit={(event) => void submit(event)} noValidate>
      <label className="profile__label" htmlFor={fieldId}>
        Display name
      </label>
      <input
        id={fieldId}
        className="profile__input"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        autoFocus
        autoComplete="nickname"
        spellCheck={false}
        aria-invalid={error !== null}
        aria-describedby={`${fieldId}-help`}
        data-testid="rename-input"
      />
      <p id={`${fieldId}-help`} className="profile__help">
        {error ? (
          <span className="profile__error" role="alert" data-testid="rename-error">
            {error}
          </span>
        ) : (
          <span>Shown on the leaderboard.</span>
        )}
        <span className="profile__count" data-over={length > MAX_DISPLAY_NAME}>
          {length}/{MAX_DISPLAY_NAME}
        </span>
      </p>
      <div className="profile__row">
        <button type="submit" className="profile__item profile__item--primary" disabled={busy} data-testid="rename-save">
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="profile__item" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function AvatarPicker({ current, auth, onDone }: { current: AvatarId; auth: AuthState; onDone: () => void }) {
  const [saving, setSaving] = useState<AvatarId | null>(null);
  const [error, setError] = useState(false);
  const labelId = useId();

  const choose = async (id: AvatarId) => {
    if (id === current) return onDone();
    setSaving(id);
    setError(false);
    try {
      await auth.updateProfile({ avatarId: id });
      onDone();
    } catch (cause) {
      console.error('Could not change the avatar', cause);
      setError(true);
      setSaving(null);
    }
  };

  return (
    <div className="profile__picker">
      <span className="profile__label" id={labelId}>
        Pick an avatar
      </span>
      <div className="profile__grid" role="group" aria-labelledby={labelId} data-testid="avatar-grid">
        {AVATAR_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className="profile__pick"
            aria-pressed={id === current}
            aria-label={AVATAR_NAMES[id]}
            title={AVATAR_NAMES[id]}
            disabled={saving !== null}
            data-saving={saving === id}
            data-testid={`avatar-${id}`}
            onClick={() => void choose(id)}
          >
            <Avatar id={id} seed={id} />
          </button>
        ))}
      </div>
      {error && (
        <p className="profile__error" role="alert">
          {SAVE_FAILED}
        </p>
      )}
      <button type="button" className="profile__item" onClick={onDone}>
        Back
      </button>
    </div>
  );
}
