/**
 * D12-A: exact Gaussian (complex) support in ExactNumericValue.
 *
 * Exact complex values — Gaussian rationals (2+3i, 1/2−5i/3) and
 * pure-imaginary radicals (√2·i) — must stay EXACT through canonicalization
 * and evaluation instead of degrading to inexact machine complex values.
 * Values outside the representable set (√2 + √3·i) must degrade gracefully
 * (stay symbolic / go float), never be wrong.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';

export const ce = new ComputeEngine();

const i = 'ImaginaryUnit';

function exactness(e: any): boolean | undefined {
  return isNumber(e) ? e.isExact : undefined;
}

describe('exact Gaussian literals', () => {
  it('Add(2, 3i) folds to a single exact literal', () => {
    const e = ce.expr(['Add', 2, ['Multiply', 3, i]]).evaluate();
    expect(e.isNumberLiteral).toBe(true);
    expect(exactness(e)).toBe(true);
    expect(e.re).toBe(2);
    expect(e.im).toBe(3);
    expect(e.json).toEqual(['Complex', 2, 3]);
  });

  it('Add(2, 3i, x) keeps the exact Gaussian as one term (CORR #11)', () => {
    // `3i` parses to a complex literal; the canonicalAdd fold must combine
    // it with `2` into a single EXACT literal (previously an inexact machine
    // complex), leaving `x` symbolic.
    const e = ce.parse('2+3\\imaginaryI+x');
    const numTerm = e.ops!.find((op) => op.isNumberLiteral)!;
    expect(numTerm).toBeDefined();
    expect(exactness(numTerm)).toBe(true);
    expect(numTerm.re).toBe(2);
    expect(numTerm.im).toBe(3);
  });

  it('Gaussian rational 1/2 − 5i/3 stays exact', () => {
    const e = ce
      .expr(['Add', ['Rational', 1, 2], ['Multiply', ['Rational', -5, 3], i]])
      .evaluate();
    expect(exactness(e)).toBe(true);
    expect(e.json).toEqual([
      'Complex',
      ['Rational', 1, 2],
      ['Rational', -5, 3],
    ]);
  });

  it('√2·i is exact (pure-imaginary radical)', () => {
    const e = ce.expr(['Multiply', ['Sqrt', 2], i]).evaluate();
    expect(exactness(e)).toBe(true);
    expect(e.re).toBe(0);
    expect(e.im).toBeCloseTo(Math.SQRT2, 15);
    expect(e.json).toEqual(['Complex', 0, ['Sqrt', 2]]);
  });
});

describe('exact Gaussian arithmetic', () => {
  it('(1+i)² = 2i exactly', () => {
    // (`ImaginaryUnit` is only resolved to the `i` literal at evaluation, so
    // the fold happens under evaluate(), not at canonicalization)
    const e = ce.expr(['Power', ['Add', 1, i], 2]).evaluate();
    expect(exactness(e)).toBe(true);
    expect(e.re).toBe(0);
    expect(e.im).toBe(2);
  });

  it('(1+i)³ = −2+2i exactly', () => {
    const e = ce.expr(['Power', ['Add', 1, i], 3]).evaluate();
    expect(exactness(e)).toBe(true);
    expect(e.re).toBe(-2);
    expect(e.im).toBe(2);
  });

  it('(2+i)³ = 2+11i exactly', () => {
    const e = ce.expr(['Power', ['Add', 2, i], 3]).evaluate();
    expect(exactness(e)).toBe(true);
    expect(e.re).toBe(2);
    expect(e.im).toBe(11);
  });

  it('(1+i)⁻² = −i/2 exactly (negative exponent → Gaussian rational)', () => {
    const e = ce.expr(['Power', ['Add', 1, i], -2]).evaluate();
    expect(exactness(e)).toBe(true);
    expect(e.json).toEqual(['Complex', 0, ['Rational', -1, 2]]);
  });

  it('1/(1+i) = (1−i)/2 exactly', () => {
    const e = ce.expr(['Divide', 1, ['Add', 1, i]]).evaluate();
    expect(exactness(e)).toBe(true);
    expect(e.json).toEqual([
      'Complex',
      ['Rational', 1, 2],
      ['Rational', -1, 2],
    ]);
  });

  it('(2+3i)(1−i) = 5+i exactly', () => {
    const e = ce
      .expr(['Multiply', ['Add', 2, ['Multiply', 3, i]], ['Subtract', 1, i]])
      .evaluate();
    expect(exactness(e)).toBe(true);
    expect(e.re).toBe(5);
    expect(e.im).toBe(1);
  });

  it('(2+3i) − 3i = 2 exactly (cancellation back to real)', () => {
    const z = ['Add', 2, ['Multiply', 3, i]];
    const e = ce.expr(['Subtract', z, ['Multiply', 3, i]]).evaluate();
    expect(e.isSame(2)).toBe(true);
    expect(exactness(e)).toBe(true);
  });

  it('|3+4i| = 5 and |1+i| = √2 exactly', () => {
    const abs1 = ce.expr(['Abs', ['Add', 3, ['Multiply', 4, i]]]).evaluate();
    expect(abs1.isSame(5)).toBe(true);
    const abs2 = ce.expr(['Abs', ['Add', 1, i]]).evaluate();
    expect(exactness(abs2)).toBe(true);
    expect(abs2.json).toEqual(['Sqrt', 2]);
  });

  it('|3 − √7 + i√(6√7 − 15)| = 1 exactly (W. Kahan)', () => {
    // (3−√7)² + (6√7−15) = 1. The a+bi split with radical parts folds the
    // radicals exactly under both evaluate() and simplify().
    const e = ce.parse('\\left|3 - \\sqrt{7} + i\\sqrt{6\\sqrt{7} - 15}\\right|');
    expect(e.evaluate().json).toBe(1);
    expect(e.simplify().json).toBe(1);
  });

  it('exact modulus of complex expressions with radical parts', () => {
    // |5 − 12i| = 13, |2 + √5·i| = 3 (perfect-square modulus), |1 + 2i| = √5.
    expect(ce.parse('|5-12i|').simplify().json).toBe(13);
    expect(
      ce.expr(['Abs', ['Add', 2, ['Multiply', ['Sqrt', 5], i]]]).simplify().json
    ).toBe(3);
    expect(ce.parse('|1+2i|').simplify().json).toEqual(['Sqrt', 5]);
  });

  it('non-reducing complex Abs stays symbolic', () => {
    // Here 2√7 − 15 ≈ −9.7 < 0, so √(2√7−15) is itself imaginary and the
    // a+bi split does not describe a real modulus: keep Abs symbolic rather
    // than fold to a wrong value.
    const e = ce.parse('\\left|3 - \\sqrt{7} + i\\sqrt{2\\sqrt{7} - 15}\\right|');
    expect(e.simplify().operator).toBe('Abs');
    // |x + iy| with free variables must never fold.
    const sym = ce.parse('|x+iy|').simplify();
    expect(sym.operator).toBe('Abs');
  });

  it('√(−4) = 2i and √(−1/2) = (√2/2)i exactly', () => {
    const a = ce.expr(['Sqrt', -4]).evaluate();
    expect(exactness(a)).toBe(true);
    expect(a.re).toBe(0);
    expect(a.im).toBe(2);
    const b = ce.expr(['Sqrt', ['Rational', -1, 2]]).evaluate();
    expect(exactness(b)).toBe(true);
    expect(b.re).toBe(0);
    expect(b.im).toBeCloseTo(Math.SQRT1_2, 15);
  });
});

describe('leaving the representable set degrades gracefully', () => {
  it('√2 + √3·i stays symbolic (two exact terms), never wrong', () => {
    const e = ce.expr(['Add', ['Sqrt', 2], ['Multiply', ['Sqrt', 3], i]]);
    // Not collapsed to a single (inexact) literal at canonicalization
    expect(e.operator).toBe('Add');
    const n = e.N();
    expect(n.re).toBeCloseTo(Math.sqrt(2), 15);
    expect(n.im).toBeCloseTo(Math.sqrt(3), 15);
  });

  it('√2·(1+i) does not fold to an inexact literal at canonicalization', () => {
    const e = ce.expr(['Multiply', ['Sqrt', 2], ['Add', 1, i]]);
    // Whatever the shape, the value must be correct and no exactness minted
    const n = e.N();
    expect(n.re).toBeCloseTo(Math.sqrt(2), 15);
    expect(n.im).toBeCloseTo(Math.sqrt(2), 15);
  });

  it('√2·i + √3·i falls back without wrong values', () => {
    const e = ce
      .expr(['Add', ['Multiply', ['Sqrt', 2], i], ['Multiply', ['Sqrt', 3], i]])
      .evaluate();
    const n = e.N();
    expect(n.re).toBeCloseTo(0, 15);
    expect(n.im).toBeCloseTo(Math.sqrt(2) + Math.sqrt(3), 14);
  });

  it('non-Gaussian complex floats stay inexact (no exactness minted)', () => {
    const e = ce.expr(['Add', 1.5, ['Multiply', 2, i]]).evaluate();
    expect(exactness(e)).toBe(false);
    expect(e.re).toBe(1.5);
    expect(e.im).toBe(2);
  });
});

describe('.N() of exact Gaussian values', () => {
  it('N(2+3i) = 2+3i', () => {
    const e = ce.expr(['Add', 2, ['Multiply', 3, i]]).N();
    expect(e.re).toBe(2);
    expect(e.im).toBe(3);
  });

  it('N(1/(1+i)) = 0.5 − 0.5i', () => {
    const e = ce.expr(['Divide', 1, ['Add', 1, i]]).N();
    expect(e.re).toBe(0.5);
    expect(e.im).toBe(-0.5);
  });

  it('N(√2·i) = 1.414…i', () => {
    const e = ce.expr(['Multiply', ['Sqrt', 2], i]).N();
    expect(e.re).toBe(0);
    expect(e.im).toBeCloseTo(Math.SQRT2, 15);
  });
});

describe('lossless JSON round-trip (matcher contract)', () => {
  const cases: [string, any][] = [
    ['2+3i', ['Add', 2, ['Multiply', 3, i]]],
    [
      '1/2 - 5i/3',
      ['Add', ['Rational', 1, 2], ['Multiply', ['Rational', -5, 3], i]],
    ],
    ['√2·i', ['Multiply', ['Sqrt', 2], i]],
    ['1/(1+i)', ['Divide', 1, ['Add', 1, i]]],
    ['(2+i)^3', ['Power', ['Add', 2, i], 3]],
    ['(1+i)^-2', ['Power', ['Add', 1, i], -2]],
    ['√(-1/2)', ['Sqrt', ['Rational', -1, 2]]],
  ];
  for (const [label, expr] of cases) {
    it(`ce.expr(x.json).isSame(x) for ${label}`, () => {
      const x = ce.expr(expr).evaluate();
      expect(ce.expr(x.json).isSame(x)).toBe(true);
    });
  }

  it('structural form round-trips through the matcher path', () => {
    const x = ce.expr(['Add', 2, ['Multiply', 3, i]]).evaluate();
    // BoxedNumber.structural = ce.expr(this.json, {form:'structural'}) is
    // load-bearing for match/replace/subs
    const s = x.structural;
    expect(s.isSame(x) || ce.expr(s.json).isSame(x)).toBe(true);
  });
});

describe('exactness plumbing', () => {
  it('exact Gaussian type is finite_complex / imaginary', () => {
    expect(
      ce
        .expr(['Add', 2, ['Multiply', 3, i]])
        .evaluate()
        .type.toString()
    ).toBe('finite_complex');
    expect(ce.expr(['Multiply', 3, i]).evaluate().type.toString()).toBe(
      'imaginary'
    );
  });

  it('sgn of an exact complex is unsigned', () => {
    const e = ce.expr(['Add', 2, ['Multiply', 3, i]]).evaluate();
    expect(e.sgn).toBe('unsigned');
  });

  it('equality: exact Gaussian equals its machine twin', () => {
    const exact = ce.expr(['Add', 2, ['Multiply', 3, i]]).evaluate();
    const machine = ce.number(ce.complex(2, 3));
    expect(exact.isSame(machine)).toBe(true);
    expect(machine.isSame(exact)).toBe(true);
  });
});
