import { ComputeEngine } from '../../src/compute-engine';

// A fresh engine so the `ce.assign('x', …)` cases don't leak into the shared
// test engine.
const ce = new ComputeEngine();

const M = (v: number, e: number) => ce.function('Measurement', [v, e]);

/** Nominal value of a (possibly evaluated) Measurement, as a float. */
function nominal(expr: ReturnType<typeof M>): number {
  return expr.operator === 'Measurement' ? (expr.op1.re ?? NaN) : (expr.re ?? NaN);
}

/** 1σ error of a Measurement, as a float (0 for a bare value). */
function error(expr: ReturnType<typeof M>): number {
  return expr.operator === 'Measurement' ? (expr.op2.re ?? NaN) : 0;
}

describe('Measurement — canonicalization', () => {
  test('Measurement(v, 0) collapses to the bare value', () => {
    const m = M(7, 0);
    expect(m.isSame(7)).toBe(true);
    expect(m.operator).not.toBe('Measurement');
  });

  test('error is canonicalized to its absolute value', () => {
    const m = M(5, -0.2);
    expect(m.operator).toBe('Measurement');
    expect(m.op2.re).toBeCloseTo(0.2, 12);
  });
});

describe('Measurement — error propagation (.N())', () => {
  test('Add: M(5,0.2) + M(3,0.4) -> 8 ± √0.20', () => {
    const r = ce.function('Add', [M(5, 0.2), M(3, 0.4)]).N();
    expect(nominal(r)).toBeCloseTo(8, 12);
    expect(error(r)).toBeCloseTo(0.4472135955, 8);
  });

  test('Multiply: M(5,0.2) · M(3,0.4) -> 15 ± √4.36', () => {
    const r = ce.function('Multiply', [M(5, 0.2), M(3, 0.4)]).N();
    expect(nominal(r)).toBeCloseTo(15, 12);
    expect(error(r)).toBeCloseTo(2.0880613018, 8);
  });

  test('Divide: M(6,0.3) / M(2,0.1) -> 3 ± √0.045', () => {
    const r = ce.function('Divide', [M(6, 0.3), M(2, 0.1)]).N();
    expect(nominal(r)).toBeCloseTo(3, 12);
    expect(error(r)).toBeCloseTo(0.2121320344, 8);
  });

  test('scalar · measurement: 2 · M(5,0.2) -> 10 ± 0.4', () => {
    const r = ce.function('Multiply', [2, M(5, 0.2)]).N();
    expect(nominal(r)).toBeCloseTo(10, 12);
    expect(error(r)).toBeCloseTo(0.4, 10);
  });

  test('scalar + measurement: M(5,0.2) + 3 -> 8 ± 0.2', () => {
    const r = ce.function('Add', [M(5, 0.2), 3]).N();
    expect(nominal(r)).toBeCloseTo(8, 12);
    expect(error(r)).toBeCloseTo(0.2, 10);
  });

  test('measurement ^ scalar: M(4,0.2)^2 -> 16 ± 1.6', () => {
    const r = ce.function('Power', [M(4, 0.2), 2]).N();
    expect(nominal(r)).toBeCloseTo(16, 12);
    expect(error(r)).toBeCloseTo(1.6, 10);
  });

  test('Negate: -M(5,0.2) -> -5 ± 0.2', () => {
    const r = ce.function('Negate', [M(5, 0.2)]).N();
    expect(nominal(r)).toBeCloseTo(-5, 12);
    expect(error(r)).toBeCloseTo(0.2, 10);
  });
});

describe('Measurement — exact/symbolic error under evaluate()', () => {
  test('exact inputs keep a symbolic error under evaluate(), float under N()', () => {
    // 1/5 and 2/5 are exact rationals; the propagated error stays a symbolic
    // Sqrt under evaluate() and only numericizes under .N() (evaluate-vs-N
    // exactness contract).
    const m = ce.function('Add', [
      ce.function('Measurement', [5, ce.number([1, 5])]),
      ce.function('Measurement', [3, ce.number([2, 5])]),
    ]);
    const e = m.evaluate();
    expect(e.operator).toBe('Measurement');
    expect(e.op1.isSame(8)).toBe(true);
    // The error stays EXACT under evaluate() (here the radical √5/5, not a
    // float)...
    expect(e.op2.isExact).toBe(true);
    // ...and numericizes correctly under .N().
    expect(e.op2.N().re).toBeCloseTo(Math.hypot(1 / 5, 2 / 5), 10);
  });
});

describe('Measurement — independent semantics', () => {
  test('two distinct literals are NOT correlated: M(5,0.2) − M(5,0.2) -> 0 ± √0.08', () => {
    const r = ce.function('Subtract', [M(5, 0.2), M(5, 0.2)]).N();
    expect(nominal(r)).toBeCloseTo(0, 12);
    expect(error(r)).toBeCloseTo(0.2828427125, 8);
  });

  // Symbolic-reuse contrast / the correctness mechanism.
  //
  // Same-source reuse is meant to be resolved by symbolic canonicalization
  // BEFORE any numeric propagation: while `x` is a FREE symbol, `x - x` folds
  // to 0 and `x + x` folds to `2x`, so substituting the measurement afterwards
  // yields the correlated (correct) result — no spurious independent error.
  test('free symbol x - x folds to 0 before propagation', () => {
    expect(ce.parse('x - x').evaluate().isSame(0)).toBe(true);
  });

  test('free symbol x + x -> 2x, then substitute -> fully correlated 10 ± 0.4', () => {
    const folded = ce.parse('x + x').simplify(); // -> 2x
    const r = folded.subs({ x: M(5, 0.2) }).N();
    expect(nominal(r)).toBeCloseTo(10, 12);
    expect(error(r)).toBeCloseTo(0.4, 10);
  });

  // CAVEAT (see report): `ce.assign('x', Measurement)` binds `x` to a concrete
  // value, so `.evaluate()` substitutes it EAGERLY — the symbolic fold never
  // happens and reuse is treated as independent. This documents the actual
  // behavior; the correlation mechanism above requires keeping `x` free.
  test('assigned measurement + evaluate substitutes eagerly (independent)', () => {
    const scoped = new ComputeEngine();
    scoped.assign('x', scoped.function('Measurement', [5, 0.2]));
    const r = scoped.parse('x - x').N();
    // Independent-propagation result, NOT 0.
    expect(r.operator).toBe('Measurement');
    expect(r.op1.re).toBeCloseTo(0, 12);
    expect(r.op2.re).toBeCloseTo(0.2828427125, 8);
  });
});

describe('Measurement — type', () => {
  test('Measurement of real inputs is real', () => {
    expect(M(5, 0.2).type.matches('real')).toBe(true);
  });
});
