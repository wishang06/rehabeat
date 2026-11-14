import { describe, expect, it } from 'vitest';
import type { JointName } from '../types';
import { HINT_SWITCH_MARGIN_DEG, hintText, jointStatus, pickHintJoint } from './hints';

describe('jointStatus', () => {
  it('is green up to one tolerance, amber up to two, red beyond', () => {
    expect(jointStatus(0, 20)).toBe('green');
    expect(jointStatus(20, 20)).toBe('green');
    expect(jointStatus(20.1, 20)).toBe('amber');
    expect(jointStatus(40, 20)).toBe('amber');
    expect(jointStatus(40.1, 20)).toBe('red');
  });
});

describe('hintText', () => {
  const words = (text: string) => text.split(' ').length;

  it('tells an arm below its target to go higher, and one above it to go lower', () => {
    expect(hintText('leftShoulder', 40, 170)).toBe('left arm higher');
    expect(hintText('rightShoulder', 150, 90)).toBe('right arm lower');
  });

  it('asks a bent elbow to straighten and a straight one to bend', () => {
    expect(hintText('leftElbow', 120, 175)).toBe('straighten left elbow');
    expect(hintText('rightElbow', 178, 90)).toBe('bend right elbow');
  });

  it('reads hip flexion as the knee coming up: a smaller hip angle is a higher knee', () => {
    expect(hintText('leftHip', 175, 90)).toBe('left knee higher');
    expect(hintText('rightHip', 60, 90)).toBe('right knee lower');
  });

  it('asks a bent knee to straighten and a straight one to bend', () => {
    expect(hintText('leftKnee', 120, 180)).toBe('straighten left knee');
    expect(hintText('rightKnee', 175, 90)).toBe('bend right knee');
  });

  it('always uses two to four words', () => {
    const joints: JointName[] = ['leftShoulder', 'rightElbow', 'leftHip', 'rightKnee'];
    for (const joint of joints) {
      for (const [current, target] of [
        [10, 170],
        [170, 10],
      ]) {
        const n = words(hintText(joint, current, target));
        expect(n).toBeGreaterThanOrEqual(2);
        expect(n).toBeLessThanOrEqual(4);
      }
    }
  });
});

describe('pickHintJoint', () => {
  it('picks the joint with the largest error among those out of tolerance', () => {
    const errors = { leftShoulder: 30, rightShoulder: 55, leftElbow: 5 };
    expect(pickHintJoint(errors, 20, null)).toBe('rightShoulder');
  });

  it('returns null when every joint is within tolerance', () => {
    expect(pickHintJoint({ leftShoulder: 12, rightShoulder: 20 }, 20, null)).toBeNull();
  });

  it('keeps the current hint joint until another is worse by the switch margin', () => {
    const close = { leftShoulder: 40, rightShoulder: 40 + HINT_SWITCH_MARGIN_DEG - 1 };
    expect(pickHintJoint(close, 20, 'leftShoulder')).toBe('leftShoulder');

    const clear = { leftShoulder: 40, rightShoulder: 40 + HINT_SWITCH_MARGIN_DEG + 1 };
    expect(pickHintJoint(clear, 20, 'leftShoulder')).toBe('rightShoulder');
  });

  it('drops the current hint joint once it is back in tolerance', () => {
    expect(pickHintJoint({ leftShoulder: 10, rightShoulder: 25 }, 20, 'leftShoulder')).toBe(
      'rightShoulder',
    );
  });
});
