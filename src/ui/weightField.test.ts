import { describe, expect, it } from 'vitest';
import { leaveField, openField, switchFieldUnit, typeInField } from './weightField';

describe('openField', () => {
  it('shows the saved weight in its unit, or nothing', () => {
    expect(openField(70, 'kg')).toEqual({ draft: '70', edited: false, refused: false });
    expect(openField(null, 'kg')).toEqual({ draft: '', edited: false, refused: false });
  });
});

describe('leaveField', () => {
  it('saves what was typed, in the unit showing', () => {
    const typed = typeInField(openField(null, 'kg'), '72,5');
    expect(leaveField(typed, 'kg')).toEqual({
      state: { draft: '72.5', edited: false, refused: false },
      save: { kg: 72.5, unit: 'kg' },
    });
  });

  it('clears the saved weight when the field is emptied', () => {
    const emptied = typeInField(openField(70, 'kg'), '');
    expect(leaveField(emptied, 'kg').save).toEqual({ kg: null, unit: 'kg' });
  });

  it('refuses what is not a weight, keeps it in the field and saves nothing', () => {
    const typed = typeInField(openField(70, 'kg'), 'abc');
    expect(leaveField(typed, 'kg')).toEqual({ state: { draft: 'abc', edited: true, refused: true } });
  });

  it('writes nothing when nothing was typed', () => {
    const untouched = openField(70, 'kg');
    expect(leaveField(untouched, 'kg')).toEqual({ state: untouched });
  });

  it('does not refuse a saved weight whose rounded display is just out of range', () => {
    // 30 kg shows as 66.1 lb, which reads back as a hair under 30 kg.
    const untouched = openField(30, 'lb');
    expect(untouched.draft).toBe('66.1');
    expect(leaveField(untouched, 'lb').state.refused).toBe(false);
  });
});

describe('switchFieldUnit', () => {
  it('reads a number typed before the unit was chosen in the unit chosen', () => {
    const typed = typeInField(openField(null, 'kg'), '154');
    const { state, save } = switchFieldUnit(typed, null, 'lb');
    expect(state).toEqual({ draft: '154', edited: false, refused: false });
    expect(save.unit).toBe('lb');
    expect(save.kg).toBeCloseTo(69.85, 1);
  });

  it('accepts a typed number that only makes sense in the new unit', () => {
    // 250 is too heavy in kg and fine in lb.
    const typed = typeInField(openField(null, 'kg'), '250');
    const { state, save } = switchFieldUnit(typed, null, 'lb');
    expect(state.refused).toBe(false);
    expect(save.kg).toBeCloseTo(113.4, 1);
  });

  it('converts a saved weight that was not retyped', () => {
    const { state, save } = switchFieldUnit(openField(70, 'kg'), 70, 'lb');
    expect(state).toEqual({ draft: '154.3', edited: false, refused: false });
    expect(save).toEqual({ kg: 70, unit: 'lb' });
  });

  it('keeps what was typed and says so when it is not a weight in the new unit either', () => {
    const typed = typeInField(openField(80, 'kg'), 'abc');
    expect(switchFieldUnit(typed, 80, 'lb')).toEqual({
      state: { draft: 'abc', edited: true, refused: true },
      save: { kg: 80, unit: 'lb' },
    });
  });

  it('converts after a typed weight has been saved', () => {
    const saved = leaveField(typeInField(openField(null, 'kg'), '70'), 'kg').state;
    expect(switchFieldUnit(saved, 70, 'lb').state.draft).toBe('154.3');
  });
});
