// Wester CAS capability suite — correctness regression tests.
//
// Problems from Michael Wester's "A Review of CAS mathematical capabilities"
// (University of New Mexico, Nov 1996). Wester used "benchmark" in the sense
// of comparing the correctness/capability of CAS systems, not execution
// speed — nothing in this file measures time.
//
// The full corpus (533 statements, Mathematica form) lives in
// `benchmarks/wester/*.m`. Two consumers, complementary by design:
//   - `benchmarks/audit/wester.ts` → REPORT-wester.md: the 48 univariate
//     operation cases (factor/expand/simplify/diff/limit/∫/solve/…), graded
//     by numeric invariant and timed against SymPy and Mathematica. Run
//     manually per release.
//   - THIS FILE: hand-transcribed problems from the categories that harness
//     cannot ingest (exact arithmetic, number theory, combinatorics, boolean
//     logic, zero equivalence, sums/products, complex domain, sets,
//     inequalities, statistics, series), asserting exact CE output in CI.
//
// Convention: a passing problem is locked with its exact output. A problem CE
// cannot do yet is `test.skip` asserting the CORRECT expected answer (so
// unskipping validates a future fix), with a comment recording what CE
// currently returns.
//
// See also http://yacas.sourceforge.net/essayschapter2.html
// Other benchmarks: http://134.155.108.17/cabench/ca-challenge.html

import { ComputeEngine } from '../../src/compute-engine';

let ce: ComputeEngine;

beforeEach(() => {
  ce = new ComputeEngine();
});

describe('Numbers', () => {
  test(`Wester 1: 50!`, () => {
    expect(ce.expr(['Factorial', 50]).evaluate().json).toEqual({
      num: '30414093201713378043612608166064768844377641568960512e+12',
    });
  });

  test(`Wester 2: prime factorization of 50!`, () => {
    expect(
      ce.expr(['FactorInteger', ['Factorial', 50]]).evaluate().json
    ).toEqual([
      'List',
      ['Tuple', 2, 47],
      ['Tuple', 3, 22],
      ['Tuple', 5, 12],
      ['Tuple', 7, 8],
      ['Tuple', 11, 4],
      ['Tuple', 13, 3],
      ['Tuple', 17, 2],
      ['Tuple', 19, 2],
      ['Tuple', 23, 2],
      ['Tuple', 29, 1],
      ['Tuple', 31, 1],
      ['Tuple', 37, 1],
      ['Tuple', 41, 1],
      ['Tuple', 43, 1],
      ['Tuple', 47, 1],
    ]);
  });

  test(`double factorials 10!! and 9!!`, () => {
    expect(ce.expr(['Factorial2', 10]).evaluate().json).toBe(3840);
    expect(ce.expr(['Factorial2', 9]).evaluate().json).toBe(945);
  });

  test(`Wester 3: 1/2 + ... + 1/10 exact`, () => {
    expect(
      ce
        .parse(
          '\\frac12+\\frac13+\\frac14+\\frac15+\\frac16+\\frac17+\\frac18+\\frac19+\\frac{1}{10}'
        )
        .evaluate().json
    ).toEqual(['Rational', 4861, 2520]);
  });

  test(`Wester 4: N(e^(pi sqrt(163))) — the Ramanujan almost-integer`, () => {
    // True value 262537412640768743.99999999999925…; correctly rounded to the
    // default 21 significant digits this is …744 (NOT the integer …743 — a
    // CAS that prints …743.0 or an integer at this precision is wrong).
    expect(
      ce.expr(['Exp', ['Multiply', 'Pi', ['Sqrt', 163]]]).N().json
    ).toEqual({
      num: '262537412640768744',
    });
  });

  test(`Wester 6: N(1/7) to 20+ digits`, () => {
    expect(ce.expr(['Divide', 1, 7]).N().json).toEqual({
      num: '0.142857142857142857143',
    });
  });

  test(`log base 8 of 32768 => exact 5`, () => {
    // Regression: this evaluated to 15·log_8(2), leaving log_8(2) = 1/3
    // unreduced (log_b(a) for a, b powers of a common base); fixed 2026-07-05.
    expect(ce.expr(['Log', 32768, 8]).evaluate().json).toBe(5);
    expect(ce.expr(['Log', 2, 8]).evaluate().json).toEqual(['Rational', 1, 3]);
  });

  test(`gcd(1776, 1554, 5698) = 74`, () => {
    expect(ce.expr(['GCD', 1776, 1554, 5698]).evaluate().json).toBe(74);
  });

  test(`10/7 (1029/1000)^(1/3) => 3^(1/3)`, () => {
    // 1029 = 3·7³, so the 7³/10³ extracts from the cube root. (Canonical
    // form of 3^(1/3) is Root(3, 3).)
    expect(
      ce
        .expr([
          'Multiply',
          ['Rational', 10, 7],
          ['Power', ['Rational', 1029, 1000], ['Rational', 1, 3]],
        ])
        .simplify().json
    ).toEqual(['Root', 3, 3]);
  });

  test(`Wester 8: denest sqrt(2 sqrt(3) + 4) = 1 + sqrt(3)`, () => {
    expect(ce.parse('\\sqrt{2\\sqrt{3}+4}').simplify().json).toEqual([
      'Add',
      1,
      ['Sqrt', 3],
    ]);
  });

  test.skip(`Wester 9: denest sqrt(14 + 3 sqrt(3 + 2 sqrt(5 - 12 sqrt(3 - 2 sqrt(2)))))`, () => {
    // (Putnam exam) => 3 + sqrt(2). CURRENT: stays unsimplified (only
    // single-level sqrt(a + b√c) denesting is implemented).
    expect(
      ce
        .parse(
          '\\sqrt{14 + 3 \\sqrt{3 + 2 \\sqrt{5 - 12 \\sqrt{3 - 2 \\sqrt{2}}}}}'
        )
        .simplify().json
    ).toEqual(['Add', 3, ['Sqrt', 2]]);
  });

  test(`denest sqrt(10 + 2 sqrt(6) + 2 sqrt(10) + 2 sqrt(15))`, () => {
    // [Jeffrey & Rich] => sqrt(2) + sqrt(3) + sqrt(5).
    expect(
      ce.parse('\\sqrt{10+2\\sqrt{6}+2\\sqrt{10}+2\\sqrt{15}}').simplify().json
    ).toEqual(['Add', ['Sqrt', 2], ['Sqrt', 3], ['Sqrt', 5]]);
  });

  test(`rationalize (sqrt(3) + sqrt(2))/(sqrt(3) - sqrt(2)) => 5 + 2 sqrt(6)`, () => {
    expect(
      ce.parse('\\frac{\\sqrt{3}+\\sqrt{2}}{\\sqrt{3}-\\sqrt{2}}').simplify()
        .json
    ).toEqual(['Add', 5, ['Multiply', 2, ['Sqrt', 6]]]);
  });

  test(`(90 + 34 sqrt(7))^(1/3) => 3 + sqrt(7)`, () => {
    // [Jeffrey & Rich]
    expect(ce.parse('(90+34\\sqrt{7})^{1/3}').simplify().json).toEqual([
      'Add',
      3,
      ['Sqrt', 7],
    ]);
  });

  test(`(90 - 34 sqrt(7))^(1/3) => 3 - sqrt(7)`, () => {
    expect(ce.parse('(90-34\\sqrt{7})^{1/3}').simplify().json).toEqual([
      'Add',
      3,
      ['Negate', ['Sqrt', 7]],
    ]);
  });

  test(`Wester 10: 2 infinity - 3 = infinity`, () => {
    expect(ce.parse('2\\infty -3').evaluate().json).toBe('PositiveInfinity');
  });

  test(`2^infinity = infinity`, () => {
    expect(ce.parse('2^\\infty').evaluate().json).toBe('PositiveInfinity');
  });
});

describe('Number theory', () => {
  test(`largest 6-digit prime and smallest 7-digit prime`, () => {
    // Wester's original form: Prime[78498] / Prime[78499] (nth prime).
    expect(ce.expr(['NthPrime', 78498]).evaluate().json).toBe(999983);
    expect(ce.expr(['NthPrime', 78499]).evaluate().json).toBe(1000003);
    expect(ce.expr(['NextPrime', 999980]).evaluate().json).toBe(999983);
    expect(ce.expr(['NextPrime', 999983]).evaluate().json).toBe(1000003);
  });

  test(`Euler totient phi(1776) = 576`, () => {
    expect(ce.expr(['Totient', 1776]).evaluate().json).toBe(576);
  });

  test(`modular inverses: 5^(-1) mod 7 = 3, 5^(-1) mod 6 = 5`, () => {
    expect(ce.expr(['PowerMod', 5, -1, 7]).evaluate().json).toBe(3);
    expect(ce.expr(['PowerMod', 5, -1, 6]).evaluate().json).toBe(5);
  });

  test(`primitive root of 191 = 19`, () => {
    expect(ce.expr(['PrimitiveRoot', 191]).evaluate().json).toBe(19);
  });

  test(`continued fraction of sqrt(23) = [4; 1,3,1,8 repeating]`, () => {
    // Wester (via Stark): 4 + 1/(1 + 1/(3 + 1/(1 + 1/(8 + …
    expect(
      ce.expr(['ContinuedFraction', ['Sqrt', 23]]).evaluate().json
    ).toEqual([
      'List',
      4,
      1,
      3,
      1,
      8,
      1,
      3,
      1,
      8,
      1,
      3,
      1,
      8,
      1,
      3,
      1,
      8,
      1,
      3,
      1,
    ]);
  });
});

describe('Combinatorics', () => {
  test(`Binomial(8, 3) = 56`, () => {
    expect(ce.expr(['Binomial', 8, 3]).evaluate().json).toBe(56);
  });

  test(`Binomial(n, 3) => n (n - 1) (n - 2) / 6`, () => {
    // Falling-factorial expansion for symbolic n, small literal integer k.
    expect(ce.expr(['Binomial', 'n', 3]).evaluate().json).toEqual([
      'Divide',
      ['Multiply', 'n', ['Subtract', 'n', 1], ['Subtract', 'n', 2]],
      6,
    ]);
  });

  test(`Pochhammer(a, 3) => a (a + 1) (a + 2)`, () => {
    // Rising-factorial expansion for symbolic a, small literal integer n.
    expect(ce.expr(['Pochhammer', 'a', 3]).evaluate().json).toEqual([
      'Multiply',
      'a',
      ['Add', 'a', 1],
      ['Add', 'a', 2],
    ]);
  });

  test(`partitions of 4 = 5`, () => {
    // {1+1+1+1, 1+1+2, 1+3, 2+2, 4} — Wester's PartitionsP[4].
    expect(ce.expr(['NPartition', 4]).evaluate().json).toBe(5);
  });

  // Not transcribed (operator not implemented): Stirling numbers of the
  // FIRST kind (StirlingS1[5, 2] = -50). `Stirling` exists but computes the
  // second kind (Stirling(5, 2) = 15).
});

describe('Boolean logic', () => {
  test(`Wester 121: True and False = False`, () => {
    expect(ce.expr(['And', 'True', 'False']).evaluate().json).toBe('False');
  });

  // Convention: UPPERCASE symbols (A, B) in boolean contexts. Evaluating a
  // bare symbol as a boolean operand types it `boolean` in the engine; with
  // a shared engine that silently breaks later numeric uses of x/y/z (see
  // logic.test.ts). This file uses a fresh engine per test, but keep the
  // convention so these can't become traps.
  test(`Wester 122: A or not A = True`, () => {
    expect(ce.expr(['Or', 'A', ['Not', 'A']]).evaluate().json).toBe('True');
  });

  test(`Wester 123: A or B or (A and B) = A or B`, () => {
    expect(
      ce.expr(['Or', 'A', 'B', ['And', 'A', 'B']]).evaluate().json
    ).toEqual(['Or', 'A', 'B']);
  });

  test(`A and (1 > 2) = False`, () => {
    expect(ce.expr(['And', 'A', ['Greater', 1, 2]]).evaluate().json).toBe(
      'False'
    );
  });

  test(`Xor(Xor(A, B), B) => A`, () => {
    // Regression: this flattened to Xor(A, B, B) without cancelling the
    // repeated operand (a ⊕ a = False); fixed 2026-07-05.
    expect(ce.expr(['Xor', ['Xor', 'A', 'B'], 'B']).evaluate().json).toBe('A');
  });
});

describe('Zero equivalence', () => {
  test(`Wester 26: sqrt(997) - (997^3)^(1/6) = 0`, () => {
    // Regression: root6(997³) was not recognized as √997 — canonicalization
    // folds 997³ → 991026973, losing the structure the (x^a)^b exponent rule
    // needs (Wester 27's bigint radicand stayed structural, so it worked) —
    // and evaluate leaked a float residue. Fixed 2026-07-05 via
    // perfect-power decomposition of the radicand in root().
    expect(ce.parse('\\sqrt{997} - (997^3)^{\\frac16}').evaluate().json).toBe(
      0
    );
    expect(ce.parse('\\sqrt{997} - (997^3)^{\\frac16}').simplify().json).toBe(
      0
    );
  });

  test(`Wester 27: sqrt(999983) - (999983^3)^(1/6) = 0`, () => {
    expect(
      ce.parse('\\sqrt{999983} - (999983^3)^{\\frac16}').evaluate().json
    ).toBe(0);
  });

  test.skip(`Wester 28: (2^(1/3) + 4^(1/3))^3 - 6 (2^(1/3) + 4^(1/3)) - 6 = 0`, () => {
    expect(
      ce
        .parse(
          '(2^{\\frac13} + 4^{\\frac13})^3 - 6(2^{\\frac13} + 4^{\\frac13}) - 6'
        )
        .simplify().json
    ).toBe(0);
  });

  test(`Wester 28 is recognized exactly after explicit expansion`, () => {
    const expression = ce.parse(
      '(2^{\\frac13} + 4^{\\frac13})^3 - 6(2^{\\frac13} + 4^{\\frac13}) - 6'
    );
    expect(ce.function('Expand', [expression]).evaluate().simplify().json).toBe(
      0
    );
  });

  test(`Wester 28 expanded cube-root polynomial numericizes`, () => {
    const expanded = ce
      .function('Expand', [ce.parse('(2^{\\frac13} + 4^{\\frac13})^3')])
      .evaluate();
    const result = expanded.N();
    expect(result.isNaN).toBe(false);
    expect(result.re).toBeCloseTo(Math.pow(Math.cbrt(2) + Math.cbrt(4), 3), 10);
  });

  test(`Power(4, 2/3) normalizes to base 2`, () => {
    expect(ce.parse('4^{\\frac23}').evaluate().json).toEqual([
      'Multiply',
      2,
      ['Root', 2, 3],
    ]);
  });

  test(`compatible cube-root powers combine on their common base`, () => {
    expect(ce.parse('2^{\\frac13} 4^{\\frac23}').simplify().json).toEqual([
      'Power',
      2,
      ['Rational', 5, 3],
    ]);
  });

  test(`cos^3 x + cos x sin^2 x - cos x = 0`, () => {
    // cos x (cos²x + sin²x − 1) = 0, via Pythagorean factoring in simplify.
    expect(
      ce.parse('\\cos^3{x} + \\cos{x}\\sin^2{x} - \\cos{x}').simplify().json
    ).toBe(0);
  });
});

describe('Sums and products', () => {
  test(`Sum(k, k=1..n) closed form = n(n+1)/2`, () => {
    // evaluate() stays symbolic for a free upper bound; simplify() produces
    // the closed form (as (n² + n)/2).
    expect(
      ce.expr(['Sum', 'k', ['Tuple', 'k', 1, 'n']]).simplify().json
    ).toEqual([
      'Multiply',
      ['Rational', 1, 2],
      ['Add', ['Power', 'n', 2], 'n'],
    ]);
  });

  test(`Sum(k^3, k=1..n) closed form = n^2(n+1)^2/4`, () => {
    expect(
      ce.expr(['Sum', ['Power', 'k', 3], ['Tuple', 'k', 1, 'n']]).simplify()
        .json
    ).toEqual([
      'Multiply',
      ['Rational', 1, 4],
      ['Power', ['Add', ['Power', 'n', 2], 'n'], 2],
    ]);
  });

  test(`Sum with free upper bound stays symbolic under evaluate()`, () => {
    // Regression: this used to enumerate to the internal iteration cap and
    // return 50015001 (the sum to 10001) for an unbound n.
    expect(
      ce.expr(['Sum', 'k', ['Tuple', 'k', 1, 'n']]).evaluate().json
    ).toEqual(['Sum', 'k', ['Limits', 'k', 1, 'n']]);
  });

  test(`telescoping Sum(g(k+1) - g(k), k=0..n) => g(n+1) - g(0)`, () => {
    // CURRENT: stays symbolic (no telescoping detection).
    expect(
      ce
        .expr([
          'Sum',
          ['Subtract', ['g', ['Add', 'k', 1]], ['g', 'k']],
          ['Tuple', 'k', 0, 'n'],
        ])
        .evaluate().json
    ).toEqual(['Subtract', ['g', ['Add', 'n', 1]], ['g', 0]]);
  });

  test(`Sum(1/k^2 + 1/k^3, k=1..oo) => pi^2/6 + zeta(3)`, () => {
    // Infinite p-series closed forms (ROADMAP B13): the Add body is split
    // term-wise (each piece converges via its own closed form) into
    // ζ(2) = π²/6 and ζ(3) (no elementary closed form, stays symbolic).
    expect(
      ce
        .expr([
          'Sum',
          [
            'Add',
            ['Divide', 1, ['Power', 'k', 2]],
            ['Divide', 1, ['Power', 'k', 3]],
          ],
          ['Tuple', 'k', 1, 'PositiveInfinity'],
        ])
        .evaluate().json
    ).toEqual(['Add', ['Divide', ['Power', 'Pi', 2], 6], ['Zeta', 3]]);
  });

  test(`Sum(1/k^2, k=2..oo) => pi^2/6 - 1`, () => {
    expect(
      ce
        .expr([
          'Sum',
          ['Power', 'k', -2],
          ['Tuple', 'k', 2, 'PositiveInfinity'],
        ])
        .evaluate().json
    ).toEqual([
      'Add',
      -1,
      ['Multiply', ['Rational', 1, 6], ['Power', 'Pi', 2]],
    ]);
  });

  test(`Sum(1/k^2, k=3..oo) => pi^2/6 - 5/4`, () => {
    expect(
      ce
        .expr([
          'Sum',
          ['Power', 'k', -2],
          ['Tuple', 'k', 3, 'PositiveInfinity'],
        ])
        .evaluate().json
    ).toEqual([
      'Add',
      ['Rational', -5, 4],
      ['Multiply', ['Rational', 1, 6], ['Power', 'Pi', 2]],
    ]);
  });

  test(`Product(k, k=1..n) => n!`, () => {
    // CURRENT: stays symbolic (no closed form for products).
    expect(
      ce.expr(['Product', 'k', ['Tuple', 'k', 1, 'n']]).evaluate().json
    ).toEqual(['Factorial', 'n']);
  });

  test(`Product(1 + 1/k, k=1..n-1) => n`, () => {
    // CURRENT: stays symbolic (no telescoping product detection).
    expect(
      ce
        .expr([
          'Product',
          ['Add', 1, ['Divide', 1, 'k']],
          ['Tuple', 'k', 1, ['Subtract', 'n', 1]],
        ])
        .evaluate().json
    ).toBe('n');
  });

  test(`Wallis: Product(1 - 1/(2k)^2, k=1..oo) => 2/pi`, () => {
    // Infinite product closed form (ROADMAP B13): the Wallis product
    // Π_{k=1}^∞ (1 − 1/(2k)²) = 2/π, matched structurally on the bound index.
    expect(
      ce
        .expr([
          'Product',
          ['Subtract', 1, ['Divide', 1, ['Power', ['Multiply', 2, 'k'], 2]]],
          ['Tuple', 'k', 1, 'PositiveInfinity'],
        ])
        .evaluate().json
    ).toEqual(['Divide', 2, 'Pi']);
  });

  test(`N(Product(1 - 1/(2k)^2, k=1..oo)) is accelerated`, () => {
    const result = ce
      .expr([
        'Product',
        ['Subtract', 1, ['Divide', 1, ['Power', ['Multiply', 2, 'k'], 2]]],
        ['Tuple', 'k', 1, 'PositiveInfinity'],
      ])
      .N();
    expect(result.re).toBeCloseTo(2 / Math.PI, 10);
  });

  test(`N(Product(1 + 1/k^2, k=1..oo)) = sinh(pi)/pi`, () => {
    const product = ce.expr([
      'Product',
      ['Add', 1, ['Power', 'k', -2]],
      ['Tuple', 'k', 1, 'PositiveInfinity'],
    ]);
    // No exact table entry: exact evaluation remains symbolic.
    expect(product.evaluate().operator).toBe('Product');
    expect(product.N().re).toBeCloseTo(Math.sinh(Math.PI) / Math.PI, 9);
  });
});

describe('Complex domain', () => {
  test(`N(ln(3 + 4i)) = ln 5 + i arctan(4/3)`, () => {
    // evaluate() correctly keeps the exact value symbolic: Ln((3 + 4i)).
    expect(ce.expr(['Ln', ['Complex', 3, 4]]).N().json).toEqual([
      'Complex',
      1.6094379124341003,
      0.9272952180016122,
    ]);
  });

  test(`N(arctan(tan(10))) = 10 - 3 pi`, () => {
    // Wester's point is the symbolic reduction (branch: 10 − 3π ≈ 0.5752);
    // the numeric value is correct, the symbolic reduction is not attempted.
    expect(ce.expr(['Arctan', ['Tan', 10]]).N().json).toEqual({
      num: '0.575222039230620284612',
    });
  });

  test(`|3 - sqrt(7) + i sqrt(6 sqrt(7) - 15)| => 1 exactly`, () => {
    // [W. Kahan] (3−√7)² + (6√7−15) = 1. The exact √(a²+b²) split folds the
    // radicals so simplify() reduces to the integer 1 (N() alone leaves a
    // 1.0000000000000000315 float residue).
    expect(
      ce
        .parse('\\left|3 - \\sqrt{7} + i\\sqrt{6\\sqrt{7} - 15}\\right|')
        .simplify().json
    ).toBe(1);
  });
});

describe('Set theory', () => {
  test(`union and intersection of sets`, () => {
    // (symbol `f` used instead of Wester's `e`, which parses as the constant)
    const sets = [
      ['Set', 'a', 'b', 'c'],
      ['Set', 'd', 'c', 'b'],
      ['Set', 'b', 'f'],
    ];
    expect(ce.expr(['Union', ...sets]).evaluate().json).toEqual([
      'Set',
      'a',
      'b',
      'c',
      'd',
      'f',
    ]);
    expect(ce.expr(['Intersection', ...sets]).evaluate().json).toEqual([
      'Set',
      'b',
    ]);
  });
});

describe('Inequalities', () => {
  test(`e^pi > pi^e is True`, () => {
    expect(ce.parse('e^\\pi > \\pi^e').evaluate().json).toBe('True');
  });

  test(`Wester 21: x >= y, y >= z, z >= x implies x = z`, () => {
    // Isolate the assumptions in a pushed scope so the ≥-cycle (which forces
    // x = y = z globally) does not poison later tests using the shared `ce`.
    ce.pushScope();
    try {
      ce.assume(ce.parse('x \\geq y'));
      ce.assume(ce.parse('y \\geq z'));
      ce.assume(ce.parse('z \\geq x'));
      expect(ce.parse('x = z').evaluate().json).toBe('True');
    } finally {
      ce.popScope();
    }
  });

  test(`Wester 22: x > y > 0 implies 2x^2 > 2y^2`, () => {
    ce.pushScope();
    try {
      ce.assume(ce.parse('x > y'));
      ce.assume(ce.parse('y > 0'));
      expect(ce.parse('2x^2 > 2y^2').evaluate().json).toBe('True');
    } finally {
      ce.popScope();
    }
  });
});

describe('Matrix theory', () => {
  test(`Mod of an integer matrix mod 2 => [[1,1],[1,0]]`, () => {
    // Elementwise Mod broadcasts over the matrix.
    expect(
      ce.expr(['Mod', ['List', ['List', 7, 11], ['List', 3, 8]], 2]).evaluate()
        .json
    ).toEqual(['List', ['List', 1, 1], ['List', 1, 0]]);
  });

  test(`2nd derivative of the rotation matrix => -[[cos t, sin t],[-sin t, cos t]]`, () => {
    // D[{{cos t, sin t},{-sin t, cos t}}, {t, 2}] => [[-cos t, -sin t], [sin t, -cos t]].
    // CURRENT: D applied to a matrix (list of lists) does not differentiate
    // elementwise; it produces a nonsensical *scalar* Add expression (treating
    // the matrix as a multi-argument function for a chain-rule expansion).
    expect(
      ce
        .expr([
          'D',
          [
            'List',
            ['List', ['Cos', 't'], ['Sin', 't']],
            ['List', ['Negate', ['Sin', 't']], ['Cos', 't']],
          ],
          't',
          't',
        ])
        .evaluate().json
    ).toEqual([
      'List',
      ['List', ['Negate', ['Cos', 't']], ['Negate', ['Sin', 't']]],
      ['List', ['Sin', 't'], ['Negate', ['Cos', 't']]],
    ]);
  });

  test(`row-vector . (a M1 + M2) symbolic product`, () => {
    // {{x, y}} . (a {{1,3,5},{2,4,6}} + {{7,-9,11},{-8,10,-12}}).
    // The inner scalar·matrix + matrix must be evaluated to a concrete matrix
    // first: feeding the *unevaluated* Add as an operand to MatrixMultiply
    // trips a type-check error (see the skipped fused-form test below).
    const M1 = ['List', ['List', 1, 3, 5], ['List', 2, 4, 6]];
    const M2 = ['List', ['List', 7, -9, 11], ['List', -8, 10, -12]];
    const inner = ce.expr(['Add', ['Multiply', 'a', M1], M2]).evaluate();
    expect(
      ce
        .expr(['MatrixMultiply', ['List', ['List', 'x', 'y']], inner])
        .evaluate().json
    ).toEqual([
      'List',
      [
        'List',
        [
          'Add',
          ['Multiply', 'a', 'x'],
          ['Multiply', 2, 'a', 'y'],
          ['Multiply', 7, 'x'],
          ['Multiply', -8, 'y'],
        ],
        [
          'Add',
          ['Multiply', 3, 'a', 'x'],
          ['Multiply', 4, 'a', 'y'],
          ['Multiply', -9, 'x'],
          ['Multiply', 10, 'y'],
        ],
        [
          'Add',
          ['Multiply', 5, 'a', 'x'],
          ['Multiply', 6, 'a', 'y'],
          ['Multiply', 11, 'x'],
          ['Multiply', -12, 'y'],
        ],
      ],
    ]);
  });

  test(`row-vector . (a M1 + M2) in fused form`, () => {
    // The natural single-expression form errors: the matrix-valued Add operand
    // is assigned the union type `finite_number | matrix<2x3>` during
    // canonicalization and rejected by MatrixMultiply's signature. CURRENT:
    // returns MatrixMultiply(..., Error(incompatible-type)).
    const M1 = ['List', ['List', 1, 3, 5], ['List', 2, 4, 6]];
    const M2 = ['List', ['List', 7, -9, 11], ['List', -8, 10, -12]];
    expect(
      ce
        .expr([
          'MatrixMultiply',
          ['List', ['List', 'x', 'y']],
          ['Add', ['Multiply', 'a', M1], M2],
        ])
        .evaluate().operator
    ).toBe('List');
  });

  test(`conjugate transpose of [[1, 2+3i],[f(4-5i), 6]]`, () => {
    // Hermitian adjoint. The (1,2) entry is the honest general answer
    // Conjugate(f(4-5i)); Wester notes it reduces to f(4+5i) only when f is
    // assumed real-valued.
    expect(
      ce
        .expr([
          'ConjugateTranspose',
          [
            'List',
            ['List', 1, ['Complex', 2, 3]],
            ['List', ['f', ['Complex', 4, -5]], 6],
          ],
        ])
        .evaluate().json
    ).toEqual([
      'List',
      ['List', 1, ['Conjugate', ['f', ['Complex', 4, -5]]]],
      ['List', ['Complex', 2, -3], 6],
    ]);
  });

  test(`symbolic 2x2 inverse of [[a,b],[1,ab]]`, () => {
    // Value-equal to Wester's 1/(a^2-1)·[[a,-1],[-1/b, a/b]] (denominator here
    // is the expanded a^2 b - b = b(a^2-1)).
    expect(
      ce
        .expr([
          'Inverse',
          ['List', ['List', 'a', 'b'], ['List', 1, ['Multiply', 'a', 'b']]],
        ])
        .evaluate().json
    ).toEqual([
      'List',
      [
        'List',
        [
          'Divide',
          ['Multiply', 'a', 'b'],
          ['Add', ['Multiply', 'b', ['Power', 'a', 2]], ['Negate', 'b']],
        ],
        [
          'Divide',
          ['Negate', 'b'],
          ['Add', ['Multiply', 'b', ['Power', 'a', 2]], ['Negate', 'b']],
        ],
      ],
      [
        'List',
        [
          'Divide',
          -1,
          ['Add', ['Multiply', 'b', ['Power', 'a', 2]], ['Negate', 'b']],
        ],
        [
          'Divide',
          'a',
          ['Add', ['Multiply', 'b', ['Power', 'a', 2]], ['Negate', 'b']],
        ],
      ],
    ]);
  });

  test(`infinity norm of [[1, -2i], [-3i, 4]] = 7`, () => {
    // Wester's matrix-norm problem — commented out even in the Mathematica
    // corpus (Mathematica 3.0 could not do it); CE computes it.
    expect(
      ce
        .expr([
          'Norm',
          [
            'List',
            ['List', 1, ['Complex', 0, -2]],
            ['List', ['Complex', 0, -3], 4],
          ],
          'PositiveInfinity',
        ])
        .evaluate().json
    ).toBe(7);
  });

  test(`M . M^-1 => identity`, () => {
    // CURRENT: the off-diagonal entries reduce to 0, but the diagonal entries
    // stay as an unsimplified Add of two fractions with a common denominator
    // (b·a^2/(b·a^2 - b) + (-b)/(b·a^2 - b)) that is not folded to 1, even
    // under simplify().
    const M = ['List', ['List', 'a', 'b'], ['List', 1, ['Multiply', 'a', 'b']]];
    expect(
      ce
        .expr(['MatrixMultiply', M, ['Inverse', M]])
        .evaluate()
        .simplify().json
    ).toEqual(['List', ['List', 1, 0], ['List', 0, 1]]);
  });

  test(`inverse of a triangular block matrix [[A11,A12],[0,A22]]`, () => {
    // => [[A11^-1, -A11^-1 A12 A22^-1], [0, A22^-1]] (Cullen, p. 35).
    expect(
      ce
        .expr(['Inverse', ['List', ['List', 'A11', 'A12'], ['List', 0, 'A22']]])
        .evaluate().json
    ).toEqual([
      'List',
      [
        'List',
        ['Divide', 1, 'A11'],
        ['Divide', ['Negate', 'A12'], ['Multiply', 'A11', 'A22']],
      ],
      ['List', 0, ['Divide', 1, 'A22']],
    ]);
  });

  test(`reduced row echelon form of the 4x5 Cullen matrix`, () => {
    // => [[1,0,-1,0,2],[0,1,2,0,-1],[0,0,0,1,3],[0,0,0,0,0]] (Cullen, p. 43).
    // Exact rational elimination for all-exact entries.
    expect(
      ce
        .expr([
          'RowReduce',
          [
            'List',
            ['List', 1, 2, 3, 1, 3],
            ['List', 3, 2, 1, 1, 7],
            ['List', 0, 2, 4, 1, 1],
            ['List', 1, 1, 1, 1, 4],
          ],
        ])
        .evaluate().json
    ).toEqual([
      'List',
      ['List', 1, 0, -1, 0, 2],
      ['List', 0, 1, 2, 0, -1],
      ['List', 0, 0, 0, 1, 3],
      ['List', 0, 0, 0, 0, 0],
    ]);
  });

  test(`matrix rank of a 3x4 integer matrix => 2`, () => {
    expect(
      ce
        .expr([
          'MatrixRank',
          [
            'List',
            ['List', -1, 3, 7, -5],
            ['List', 4, -2, 1, 3],
            ['List', 2, 4, 15, -7],
          ],
        ])
        .evaluate().json
    ).toBe(2);
  });

  test(`matrix rank of an exact-radical 2x2 matrix => 1`, () => {
    // [[2√2, 8],[6√6, 24√3]] is rank-deficient (row 2 = 3√3 · row 1).
    expect(
      ce
        .expr([
          'MatrixRank',
          [
            'List',
            ['List', ['Multiply', 2, ['Sqrt', 2]], 8],
            [
              'List',
              ['Multiply', 6, ['Sqrt', 6]],
              ['Multiply', 24, ['Sqrt', 3]],
            ],
          ],
        ])
        .evaluate().json
    ).toBe(1);
  });

  test(`matrix rank of a trigonometric 2x2 matrix => 1`, () => {
    // Row 2 = [sin 2t, cos 2t] via double-angle identities, so rank 1. CURRENT:
    // MatrixRank stays symbolic (numeric conversion of the trig entries fails,
    // and no trig-identity simplification is applied).
    expect(
      ce
        .expr([
          'MatrixRank',
          [
            'List',
            [
              'List',
              ['Sin', ['Multiply', 2, 't']],
              ['Cos', ['Multiply', 2, 't']],
            ],
            [
              'List',
              [
                'Multiply',
                2,
                ['Subtract', 1, ['Power', ['Cos', 't'], 2]],
                ['Cos', 't'],
              ],
              [
                'Multiply',
                ['Subtract', 1, ['Multiply', 2, ['Power', ['Sin', 't'], 2]]],
                ['Sin', 't'],
              ],
            ],
          ],
        ])
        .evaluate().json
    ).toBe(1);
  });

  test(`Vandermonde 4x4 determinant (numeric spot-check) => 240`, () => {
    // The symbolic determinant is value-correct but returned in an unfactored
    // rational form (see the skipped factoring test); a numeric substitution
    // (w,x,y,z) = (2,3,5,7) confirms the value 240.
    expect(
      ce
        .expr([
          'Determinant',
          [
            'List',
            ['List', 1, 1, 1, 1],
            ['List', 2, 3, 5, 7],
            ['List', 4, 9, 25, 49],
            ['List', 8, 27, 125, 343],
          ],
        ])
        .evaluate().json
    ).toBe(240);
  });

  test(`Vandermonde determinant factors to the difference product`, () => {
    // => (w-x)(w-y)(w-z)(x-y)(x-z)(y-z). CURRENT: evaluate() yields a
    // value-correct but unfactored expression carrying a /(-w+x) division
    // artifact; Factor does not evaluate the inner Determinant, and simplify()
    // leaves Determinant(...) unevaluated.
    const M = [
      'List',
      ['List', 1, 1, 1, 1],
      ['List', 'w', 'x', 'y', 'z'],
      [
        'List',
        ['Power', 'w', 2],
        ['Power', 'x', 2],
        ['Power', 'y', 2],
        ['Power', 'z', 2],
      ],
      [
        'List',
        ['Power', 'w', 3],
        ['Power', 'x', 3],
        ['Power', 'y', 3],
        ['Power', 'z', 3],
      ],
    ];
    const det = ce.expr(['Determinant', M]).evaluate();
    const product = ce.parse('(w-x)(w-y)(w-z)(x-y)(x-z)(y-z)');
    expect(det.sub(product).simplify().json).toBe(0);
  });

  test(`characteristic polynomial of a 3x3 matrix`, () => {
    // det(λI - A) for A = [[5,-3,-7],[-2,1,2],[2,-3,-4]]; its roots are the
    // eigenvalues {1, -2, 3} (verified: p(1)=p(-2)=p(3)=0).
    expect(
      ce
        .expr([
          'CharacteristicPolynomial',
          [
            'List',
            ['List', 5, -3, -7],
            ['List', -2, 1, 2],
            ['List', 2, -3, -4],
          ],
          'lambda',
        ])
        .evaluate()
        .toString()
    ).toBe('lambda^3 - 2lambda^2 - 5lambda + 6');
  });

  test(`eigenvalues of the 3x3 matrix => {1, -2, 3}`, () => {
    // Regression: the analytic 3x3 solver used a sign-flipped `q` in its
    // depressed cubic, mirroring every root about tr/3 — it returned
    // [10/3, -5/3, 1/3], none of which are roots of the (correct)
    // characteristic polynomial λ^3-2λ^2-5λ+6. Invisible for spectra
    // symmetric about their mean (e.g. {1,2,3}); fixed 2026-07-05.
    const M = [
      'List',
      ['List', 5, -3, -7],
      ['List', -2, 1, 2],
      ['List', 2, -3, -4],
    ];
    const ev = ce.expr(['Eigenvalues', M]).evaluate();
    const vals = (ev.ops ?? []).map((o) => o.re ?? NaN).sort((a, b) => a - b);
    expect(vals).toHaveLength(3);
    [-2, 1, 3].forEach((e, i) => expect(vals[i]).toBeCloseTo(e, 10));
  });

  test(`complex eigenvalues of a real 3x3 matrix => {2, i, -i}`, () => {
    // Regression: the analytic 3x3 solver silently returned only the REAL
    // part of a complex-conjugate eigenvalue pair (twice) — [[0,-1,0],
    // [1,0,0],[0,0,2]] came back as {2, 0, 0}. Fixed 2026-07-05.
    const M = [
      'List',
      ['List', 0, -1, 0],
      ['List', 1, 0, 0],
      ['List', 0, 0, 2],
    ];
    const ev = ce.expr(['Eigenvalues', M]).evaluate();
    const vals = (ev.ops ?? [])
      .map((o) => ({ re: o.re, im: o.im }))
      .sort((a, b) => a.im - b.im || a.re - b.re);
    expect(vals).toHaveLength(3);
    expect(vals[0].re).toBeCloseTo(0, 10);
    expect(vals[0].im).toBeCloseTo(-1, 10);
    expect(vals[1].re).toBeCloseTo(2, 10);
    expect(vals[1].im).toBeCloseTo(0, 10);
    expect(vals[2].re).toBeCloseTo(0, 10);
    expect(vals[2].im).toBeCloseTo(1, 10);
  });

  test(`eigenvalues of the 5x5 tridiagonal (2 on diag, 1 off) => {2±√3, 1, 2, 3}`, () => {
    // Wilkinson, p. 307. The exact set is {2-√3, 1, 2, 3, 2+√3}; CE returns it
    // numerically (via QR), so we check the values within tolerance.
    const M = [
      'List',
      ['List', 2, 1, 0, 0, 0],
      ['List', 1, 2, 1, 0, 0],
      ['List', 0, 1, 2, 1, 0],
      ['List', 0, 0, 1, 2, 1],
      ['List', 0, 0, 0, 1, 2],
    ];
    const ev = ce.expr(['Eigenvalues', M]).evaluate();
    const vals = (ev.ops ?? []).map((o) => o.re ?? NaN).sort((a, b) => a - b);
    const expected = [2 - Math.sqrt(3), 1, 2, 3, 2 + Math.sqrt(3)];
    expect(vals).toHaveLength(5);
    expected.forEach((e, i) => expect(vals[i]).toBeCloseTo(e, 10));
  });

  test(`eigenvalues of the 8x8 Rosser matrix`, () => {
    // The famous numeric-eigensolver stress test (Cleve Moler). Exact set:
    // {-10√10405, 0, 510-100√26, 1000, 1000, 510+100√26, 1020, 10√10405} ≈
    // {-1020.049, 0, 0.098, 1000, 1000, 1019.902, 1020, 1020.049}.
    // CE's numeric QR (Hessenberg reduction + Francis double-shift QR with
    // deflation) converges to the true spectrum, including the double
    // eigenvalue 1000 and the tiny eigenvalue ≈ 0.098.
    const rosser = [
      'List',
      ['List', 611, 196, -192, 407, -8, -52, -49, 29],
      ['List', 196, 899, 113, -192, -71, -43, -8, -44],
      ['List', -192, 113, 899, 196, 61, 49, 8, 52],
      ['List', 407, -192, 196, 611, 8, 44, 59, -23],
      ['List', -8, -71, 61, 8, 411, -599, 208, 208],
      ['List', -52, -43, 49, 44, -599, 411, 208, 208],
      ['List', -49, -8, 8, 59, 208, 208, 99, -911],
      ['List', 29, -44, 52, -23, 208, 208, -911, 99],
    ];
    const ev = ce.expr(['Eigenvalues', rosser]).evaluate();
    const vals = (ev.ops ?? [])
      // `+ 0` normalizes signed zero: the exact-zero eigenvalue lands within a
      // rounding error of 0, whose sign is platform-dependent, and Jest's
      // `toEqual` treats -0 and +0 as distinct.
      .map((o) => Math.round((o.re ?? NaN) * 1e3) / 1e3 + 0)
      .sort((a, b) => a - b);
    expect(vals).toEqual([
      -1020.049, 0, 0.098, 1000, 1000, 1019.902, 1020, 1020.049,
    ]);
  });

  test(`matrix square root of [[10,7],[7,17]] => [[3,1],[1,4]]`, () => {
    // MatrixPower accepts a half-integer exponent: A^{1/2} is the principal
    // matrix square root of an exact 2×2 positive-semidefinite matrix, via the
    // closed form √M = (M + √(det M)·I) / √(tr M + 2·√(det M)).
    expect(
      ce
        .expr([
          'MatrixPower',
          ['List', ['List', 10, 7], ['List', 7, 17]],
          ['Rational', 1, 2],
        ])
        .evaluate().json
    ).toEqual(['List', ['List', 3, 1], ['List', 1, 4]]);
  });

  test(`SVD singular values of [[1,1],[2,2],[3,3]] => {2√7, 0}`, () => {
    // The dedicated `SingularValues` head returns the singular values in exact
    // form (√ of the eigenvalues of the exact Gram matrix A^T·A = [[14,14],
    // [14,14]], whose eigenvalues are {28, 0}), sorted descending: [2√7, 0].
    const singularValues = ce
      .expr([
        'SingularValues',
        ['List', ['List', 1, 1], ['List', 2, 2], ['List', 3, 3]],
      ])
      .evaluate();
    expect(singularValues.json).toEqual([
      'List',
      ['Multiply', 2, ['Sqrt', 7]],
      0,
    ]);
  });

  // Not transcribed (operators not implemented): matrix exponential
  // (MatrixExp[{{1,-2},{2,1}}] => e·[[cos 2, -sin 2],[sin 2, cos 2]]) — Exp
  // broadcasts elementwise instead; sine of a matrix (Im[MatrixExp[M·I]]);
  // Smith / Jordan normal forms; superdiagonal extraction and block-diagonal
  // construction (no natural CE head).
});

describe('Statistics', () => {
  test(`Mean({3, 7, 11, 5, 19}) = 9`, () => {
    expect(ce.expr(['Mean', ['List', 3, 7, 11, 5, 19]]).evaluate().json).toBe(
      9
    );
  });

  test(`Median({3, 7, 11, 5, 19}) = 7`, () => {
    expect(ce.expr(['Median', ['List', 3, 7, 11, 5, 19]]).evaluate().json).toBe(
      7
    );
  });

  test(`Mode({3, 7, 11, 7, 3, 5, 7}) = 7`, () => {
    expect(
      ce.expr(['Mode', ['List', 3, 7, 11, 7, 3, 5, 7]]).evaluate().json
    ).toBe(7);
  });

  test(`Quartiles({1..8}) = (5/2, 9/2, 13/2)`, () => {
    expect(
      ce.expr(['Quartiles', ['List', 1, 2, 3, 4, 5, 6, 7, 8]]).evaluate().json
    ).toEqual([
      'Tuple',
      ['Rational', 5, 2],
      ['Rational', 9, 2],
      ['Rational', 13, 2],
    ]);
  });

  test(`sample StandardDeviation({1..5}) = sqrt(10)/2, Variance = 5/2`, () => {
    expect(
      ce.expr(['StandardDeviation', ['List', 1, 2, 3, 4, 5]]).evaluate().json
    ).toEqual(['Divide', ['Sqrt', 10], 2]);
    expect(
      ce.expr(['Variance', ['List', 1, 2, 3, 4, 5]]).evaluate().json
    ).toEqual(['Rational', 5, 2]);
  });

  test(`Binomial(15, 3/4): P(X = 12) exact and numeric`, () => {
    // C(15,12)·(3/4)^12·(1/4)^3 = 455·3^12/4^15 = 241805655/1073741824 ≈ 0.22520.
    const pdf = ce.expr([
      'PDF',
      ['BinomialDistribution', 15, ['Rational', 3, 4]],
      12,
    ]);
    expect(pdf.evaluate().json).toEqual(['Rational', 241805655, 1073741824]);
    expect(pdf.N().json).toEqual({
      num: '0.225199065171182155608953125',
    });
  });

  test(`Binomial(15, 3/4): P(X <= 12) (CDF) => I_{1/4}(3, 13) ≈ 0.76391`, () => {
    // CDF(k) = I_{1-p}(n-k, k+1) = I_{1/4}(3, 13).
    const cdf = ce.expr([
      'CDF',
      ['BinomialDistribution', 15, ['Rational', 3, 4]],
      12,
    ]);
    expect(cdf.evaluate().json).toEqual([
      'BetaRegularized',
      ['Rational', 1, 4],
      3,
      13,
    ]);
    expect(cdf.N().json).toEqual({ num: '0.763912188820540904999' });
  });

  test(`Normal(4.35, 0.59): CDF(5) - CDF(4) ≈ 0.58819`, () => {
    // Wester's review cites 0.5867, but an independent mpmath computation gives
    // 0.588185984502579239824…, which matches CE exactly — Wester's cited value
    // is inaccurate.
    expect(
      ce
        .expr([
          'Subtract',
          ['CDF', ['NormalDistribution', 4.35, 0.59], 5],
          ['CDF', ['NormalDistribution', 4.35, 0.59], 4],
        ])
        .N().json
    ).toEqual({ num: '0.588185984502579239826' });
  });
});

describe('Series', () => {
  test(`Taylor series of sin x about 0, order 7`, () => {
    expect(
      ce
        .expr(['Series', ['Sin', 'x'], 'x', 0, 7])
        .evaluate()
        .toString()
    ).toBe('x - 1/6 * x^3 + 1/120 * x^5 - 1/5040 * x^7 + BigO(x^9)');
  });
});

describe('Algebra', () => {
  test(`Wester 14: (x^2 - 4)/(x^2 + 4x + 4) => (x - 2)/(x + 2)`, () => {
    // Policy decision 2026-07-05: common-factor cancellation belongs in
    // simplify(), not evaluate(). (Canonical .json spells x − 2 as
    // ['Add', 'x', -2].)
    expect(
      ce.parse('\\frac{x ^{2} - 4}{x ^{2} + 4 x + 4}').simplify().json
    ).toEqual(['Divide', ['Add', 'x', -2], ['Add', 'x', 2]]);
  });
});
