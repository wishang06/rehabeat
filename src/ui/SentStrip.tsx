import { useCallback, useEffect, useRef, useState } from 'react';
import { dayKey, sentView, type CareStore, type MyProgram, type SessionRecord } from '../care';
import { MOVES } from '../moves';

/** A finished program session, and where to send it. */
export interface SentCare {
  store: CareStore;
  program: MyProgram;
  session: SessionRecord;
}

interface SentStripProps {
  care: SentCare;
  /** Called once the session is saved, so the title card can show the new count. */
  onSaved: () => void;
}

type SendState = 'sending' | 'sent' | 'failed';

/**
 * On the results screen after a program session: sends the session to the
 * doctor, and tells the patient what was sent. A failed send says so and can
 * be tried again; the session keeps its id, so trying again cannot send it twice.
 */
export function SentStrip({ care, onSaved }: SentStripProps) {
  const { store, program, session } = care;
  const [state, setState] = useState<SendState>('sending');
  const attempted = useRef<string | null>(null);

  const send = useCallback(() => {
    setState('sending');
    store
      .saveSession(session)
      .then(() => {
        setState('sent');
        onSaved();
      })
      .catch((cause: unknown) => {
        console.error('Could not send the session', cause);
        setState('failed');
      });
  }, [store, session, onSaved]);

  // Send once per session, as the screen arrives.
  useEffect(() => {
    if (attempted.current === session.id) return;
    attempted.current = session.id;
    send();
  }, [session.id, send]);

  const view = sentView(program, session, MOVES, dayKey(new Date()));
  const doctor = program.doctorName;

  return (
    <section className="sent slab" data-testid="sent-strip" aria-live="polite">
      <h2 className="sent__head label" data-testid="sent-status">
        {state === 'sent' ? `Sent to ${doctor}` : state === 'sending' ? `Sending to ${doctor}…` : 'Not sent.'}
      </h2>
      {state === 'failed' && (
        <button type="button" className="button button--quiet" onClick={send} data-testid="sent-retry">
          Try again
        </button>
      )}
      <dl className="sent__numbers">
        <div>
          <dd className="led">{Math.round(view.average)}</dd>
          <dt>average</dt>
        </div>
        <div>
          <dd className="led">{view.holds}</dd>
          <dt>{view.holds === 1 ? 'hold' : 'holds'}</dt>
        </div>
        {view.week && (
          <div>
            <dd className="led">
              {view.week.done}/{view.week.prescribed}
            </dd>
            <dt>this week</dt>
          </div>
        )}
      </dl>
      {view.workOn && <p className="sent__work">Work on: {view.workOn}</p>}
      {view.partial && <p className="sent__work">Ended early: this session does not count toward your week.</p>}
      <p className="sent__privacy">
        Only scores and joint angles are sent. The camera picture never leaves this laptop.
      </p>
    </section>
  );
}
