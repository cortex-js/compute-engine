import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

// Build `lim_{x→a} body`.
function lim(body: any, a: any) {
  return ce.expr(['Limit', ['Function', ce.expr(body), 'x'], ce.expr(a)]);
}

describe('LIMITS AT SPECIAL-FUNCTION POLES (soundness)', () => {
  // Regression: the symbolic limit engine used to substitute `Digamma(-1)` as a
  // finite symbol and return a WRONG 0 for `lim (x+1)·Digamma(x)`. It must now
  // never return that wrong value (it defers; the result stays unevaluated or is
  // computed correctly).
  test('a cancelled Digamma pole does not return a wrong finite value', () => {
    const e = lim(['Multiply', ['Add', 'x', 1], ['Digamma', 'x']], -1).evaluate();
    // The true limit is -1; the engine must NOT claim it is 0.
    expect(e.is(0)).not.toBe(true);
    // It defers rather than guessing: stays an unevaluated Limit.
    expect(e.operator).toBe('Limit');
  });

  test('cancelled Gamma/Zeta poles are not given a wrong value', () => {
    expect(
      lim(['Multiply', 'x', ['Gamma', 'x']], 0).evaluate().is(0)
    ).not.toBe(true);
    expect(
      lim(['Subtract', ['Gamma', 'x'], ['Divide', 1, 'x']], 0).evaluate().is(0)
    ).not.toBe(true);
  });

  // The numeric path still works where its sample ladder avoids the (integer-
  // spaced) poles: lim x·Gamma(x) at 0 = 1 (the residue of Gamma at 0).
  test('numeric evaluation recovers the value when sampling avoids poles', () => {
    expect(lim(['Multiply', 'x', ['Gamma', 'x']], 0).N().re).toBeCloseTo(1, 6);
  });

  describe('no over-deferral — ordinary limits are unaffected', () => {
    test('a special function away from its poles is not deferred', () => {
      // Gamma(2)/Gamma(3) = 1/2; neither argument is a pole.
      const e = lim(
        ['Divide', ['Gamma', 'x'], ['Gamma', ['Add', 'x', 1]]],
        2
      ).N();
      expect(e.re).toBeCloseTo(0.5, 10);
    });
    test('elementary limits keep their exact symbolic results', () => {
      expect(lim(['Divide', ['Sin', 'x'], 'x'], 0).evaluate().re).toBe(1);
      expect(
        lim(
          ['Divide', ['Subtract', ['Power', 'x', 2], 1], ['Subtract', 'x', 1]],
          1
        )
          .evaluate()
          .re
      ).toBe(2);
    });
  });
});

describe('CANCELLING ln/√ DIFFERENCES (CORRECTNESS_FINDINGS P0-3)', () => {
  // The asymptotic pass ranked co-dominant differences like `ln(x+1) − ln x`
  // by their (cancelling) leading terms and returned wrong finite limits.
  // They are now combined (`ln(u/v)`, conjugate quotients) before ranking.
  const INF = { sym: 'PositiveInfinity' };

  test('x·(ln(x+1) − ln x) → 1', () => {
    const e = lim(
      ['Multiply', 'x', ['Subtract', ['Ln', ['Add', 'x', 1]], ['Ln', 'x']]],
      INF
    ).evaluate();
    expect(e.isSame(ce.number(1))).toBe(true);
  });

  test('x·(ln(x+2) − ln x) → 2', () => {
    const e = lim(
      ['Multiply', 'x', ['Subtract', ['Ln', ['Add', 'x', 2]], ['Ln', 'x']]],
      INF
    ).evaluate();
    expect(e.isSame(ce.number(2))).toBe(true);
  });

  test('x·(√(x+1) − √x) → +∞', () => {
    const e = lim(
      ['Multiply', 'x', ['Subtract', ['Sqrt', ['Add', 'x', 1]], ['Sqrt', 'x']]],
      INF
    ).evaluate();
    expect(e.isSame(ce.PositiveInfinity)).toBe(true);
  });

  test('√x·(√(x+1) − √x) → 1/2 (exact)', () => {
    const e = lim(
      [
        'Multiply',
        ['Sqrt', 'x'],
        ['Subtract', ['Sqrt', ['Add', 'x', 1]], ['Sqrt', 'x']],
      ],
      INF
    ).evaluate();
    expect(e.isSame(ce.expr(['Rational', 1, 2]))).toBe(true);
  });

  test('ln(2x) − ln x → ln 2 (exact); ln(x+1) − ln x → 0', () => {
    expect(
      lim(['Subtract', ['Ln', ['Multiply', 2, 'x']], ['Ln', 'x']], INF)
        .evaluate()
        .isSame(ce.expr(['Ln', 2]))
    ).toBe(true);
    expect(
      lim(['Subtract', ['Ln', ['Add', 'x', 1]], ['Ln', 'x']], INF)
        .evaluate()
        .isSame(ce.number(0))
    ).toBe(true);
  });

  test('controls unchanged: x²−x → +∞, ln x − x → −∞, x·e^{−x} → 0', () => {
    expect(
      lim(['Subtract', ['Power', 'x', 2], 'x'], INF)
        .evaluate()
        .isSame(ce.PositiveInfinity)
    ).toBe(true);
    expect(
      lim(['Subtract', ['Ln', 'x'], 'x'], INF)
        .evaluate()
        .isSame(ce.NegativeInfinity)
    ).toBe(true);
    expect(
      lim(['Multiply', 'x', ['Exp', ['Negate', 'x']]], INF)
        .evaluate()
        .isSame(ce.number(0))
    ).toBe(true);
  });
});
