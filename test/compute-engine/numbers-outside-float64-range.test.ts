import type { MathJsonExpression } from '../../src/math-json/types';
import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import { packTensor } from '../../src/compute-engine/boxed-expression/tensor-view';

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
    const p3 = new ComputeEngine({ precision: 3 });
    const q = p3.parse('\\frac{1}{7\\cdot 10^{400}}').evaluate().numericValue;
    if (typeof q !== 'object') throw new Error('expected an exact value');
    expect(q.div(p3._numericValue(1e-300)).re).toBe(1.43e-101);
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
    // The exact value is 10i/y. The factor `i` is kept.
    expect(
      m.parse('\\frac{10^{400}}{y}\\cdot 10^{-399}\\cdot i').N().toString()
    ).toBe('(10i) / y');
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
    [['Reduce', ['List', ['Power', 10, 400], ['Power', 10, -400]], 'Multiply'], '1'],
    [['Product', ['List', ['Power', 10, 400], 2]], '+oo'],
    [['Product', ['List', 1.5, 2]], '3'],
  ])('%j .N() is %s', (expr, expected) => {
    expect(m.box(expr as never).N().toString()).toBe(expected);
  });
});
