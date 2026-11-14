/**
 * Problem spots: where a patient's recent sessions go wrong, each with a
 * trend against the sessions before them. Every finding carries its numbers
 * as well as a sentence, so anything that reads findings later (the doctor's
 * page now, a drafted summary later) reads the same thing.
 */
import type { JointName, Move } from '../../types';
import { capitalize, jointLabel, partOf } from '../labels';
import type { HoldRecord, SessionRecord } from '../types';

/** How many of the latest sessions count as recent. The same number before them is what they are compared with. */
export const RECENT_SESSIONS = 3;
/** A joint this many degrees short of, or past, its target is reported. */
export const JOINT_REPORT_DEG = 8;
/** A hold counts toward a joint finding only if the joint was in view for this share of it. */
export const JOINT_SEEN_MIN = 0.5;
/** A form rule flagged on this share of a move's holds is reported. */
export const FORM_REPORT_SHARE = 0.3;
/** Arriving this late on average is reported. */
export const LATE_REPORT_MS = 300;
/** A scored joint out of view for this share of its holds is reported. */
export const VIEW_REPORT_SHARE = 0.2;
/** A change of more than this fraction of the earlier value counts as better or worse. */
export const TREND_STEP = 0.2;
/** Sessions shown in a finding's trend line. */
export const SERIES_SESSIONS = 6;

export type FindingKind = 'breach' | 'joint' | 'form' | 'timing' | 'view';
export type Trend = 'better' | 'worse' | 'same' | 'new';

export interface Finding {
  kind: FindingKind;
  moveId: string | null;
  joint: JointName | null;
  ruleId: string | null;
  /**
   * joint: degrees short of the target (negative: past it). form: share of holds flagged.
   * breach: holds past the limit. timing: ms late. view: share of the hold out of view.
   */
  value: number;
  /** The same over the sessions before the recent ones, or null when they have nothing to compare. */
  previous: number | null;
  trend: Trend;
  /** The value in each of the last few sessions that have one, oldest first. */
  series: number[];
  text: string;
}

const KIND_ORDER: readonly FindingKind[] = ['breach', 'joint', 'form', 'timing', 'view'];

const FORM_PHRASE: Readonly<Record<string, string>> = {
  'trunk-lean': 'trunk leans',
  'shoulder-shrug': 'shoulders rise',
};

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

const holdsOf = (sessions: readonly SessionRecord[]): HoldRecord[] => sessions.flatMap((session) => session.holds);

/** Degrees of movement short of the target (negative: past it), from a signed angle error. */
function shortfall(joint: JointName, meanError: number): number {
  // A shoulder opens as the arm rises, so reading under the target is short. The other joints close as they bend.
  return partOf(joint) === 'Shoulder' ? -meanError : meanError;
}

function trendOf(value: number, previous: number | null): Trend {
  if (previous === null) return 'new';
  const [size, before] = [Math.abs(value), Math.abs(previous)];
  if (before === 0) return size > 0 ? 'worse' : 'same';
  if (size < before * (1 - TREND_STEP)) return 'better';
  if (size > before * (1 + TREND_STEP)) return 'worse';
  return 'same';
}

/** What one finding measures: a number from a set of holds, or null when they say nothing about it. */
interface Measure {
  kind: FindingKind;
  moveId: string | null;
  joint: JointName | null;
  ruleId: string | null;
  of: (holds: HoldRecord[]) => number | null;
  reported: (value: number) => boolean;
  text: (value: number, previous: number | null, trend: Trend, recent: HoldRecord[], before: HoldRecord[]) => string;
}

const suffix = (trend: Trend, was: string | null): string =>
  trend === 'same' ? ' No change.' : (trend === 'better' || trend === 'worse') && was !== null ? ` Was ${was}.` : '';

function measuresFor(recent: HoldRecord[], moves: readonly Move[]): Measure[] {
  const nameOf = (moveId: string) => moves.find((move) => move.id === moveId)?.name ?? moveId;
  const measures: Measure[] = [];
  const seen = new Set<string>();
  const once = (key: string) => (seen.has(key) ? false : (seen.add(key), true));

  for (const hold of recent) {
    for (const joint of hold.overLimit) {
      if (!once(`breach|${joint}`)) continue;
      measures.push({
        kind: 'breach',
        moveId: null,
        joint,
        ruleId: null,
        of: (holds) => (holds.length === 0 ? null : holds.filter((h) => h.overLimit.includes(joint)).length),
        reported: (value) => value >= 1,
        text: (value) =>
          `${capitalize(jointLabel(joint))} went past its limit on ${value} ${value === 1 ? 'hold' : 'holds'}.`,
      });
    }

    for (const joint of Object.keys(hold.joints) as JointName[]) {
      if (once(`joint|${hold.moveId}|${joint}`)) {
        const moveId = hold.moveId;
        measures.push({
          kind: 'joint',
          moveId,
          joint,
          ruleId: null,
          of: (holds) =>
            mean(
              holds.flatMap((h) => {
                const measured = h.moveId === moveId ? h.joints[joint] : undefined;
                return measured && measured.seen >= JOINT_SEEN_MIN ? [shortfall(joint, measured.meanError)] : [];
              }),
            ),
          reported: (value) => Math.abs(value) >= JOINT_REPORT_DEG,
          text: (value, previous, trend) => {
            const degrees = Math.round(Math.abs(value));
            const how = value >= 0 ? `stops ${degrees}° short` : `goes ${degrees}° past`;
            const was = previous === null ? null : `${Math.round(Math.abs(previous))}°`;
            return `${nameOf(moveId)}: ${jointLabel(joint)} ${how}.${suffix(trend, was)}`;
          },
        });
      }
      if (once(`view|${joint}`)) {
        measures.push({
          kind: 'view',
          moveId: null,
          joint,
          ruleId: null,
          of: (holds) => mean(holds.flatMap((h) => (h.joints[joint] ? [1 - h.joints[joint].seen] : []))),
          reported: (value) => value >= VIEW_REPORT_SHARE,
          text: (value) =>
            `${capitalize(jointLabel(joint))} is out of view for ${Math.round(value * 100)}% of the hold.`,
        });
      }
    }

    for (const ruleId of hold.formFlags) {
      if (!once(`form|${hold.moveId}|${ruleId}`)) continue;
      const moveId = hold.moveId;
      const count = (holds: HoldRecord[]) => {
        const ofMove = holds.filter((h) => h.moveId === moveId);
        return { flagged: ofMove.filter((h) => h.formFlags.includes(ruleId)).length, total: ofMove.length };
      };
      measures.push({
        kind: 'form',
        moveId,
        joint: null,
        ruleId,
        of: (holds) => {
          const { flagged, total } = count(holds);
          return total === 0 ? null : flagged / total;
        },
        reported: (value) => value >= FORM_REPORT_SHARE,
        text: (_value, _previous, trend, recentHolds, beforeHolds) => {
          const now = count(recentHolds);
          const then = count(beforeHolds);
          // "Was 6 of 10" only reads right against the same number of holds.
          const was = then.total === now.total ? `${then.flagged} of ${then.total}` : null;
          const phrase = FORM_PHRASE[ruleId] ?? ruleId;
          return `${nameOf(moveId)}: ${phrase} on ${now.flagged} of ${now.total} holds.${suffix(trend, was)}`;
        },
      });
    }
  }

  measures.push({
    kind: 'timing',
    moveId: null,
    joint: null,
    ruleId: null,
    of: (holds) => mean(holds.filter((h) => h.label !== 'Miss').map((h) => h.timingOffsetMs)),
    reported: (value) => value >= LATE_REPORT_MS,
    text: (value, previous, trend) =>
      `Arrives ${(value / 1000).toFixed(1)} s late on average.${suffix(trend, previous === null ? null : `${(previous / 1000).toFixed(1)} s`)}`,
  });
  return measures;
}

/**
 * The problem spots in a patient's sessions, most pressing first: limit
 * breaches, then joints off their target, form rules, lateness and joints
 * out of view. `sessions` in any order; `moves` only supplies names.
 */
export function findings(sessions: readonly SessionRecord[], moves: readonly Move[]): Finding[] {
  const ordered = [...sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const recentSessions = ordered.slice(-RECENT_SESSIONS);
  const beforeSessions = ordered.slice(-2 * RECENT_SESSIONS, -RECENT_SESSIONS);
  const recent = holdsOf(recentSessions);
  const before = holdsOf(beforeSessions);

  const found: Finding[] = [];
  for (const measure of measuresFor(recent, moves)) {
    const value = measure.of(recent);
    if (value === null || !measure.reported(value)) continue;
    const previous = measure.of(before);
    const trend = trendOf(value, previous);
    found.push({
      kind: measure.kind,
      moveId: measure.moveId,
      joint: measure.joint,
      ruleId: measure.ruleId,
      value,
      previous,
      trend,
      series: ordered
        .slice(-SERIES_SESSIONS)
        .map((session) => measure.of(session.holds))
        .filter((point): point is number => point !== null),
      text: measure.text(value, previous, trend, recent, before),
    });
  }

  // A stable sort: findings of one kind keep the order they were found in when their sizes tie.
  return found.sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || Math.abs(b.value) - Math.abs(a.value),
  );
}
