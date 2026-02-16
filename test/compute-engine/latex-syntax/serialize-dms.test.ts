import { normalizeAngle } from '../../../src/compute-engine/latex-syntax/serialize-dms';

describe('Angle Normalization', () => {
  test('none: no normalization', () => {
    expect(normalizeAngle(370, 'none')).toBe(370);
    expect(normalizeAngle(-45, 'none')).toBe(-45);
  });

  test('0...360: normalize to [0, 360)', () => {
    expect(normalizeAngle(370, '0...360')).toBeCloseTo(10, 10);
    expect(normalizeAngle(-45, '0...360')).toBeCloseTo(315, 10);
    expect(normalizeAngle(720, '0...360')).toBeCloseTo(0, 10);
  });

  test('-180...180: normalize to [-180, 180]', () => {
    expect(normalizeAngle(190, '-180...180')).toBeCloseTo(-170, 10);
    expect(normalizeAngle(-190, '-180...180')).toBeCloseTo(170, 10);
    expect(normalizeAngle(370, '-180...180')).toBeCloseTo(10, 10);
  });
});
