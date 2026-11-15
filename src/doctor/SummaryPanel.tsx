import { useState } from 'react';
import { requestDraft, summaryInput, type Draft, type PatientFile } from '../care';
import { MOVES } from '../moves';

interface SummaryPanelProps {
  file: PatientFile;
  today: string;
  /** Puts the drafted note into the note box, for the doctor to edit and send. */
  onUseNote: (note: string) => void;
}

type State =
  | { kind: 'idle' }
  | { kind: 'drafting' }
  | { kind: 'failed'; message: string }
  | { kind: 'done'; draft: Draft };

/**
 * A summary of the patient drafted by Gemini from the numbers on this page,
 * on the doctor's request. Nothing reaches the patient from here: the drafted
 * note only goes into the note box, and the doctor edits it and presses
 * Save and send as usual. The draft is not stored.
 */
export function SummaryPanel({ file, today, onUseNote }: SummaryPanelProps) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const hasSessions = file.sessions.length > 0;

  const draft = () => {
    setState({ kind: 'drafting' });
    void requestDraft(summaryInput(file, today, MOVES)).then((result) =>
      setState(result.ok ? { kind: 'done', draft: result.draft } : { kind: 'failed', message: result.message }),
    );
  };

  return (
    <section className="doc-panel doc-ai" data-testid="summary-panel" aria-live="polite">
      <div className="doc-ai__head">
        <h2 className="label">Summary</h2>
        <button
          type="button"
          className="doc-btn"
          data-testid="summary-draft"
          disabled={!hasSessions || state.kind === 'drafting'}
          onClick={draft}
        >
          {state.kind === 'drafting' ? 'Drafting…' : state.kind === 'done' ? 'Draft again' : 'Draft with Gemini'}
        </button>
      </div>

      {!hasSessions && <p className="doc-quiet">No sessions to summarise yet.</p>}
      {hasSessions && state.kind === 'idle' && (
        <p className="doc-quiet">
          Gemini drafts a summary, changes to consider and a note to {file.patient.name}. It is sent the condition,
          program, scores and problem spots on this page, never the patient’s name.
        </p>
      )}
      {state.kind === 'failed' && (
        <p className="doc-error" role="alert" data-testid="summary-error">
          {state.message}
        </p>
      )}

      {state.kind === 'done' && (
        <div className="doc-ai__draft" data-testid="summary-draft-text">
          <p className="doc-ai__badge">Drafted by Gemini from the numbers on this page. Check it before you use any of it.</p>
          <p className="doc-ai__summary">{state.draft.summary}</p>
          {state.draft.suggestions.length > 0 && (
            <>
              <h3 className="label">To consider</h3>
              <ul className="doc-ai__suggestions">
                {state.draft.suggestions.map((suggestion) => (
                  <li key={suggestion}>{suggestion}</li>
                ))}
              </ul>
            </>
          )}
          <h3 className="label">Draft note to {file.patient.name}</h3>
          <blockquote className="doc-ai__note">{state.draft.note}</blockquote>
          <button
            type="button"
            className="doc-btn"
            data-testid="summary-use-note"
            onClick={() => onUseNote(state.draft.note)}
          >
            Use as note
          </button>
        </div>
      )}
    </section>
  );
}
