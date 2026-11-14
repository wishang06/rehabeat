import { useState, type FormEvent } from 'react';

interface JoinCodeProps {
  /** Joins the doctor whose code this is. Rejects with a sentence saying why not. */
  onJoin: (code: string) => Promise<void>;
}

/** For a signed-in player with no program: enter the code a doctor gave them. */
export function JoinCode({ onJoin }: JoinCodeProps) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    onJoin(code)
      .catch((cause: unknown) => setError(cause instanceof Error ? `${cause.message}.` : 'That code did not work.'))
      .finally(() => setBusy(false));
  };

  return (
    <form className="join" onSubmit={join} data-testid="join-code">
      <label className="join__label" htmlFor="join-code-input">
        Have a code from your doctor?
      </label>
      <div className="join__row">
        <input
          id="join-code-input"
          className="join__input"
          value={code}
          maxLength={10}
          autoComplete="off"
          spellCheck={false}
          placeholder="ABCDE23456"
          onChange={(event) => setCode(event.target.value.toUpperCase())}
        />
        <button type="submit" className="button button--quiet" disabled={busy}>
          Join
        </button>
      </div>
      {error && (
        <p className="join__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
