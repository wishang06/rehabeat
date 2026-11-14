import { LIMIT_SLIDER, capitalize, jointLabel, limitText, partOf, type PrescriptionBody } from '../care';
import type { JointLimit } from '../scoring';
import { JOINT_NAMES, type JointName } from '../types';
import { setLimit } from './editor';

/** The limit a joint starts on when "Up to" is picked. */
const START_DEG = 90;

type Choice = 'none' | 'range' | 'off';

const CHOICES: readonly [Choice, string][] = [
  ['none', 'No limit'],
  ['range', 'Up to'],
  ['off', 'Off'],
];

interface LimitsEditorProps {
  draft: PrescriptionBody;
  onChange: (next: PrescriptionBody) => void;
}

/**
 * A limit for each joint: none, off, or a range. A range is set as movement
 * from rest ("raise up to 90°"), the way it is prescribed, not as the game's own angle.
 */
export function LimitsEditor({ draft, onChange }: LimitsEditorProps) {
  const choose = (joint: JointName, choice: Choice) => {
    const slider = LIMIT_SLIDER[partOf(joint)];
    const limit: JointLimit | null =
      choice === 'none'
        ? null
        : choice === 'off'
          ? { kind: 'off' }
          : { kind: 'range', maxDeg: Math.min(slider.max, START_DEG) };
    onChange(setLimit(draft, joint, limit));
  };

  return (
    <div className="doc-limits">
      {JOINT_NAMES.map((joint) => {
        const limit = draft.limits[joint];
        const choice: Choice = limit ? limit.kind : 'none';
        const slider = LIMIT_SLIDER[partOf(joint)];
        const name = capitalize(jointLabel(joint));
        return (
          <fieldset key={joint} className="doc-limit" data-testid={`limit-${joint}`}>
            <legend>{name}</legend>
            <div className="doc-seg">
              {CHOICES.map(([value, label]) => (
                <label key={value} data-on={choice === value} data-limit={value !== 'none'}>
                  <input
                    type="radio"
                    name={`limit-${joint}`}
                    value={value}
                    checked={choice === value}
                    onChange={() => choose(joint, value)}
                  />
                  {label}
                </label>
              ))}
            </div>
            {limit?.kind === 'range' && (
              <label className="doc-limit__range">
                <input
                  type="range"
                  min={slider.min}
                  max={slider.max}
                  step={slider.step}
                  value={limit.maxDeg}
                  aria-label={`${name}: degrees of movement allowed`}
                  onChange={(event) =>
                    onChange(setLimit(draft, joint, { kind: 'range', maxDeg: Number(event.target.value) }))
                  }
                />
                <span className="doc-num">{limitText(joint, limit).split(': ')[1]}</span>
              </label>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
