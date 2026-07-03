import { ComputeEngine } from '../../src/compute-engine';

/**
 * Regression tests for the P2 "Canonicalization" (#11–13) and "Comparison"
 * (#14–16) clusters of CORRECTNESS_FINDINGS.md.
 *
 * Fixed in:
 *  - boxed-expression/arithmetic-mul-div.ts (float-coefficient division, #12)
 *  - boxed-expression/boxed-function.ts     (Root.inv → 1/Root form, #13)
 *  - boxed-expression/boxed-number.ts       (primitive isSame / -0, #15)
 *  - boxed-expression/boxed-tensor.ts        (element-wise isEqual tolerance, #16)
 *
 * #11 (exact Gaussian-integer capture in `Add`) is ESCALATED, not fixed: the
 * exactness model (`ExactNumericValue` has no imaginary part, and the
 * `isExact ⟹ asExact` invariant is relied on by ~57 consumers / 10 asExact
 * sites) would need a core change. The test below documents current behavior.
 *
 * #14 was already fixed by the round-8 bounds-driven eq/cmp work; these tests
 * lock the repros and their residual surface.
 */

//
// #12 — Divide coefficient extraction must not mint exact cancellation
//       from float coefficients (align with Add/Multiply float-exclusion).
//
describe('#12: float division coefficients do not fold exactly', () => {
  const ce = new ComputeEngine();

  test('(0.3x)/(0.1y) stays unfactored — no spurious exact 3', () => {
    const e = ce.box(['Divide', ['Multiply', 0.3, 'x'], ['Multiply', 0.1, 'y']]);
    // Must NOT be the exact `(3x)/y`; the float coefficients stay put.
    expect(e.json).toEqual([
      'Divide',
      ['Multiply', 0.3, 'x'],
      ['Multiply', 0.1, 'y'],
    ]);
  });

  test('Divide(0.3, 0.1) stays a float division (control)', () => {
    expect(ce.box(['Divide', 0.3, 0.1]).json).toEqual(['Divide', 0.3, 0.1]);
  });

  test('exact coefficients still fold: (2x)/(4y) → (1/2)·(x/y)', () => {
    const e = ce.box(['Divide', ['Multiply', 2, 'x'], ['Multiply', 4, 'y']]);
    // Exact 2/4 = 1/2 coefficient is still extracted.
    expect(e.isSame(ce.parse('\\frac{x}{2y}'))).toBe(true);
  });

  test('exact ÷ exact radical still folds: √3/3', () => {
    const e = ce.box(['Divide', ['Sqrt', 3], 3]);
    expect(e.isSame(ce.box(['Multiply', ['Rational', 1, 3], ['Sqrt', 3]]))).toBe(
      true
    );
  });

  test('equal float coefficients still cancel to a unit: (0.2x)/(0.2y) → x/y', () => {
    const e = ce.box(['Divide', ['Multiply', 0.2, 'x'], ['Multiply', 0.2, 'y']]);
    expect(e.json).toEqual(['Divide', 'x', 'y']);
  });
});

//
// #13 — Negative fractional exponents canonicalize uniformly to the
//       reciprocal-of-root form 1/Root(a, n) (never Root(a, -n)).
//
describe('#13: negative unit-fraction exponents → 1/Root form', () => {
  const ce = new ComputeEngine();

  test('x^(-1/2) → Divide(1, Sqrt(x))', () => {
    expect(ce.box(['Power', 'x', ['Rational', -1, 2]]).json).toEqual([
      'Divide',
      1,
      ['Sqrt', 'x'],
    ]);
  });

  test('x^(-1/3) → Divide(1, Root(x, 3)) — NOT Root(x, -3)', () => {
    const e = ce.box(['Power', 'x', ['Rational', -1, 3]]);
    expect(e.json).toEqual(['Divide', 1, ['Root', 'x', 3]]);
    expect(e.latex).toBe('\\frac{1}{\\sqrt[3]{x}}');
  });

  test('x^(-1/4) → Divide(1, Root(x, 4))', () => {
    expect(ce.box(['Power', 'x', ['Rational', -1, 4]]).json).toEqual([
      'Divide',
      1,
      ['Root', 'x', 4],
    ]);
  });

  test('1/Root(x, 3) is stable (does not fold to Root(x, -3))', () => {
    expect(ce.box(['Divide', 1, ['Root', 'x', 3]]).json).toEqual([
      'Divide',
      1,
      ['Root', 'x', 3],
    ]);
  });

  test('Root(x, -3) normalizes on boxing; inverting yields Root(x, 3)', () => {
    // Boxing `Root(x, -3)` already normalizes to `1/Root(x, 3)`, so its inverse
    // is the plain positive-index root.
    const r = ce.box(['Root', 'x', -3]);
    expect(r.json).toEqual(['Divide', 1, ['Root', 'x', 3]]);
    expect(r.inv().json).toEqual(['Root', 'x', 3]);
  });
});

//
// #14 — eq()/cmp() consult inequality bounds (round-8; locked here).
//
describe('#14: bounded-symbol equality/ordering consults assumptions', () => {
  test('assume(w>4) refutes w = 2', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('w>4'));
    expect(ce.box('w').isEqual(2)).toBe(false);
    expect(ce.box(['Equal', 'w', 2]).evaluate().symbol).toBe('False');
  });

  test('assume(s>4), assume(t<1) ⇒ s > t (both directions)', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('s>4'));
    ce.assume(ce.parse('t<1'));
    expect(ce.box('s').isGreater(ce.box('t'))).toBe(true);
    expect(ce.box('t').isLess(ce.box('s'))).toBe(true);
    expect(ce.box('s').isLess(ce.box('t'))).toBe(false);
  });

  test('overlapping bounds stay indeterminate', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('s>4'));
    ce.assume(ce.parse('t>1'));
    // s>4 and t>1 do not separate: s vs t is unknown.
    expect(ce.box('s').isGreater(ce.box('t'))).toBe(undefined);
  });
});

//
// #15 — primitive-vs-boxed isSame agree; -0 normalizes to +0.
//
describe('#15: isSame primitive overload matches the boxed path', () => {
  const ce = new ComputeEngine();

  test('Rational(1,2).isSame(0.5) matches .isSame(ce.number(0.5))', () => {
    const half = ce.box(['Rational', 1, 2]);
    expect(half.isSame(0.5)).toBe(half.isSame(ce.number(0.5)));
    expect(half.isSame(0.5)).toBe(true);
  });

  test('-0 compares same to +0 in both directions (normalizes to +0)', () => {
    expect(ce.number(-0).isSame(-0)).toBe(true);
    expect(ce.number(-0).isSame(0)).toBe(true);
    expect(ce.number(0).isSame(-0)).toBe(true);
    expect(ce.number(0).isSame(0)).toBe(true);
  });

  test('NaN stays reflexive under isSame', () => {
    expect(ce.number(NaN).isSame(NaN)).toBe(true);
    expect(ce.number(NaN).isSame(0)).toBe(false);
  });

  test('hot integer checks unaffected', () => {
    expect(ce.number(7).isSame(7)).toBe(true);
    expect(ce.number(7).isSame(8)).toBe(false);
    expect(ce.box(['Rational', 1, 2]).isSame(1)).toBe(false);
  });
});

//
// #16 — collection isEqual is tolerance-aware element-wise; the three
//       comparison methods are deliberate and documented around NaN.
//
describe('#16: tensor/list isEqual uses element-wise tolerance', () => {
  const ce = new ComputeEngine();

  test('near-equal float vectors are isEqual within tolerance', () => {
    expect(
      ce.box(['List', 1, 2, 3]).isEqual(ce.box(['List', 1, 2, 3.00000000001]))
    ).toBe(true);
  });

  test('near-equal float matrices are isEqual within tolerance', () => {
    const a = ce.box(['List', ['List', 1, 2], ['List', 3, 4]]);
    const b = ce.box(['List', ['List', 1, 2], ['List', 3, 4.00000000001]]);
    expect(a.isEqual(b)).toBe(true);
  });

  test('distinct vectors are not equal', () => {
    expect(ce.box(['List', 1, 2, 3]).isEqual(ce.box(['List', 1, 2, 4]))).toBe(
      false
    );
  });

  test('mismatched shapes are not equal', () => {
    expect(ce.box(['List', 1, 2, 3]).isEqual(ce.box(['List', 1, 2]))).toBe(
      false
    );
  });

  test('symbolic element mismatch is indeterminate (three-valued)', () => {
    expect(ce.box(['List', 'x', 2]).isEqual(ce.box(['List', 'y', 2]))).toBe(
      undefined
    );
    expect(ce.box(['List', 'x', 2]).isEqual(ce.box(['List', 'x', 2]))).toBe(
      true
    );
  });

  test('NaN collections: isSame/is structural-true, isEqual mathematically false', () => {
    const a = ce.box(['List', NaN, 1]);
    const b = ce.box(['List', NaN, 1]);
    // isSame / is: identical NaN pattern is structurally the same.
    expect(a.isSame(b)).toBe(true);
    expect(a.is(b)).toBe(true);
    // isEqual: NaN ≠ NaN, matching scalar isEqual.
    expect(a.isEqual(b)).toBe(false);
    // Scalar reference points.
    expect(ce.number(NaN).isSame(ce.number(NaN))).toBe(true);
    expect(ce.number(NaN).isEqual(ce.number(NaN))).toBe(false);
  });
});

//
// #11 — FIXED by D12-A (exact Gaussian support in ExactNumericValue): the
//       Add fold now produces a single EXACT complex literal.
//
describe('#11 (FIXED): Gaussian-integer capture in Add is exact', () => {
  const ce = new ComputeEngine();

  test('Add(2, 3i, x) carries an EXACT complex constant', () => {
    const e = ce.box(['Add', 2, ['Complex', 0, 3], 'x']);
    const num = (e.ops ?? []).find((op) => op.isNumberLiteral);
    expect(num?.isSame(ce.box(['Complex', 2, 3]))).toBe(true);
    expect(num?.isExact).toBe(true);
  });
});
