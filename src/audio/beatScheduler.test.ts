import { describe, expect, it } from 'vitest';
import { BeatGrid } from './beatGrid';
import { generateBeatmap } from './beatmap';
import { BeatScheduler, type DueBeat } from './beatScheduler';

/** Beats every 0.5 s from track time 0. */
const grid = new BeatGrid(generateBeatmap(120, 16));

/** Polls the scheduler every `stepSec` over [from, to] and collects what it hands out. */
function poll(scheduler: BeatScheduler, from: number, to: number, stepSec = 0.025): DueBeat[] {
  const steps = Math.round((to - from) / stepSec);
  const beats: DueBeat[] = [];
  for (let i = 0; i <= steps; i += 1) beats.push(...scheduler.due(from + i * stepSec));
  return beats;
}

describe('BeatScheduler', () => {
  it('hands out nothing while the first beat is beyond the lookahead', () => {
    const scheduler = new BeatScheduler(grid, 0.15);
    expect(scheduler.due(-0.25)).toEqual([]);
    expect(scheduler.due(-0.16)).toEqual([]);
  });

  it('hands out a beat as soon as it enters the lookahead window', () => {
    const scheduler = new BeatScheduler(grid, 0.15);
    expect(scheduler.due(-0.15)).toEqual([{ index: 0, time: 0 }]);
    expect(scheduler.due(0.3)).toEqual([]);
    expect(scheduler.due(0.36)).toEqual([{ index: 1, time: 0.5 }]);
  });

  it('hands out every beat exactly once, in order, when polled every 25 ms', () => {
    const beats = poll(new BeatScheduler(grid, 0.15), -0.25, 3.2);
    expect(beats.map((beat) => beat.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(beats.map((beat) => beat.time)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3]);
  });

  it('never repeats a beat when polled again at the same instant', () => {
    const scheduler = new BeatScheduler(grid, 0.15);
    expect(scheduler.due(0.4)).toHaveLength(1);
    expect(scheduler.due(0.4)).toEqual([]);
  });

  it('hands out several beats at once when the window covers them', () => {
    const scheduler = new BeatScheduler(grid, 1.2);
    expect(scheduler.due(0).map((beat) => beat.index)).toEqual([0, 1, 2]);
  });

  it('drops beats that were missed while the timer was stalled', () => {
    const scheduler = new BeatScheduler(grid, 0.15);
    poll(scheduler, -0.25, 0.2);
    expect(scheduler.due(2.4).map((beat) => beat.index)).toEqual([5]);
    expect(scheduler.due(2.9).map((beat) => beat.index)).toEqual([6]);
  });

  it('does not replay earlier beats when first polled mid-track', () => {
    const scheduler = new BeatScheduler(grid, 0.15);
    expect(scheduler.due(1.26)).toEqual([]);
    expect(scheduler.due(1.4)).toEqual([{ index: 3, time: 1.5 }]);
  });

  it('still hands out a beat that is due exactly now', () => {
    const scheduler = new BeatScheduler(grid, 0.15);
    expect(scheduler.due(1)).toEqual([{ index: 2, time: 1 }]);
  });

  it('starts at beat 0 even when the track opens with silence', () => {
    const late = new BeatGrid({ bpm: 120, offset: 1, beats: [1, 1.5, 2] });
    const scheduler = new BeatScheduler(late, 0.15);
    expect(poll(scheduler, -0.25, 0.8)).toEqual([]);
    expect(scheduler.due(0.9)).toEqual([{ index: 0, time: 1 }]);
  });

  it('keeps going past the end of the beat list and across loops', () => {
    const looped = new BeatGrid({ bpm: 120, offset: 0, beats: [0, 0.5, 1, 1.5] }, { loopDuration: 2 });
    const beats = poll(new BeatScheduler(looped, 0.15), -0.25, 4.6);
    expect(beats.map((beat) => beat.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(beats.map((beat) => beat.time)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5]);
  });
});
