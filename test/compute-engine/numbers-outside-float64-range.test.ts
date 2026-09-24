import type { MathJsonExpression } from '../../src/math-json/types';
import { ComputeEngine } from '../../src/compute-engine';
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
