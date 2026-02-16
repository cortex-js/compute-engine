import { normalizeAngle, degreesToDMS } from '../../../src/compute-engine/latex-syntax/serialize-dms';

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

describe('DMS Formatting', () => {
  test('whole degrees only', () => {
    expect(degreesToDMS(9)).toEqual({ deg: 9, min: 0, sec: 0 });
  });

  test('degrees and minutes', () => {
    expect(degreesToDMS(9.5)).toEqual({ deg: 9, min: 30, sec: 0 });
  });

  test('full DMS', () => {
    const result = degreesToDMS(9.504166666666666);
    expect(result.deg).toBe(9);
    expect(result.min).toBe(30);
    expect(result.sec).toBeCloseTo(15, 1);
  });

  test('negative degrees', () => {
    const result = degreesToDMS(-9.5);
    expect(result.deg).toBe(-9);
    expect(result.min).toBe(-30);
    expect(result.sec).toBe(0);
  });

  test('rounds seconds to avoid floating point noise', () => {
    const result = degreesToDMS(9.504166666666);
    expect(result.sec).toBeCloseTo(15, 2);
  });
});
