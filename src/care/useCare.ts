/** React's way into the doctor loop's data: which store to use, and the patient's program. */
import { useCallback, useEffect, useState } from 'react';
import type { AuthState } from '../lib/auth';
import { createDemoClinic } from './demoClinic';
import type { CareStore, MyProgram } from './types';

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    // Storage blocked: the demo clinic still works for the visit, in memory.
    return undefined;
  }
}

let demo: CareStore | null = null;

/**
 * Where programs and sessions live for this visitor, or null until the
 * sign-in state is known. Signed out, it is the demo clinic kept in this browser.
 */
export function careStoreFor(auth: AuthState): CareStore | null {
  if (!auth.ready) return null;
  demo ??= createDemoClinic(browserStorage());
  return demo;
}

/** Calls `reload` when the window gets focus back, or another tab changes what this browser stores. */
function useRefresh(reload: () => void): void {
  useEffect(() => {
    window.addEventListener('focus', reload);
    window.addEventListener('storage', reload);
    return () => {
      window.removeEventListener('focus', reload);
      window.removeEventListener('storage', reload);
    };
  }, [reload]);
}

/**
 * The player's program, if a doctor has given them one. It is read again
 * when the window gets focus back and when `reload` is called. A store that
 * fails is read as no program: the game must stay playable.
 */
export function useMyProgram(store: CareStore | null): {
  program: MyProgram | null;
  loading: boolean;
  reload: () => void;
} {
  const [program, setProgram] = useState<MyProgram | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((count) => count + 1), []);

  useEffect(() => {
    if (!store) return;
    let current = true;
    store
      .myProgram()
      .then((found) => {
        if (current) setProgram(found);
      })
      .catch((cause: unknown) => {
        console.warn('[care] could not read the program', cause);
        if (current) setProgram(null);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [store, tick]);

  useRefresh(reload);
  return { program, loading, reload };
}

export { useRefresh };
