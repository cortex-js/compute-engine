import type { MathJsonExpression } from '../../src/math-json/types';
import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import { packTensor } from '../../src/compute-engine/boxed-expression/tensor-view';
import { rationalAsFloat } from '../../src/compute-engine/numerics/rationals';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { ExactNumericValue } from '../../src/compute-engine/numeric-value/exact-numeric-value';
import { isGaussianInteger } from '../../src/compute-engine/numeric-value/gaussian-integer';

// A number whose magnitude is outside the float64 range (`10^400`,
// `10^-400`) has a machine value of ±Infinity or 0. Two kinds of code used
// that machine value in place of the number:
//
// - Tensor packing stored such a cell as `float64`, so `Norm([10^400, 1])`
//   answered `+oo` and a `10^-400` entry read back as 0 under `.N()`.
// - The ordering of `Max`, `Min`, `Clamp` and `Sort` compared machine values
//   (or applied the engine tolerance, which is larger than the difference),
//   so `Max(10^-400, 2·10^-400)` answered the smaller value.
//
// The expected values are hand calculations. Machine numbers keep the
// float64 route (the controls below).

const ce = new ComputeEngine();

const BIG: MathJsonExpression = ['Power', 10, 400];
const BIG_PLUS_ONE: MathJsonExpression = ['Add', ['Power', 10, 400], 1];
const TINY: MathJsonExpression = ['Power', 10, -400];
const TWO_TINY: MathJsonExpression = ['Multiply', 2, ['Power', 10, -400]];
const THREE_TINY: MathJsonExpression = ['Multiply', 3, ['Power', 10, -400]];

describe('TENSOR PACKING OF NUMBERS OUTSIDE THE FLOAT64 RANGE', () => {
  test('An exact integer that overflows float64 packs as an expression', () => {
    const t = packTensor(ce, ce.box(['List', BIG, 1]).evaluate());
    expect(t?.dtype).toBe('expression');
  });

  test('A decimal that underflows float64 packs as an expression under .N()', () => {
    const t = packTensor(ce, ce.box(['List', TINY, 1]).N(), {
      numeric: true,
    });
    expect(t?.dtype).toBe('expression');
  });

  test('Machine numbers keep the float64 route', () => {
    const t = packTensor(ce, ce.box(['List', 1.5, 2.5, 1e-300]).evaluate());
    expect(t?.dtype).toBe('float64');
    const n = packTensor(ce, ce.box(['List', 1, 2, 3]).N(), { numeric: true });
    expect(n?.dtype).toBe('float64');
  });

  test('Norm([10^400, 1]) is √(10^800 + 1), not +oo', () => {
    // ‖(10^400, 1)‖ = √(10^800 + 1), which is not an integer.
    const r = ce.box(['Norm', ['List', BIG, 1]]).evaluate();
    expect(r.operator).toBe('Sqrt');
    expect(
      r.op1.isSame(ce.box(['Add', ['Power', 10, 800], 1]).evaluate())
    ).toBe(true);
    expect(
      ce
        .box(['Norm', ['List', BIG, 1]])
        .N()
        .toString()
    ).toBe('1e+400');
  });

  test('Norm of a vector parsed from LaTeX', () => {
    expect(
      ce.parse('\\operatorname{Norm}([10^{400}, 0])').evaluate().toString()
    ).toBe('1e+400');
  });

  test('Spectral norm of diag(10^400, 10^400 + 1) is 10^400 + 1', () => {
    const m: MathJsonExpression = [
      'List',
      ['List', BIG, 0],
      ['List', 0, BIG_PLUS_ONE],
    ];
    const expected = ce.box(BIG_PLUS_ONE).evaluate();
    expect(ce.box(['Norm', m, 2]).evaluate().isSame(expected)).toBe(true);
    const parsed = ce.parse(
      '\\operatorname{Norm}(\\begin{pmatrix}10^{400}&0\\\\0&10^{400}+1\\end{pmatrix}, 2)'
    );
    expect(parsed.evaluate().isSame(expected)).toBe(true);
  });

  test('Norm([10^-400, 0]).N() is 1e-400, not 0', () => {
    expect(
      ce
        .box(['Norm', ['List', TINY, 0]])
        .N()
        .toString()
    ).toBe('1e-400');
  });

  test('Spectral norm of [[10^-400, 0], [0, 0]] is 10^-400', () => {
    // Under `.N()` the entries are the decimal `1e-400`, which is not a
    // rational literal: the norm stayed unevaluated.
    const m: MathJsonExpression = ['List', ['List', TINY, 0], ['List', 0, 0]];
    const expected = ce.box(TINY).evaluate();
    expect(ce.box(['Norm', m, 2]).evaluate().isSame(expected)).toBe(true);
    expect(ce.box(['Norm', m, 2]).N().toString()).toBe('1e-400');
    const parsed = ce.parse(
      '\\operatorname{Norm}(\\begin{pmatrix}10^{-400}&0\\\\0&0\\end{pmatrix}, 2)'
    );
    expect(parsed.evaluate().isSame(expected)).toBe(true);
    expect(parsed.N().toString()).toBe('1e-400');
  });

  test('Spectral norm of diag(10^-400, 2·10^-400) is 2·10^-400', () => {
    const m: MathJsonExpression = [
      'List',
      ['List', TINY, 0],
      ['List', 0, TWO_TINY],
    ];
    expect(
      ce.box(['Norm', m, 2]).evaluate().isSame(ce.box(TWO_TINY).evaluate())
    ).toBe(true);
    expect(ce.box(['Norm', m, 2]).N().toString()).toBe('2e-400');
    // √2 · 10^-400 ≈ 1.414 · 10^-400 is larger than 10^-400: an exact
    // radical modulus.
    const r: MathJsonExpression = [
      'List',
      ['List', ['Multiply', ['Sqrt', 2], TINY], 0],
      ['List', 0, TINY],
    ];
    expect(ce.box(['Norm', r, 2]).evaluate().toString()).toBe('sqrt(2)/1e+400');
    expect(ce.box(['Norm', r, 2]).N().toString()).toBe(
      '1.4142135623730950488e-400'
    );
  });

  test('Determinant with entries above 2^53 is exact', () => {
    // (10^20 + 1)(10^20 − 1) − 10^20 · 10^20 = −1
    const m: MathJsonExpression = [
      'List',
      ['List', ['Add', ['Power', 10, 20], 1], ['Power', 10, 20]],
      ['List', ['Power', 10, 20], ['Subtract', ['Power', 10, 20], 1]],
    ];
    expect(ce.box(['Determinant', m]).evaluate().toString()).toBe('-1');
    expect(
      ce
        .parse(
          '\\det\\begin{pmatrix}10^{20}+1&10^{20}\\\\10^{20}&10^{20}-1\\end{pmatrix}'
        )
        .evaluate()
        .toString()
    ).toBe('-1');
  });
});

describe('EXACT SQUARE ROOT OF A LARGE VALUE', () => {
  // A rounded float root with an integer value was boxed as an exact integer.
  test('√(10^30 + 1) stays symbolic', () => {
    const r = ce.box(['Sqrt', ['Add', ['Power', 10, 30], 1]]).evaluate();
    expect(r.operator).toBe('Sqrt');
  });

  test('√(10^40 · √2) stays symbolic', () => {
    const r = ce
      .box(['Sqrt', ['Multiply', ['Power', 10, 40], ['Sqrt', 2]]])
      .evaluate();
    expect(r.operator).toBe('Sqrt');
  });

  test('A perfect square stays exact', () => {
    expect(
      ce
        .box(['Sqrt', ['Power', 10, 30]])
        .evaluate()
        .toString()
    ).toBe('1000000000000000');
    expect(
      ce
        .box(['Sqrt', ['Power', 10, 402]])
        .evaluate()
        .toString()
    ).toBe('1e+201');
  });
});

describe('ORDERING NUMBERS OUTSIDE THE FLOAT64 RANGE', () => {
  test('Max and Min, box route', () => {
    expect(
      ce
        .box(['Max', TINY, TWO_TINY])
        .evaluate()
        .isSame(ce.box(TWO_TINY).evaluate())
    ).toBe(true);
    expect(ce.box(['Max', TINY, TWO_TINY]).N().toString()).toBe('2e-400');
    expect(ce.box(['Min', TWO_TINY, TINY]).N().toString()).toBe('1e-400');
    expect(
      ce
        .box(['Max', BIG, BIG_PLUS_ONE])
        .evaluate()
        .isSame(ce.box(BIG_PLUS_ONE).evaluate())
    ).toBe(true);
    expect(
      ce
        .box(['Max', ['List', TINY, { num: '2e-400' }]])
        .evaluate()
        .toString()
    ).toBe('2e-400');
  });

  test('Max and Min, parse route', () => {
    // `2\cdot 10^{-400}` parses as the decimal `2e-400`.
    expect(
      ce.parse('\\max(10^{-400}, 2\\cdot 10^{-400})').evaluate().toString()
    ).toBe('2e-400');
    expect(ce.parse('\\min(2\\cdot 10^{-400}, 10^{-400})').N().toString()).toBe(
      '1e-400'
    );
  });

  test('Clamp and ElementMax', () => {
    expect(ce.box(['Clamp', TINY, TWO_TINY, THREE_TINY]).N().toString()).toBe(
      '2e-400'
    );
    expect(
      ce
        .box(['ElementMax', TINY, { num: '2e-400' }])
        .evaluate()
        .toString()
    ).toBe('2e-400');
  });

  test('Sort', () => {
    expect(
      ce
        .box(['Sort', ['List', TWO_TINY, TINY]])
        .N()
        .toString()
    ).toBe('[1e-400,2e-400]');
    expect(
      ce
        .box(['Sort', ['List', { num: '2e-400' }, TINY]])
        .evaluate()
        .toString()
    ).toBe('[1/1e+400,2e-400]');
  });

  test('Machine numbers are ordered exactly too', () => {
    // Two different values are never a tie, also when they are closer than
    // the engine tolerance (1e-10).
    expect(ce.box(['Max', 1e-12, 2e-12]).evaluate().toString()).toBe('2e-12');
    expect(ce.box(['Max', 1.5, 2.5]).evaluate().toString()).toBe('2.5');
    expect(ce.parse('\\max(1.5, 2.5)').evaluate().toString()).toBe('2.5');
  });
});

describe('EXACT STATISTICS ORDER VALUES BY THEIR EXACT VALUES', () => {
  // The exact route of Median, Quartiles and Mode sorted by machine values.
  test('Median of values that underflow float64', () => {
    // sorted: 10^-400, 2·10^-400, 3·10^-400 → the median is 2·10^-400
    expect(
      ce
        .box(['Median', ['List', THREE_TINY, TINY, TWO_TINY]])
        .evaluate()
        .isSame(ce.box(TWO_TINY).evaluate())
    ).toBe(true);
  });

  test('Median of values that overflow float64', () => {
    const r = ce
      .box([
        'Median',
        ['List', BIG, ['Add', ['Power', 10, 400], 2], BIG_PLUS_ONE],
      ])
      .evaluate();
    expect(r.isSame(ce.box(BIG_PLUS_ONE).evaluate())).toBe(true);
  });

  test('Median of integers above 2^53 with the same machine value', () => {
    expect(
      ce
        .parse('\\operatorname{Median}([10^{20}+1, 10^{20}, 10^{20}+2])')
        .evaluate()
        .toString()
    ).toBe('100000000000000000001');
  });

  test('Quartiles and Mode', () => {
    // sorted: 1, 1, 2, 3, 5 (× 10^-400) → Q1 = 1, Q2 = 2, Q3 = (3 + 5)/2 = 4
    const q = ce
      .box([
        'Quartiles',
        ['List', THREE_TINY, TINY, TWO_TINY, TINY, ['Multiply', 5, TINY]],
      ])
      .evaluate();
    expect(q.ops!.map((x) => x.N().toString())).toEqual([
      '1e-400',
      '2e-400',
      '4e-400',
    ]);
    expect(
      ce
        .box(['Mode', ['List', TINY, TWO_TINY, TWO_TINY]])
        .evaluate()
        .isSame(ce.box(TWO_TINY).evaluate())
    ).toBe(true);
  });

  test('Machine data keeps its median', () => {
    expect(
      ce
        .box(['Median', ['List', 3, 1, 4, 2]])
        .evaluate()
        .toString()
    ).toBe('5/2');
  });
});

describe('MACHINE PRODUCTS AND QUOTIENTS WITH A FACTOR OUTSIDE THE FLOAT64 RANGE', () => {
  // At machine precision each factor of a product was converted to a double
  // before the product was formed. A factor such as `1/10^400` became 0 and
  // `10^400 + 1` became +∞, so a product whose value is in the double range
  // (`(10^300 + 1)/10^400` is about `1e-100`) came out 0 or +∞. The expected
  // values are those of the default (21-digit) precision, rounded to a
  // double; `1/7 · 10^-20` was checked with Python `decimal`.
  //
  // Constructing an engine sets the global big-decimal precision, which the
  // engine `ce` of the tests above also reads. So the machine engine is made
  // only when this block runs, and a default engine is made after it to set
  // the default precision again.
  let m: ComputeEngine;
  beforeAll(() => {
    m = new ComputeEngine({ precision: 'machine' });
  });
  afterAll(() => {
    new ComputeEngine();
  });

  test.each([
    ['\\frac{10^{300}+1}{10^{400}}', 1e-100],
    ['10^{-400}\\cdot10^{300}', 1e-100],
    ['-10^{-400}\\cdot10^{300}', -1e-100],
    ['10^{400}\\cdot10^{-300}', 1e100],
    ['\\frac{10^{400}+1}{10^{300}}', 1e100],
    ['\\frac{10^{300}}{10^{400}+1}', 1e-100],
    ['10^{-400}\\cdot10^{300}\\cdot2.5', 2.5e-100],
    ['\\frac{10^{300}+1}{10^{400}}+10^{-100}', 2e-100],
    // `10^{-320}` is a subnormal double, which keeps only a few digits.
    ['\\frac{1}{7}\\cdot10^{-320}\\cdot10^{300}', 1.4285714285714285e-21],
  ])('%s', (tex, expected) => {
    expect(m.parse(tex).N().re).toBe(expected);
  });

  test('a symbolic co-factor keeps the numeric coefficient', () => {
    expect(m.parse('\\frac{10^{300}+1}{10^{400}}x').N().toString()).toBe(
      '1e-100 * x'
    );
  });

  test('the reciprocal of a small angle is finite, not a pole', () => {
    expect(m.parse('\\csc(\\frac{10^{300}+1}{10^{400}})').N().re).toBe(1e100);
    expect(m.parse('\\cot(\\frac{10^{300}+1}{10^{400}})').N().re).toBe(1e100);
    // A true underflow keeps the signed infinity.
    expect(m.parse('\\csc(10^{-400})').N().toString()).toBe('+oo');
  });

  test('a value that is truly out of range stays 0', () => {
    expect(m.parse('\\frac{1.5}{10^{400}+1}').N().re).toBe(0);
  });

  // Last in the block: it constructs a default engine, which sets the global
  // precision back to the default.
  test('the default precision gives the same values', () => {
    const d = new ComputeEngine();
    expect(d.parse('\\frac{10^{300}+1}{10^{400}}').N().re).toBe(1e-100);
    expect(d.parse('10^{-400}\\cdot10^{300}').N().re).toBe(1e-100);
  });
});

describe('MACHINE FUNCTIONS AND SUMS OF EXACT VALUES OUTSIDE THE FLOAT64 RANGE', () => {
  // At machine precision, the numeric value of an exact operand was its
  // double: `10^{-401}` was 0 and `10^{400}` was +∞. The functions of these
  // operands, and the sums and products that combine them, then gave 0, +∞
  // or NaN where the value is in the double range. The expected values are
  // the values given by Python `decimal` at 40 digits, rounded to a double.
  let saved: number;
  let m: ComputeEngine;
  beforeAll(() => {
    saved = BigDecimal.precision;
    m = new ComputeEngine({ precision: 'machine' });
  });
  afterAll(() => {
    BigDecimal.precision = saved;
  });

  test.each([
    ['\\sqrt{10^{-401}}', 3.1622776601683792e-201],
    ['\\sqrt{10^{401}}', 3.1622776601683794e200],
    ['\\sqrt{10^{-401}}\\cdot10^{300}', 3.1622776601683795e99],
    ['\\sqrt[3]{10^{-900}}', 1e-300],
    ['\\sqrt[3]{-10^{-900}}', -1e-300],
    ['\\ln(10^{400})', 921.0340371976183],
    ['\\log(10^{400})', 400],
    ['\\log_2(10^{400})', 1328.771237954945],
    ['\\log_{10^{400}}(10)', 0.0025],
    ['10^{400}-10^{400}+1', 1],
  ])('%s', (tex, expected) => {
    expect(m.parse(tex).N().re).toBe(expected);
  });

  test('a complex value of an exact operand outside the range', () => {
    expect(m.parse('\\ln(-10^{400})').N().toString()).toBe(
      '(921.0340371976183 + 3.141592653589793i)'
    );
    expect(m.parse('\\sqrt{-10^{-401}}').N().im).toBe(3.1622776601683792e-201);
  });

  test('an exact radical factor outside the range', () => {
    // √2 · 10^-100 = 1.414213562373095048…e-100.
    m.assign('x', 1e300);
    expect(
      m.box(['Multiply', ['Divide', ['Sqrt', 2], ['Power', 10, 400]], 'x']).N()
        .re
    ).toBe(1.414213562373095e-100);
  });

  test('an exact coefficient of a symbolic factor outside the range', () => {
    // The exact value is 10/y (the value of `evaluate()`).
    expect(m.parse('\\frac{10^{400}}{y}\\cdot 10^{-399}').N().toString()).toBe(
      '10 / y'
    );
  });

  test('an engine below machine precision keeps its coarse precision', () => {
    // The quotient is computed at the 3 digits of the engine, not at the 25
    // digits that the machine precision uses to get a correct double.
    // Constructing an engine writes the module-global `BigDecimal.precision`,
    // so it is restored: the later blocks use the shared engine.
    const saved = BigDecimal.precision;
    try {
      const p3 = new ComputeEngine({ precision: 3 });
      const q = p3.parse('\\frac{1}{7\\cdot 10^{400}}').evaluate().numericValue;
      if (typeof q !== 'object') throw new Error('expected an exact value');
      expect(q.div(p3._numericValue(1e-300)).re).toBe(1.43e-101);
    } finally {
      BigDecimal.precision = saved;
    }
  });
});

describe('MACHINE NUMERIC VALUE OF A RESULT ABOVE THE LARGEST DOUBLE', () => {
  // At machine precision, `.N()` gives a machine float (user decision,
  // 2026-09-26). An integer or a rational above the largest double is then
  // +∞ or -∞, as `10^{800}` written as a power already was. Before, an exact
  // integer literal (`10^{400}/10^{-400}` is the literal `1e+800`), a sum of
  // exact terms (`10^{400} + 1`) and a sum or a product over a list of big
  // integers kept the exact integer. An intermediate value can be exact: a
  // result in the double range stays as it is. Exact `evaluate()` and the
  // default precision keep the exact integer.
  let saved: number;
  let m: ComputeEngine;
  beforeAll(() => {
    saved = BigDecimal.precision;
    m = new ComputeEngine({ precision: 'machine' });
  });
  afterAll(() => {
    BigDecimal.precision = saved;
  });

  test.each([
    ['10^{800}', '+oo'],
    ['\\frac{10^{400}}{10^{-400}}', '+oo'],
    ['10^{400}+1', '+oo'],
    ['-10^{400}-1', '-oo'],
    ['2\\cdot10^{400}+3', '+oo'],
    ['10^{400}\\cdot 3', '+oo'],
    ['\\frac{10^{400}+1}{3}', '+oo'],
    ['-\\frac{10^{800}}{7}', '-oo'],
    ['\\sum_{k=1}^{3} 10^{400}k', '+oo'],
    ['\\prod_{k=1}^{3} 10^{200}k', '+oo'],
    ['(10^{400}+1)i', '~oo'],
  ])('%s', (tex, expected) => {
    const n = m.parse(tex).N();
    expect(n.toString()).toBe(expected);
    expect(m.parse(tex).evaluate({ numericApproximation: true }).json).toEqual(
      n.json
    );
  });

  test.each([
    ['10^{400}-10^{400}+1', 1],
    ['\\frac{10^{300}+1}{10^{400}}', 1e-100],
    ['10^{400}\\cdot10^{-300}', 1e100],
    ['\\sqrt{10^{401}}', 3.1622776601683794e200],
    ['\\ln(10^{400})', 921.0340371976183],
  ])('a result in the double range: %s', (tex, expected) => {
    expect(m.parse(tex).N().re).toBe(expected);
  });

  test('a symbolic factor with an exact coefficient', () => {
    // The exact value is 10^{100}/y, in the double range.
    expect(m.parse('\\frac{10^{400}}{y}\\cdot 10^{-300}').N().toString()).toBe(
      '1e+100 / y'
    );
    // The exact value is 10i/y. The factor `i` is multiplied into the
    // number coefficient, as at the default precision.
    expect(
      m.parse('\\frac{10^{400}}{y}\\cdot 10^{-399}\\cdot i').N().toString()
    ).toBe('10i / y');
    // The exact value is (10 + 10i)/y.
    expect(
      m.parse('\\frac{10^{400}}{y}\\cdot 10^{-399} (1+i)').N().toString()
    ).toBe('(10 + 10i) / y');
  });

  test('a sum over a list of big integers', () => {
    m.declare('K', { value: m.box(['List', 3, -5, 7, 2]) });
    // The exact sum is 7·10^{308}, above the largest double. The sum of the
    // doubles of the terms is `∞ - ∞ + … = NaN`.
    const sum = m.box(['Sum', ['Multiply', { num: '1e308' }, 'K']]);
    expect(sum.N().toString()).toBe('+oo');
    expect(sum.evaluate().N().toString()).toBe('+oo');
    // The exact sum is 1.
    expect(
      m
        .box(['Sum', ['List', { num: '1e400' }, { num: '-1e400' }, 1]])
        .N()
        .toString()
    ).toBe('1');
  });

  test('exact evaluate() keeps the exact integer', () => {
    const v = m.parse('\\frac{10^{400}}{10^{-400}}').evaluate();
    expect(v.isExact).toBe(true);
    expect(v.toString()).toBe('1e+800');
    expect(m.parse('\\log(10^{400})').evaluate().toString()).toBe('400');
  });

  // Last in the block: it constructs a default engine, which sets the global
  // precision back to the default.
  test('the default precision keeps the exact integer', () => {
    const d = new ComputeEngine();
    expect(d.parse('10^{800}').N().toString()).toBe('1e+800');
    expect(d.parse('\\frac{10^{400}}{10^{-400}}').N().toString()).toBe(
      '1e+800'
    );
  });
});

describe('MACHINE NUMERIC VALUE OF A PRODUCT OVER A LIST', () => {
  // A numeric fold of doubles gives `∞ · 0 = NaN` for `[10^400, 0]`, but the
  // exact product is 0. When the numeric fold of `Reduce` (and so of
  // `Product(L)`) is NaN or infinite, the float of the exact fold is used.
  let m: ComputeEngine;
  let saved: number;
  beforeAll(() => {
    saved = BigDecimal.precision;
    m = new ComputeEngine({ precision: 'machine' });
  });
  afterAll(() => {
    BigDecimal.precision = saved;
  });
  test.each([
    [['Product', ['List', ['Power', 10, 400], 0]], '0'],
    [['Product', ['List', { num: '1e400' }, 0]], '0'],
    [
      ['Reduce', ['List', ['Power', 10, 400], ['Power', 10, -400]], 'Multiply'],
      '1',
    ],
    [['Product', ['List', ['Power', 10, 400], 2]], '+oo'],
    [['Product', ['List', 1.5, 2]], '3'],
  ])('%j .N() is %s', (expr, expected) => {
    expect(
      m
        .box(expr as never)
        .N()
        .toString()
    ).toBe(expected);
  });
});

describe('MACHINE NUMERIC VALUE OF A SUM OR A PRODUCT WITH A TERM OUTSIDE THE FLOAT64 RANGE', () => {
  // At machine precision the double of a term such as `10^{400}` is ±∞, and
  // the numeric fold can be NaN (`∞ - ∞`, `∞ · 0`) where the exact value is
  // finite. The float of the exact value is used then, on the synchronous
  // and on the asynchronous evaluation.
  let m: ComputeEngine;
  let saved: number;
  beforeAll(() => {
    saved = BigDecimal.precision;
    m = new ComputeEngine({ precision: 'machine' });
  });
  afterAll(() => {
    BigDecimal.precision = saved;
  });

  test.each([
    // -10^{400} + 0 + 10^{400}
    ['\\sum_{k=-1}^{1} 10^{400} k', '0'],
    ['\\sum_{k=1}^{3} 10^{400}k', '+oo'],
    // 10^{-400} · 10^{400}
    ['\\prod_{k=1}^{2} 10^{800k-1200}', '1'],
    // 10^{-400} · 1 · 10^{400}
    ['\\prod_{k=1}^{3} 10^{400(k-2)}', '1'],
    ['\\prod_{k=1}^{3} 10^{200}k', '+oo'],
    // ln 0 is exactly -∞.
    ['\\sum_{k=0}^{3} \\ln k', '-oo'],
    ['\\sum_{k=0}^{2} (\\ln k - 10^{400}k)', '-oo'],
  ])('%s', async (tex, expected) => {
    expect(m.parse(tex).N().toString()).toBe(expected);
    expect(
      (
        await m.parse(tex).evaluateAsync({ numericApproximation: true })
      ).toString()
    ).toBe(expected);
  });

  test('a sum over a list of big integers, asynchronous', async () => {
    const sum = m.box([
      'Sum',
      ['List', { num: '1e400' }, { num: '-1e400' }, 1],
    ]);
    expect(
      (await sum.evaluateAsync({ numericApproximation: true })).toString()
    ).toBe('1');
  });
});

// A complex power, root, square root or exponential removes the roundoff dust
// of its kernel. The test for dust must be relative to the modulus of the
// result: a part that is small is not dust when the whole result is small.
// A test against the fixed value 1e-14 changed `(10^{-10}i)^2 = -10^{-20}` to
// 0. The expected values are hand calculations, for example
// (10^{-6}i)^3 = 10^{-18}·i^3 = -10^{-18}i.
describe('COMPLEX RESULTS WITH A SMALL MODULUS', () => {
  // `BigDecimal.precision` is global, and constructing an engine sets it
  // (an earlier block leaves it at 3 digits). Thus each group of tests
  // makes its engine before it runs, and the precision is restored after
  // this block.
  let savedPrecision: number;
  beforeAll(() => {
    savedPrecision = BigDecimal.precision;
  });
  afterAll(() => {
    BigDecimal.precision = savedPrecision;
  });
  const engines: [string, () => ComputeEngine][] = [
    ['default precision', () => new ComputeEngine()],
    ['machine precision', () => new ComputeEngine({ precision: 'machine' })],
  ];

  // Compare the parts of `actual` with `re` and `im`, with a relative error
  // of 1e-12 of the modulus. A part that must be 0 must be exactly 0.
  function expectComplex(
    actual: { re: number; im: number },
    re: number,
    im: number
  ) {
    const scale = 1e-12 * Math.hypot(re, im);
    if (re === 0) expect(actual.re).toBe(0);
    else expect(Math.abs(actual.re - re)).toBeLessThanOrEqual(scale);
    if (im === 0) expect(actual.im).toBe(0);
    else expect(Math.abs(actual.im - im)).toBeLessThanOrEqual(scale);
  }

  describe.each(engines)('%s', (engineName, engine) => {
    let e: ComputeEngine;
    beforeAll(() => {
      e = engine();
    });
    test.each([
      ['(10^{-10}i)^2', -1e-20, 0],
      ['(10^{-6}i)^3', 0, -1e-18],
      ['(10^{-8}+10^{-8}i)^2', 0, 2e-16],
      // (10^{-10}i)^{2.5} = 10^{-25}·e^{i·5π/4}
      ['(10^{-10}i)^{2.5}', -Math.SQRT1_2 * 1e-25, -Math.SQRT1_2 * 1e-25],
      // √(10^{-30}i) = 10^{-15}·e^{iπ/4}
      ['\\sqrt{10^{-30}i}', Math.SQRT1_2 * 1e-15, Math.SQRT1_2 * 1e-15],
    ])('%s under .N()', (latex, re, im) => {
      const v = e.parse(latex).N();
      expectComplex(v, re, im);
    });

    test('a part whose value is 0 is exactly 0', () => {
      expect(e.parse('i^2').N().toString()).toBe('-1');
      expect(e.parse('\\sqrt{-4}').N().toString()).toBe('2i');
      expect(e.parse('(2i)^2').N().toString()).toBe('-4');
      expectComplex(e._numericValue({ re: 0, im: 1.5 }).pow(3), 0, -3.375);
      // π at the working precision of the engine, a float. At the default
      // precision the big-decimal kernel removes a part below
      // 10^(2−precision) times the modulus, and `e^{iπ}` is `-1`. At machine
      // precision no part is removed: the value is `-1 + sin(Math.PI)·i`,
      // the value at that double (an exact `e^{iπ}` is reduced exactly
      // before it becomes a float, and is `-1`).
      const pi = e.symbol('Pi').N();
      expectComplex(
        e._numericValue({ re: 0, im: pi.bignumRe ?? pi.re }).exp(),
        -1,
        engineName === 'machine precision' ? Math.sin(Math.PI) : 0
      );
    });

    // `Math.PI` is the decimal 3.141592653589793, which is π − 2.38·10^{-16}.
    // At machine precision, `e^{i·Math.PI}` is computed with the double
    // `Math.PI`, whose sine is `1.2246467991473532e-16`, and the part is
    // kept. At the default precision (21 digits) the big-decimal kernel
    // reads the decimal and computes sin(3.141592653589793) =
    // 2.38462643383279502884·10^{-16} (Python `mpmath`).
    test('e^{i·3.141592653589793}', () => {
      const r = e._numericValue({ re: 0, im: Math.PI }).exp();
      if (engineName === 'machine precision')
        expectComplex(r, -1, Math.sin(Math.PI));
      else expectComplex(r, -1, 2.384626433832795e-16);
    });

    test('the numeric-value kernels keep a small result', () => {
      const nv = (re: number, im: number) => e._numericValue({ re, im });
      expectComplex(nv(0, 1e-10).pow(2), -1e-20, 0);
      expectComplex(nv(0, 1e-6).pow(3), 0, -1e-18);
      // (10^{-10}i)^{2+0.5i} = e^{(2+0.5i)(ln 10^{-10} + iπ/2)}
      const lnMod = Math.log(1e-10);
      const mag = Math.exp(2 * lnMod - 0.5 * (Math.PI / 2));
      const arg = 2 * (Math.PI / 2) + 0.5 * lnMod;
      expectComplex(
        nv(0, 1e-10).pow({ re: 2, im: 0.5 }),
        mag * Math.cos(arg),
        mag * Math.sin(arg)
      );
      // ∛(10^{-30}i) = 10^{-10}·e^{iπ/6}
      expectComplex(
        nv(0, 1e-30).root(3),
        1e-10 * Math.cos(Math.PI / 6),
        1e-10 * Math.sin(Math.PI / 6)
      );
      // ∛(8i) = 2·e^{iπ/6}. The machine kernel read only the real part.
      expectComplex(
        nv(0, 8).root(3),
        2 * Math.cos(Math.PI / 6),
        2 * Math.sin(Math.PI / 6)
      );
      expectComplex(
        nv(0, 1e-30).sqrt(),
        Math.SQRT1_2 * 1e-15,
        Math.SQRT1_2 * 1e-15
      );
      // e^{-40+i} = e^{-40}·(cos 1 + i·sin 1)
      expectComplex(
        nv(-40, 1).exp(),
        Math.exp(-40) * Math.cos(1),
        Math.exp(-40) * Math.sin(1)
      );
    });

    test('a complex square root with a small imaginary part', () => {
      // √(1 + εi) = 1 + (ε/2)i to first order; the second-order term is
      // below the double precision for ε = 10^{-10}.
      const nv = (re: number, im: number) => e._numericValue({ re, im });
      expectComplex(nv(1, 1e-10).sqrt(), 1, 5e-11);
      expectComplex(nv(-1, 1e-10).sqrt(), 5e-11, 1);
      expectComplex(nv(-1, -1e-10).sqrt(), 5e-11, -1);
      expectComplex(nv(3, -4).sqrt(), 2, -1);
      expectComplex(nv(-3, 4).sqrt(), 1, 2);
    });

    test('a complex power that the complex kernel cannot compute', () => {
      // The complex kernel gives NaN + NaN·i for these powers, because an
      // intermediate value overflows or underflows. The power is computed
      // again in polar form: z^w = |z|^w·e^{i·w·arg(z)} for a real w.
      // |10^{300}(1+i)|^{0.3} = 10^{90}·2^{0.15}, arg = π/4.
      const v = e.box(['Power', ['Complex', 1e300, 1e300], 0.3]).N();
      const m1 = 1e90 * 2 ** 0.15;
      expectComplex(
        v,
        m1 * Math.cos((0.3 * Math.PI) / 4),
        m1 * Math.sin((0.3 * Math.PI) / 4)
      );
      // |10^{-200}(1+i)|^{-0.5} = 10^{100}·2^{-0.25}, arg = π/4.
      const w = e.box(['Power', ['Complex', 1e-200, 1e-200], -0.5]).N();
      const m2 = 1e100 * 2 ** -0.25;
      expectComplex(
        w,
        m2 * Math.cos(-Math.PI / 8),
        m2 * Math.sin(-Math.PI / 8)
      );
      // A result that overflows the double range is complex infinity, not
      // NaN, at machine precision. At the default precision the parts are
      // big decimals and the result is finite:
      // (10^{300}(1+i))^{1.5} = 2^{0.75}·10^{450}·e^{i·3π/8}, whose parts to
      // 21 digits (Python `mpmath`) are 6.43594252905582624735e+449 and
      // 1.55377397403003730734e+450.
      expect(
        e
          .box(['Power', ['Complex', 1e300, 1e300], 1.5])
          .N()
          .toString()
      ).toBe(
        engineName === 'machine precision'
          ? '~oo'
          : '(6.43594252905582624735e+449 + 1.55377397403003730734e+450i)'
      );
    });
  });

  test('a machine complex square root of a very small or a very large value', () => {
    // The sum `m + |a|` of the square root formula can overflow, and its half
    // can underflow to 0. The expected values: √(2^{-1074}i) =
    // 2^{-537}·(1+i)/√2 = 2^{-537.5}·(1+i), and √(10^{308}(1+i)) =
    // 10^{154}·√(1+i), with √(1+i) = √((√2+1)/2) + i·√((√2−1)/2).
    const m = new ComputeEngine({ precision: 'machine' });
    const nv = (re: number, im: number) => m._numericValue({ re, im });
    const tiny = 2 ** -538 * Math.SQRT2;
    expectComplex(nv(0, Number.MIN_VALUE).sqrt(), tiny, tiny);
    expectComplex(nv(0, -Number.MIN_VALUE).sqrt(), tiny, -tiny);
    const re = 1e154 * Math.sqrt((Math.SQRT2 + 1) / 2);
    const im = 1e154 * Math.sqrt((Math.SQRT2 - 1) / 2);
    expectComplex(nv(1e308, 1e308).sqrt(), re, im);
    // √(10^{308}(−1+i)) = i·√(10^{308}(1−i)): the parts are exchanged.
    expectComplex(nv(-1e308, 1e308).sqrt(), im, re);
    // √(10^{-310}(1−i)) = 10^{-155}·√(1−i)
    expectComplex(
      nv(1e-310, -1e-310).sqrt(),
      1e-155 * Math.sqrt((Math.SQRT2 + 1) / 2),
      -1e-155 * Math.sqrt((Math.SQRT2 - 1) / 2)
    );
  });

  test('a big-decimal complex power outside the float64 range', () => {
    // (10^{-200}i)^2 = -10^{-400}: the dust test compares big decimals.
    const d = new ComputeEngine();
    const v = d._numericValue({ re: 0, im: 1e-200 }).pow(2);
    expect(v.bignumRe?.toString()).toBe('-1e-400');
    expect(v.im).toBe(0);
  });
});

describe('COMPLEX POWER WITH A MODULUS ABOVE THE LARGEST DOUBLE', () => {
  // The polar form computes ln|z| without forming |z|, which can be above the
  // largest double for finite parts. A retry whose magnitude overflows or
  // underflows gives the complex infinity or 0, not a symbolic power.
  test('finite parts with an overflowing modulus', () => {
    const ce = new ComputeEngine();
    const z = ce.box(['Power', ['Complex', 1.5e308, 1.5e308], 0.3]).N();
    // (1.5·10^{308}(1+i))^{0.3}, computed with Python `mpmath` for the
    // decimal parts 1.5e308: 3.06064805533990338732e+92 +
    // 7.34796587106974328166e+91i. (The previous expected values,
    // 3.0606480553398345e92 and 7.347965871069578e91, were a machine
    // computation, wrong from the 14th digit.)
    expect(z.re).toBeCloseTo(3.0606480553399034e92, -78);
    expect(z.im).toBeCloseTo(7.347965871069743e91, -77);
  });
  test('an infinite part gives the complex infinity', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Power', ['Complex', 'PositiveInfinity', 1], ['Complex', 1, 1]])
        .N()
        .toString()
    ).toBe('~oo');
  });
});

// The imaginary part of an exact value is stored exactly, as a rational
// times the square root of an integer, but the question "is this value
// complex?" was answered from its double projection `im`, which is `0` for
// an imaginary part below the double range. So `i·10^{-800}` was stored
// exactly and read as zero. `isComplex` reads the exact part.
// Specification: docs/plans/2026-09-27-big-decimal-imaginary-part.md, §1
// (the table of defects), §2.1 and §2.2, "Phase 1" in §6.
describe('EXACT IMAGINARY PART OUTSIDE THE FLOAT64 RANGE', () => {
  const ce = new ComputeEngine();

  // §1 table, row 1: `i\cdot10^{-800}` `.evaluate()` was `0`.
  test('i·10^{-800} evaluates to a non-zero exact imaginary value', () => {
    const z = ce.parse('i\\cdot10^{-800}').evaluate();
    expect(z.isSame(0)).toBe(false);
    expect(z.json).toEqual(['Complex', 0, ['Rational', 1, { num: '1e+800' }]]);
    const nv = z.numericValue;
    expect(typeof nv).toBe('object');
    if (typeof nv === 'object') {
      expect(nv.isExact).toBe(true);
      expect(nv.isZero).toBe(false);
      expect(nv.isComplex).toBe(true);
      // `im` is the double projection of the imaginary part, which is 0
      expect(nv.im).toBe(0);
    }
    expect(z.im).toBe(0);
  });

  // §1 table, row 2: `(1+i)10^{-800}` `.evaluate()` lost its imaginary part.
  test('(1+i)·10^{-800} keeps both parts under evaluate()', () => {
    const z = ce.parse('(1+i)10^{-800}').evaluate();
    const part: MathJsonExpression = ['Rational', 1, { num: '1e+800' }];
    expect(z.json).toEqual(['Complex', part, part]);
  });

  // §6 "Phase 1" acceptance: the pair test. The value `2·10^{-800}i` is
  // written as `2i·10^{-800}`: the parser reads `2\cdot10^{-800}` as the
  // decimal literal `2e-800`, which is inexact, and the product of an inexact
  // real with `i` still keeps a double imaginary part (Phase 2 and Phase 3 of
  // the design note).
  test('10^{-800}i and 2·10^{-800}i are distinct and not zero', () => {
    const a = ce.parse('10^{-800}i').evaluate();
    const b = ce.parse('2i\\cdot10^{-800}').evaluate();
    expect(a.isSame(0)).toBe(false);
    expect(b.isSame(0)).toBe(false);
    expect(a.isSame(b)).toBe(false);
    expect(b.json).toEqual(['Complex', 0, ['Rational', 1, { num: '5e+799' }]]);
    for (const z of [a, b]) {
      const nv = z.numericValue;
      if (typeof nv === 'object') {
        expect(nv.isZero).toBe(false);
        expect(nv.isComplex).toBe(true);
      } else throw new Error('expected a numeric value');
    }
  });

  // §1 table, row 3, the exact route only: `(1+i)10^{800}` `.N()` is still
  // `~oo` until Phase 2, but `evaluate()` keeps both parts exactly.
  test('(1+i)·10^{800} keeps both parts under evaluate()', () => {
    const z = ce.parse('(1+i)10^{800}').evaluate();
    expect(z.json).toEqual(['Complex', { num: '1e+800' }, { num: '1e+800' }]);
    const nv = z.numericValue;
    if (typeof nv === 'object') {
      expect(nv.isExact).toBe(true);
      expect(nv.isComplex).toBe(true);
      // The double projection of 10^{800} is +Infinity
      expect(nv.im).toBe(Infinity);
    } else throw new Error('expected a numeric value');
  });

  // §2.2, `_liftComplex`: an inexact complex value with integer parts is
  // lifted to an exact value when it meets an exact value. A double cannot
  // hold `10^{-800}i`, so the inexact imaginary part is tested with `0.5i`
  // (not an integer: no lift) and `2i` (an integer: lift). The real part,
  // which can be a big decimal, is tested with `10^{-800}`, whose double
  // projection is the integer `0`: it must not be lifted to an exact zero.
  test('only a Gaussian integer is lifted to an exact value', () => {
    const third = ce._numericValue({ rational: [1, 3] });
    const half = third.mul(ce._numericValue({ re: 0, im: 0.5 }));
    expect(half.isExact).toBe(false);
    expect(half.im).toBeCloseTo(1 / 6, 15);

    const two = third.mul(ce._numericValue({ re: 0, im: 2 }));
    expect(two.isExact).toBe(true);
    expect(two.toString()).toBe('2/3i');

    const tinyRe = ce._numericValue({ re: new BigDecimal('1e-800'), im: 2 });
    expect(tinyRe.re).toBe(0);
    const product = third.mul(tinyRe);
    expect(product.isExact).toBe(false);
    expect(product.bignumRe?.isZero()).toBe(false);
    const sum = third.add(tinyRe);
    expect(sum.isExact).toBe(false);
  });

  // §2.2, `eq` of an exact value against an inexact one: the real parts
  // compare at working precision through `bignumRe`, and the imaginary parts
  // now follow the same rule through `bignumIm`. They were compared as
  // doubles, so the exact `10^{-800}i` (double `im` 0) was equal to an
  // inexact 0.
  test('10^{-800}i is not the same as an inexact 0, in both directions', () => {
    const tiny = ce.parse('10^{-800}i').evaluate();
    const zero = ce.number(ce._numericValue(ce.bignum('0.0')));
    expect(tiny.isSame(zero)).toBe(false);
    expect(zero.isSame(tiny)).toBe(false);
    const a = tiny.numericValue;
    const b = zero.numericValue;
    if (typeof a !== 'object' || typeof b !== 'object')
      throw new Error('expected numeric values');
    expect(a.eq(b)).toBe(false);
    expect(b.eq(a)).toBe(false);
  });

  // The imaginary part mirrors the real part: the exact √2 is not the same
  // as the double 1.4142135623730951, so the exact √2·i is not the same as
  // the inexact 1.4142135623730951i. An integer part is the same in both
  // lanes (2i).
  test('an exact imaginary part against an inexact one follows the real part', () => {
    const real = ce.parse('\\sqrt2').evaluate();
    const realFloat = ce.number(ce._numericValue(1.4142135623730951));
    expect(real.isSame(realFloat)).toBe(false);
    expect(realFloat.isSame(real)).toBe(false);

    const imag = ce.parse('\\sqrt2 i').evaluate();
    const imagFloat = ce.number(
      ce._numericValue({ re: 0, im: 1.4142135623730951 })
    );
    expect(imag.isSame(imagFloat)).toBe(false);
    expect(imagFloat.isSame(imag)).toBe(false);

    const two = ce.parse('2i').evaluate().numericValue;
    const twoFloat = ce._numericValue({ re: 0, im: 2 });
    if (typeof two !== 'object') throw new Error('expected a numeric value');
    expect(two.eq(twoFloat)).toBe(true);
    expect(twoFloat.eq(two)).toBe(true);
  });

  // `eq` against a machine value (a double, no `bignumRe`) compares at the
  // precision of the double: the projections are compared, so the exact 1/3
  // and √2 are the same as their nearest doubles, from both sides. A part
  // whose projection lost its value (10^{400} → Infinity, 10^{-400} → 0,
  // the imaginary 10^{-800} → 0) is not the same as that double.
  // (Before this rule, the exact side compared 25 digits against the
  // 16-digit double, and 1/3 against 0.3333333333333333 was unequal.)
  test('against a machine value, eq compares the doubles', () => {
    const machine = new ComputeEngine({ precision: 'machine' });
    const third = machine.number(1 / 3);
    const exactThird = machine.box(['Rational', 1, 3]);
    expect(third.isSame(exactThird)).toBe(true);
    expect(exactThird.isSame(third)).toBe(true);

    const root = machine.number(Math.SQRT2);
    const exactRoot = machine.parse('\\sqrt2').evaluate();
    expect(root.isSame(exactRoot)).toBe(true);
    expect(exactRoot.isSame(root)).toBe(true);

    // The inexact operand is built from a big decimal: at machine precision
    // it becomes a machine value (`{re: 0, im: 0}` would give the exact 0).
    const pairs: [MathJsonExpression, number][] = [
      [BIG, Infinity],
      [TINY, 0],
      [['Multiply', 'ImaginaryUnit', ['Power', 10, -800]], 0],
    ];
    for (const [exactJson, double] of pairs) {
      const exact = machine.box(exactJson).evaluate().numericValue;
      const inexact = machine._numericValue(new BigDecimal(double));
      if (typeof exact !== 'object') throw new Error('expected a value');
      expect(inexact.constructor.name).toBe('MachineNumericValue');
      expect(exact.eq(inexact)).toBe(false);
      expect(inexact.eq(exact)).toBe(false);
    }
  });

  // `ExactNumericValue.sum` treats an inexact Gaussian integer as exact, and
  // decides this with `isGaussianInteger()`, the rule `_liftComplex` uses.
  // A real part too small for a double (`10^{-800}`, projection 0) does not
  // make the value a Gaussian integer.
  test('the exact sum treats only a Gaussian integer as exact', () => {
    const half = ce._numericValue({ rational: [1, 2] });
    const [gauss] = ExactNumericValue.sum(
      [half, ce._numericValue({ re: 0, im: 3 })],
      (x) => ce._numericValue(x)
    ).filter((x) => !x.isZero);
    expect(gauss.isExact).toBe(true);
    expect(gauss.toString()).toBe('(1/2 + 3i)');

    const tinyRe = ce._numericValue({ re: ce.bignum('1e-800'), im: 3 });
    expect(isGaussianInteger(tinyRe)).toBe(false);
    expect(isGaussianInteger(ce._numericValue({ re: 0, im: 3 }))).toBe(true);
    const sums = ExactNumericValue.sum([half, tinyRe], (x) =>
      ce._numericValue(x)
    );
    expect(sums).toHaveLength(1);
    expect(sums[0].isExact).toBe(false);
    expect(sums[0].bignumRe?.toString()).not.toBe('0.5');
  });

  // §1 table, the exact route of row 4 (`(10^{-200}(1+i))^2`). The integer
  // power of an exact imaginary value is computed exactly
  // (`exactIntegerPow`, `boxed-expression/arithmetic-power.ts`). Its guard on
  // the size of the result read the double projection of the imaginary part,
  // which is `0` for `10^{-200}` and `10^{-800}` and `Infinity` for
  // `10^{400}`, so these powers stayed symbolic.
  test.each([
    ['(10^{-200}i)^2', '-10^{-400}'],
    ['(10^{400}i)^2', '-10^{800}'],
    ['(10^{-800}i)^3', '-10^{-2400}i'],
  ])('%s evaluates to the exact %s', (input, expected) => {
    const z = ce.parse(input).evaluate();
    const want = ce.parse(expected).evaluate();
    expect(z.json).toEqual(want.json);
    expect(z.isSame(want)).toBe(true);
    const nv = z.numericValue;
    if (typeof nv === 'object') expect(nv.isExact).toBe(true);
  });

  test('the exact expected values of the powers', () => {
    expect(ce.parse('(10^{-200}i)^2').evaluate().json).toEqual([
      'Rational',
      -1,
      { num: '1e+400' },
    ]);
    expect(ce.parse('(10^{400}i)^2').evaluate().json).toEqual({
      num: '-1e+800',
    });
    expect(ce.parse('(10^{-800}i)^3').evaluate().json).toEqual([
      'Complex',
      0,
      ['Rational', -1, { num: '1e+2400' }],
    ]);
  });

  // §3, a test of integrality on the projection: the sum of imaginary terms
  // (`boxed-expression/arithmetic-add.ts`) tested `Number.isSafeInteger(im)`
  // to find an integer coefficient of `i`, and the projection `0` of
  // `10^{-800}` passed that test, so the exact term was folded into the
  // float coefficient as `0`. The canonical sum keeps the exact term. (Under
  // `evaluate()` the float `2.5i` absorbs it, because the imaginary part of
  // an inexact value is a double until Phase 2 of the design note.)
  test('10^{-800}i + 2.5i keeps the exact term in the canonical sum', () => {
    const sum = ce.parse('10^{-800}i + 2.5i');
    expect(sum.isSame(ce.parse('2.5i'))).toBe(false);
    expect(sum.operator).toBe('Add');
    expect(sum.nops).toBe(2);
    const tiny = ce.parse('10^{-800}i').evaluate();
    expect(sum.ops!.some((op) => op.evaluate().isSame(tiny))).toBe(true);
  });

  // §2.5 and §3, the statistics functions: the carrier of the data read the
  // double projection of an exact datum, so the imaginary part `10^{400}`,
  // whose projection is `Infinity`, made the datum the complex infinity.
  test('Mean([1, 10^{400}i, 3]) is 4/3 + (10^{400}/3)i', () => {
    const m = ce.parse('\\operatorname{Mean}([1, 10^{400}i, 3])').evaluate();
    expect(m.json).toEqual([
      'Complex',
      ['Rational', 4, 3],
      ['Rational', { num: '1e+400' }, 3],
    ]);
    const nv = m.numericValue;
    if (typeof nv === 'object') expect(nv.isExact).toBe(true);
    else throw new Error('expected a numeric value');
  });

  // §3: the recognizer of the imaginary unit (`boxed-expression/
  // arithmetic-mul-div.ts`, `utils.ts`) compared the double of the real part
  // with `0`, so `10^{-800} + i`, whose real part projects to `0`, was
  // taken for `i` and the product was simplified as `i·i = -1`.
  // (10^{-800} + i)·i = -1 + 10^{-800}·i.
  test('(10^{-800} + i)·i is not simplified as i·i', () => {
    const expected: MathJsonExpression = [
      'Complex',
      -1,
      ['Rational', 1, { num: '1e+800' }],
    ];
    const product = ce.parse('(10^{-800}+i)\\cdot i');
    expect(product.evaluate().json).toEqual(expected);
    expect(product.simplify().evaluate().json).toEqual(expected);
    expect(product.isSame(-1)).toBe(false);
  });

  // §5 and decision D2 of the design note: compiled code computes in
  // doubles, so a constant whose imaginary part underflows the double range
  // is folded as `{re, im: 0}`, which is what the compiled double arithmetic
  // gives for the same value. Paired with the first test of this block,
  // where the same value stays non-zero under `evaluate()`.
  test('compiled 10^{-800}i folds to the double 0', () => {
    const expr = ce.parse('10^{-800}i');
    expect(expr.evaluate().isSame(0)).toBe(false);
    const result = compile(expr, { to: 'javascript' });
    expect(result.success).toBe(true);
    const value: unknown = result.run!({});
    if (typeof value === 'number') expect(value).toBe(0);
    else expect(value).toEqual({ re: 0, im: 0 });
  });

  // §2.3, the arithmetic of `BigNumericValue` with an exact complex operand.
  // Once the "is complex?" test reads the exact imaginary part, an exact
  // `1 + 10^{-400}i` reaches the complex product of the big-decimal class.
  // That product multiplied the double projections: the real part `10^{400}`
  // is `Infinity` as a double and `10^{-400}` is `0`, so `Infinity · 0` made
  // the product `NaN`, in both operand orders. With every part a big decimal,
  // 10^{400}·(1 + 10^{-400}i) = 10^{400} + i and
  // 10^{400}/(1 + 10^{-400}i) = 10^{400}(1 − 10^{-400}i)/(1 + 10^{-800}),
  // whose parts are 10^{400} and −1 at the working precision.
  test('10^{400} (big decimal) times and over the exact 1 + 10^{-400}i', () => {
    const big = ce._numericValue(ce.bignum('1e400'));
    const z = ce._numericValue({
      rational: [1, 1],
      imRational: [BigInt(1), BigInt(10) ** BigInt(400)],
    });
    expect(z.isComplex).toBe(true);
    for (const product of [big.mul(z), z.mul(big)]) {
      expect(product.isNaN).toBe(false);
      expect(product.bignumRe?.eq(ce.bignum('1e400'))).toBe(true);
      expect(product.im).toBe(1);
      expect(product.toString()).toBe('(1e+400 + i)');
    }
    const quotient = big.div(z);
    expect(quotient.isNaN).toBe(false);
    expect(quotient.bignumRe?.eq(ce.bignum('1e400'))).toBe(true);
    expect(quotient.im).toBe(-1);
  });

  // The same class multiplied its double imaginary part by the double of a
  // big-decimal factor, which is `Infinity` for a finite `10^{400}`, and so
  // answered `~oo` for (1.5 + 10^{-300}i)·10^{400} = 1.5·10^{400} + 10^{100}i.
  test('(1.5 + 10^{-300}i) times the big decimal 10^{400} is finite', () => {
    const w = ce._numericValue({ re: ce.bignum('1.5'), im: 1e-300 });
    const product = w.mul(ce.bignum('1e400'));
    expect(product.isComplexInfinity).toBe(false);
    expect(product.bignumRe?.eq(ce.bignum('1.5e400'))).toBe(true);
    expect(product.im).toBe(1e100);
  });
});

// §2.1: the double projection of an exact rational. It divided
// `Number(numerator)` by `Number(denominator)`, and a bigint beyond the
// double range converts to `Infinity`, so `(10^400 + 1)/10^400`, whose
// nearest double is `1`, projected to `Infinity/Infinity = NaN`.
describe('DOUBLE PROJECTION OF AN EXACT RATIONAL OUTSIDE THE FLOAT64 RANGE', () => {
  const ce = new ComputeEngine();

  test('(10^400 + 1)/10^400 projects to 1', () => {
    const q = ce.box(['Divide', BIG_PLUS_ONE, BIG]).evaluate();
    expect(q.isSame(1)).toBe(false);
    expect(q.re).toBe(1);
  });

  test('the imaginary part projects the same way', () => {
    const z = ce
      .box(['Multiply', ['Divide', BIG_PLUS_ONE, BIG], 'ImaginaryUnit'])
      .evaluate();
    const nv = z.numericValue;
    if (typeof nv === 'object') {
      expect(nv.isExact).toBe(true);
      expect(nv.im).toBe(1);
      expect(nv.re).toBe(0);
    } else throw new Error('expected a numeric value');
  });

  test('bigint rationals beyond the double range', () => {
    const big = 10n ** 400n;
    expect(rationalAsFloat([big + 1n, big])).toBe(1);
    expect(rationalAsFloat([-7n * big, 2n * big])).toBe(-3.5);
    expect(rationalAsFloat([1n, big])).toBe(0);
    expect(rationalAsFloat([big, 3n])).toBe(Infinity);
    // 10^400/(3·10^100) = 10^300/3, a finite double
    expect(rationalAsFloat([big, 3n * 10n ** 100n])).toBe(1e300 / 3);
  });

  // A subnormal result (below 2^-1022) must be rounded once, from the exact
  // quotient. Rounding the quotient to 53 bits first and then scaling it
  // rounded twice: (2^54 + 1)/2^1129 is just above half of 2^-1074, the
  // first rounding made it exactly half, and the second rounded that tie
  // to 0. Each expected value is the correctly rounded double, checked
  // against Python's correctly rounded integer division (`n / d` on ints),
  // and written as a multiple of 2^-1074 (`Number.MIN_VALUE`), which is
  // exact.
  test.each([
    // just above the midpoint between 0 and 2^-1074: rounds up
    ['(2^54 + 1)/2^1129', 2n ** 54n + 1n, 2n ** 1129n, Number.MIN_VALUE],
    // exactly the midpoint: ties to even gives 0
    ['1/2^1075', 1n, 2n ** 1075n, 0],
    // 1.5·2^-1074: ties to even gives 2·2^-1074
    ['3/2^1075', 3n, 2n ** 1075n, 2 * Number.MIN_VALUE],
    // the largest subnormal, (2^52 - 1)·2^-1074
    [
      '(2^53 - 2)/2^1075',
      2n ** 53n - 2n,
      2n ** 1075n,
      (2 ** 52 - 1) * Number.MIN_VALUE,
    ],
    // (2^52 - 1/2)·2^-1074 is a tie between the largest subnormal (odd)
    // and the smallest normal 2^-1022 (even): it rounds to 2^-1022
    ['(2^53 - 1)/2^1075', 2n ** 53n - 1n, 2n ** 1075n, 2 ** -1022],
    // the smallest normal, exactly
    ['2^55/2^1077', 2n ** 55n, 2n ** 1077n, 2 ** -1022],
    // a negative subnormal
    ['-(2^54 + 1)/2^1129', -(2n ** 54n + 1n), 2n ** 1129n, -Number.MIN_VALUE],
  ])('%s is rounded once in the subnormal range', (_, n, d, expected) => {
    expect(Object.is(rationalAsFloat([n, d]), expected)).toBe(true);
  });

  test('a rational out of the double range projects to 0 or ±Infinity', () => {
    const tiny = ce.box(['Divide', 1, BIG_PLUS_ONE]).evaluate();
    expect(tiny.re).toBe(0);
    const huge = ce.box(['Divide', BIG_PLUS_ONE, 3]).evaluate();
    expect(huge.re).toBe(Infinity);
    const negHuge = ce.box(['Divide', ['Negate', BIG_PLUS_ONE], 3]).evaluate();
    expect(negHuge.re).toBe(-Infinity);
  });

  // An ordinary rational keeps the double it had: the quotient of the two
  // converted parts, bit for bit.
  test.each([
    [1, 3],
    [-7, 2],
    [22, 7],
    [123456789, 1000],
  ])('%d/%d projects as Number(n)/Number(d)', (n, d) => {
    const q = ce.box(['Rational', n, d]).evaluate();
    expect(Object.is(q.re, n / d)).toBe(true);
    expect(Object.is(rationalAsFloat([BigInt(n), BigInt(d)]), n / d)).toBe(
      true
    );
  });
});

// §2.2, `eq` between an inexact value and an exact one. The inexact classes
// (`BigNumericValue`, `MachineNumericValue`) compared the double `im` of the
// exact operand, which is `0` for `10^{-800}i`, so an inexact `0` was equal
// to that value from the inexact side. The inexact classes now let the exact
// operand compare the pair, so the relation is symmetric. (Whether the pair
// is equal is decided by `ExactNumericValue.eq`, which compares both parts at
// the working precision.)
describe('EQ BETWEEN AN INEXACT VALUE AND AN EXACT IMAGINARY VALUE', () => {
  const tiny = (e: ComputeEngine) =>
    e._numericValue({
      rational: [0, 1],
      imRational: [BigInt(1), BigInt(10) ** BigInt(800)],
    });

  test('big-decimal 0 and the exact 10^{-800}i are not eq, from both sides', () => {
    const e = new ComputeEngine();
    const zero = e._numericValue(new BigDecimal(0));
    expect(zero.constructor.name).toBe('BigNumericValue');
    expect(zero.eq(tiny(e))).toBe(false);
    expect(tiny(e).eq(zero)).toBe(false);
  });

  test('machine 0 and the exact 10^{-800}i are not eq, from both sides', () => {
    const e = new ComputeEngine({ precision: 'machine' });
    const zero = e._numericValue(new BigDecimal(0));
    expect(zero.constructor.name).toBe('MachineNumericValue');
    expect(zero.eq(tiny(e))).toBe(false);
    expect(tiny(e).eq(zero)).toBe(false);
  });

  test('inexact 2i and the exact 2i are equal from both sides', () => {
    for (const e of [
      new ComputeEngine(),
      new ComputeEngine({ precision: 'machine' }),
    ]) {
      const inexact = e._numericValue({ re: new BigDecimal(0), im: 2 });
      const exact = e._numericValue({ rational: [0, 1], imRational: [2, 1] });
      expect(inexact.constructor.name).not.toBe('ExactNumericValue');
      expect(exact.constructor.name).toBe('ExactNumericValue');
      expect(inexact.eq(exact)).toBe(true);
      expect(exact.eq(inexact)).toBe(true);
    }
  });
});

// A big-decimal value whose real part is too small for a double
// (`10^{-800} + 2i` at precision 1000) projects its real part to the double
// `0`. The boxed Add and Multiply routes lift a Gaussian-integer literal to
// an exact value; they must not take this value for the Gaussian integer
// `2i`, which would drop its real part.
describe('BIG-DECIMAL REAL PART OUTSIDE THE FLOAT64 RANGE, BOXED ROUTES', () => {
  const withPrecision1000 = (fn: () => void) => {
    const saved = ce.precision;
    try {
      ce.precision = 1000;
      fn();
    } finally {
      ce.precision = saved;
    }
  };
  const z = () =>
    ce.number(ce._numericValue({ re: ce.bignum('1e-800'), im: 2 }));

  test('Add(1/2, 10^{-800} + 2i) keeps the real part 10^{-800}', () =>
    withPrecision1000(() => {
      const r = ce.function('Add', [ce.parse('\\frac12'), z()]).evaluate();
      expect(r.im).toBe(2);
      expect(r.bignumRe!.sub(ce.bignum('0.5')).eq(ce.bignum('1e-800'))).toBe(
        true
      );
    }));

  test('Multiply(√2, 10^{-800} + 2i) keeps the real part √2·10^{-800}', () =>
    withPrecision1000(() => {
      const r = ce.function('Multiply', [ce.parse('\\sqrt2'), z()]).evaluate();
      expect(r.im).toBeCloseTo(2 * Math.SQRT2, 14);
      const re = r.bignumRe!;
      expect(re.isZero()).toBe(false);
      // √2·10^{-800} = 1.41421356237309504880…·10^{-800}
      expect(re.toString()).toMatch(/^1\.4142135623730950488\d*e-800$/);
    }));

  // (10^{-800} + 2i)^2 = -4 + 4·10^{-800}·i + 10^{-1600}. The boxed route
  // does not lift the base to the exact `2i`, and the big-decimal power holds
  // its imaginary part as a big decimal, so `4·10^{-800}` is kept. The real
  // part `-4 + 10^{-1600}` is `-4` at 1000 digits.
  test('Power(10^{-800} + 2i, 2) keeps the imaginary part 4·10^{-800}', () =>
    withPrecision1000(() => {
      const r = ce.function('Power', [z(), ce.number(2)]).evaluate();
      expect(r.isSame(-4)).toBe(false);
      expect(r.bignumRe!.eq(-4)).toBe(true);
      expect(r.bignumIm!.eq(ce.bignum('4e-800'))).toBe(true);
    }));
});
