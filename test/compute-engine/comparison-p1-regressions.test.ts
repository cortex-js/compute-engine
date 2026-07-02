import { ComputeEngine } from '../../src/compute-engine';

/**
 * Regression tests for the comparison P1 cluster (Wave 4 batch 2;
 * CORRECTNESS_FINDINGS CM-P1-1 … CM-P1-4).
 *
 * Fixed in:
 *  - boxed-expression/boxed-symbol.ts   (isSame follows the binding, CM-P1-1)
 *  - boxed-expression/compare.ts        (same()/eq()/cmp(), CM-P1-2a/3/4)
 *  - numeric-value/exact-numeric-value.ts (eq at working precision, CM-P1-2b)
 *
 * CM-P1-5 (isEqual identity semantics for free-variable expressions) is a
 * documented contract fork against comparison-assumptions-regressions.test.ts
 * (`x.isEqual(2)` → undefined, committed as the P0-30 fix) and was NOT changed.
 */

describe('CM-P1-1: BoxedSymbol.isSame follows a function-valued binding', () => {
  test('g := x^2+1 ; g.isSame(x^2+1)', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.parse('x^2+1'));
    expect(ce.symbol('g').isSame(ce.parse('x^2+1'))).toBe(true);
  });

  test('symmetry for the expression-valued binding', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.parse('x^2+1'));
    const g = ce.symbol('g');
    const e = ce.parse('x^2+1');
    expect(g.isSame(e)).toBe(e.isSame(g));
    expect(e.isSame(g)).toBe(true);
  });
});

describe('CM-P1-2: isSame is a symmetric, transitive equivalence relation', () => {
  test('symbol-with-value vs literal is symmetric (one := 1)', () => {
    const ce = new ComputeEngine();
    ce.assign('one', 1);
    const one = ce.symbol('one');
    const lit = ce.number(1);
    expect(one.isSame(lit)).toBe(true);
    expect(lit.isSame(one)).toBe(true); // used to be false (asymmetric)
  });

  test('ImaginaryUnit vs Complex(0,1) is symmetric', () => {
    const ce = new ComputeEngine();
    const i = ce.symbol('ImaginaryUnit');
    const c = ce.box(['Complex', 0, 1]);
    expect(i.isSame(c)).toBe(true);
    expect(c.isSame(i)).toBe(true); // used to be false
  });

  test('exact vs inexact 1/3 is symmetric and strict (both directions false)', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['Rational', 1, 3]);
    const machine = ce.number(0.3333333333333333);
    const big = ce.parse('0.333333333333333333333333333333');
    // Exact 1/3 is NOT the same as any finite decimal approximation, in either
    // direction (used to be true one way / false the other → asymmetric).
    expect(r.isSame(machine)).toBe(machine.isSame(r));
    expect(r.isSame(big)).toBe(big.isSame(r));
    expect(r.isSame(machine)).toBe(false);
    expect(r.isSame(big)).toBe(false);
  });

  test('exactly-representable 1/2 equals 0.5 in both directions', () => {
    const ce = new ComputeEngine();
    const half = ce.box(['Rational', 1, 2]);
    const p5 = ce.number(0.5);
    expect(half.isSame(p5)).toBe(true);
    expect(p5.isSame(half)).toBe(true);
  });

  test('transitivity holds across a representation pool', () => {
    const ce = new ComputeEngine();
    ce.assign('one', 1);
    ce.assign('third', ['Rational', 1, 3]);
    ce.assign('g', ce.parse('x^2+1'));
    const pool = [
      ce.number(1),
      ce.symbol('one'),
      ce.box(['Rational', 1, 3]),
      ce.symbol('third'),
      ce.number(0.3333333333333333),
      ce.parse('0.333333333333333333333333333333'),
      ce.box(['Rational', 1, 2]),
      ce.number(0.5),
      ce.box(['Complex', 0, 1]),
      ce.symbol('ImaginaryUnit'),
      ce.parse('x^2+1'),
      ce.symbol('g'),
      ce.symbol('x'),
      ce.symbol('y'),
    ];
    const n = pool.length;
    const M: boolean[][] = [];
    for (let i = 0; i < n; i++) {
      M[i] = [];
      for (let j = 0; j < n; j++) M[i][j] = pool[i].isSame(pool[j]);
    }
    // Reflexive
    for (let i = 0; i < n; i++) expect(M[i][i]).toBe(true);
    // Symmetric
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) expect(M[i][j]).toBe(M[j][i]);
    // Transitive
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        for (let k = 0; k < n; k++)
          if (M[i][j] && M[j][k]) expect(M[i][k]).toBe(true);
  });
});

describe('CM-P1-3: eq() does not collapse determinable values to a spurious false', () => {
  test('non-canonical Add(1,1).isEqual(2)', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Add', 1, 1], { canonical: false }).isEqual(2)).toBe(true);
  });

  test('non-canonical Sqrt(4).isEqual(2)', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Sqrt', 4], { canonical: false }).isEqual(2)).toBe(true);
  });

  test('canonical path is unaffected', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Add', 1, 1]).isEqual(2)).toBe(true);
    expect(ce.box(['Add', 1, 1]).isEqual(3)).toBe(false);
  });
});

describe('CM-P1-4: cmp() uses one tolerance policy for ordering predicates', () => {
  test('1 vs 1+1e-11: isEqual true ⇒ isLess/isGreater false, both directions', () => {
    const ce = new ComputeEngine();
    const a = ce.number(1);
    const b = ce.number(1 + 1e-11);
    expect(a.isEqual(b)).toBe(true);
    // If equal within tolerance, strict ordering must be false.
    expect(a.isLess(b)).toBe(false);
    expect(a.isGreater(b)).toBe(false);
    expect(b.isLess(a)).toBe(false);
    expect(b.isGreater(a)).toBe(false);
    // Non-strict ordering is true.
    expect(a.isLessEqual(b)).toBe(true);
    expect(b.isGreaterEqual(a)).toBe(true);
  });

  test('genuinely-ordered values still compare strictly', () => {
    const ce = new ComputeEngine();
    const a = ce.number(1);
    const b = ce.number(2);
    expect(a.isEqual(b)).toBe(false);
    expect(a.isLess(b)).toBe(true);
    expect(b.isGreater(a)).toBe(true);
  });
});
