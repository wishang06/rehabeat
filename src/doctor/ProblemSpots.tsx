import type { Finding } from '../care';
import { Sparkline } from './Sparkline';

/** Pink is for what needs attention: a breach, or anything getting worse. Cyan is for what is improving. */
function toneOf(finding: Finding): 'cyan' | 'pink' | 'dim' {
  if (finding.kind === 'breach' || finding.trend === 'worse') return 'pink';
  return finding.trend === 'better' ? 'cyan' : 'dim';
}

interface ProblemSpotsProps {
  findings: readonly Finding[];
  /** Whether the patient has any session at all. */
  hasSessions: boolean;
}

/** Where the patient's recent sessions go wrong, most pressing first, each with its trend. */
export function ProblemSpots({ findings, hasSessions }: ProblemSpotsProps) {
  if (!hasSessions) return <p className="doc-quiet">No sessions yet.</p>;
  if (findings.length === 0) return <p className="doc-quiet">Nothing stands out in the last sessions.</p>;
  return (
    <ul className="doc-spots" data-testid="problem-spots">
      {findings.map((finding) => {
        const tone = toneOf(finding);
        const [lead, ...rest] = finding.text.split(': ');
        return (
          <li key={`${finding.kind}:${finding.moveId}:${finding.joint}:${finding.ruleId}`} data-tone={tone}>
            <span>
              {rest.length > 0 ? (
                <>
                  <b>{lead}:</b> {rest.join(': ')}
                </>
              ) : (
                finding.text
              )}
            </span>
            <Sparkline series={finding.series} tone={tone} />
          </li>
        );
      })}
    </ul>
  );
}
