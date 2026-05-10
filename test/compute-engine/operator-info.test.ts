import { ComputeEngine } from '../../src/compute-engine';

describe('ce.operatorInfo()', () => {
  const ce = new ComputeEngine();

  test('returns undefined for unknown head', () => {
    expect(ce.operatorInfo('TotallyNotAHead')).toBeUndefined();
  });

  test('returns function kind for an evaluable operator', () => {
    const info = ce.operatorInfo('Add');
    expect(info).toBeDefined();
    expect(info?.kind).toBe('function');
    expect(info?.signature).toBeDefined();
  });

  test('returns function kind for Range', () => {
    const info = ce.operatorInfo('Range');
    expect(info).toBeDefined();
    expect(info?.kind).toBe('function');
  });

  test('signature is a BoxedType (not a string)', () => {
    const info = ce.operatorInfo('Add');
    expect(info?.signature).toBeDefined();
    // BoxedType has a .matches method and stringifies via toString
    expect(typeof info?.signature?.matches).toBe('function');
    expect(typeof String(info?.signature)).toBe('string');
  });

  test('does not return info for pure constants', () => {
    // Pi is a value definition, not an operator definition.
    // operatorInfo is for function-position heads only.
    expect(ce.operatorInfo('Pi')).toBeUndefined();
  });

  test('returns opaque kind for a typed-but-no-evaluator head', () => {
    // Triangle is registered as an operator (has a signature) but has no
    // evaluate or collection handler, making it opaque.
    const info = ce.operatorInfo('Triangle');
    expect(info).toBeDefined();
    expect(info?.kind).toBe('opaque');
  });
});
