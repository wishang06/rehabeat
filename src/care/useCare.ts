/** React's way into the doctor loop's data: which store to use, and the patient's program. */
import { useCallback, useEffect, useState } from 'react';
import type { AuthState } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { createDemoClinic } from './demoClinic';
import { createSupabaseClinic } from './supabaseClinic';
import { CareSetupError, type CareStore, type MyProgram, type PatientFile } from './types';

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    // Storage blocked: the demo clinic still works for the visit, in memory.
    return undefined;
  }
}

let demo: CareStore | null = null;
let clinic: { userId: string; store: CareStore } | null = null;

/**
 * Where programs and sessions live for this visitor, or null until the
 * sign-in state is known. Signed out (or with accounts switched off) it is
 * the demo clinic kept in this browser; signed in, the real clinic. There
 * is no switch between the two: it follows sign-in.
 */
export function careStoreFor(auth: AuthState): CareStore | null {
  if (!auth.ready) return null;
  if (supabase && auth.user) {
    if (clinic?.userId !== auth.user.id) {
      clinic = { userId: auth.user.id, store: createSupabaseClinic(supabase, auth.user.id) };
    }
    return clinic.store;
  }
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
 * when the window gets focus back and when `reload` is called.
 *
 * `loading` is true until this store has answered once: a patient's limits
 * are in their program, so the game does not start before it is known.
 * `error` is 'setup' when the real clinic's tables are not there yet (there
 * are no programs to have), and 'failed' when the read failed: the game
 * stays playable, and says that any limits are not applied.
 */
export function useMyProgram(store: CareStore | null): {
  program: MyProgram | null;
  loading: boolean;
  error: 'setup' | 'failed' | null;
  reload: () => void;
} {
  const [read, setRead] = useState<{
    store: CareStore;
    program: MyProgram | null;
    error: 'setup' | 'failed' | null;
  } | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((count) => count + 1), []);

  useEffect(() => {
    if (!store) return;
    let current = true;
    store
      .myProgram()
      .then((program) => {
        if (current) setRead({ store, program, error: null });
      })
      .catch((cause: unknown) => {
        console.warn('[care] could not read the program', cause);
        if (current) setRead({ store, program: null, error: cause instanceof CareSetupError ? 'setup' : 'failed' });
      });
    return () => {
      current = false;
    };
  }, [store, tick]);

  useRefresh(reload);
  // What was read from another store (before signing in or out) says nothing about this one.
  const answered = read !== null && read.store === store;
  return {
    program: answered ? read.program : null,
    loading: !answered,
    error: answered ? read.error : null,
    reload,
  };
}

/**
 * The doctor's patients with their programs and sessions. Read again when
 * the window gets focus back and when `reload` is called. `error` is
 * 'setup' when the real clinic's tables are not there yet.
 */
export function usePatients(store: CareStore | null): {
  files: PatientFile[] | null;
  error: 'setup' | 'failed' | null;
  reload: () => void;
} {
  const [files, setFiles] = useState<PatientFile[] | null>(null);
  const [error, setError] = useState<'setup' | 'failed' | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((count) => count + 1), []);

  useEffect(() => {
    if (!store) return;
    let current = true;
    store
      .listPatients()
      .then((found) => {
        if (!current) return;
        setFiles(found);
        setError(null);
      })
      .catch((cause: unknown) => {
        console.warn('[care] could not read the patients', cause);
        if (current) setError(cause instanceof CareSetupError ? 'setup' : 'failed');
      });
    return () => {
      current = false;
    };
  }, [store, tick]);

  useRefresh(reload);
  return { files, error, reload };
}
