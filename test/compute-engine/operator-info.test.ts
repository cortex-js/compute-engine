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

  test('canEvaluate is true for operators with an evaluation rule', () => {
    // Heads that carry an evaluate handler...
    for (const head of ['Sin', 'Add', 'Eigenvalues', 'Which', 'If'])
      expect(ce.operatorInfo(head)?.canEvaluate).toBe(true);
    // ...or a collection handler (Range computes by enumeration).
    expect(ce.operatorInfo('Range')?.canEvaluate).toBe(true);
  });

  test('canEvaluate is false for registered-but-inert heads', () => {
    // Triangle and To are registered operators (they parse/serialize) but
    // provide no evaluation rule: evaluate() returns them unchanged.
    for (const head of ['Triangle', 'To'])
      expect(ce.operatorInfo(head)?.canEvaluate).toBe(false);
  });

  test('canEvaluate tracks kind === "function"', () => {
    for (const head of ['Sin', 'Add', 'Triangle', 'To', 'Range'])
      expect(ce.operatorInfo(head)?.canEvaluate).toBe(
        ce.operatorInfo(head)?.kind === 'function'
      );
  });

  test('canEvaluate reports false for heads that reduce only via canonicalization', () => {
    // Documented caveat: these compute through a `canonical` rewrite to a
    // different operator (Exp/Square -> Power, Greater -> Less, Complex),
    // so they carry no evaluate/collection handler of their own.
    for (const head of ['Exp', 'Square', 'Greater', 'Complex'])
      expect(ce.operatorInfo(head)?.canEvaluate).toBe(false);
  });
});
