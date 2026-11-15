/**
 * A simulated player through the whole path from pose angles to a result:
 * AngleSmoother -> ScoringEngine, on a 72 BPM beat grid. The player moves
 * like a person (minimum-jerk reaches), the landmarks are noisy and the
 * camera's frame rate is not steady, so these tests check that the game hears
 * the player on the beat. The song never waits: a move the player misses is a
 * Miss, and the next move is scored on its own.
 */
import { describe, expect, it } from 'vitest';
import { AngleSmoother } from '../pose/angleSmoother';
import type { BeatResult, Move, PoseFrame } from '../types';
import { Routine } from './routine';
import { ScoringEngine } from './scoringEngine';

const BPM = 72;
const SPB = 60 / BPM;
const REST = 10;
const TARGET = 90;
/** How long a reach or a release takes the player. */
const MOVE_SEC = 0.6;
/** The angle at which the score crosses Good (one tolerance short of the target). */
const GOOD_ANGLE = 70;

const sideRaise: Move = {
  id: 'side-arm-raise',
  name: 'Side Arm Raise',
  joints: { leftShoulder: TARGET, rightShoulder: TARGET },
  tolerance: 20,
  beats: { reach: 2, hold: 4, release: 2 },
  formRules: [],
};
const routine = new Routine([sideRaise]);
const cycleBeats = 8;
const holdStart = (cycle: number) => (cycle * cycleBeats + 2) * SPB;
const holdEnd = (cycle: number) => (cycle * cycleBeats + 6) * SPB;

/** Minimum-jerk position 0 to 1 for s in [0, 1]: how a hand moves to a target. */
const minJerk = (s: number) => (s <= 0 ? 0 : s >= 1 ? 1 : 10 * s ** 3 - 15 * s ** 4 + 6 * s ** 5);
/** The s in [0, 1] at which minJerk(s) reaches `fraction`. */
function minJerkAt(fraction: number): number {
  let low = 0;
  let high = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (minJerk(mid) < fraction) low = mid;
    else high = mid;
  }
  return low;
}

/** What the player does in one cycle, in beats relative to the hold. */
interface CyclePlan {
  /** Beats after the hold starts that the arm reaches the target; null to sit the move out. */
  arriveBeats: number | null;
  /** Beats after the hold ends that the arm starts coming down. */
  leaveBeats?: number;
  /** Beats after the hold starts that the arm sags to `sagDeg` and stays there until it leaves. */
  sagBeats?: number;
  sagDeg?: number;
}

interface Movement {
  arrive: number;
  leave: number;
  sag: { at: number; deg: number } | null;
}

/** How long a sag takes. */
const SAG_SEC = 0.3;

function movements(plans: readonly CyclePlan[]): (Movement | null)[] {
  return plans.map((plan, cycle) =>
    plan.arriveBeats === null
      ? null
      : {
          arrive: holdStart(cycle) + plan.arriveBeats * SPB,
          leave: holdEnd(cycle) + (plan.leaveBeats ?? 0) * SPB,
          sag:
            plan.sagBeats === undefined
              ? null
              : { at: holdStart(cycle) + plan.sagBeats * SPB, deg: plan.sagDeg ?? TARGET },
        },
  );
}

/** The clean arm angle at time t. */
function armAt(t: number, moves: readonly (Movement | null)[]): number {
  for (const move of moves) {
    if (!move) continue;
    if (t >= move.arrive - MOVE_SEC && t <= move.arrive) {
      return REST + (TARGET - REST) * minJerk((t - (move.arrive - MOVE_SEC)) / MOVE_SEC);
    }
    const held = move.sag && t >= move.sag.at ? move.sag.deg : TARGET;
    if (t > move.arrive && t < move.leave) {
      if (!move.sag || t < move.sag.at) return TARGET;
      return TARGET - (TARGET - move.sag.deg) * minJerk((t - move.sag.at) / SAG_SEC);
    }
    if (t >= move.leave && t <= move.leave + MOVE_SEC) {
      return held - (held - REST) * minJerk((t - move.leave) / MOVE_SEC);
    }
  }
  return REST;
}

/** When the clean arm crosses the Good line on the way up. */
const reachesGood = (move: Movement) =>
  move.arrive - MOVE_SEC + MOVE_SEC * minJerkAt((GOOD_ANGLE - REST) / (TARGET - REST));

/** Seeded uniform [0, 1) and standard normal noise, so the simulation never flakes. */
function random(seed: number) {
  let state = seed;
  const uniform = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const gaussian = () => Math.sqrt(-2 * Math.log(uniform() + 1e-12)) * Math.cos(2 * Math.PI * uniform());
  return { uniform, gaussian };
}

interface SimOptions {
  fps?: number;
  /** Each frame interval varies by up to this fraction either way. */
  intervalJitter?: number;
  /** Landmark noise on each arm, in degrees (standard deviation). */
  noiseDeg?: number;
  seed?: number;
}

interface SimRun {
  results: BeatResult[];
  moves: (Movement | null)[];
}

function simulate(plans: readonly CyclePlan[], options: SimOptions = {}): SimRun {
  const { fps = 30, intervalJitter = 0, noiseDeg = 2, seed = 1 } = options;
  const { uniform, gaussian } = random(seed);
  const moves = movements(plans);
  const smoother = new AngleSmoother();
  const engine = new ScoringEngine({ routine, timeOfBeat: (beat) => beat * SPB });

  const results: BeatResult[] = [];
  const end = plans.length * cycleBeats * SPB + 0.1;
  for (let t = 0; t < end; t += (1 / fps) * (1 + intervalJitter * (2 * uniform() - 1))) {
    const raw = {
      leftShoulder: armAt(t, moves) + noiseDeg * gaussian(),
      rightShoulder: armAt(t, moves) + noiseDeg * gaussian(),
    };
    const angles = smoother.smooth(raw, t);
    const frame: PoseFrame = { t, angles, visible: ['leftShoulder', 'rightShoulder'] };
    results.push(...engine.push(frame));
  }
  return { results, moves };
}

const onTime: CyclePlan = { arriveBeats: 0 };

describe('rhythm simulation: a player through pose smoothing and scoring', () => {
  it('an on-time player scores Perfect every cycle', () => {
    const run = simulate([onTime, onTime, onTime, onTime]);
    expect(run.results.map((result) => result.label)).toEqual(['Perfect', 'Perfect', 'Perfect', 'Perfect']);
    // The measured arrival is within 25 ms of when the arm really crossed the Good line
    // (7-21 ms here; the old filter settings gave 29-37 ms).
    run.results.forEach((result, cycle) => {
      const truthMs = (reachesGood(run.moves[cycle]!) - holdStart(cycle)) * 1000;
      expect(Math.abs(result.timingOffsetMs - truthMs)).toBeLessThan(25);
    });
  });

  it('a player whose arms sag just under Good gets a Miss for that hold', () => {
    // Lands in the reach, then sags to 67.5 degrees (score 55) as the hold starts: under Good,
    // but above the line at which the lock lets go.
    const run = simulate([{ arriveBeats: -0.5, sagBeats: 0, sagDeg: 67.5 }]);
    expect(run.results[0].label).toBe('Miss');
  });

  it('releasing a quarter beat early after a good hold is not a Miss', () => {
    const early: CyclePlan = { arriveBeats: 0, leaveBeats: -0.25 };
    const run = simulate([early, early, early]);
    expect(run.results.every((result) => result.label !== 'Miss')).toBe(true);
  });

  it('a player who sits a move out misses it and catches up on the next one', () => {
    const run = simulate([onTime, { arriveBeats: null }, onTime, onTime]);
    // The song carries on through the missed move: it is one Miss, and the moves after it score as usual.
    expect(run.results.map((result) => result.label)).toEqual(['Perfect', 'Miss', 'Perfect', 'Perfect']);
  });

  it('a player who lets go half-way through a hold can still land the next one', () => {
    const run = simulate([{ arriveBeats: 0, leaveBeats: -2 }, onTime]);
    expect(run.results[0].label).not.toBe('Perfect');
    expect(run.results[1].label).toBe('Perfect');
  });

  it('a 15 fps player (the CPU delegate on a slow laptop) still scores Perfect on time', () => {
    const run = simulate([onTime, onTime, onTime], { fps: 15, seed: 2 });
    expect(run.results.map((result) => result.label)).toEqual(['Perfect', 'Perfect', 'Perfect']);
  });

  it("irregular frame intervals do not change an on-time player's result", () => {
    const run = simulate([onTime, onTime, onTime], { intervalJitter: 0.3, seed: 3 });
    expect(run.results.map((result) => result.label)).toEqual(['Perfect', 'Perfect', 'Perfect']);
    run.results.forEach((result, cycle) => {
      const truthMs = (reachesGood(run.moves[cycle]!) - holdStart(cycle)) * 1000;
      expect(Math.abs(result.timingOffsetMs - truthMs)).toBeLessThan(25);
    });
  });
});
