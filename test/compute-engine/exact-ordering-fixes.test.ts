import type { MathJsonExpression } from '../../src/math-json/types';
import type { Expression } from '../../src/compute-engine/global-types';
import { ComputeEngine } from '../../src/compute-engine';

// The order of `Max`, `Min` and `Sort` (`exactOrder`) is exact: at a
// precision that cannot separate two values, the operator stays
// unevaluated; when it answers, the answer is the true order. Each true
// order below is also checked with the value of the operands at 50 digits.

const ce = new ComputeEngine();

/** Run `fn` with an engine at the precision `precision`. */
function atPrecision(precision: number, fn: (e: ComputeEngine) => void) {
  if (precision === ce.precision) {
    fn(ce);
    return;
  }
  const e = new ComputeEngine({ precision });
  try {
    fn(e);
  } finally {
    // Constructing an engine sets the global precision of big decimals.
    // Setting the precision of the shared engine to its current value does
    // not reset it, so it is set to another value first.
    ce.precision = 30;
    ce.precision = 'auto';
  }
}

const EPSILON: MathJsonExpression = ['Power', 10, -30];
const SQRT2_PLUS: MathJsonExpression = ['Sqrt', ['Add', 2, EPSILON]];
const THIRD_ROOT_PLUS: MathJsonExpression = [
  'Sqrt',
  ['Add', ['Rational', 1, 3], EPSILON],
];
const THIRD_ROOT: MathJsonExpression = ['Sqrt', ['Rational', 1, 3]];

/** `result` is `expected`, or `result` is the unevaluated `operator`. */
function expectTrueOrUndecided(
  e: ComputeEngine,
  result: Expression,
  operator: string,
  expected: MathJsonExpression
) {
  if (result.operator === operator) return;
  expect(result.isSame(e.box(expected).evaluate())).toBe(true);
}

// `cmp()` subtracted the operands with `a.sub(b)`, which folds two exact
// radicals into one float: `√(2 + 10⁻³⁰) − √2` was `−1.7·10⁻²¹` at 21
// digits, and that float had the error of its own rounding only.
describe('TWO RADICALS CLOSER THAN THE PRECISION', () => {
  test('the true order: the value of each operand at 50 digits', () => {
    atPrecision(50, (e) => {
      const d = e
        .box(['Subtract', SQRT2_PLUS, ['Sqrt', 2]])
        .N()
        .toString();
      expect(d.startsWith('3.53553390593273762')).toBe(true);
      expect(d.endsWith('e-31')).toBe(true);
    });
  });

  test('at 21 digits, no wrong order', () => {
    atPrecision(21, (e) => {
      const ev = (x: MathJsonExpression) => e.box(x).evaluate();
      expectTrueOrUndecided(
        e,
        ev(['Max', SQRT2_PLUS, ['Sqrt', 2]]),
        'Max',
        SQRT2_PLUS
      );
      expectTrueOrUndecided(e, ev(['Min', SQRT2_PLUS, ['Sqrt', 2]]), 'Min', [
        'Sqrt',
        2,
      ]);
      expectTrueOrUndecided(
        e,
        ev(['Max', THIRD_ROOT, THIRD_ROOT_PLUS]),
        'Max',
        THIRD_ROOT_PLUS
      );
      const sorted = ev(['Sort', ['List', ['Sqrt', 2], SQRT2_PLUS]]);
      expectTrueOrUndecided(e, sorted, 'Sort', [
        'List',
        ['Sqrt', 2],
        SQRT2_PLUS,
      ]);
    });
  });

  test('at 50 digits, the true order', () => {
    atPrecision(50, (e) => {
      const ev = (x: MathJsonExpression) => e.box(x).evaluate();
      expect(ev(['Max', SQRT2_PLUS, ['Sqrt', 2]]).isSame(ev(SQRT2_PLUS))).toBe(
        true
      );
      expect(ev(['Max', ['Sqrt', 2], SQRT2_PLUS]).isSame(ev(SQRT2_PLUS))).toBe(
        true
      );
      expect(ev(['Min', SQRT2_PLUS, ['Sqrt', 2]]).isSame(ev(['Sqrt', 2]))).toBe(
        true
      );
      expect(
        ev(['Max', THIRD_ROOT, THIRD_ROOT_PLUS]).isSame(ev(THIRD_ROOT_PLUS))
      ).toBe(true);
      expect(
        ev(['Sort', ['List', SQRT2_PLUS, ['Sqrt', 2]]]).isSame(
          ev(['List', ['Sqrt', 2], SQRT2_PLUS])
        )
      ).toBe(true);
    });
  });
});

// `Product.mul` multiplied the numerator and the denominator of a radicand
// as two numbers; with bigints the product was a bigint, and
// `Math.sqrt(bigint)` threw.
describe('A RADICAND LARGER THAN A SAFE INTEGER', () => {
  test('the 2-norm of a matrix of large floats', () => {
    const v = ce
      .box([
        'Norm',
        ['List', ['List', 1e200, 1e200], ['List', 1e200, 2e200]],
        2,
      ])
      .evaluate();
    expect(v.operator).not.toBe('Error');
    // The largest singular value of 10²⁰⁰·[[1, 1], [1, 2]] is
    // 10²⁰⁰·(3 + √5)/2.
    expect(v.N().re / 1e200).toBeCloseTo((3 + Math.sqrt(5)) / 2, 12);
  });

  test('2·√(10⁸⁰⁰ + 1)', () => {
    const v = ce
      .box(['Multiply', 2, ['Sqrt', ['Add', ['Power', 10, 800], 1]]])
      .evaluate();
    expect(v.operator).not.toBe('Error');
    expect(v.N().toString()).toBe('2e+400');
  });

  test('2·√(1 + 10⁻³⁰) stays exact', () => {
    const v = ce.box(['Multiply', 2, ['Sqrt', ['Add', 1, EPSILON]]]).evaluate();
    expect(v.operator).toBe('Multiply');
    expect(v.N().re).toBeCloseTo(2, 15);
  });

  test('2·√(1 + 10⁻³⁰) − 2 at 50 digits', () => {
    atPrecision(50, (e) => {
      const v = e
        .box(['Add', ['Multiply', 2, ['Sqrt', ['Add', 1, EPSILON]]], -2])
        .evaluate();
      expect(v.operator).toBe('Add');
      expect(v.N().re).toBeCloseTo(1e-30, 40);
    });
  });
});

// `Add` read the coefficient of `√(1 + 10⁻³⁰)` as a big float, which is `1`
// at 21 digits, and `√(1 + 10⁻³⁰) − 1` was an exact `0`.
describe('A SUM WITH A RADICAL CLOSE TO AN INTEGER', () => {
  const diff: MathJsonExpression = ['Add', ['Sqrt', ['Add', 1, EPSILON]], -1];

  test('the sum stays exact', () => {
    atPrecision(21, (e) => {
      const v = e.box(diff).evaluate();
      expect(v.operator).toBe('Add');
    });
    atPrecision(50, (e) => {
      const v = e.box(diff).evaluate();
      expect(v.operator).toBe('Add');
      expect(v.N().re).toBeCloseTo(5e-31, 40);
    });
  });

  test('Max with 0', () => {
    atPrecision(21, (e) => {
      // Not decided at 21 digits, and not a tie: decided at 50 digits
      // (`exactOrder`, step 2).
      expect(
        e.box(['Max', diff, 0]).evaluate().isSame(e.box(diff).evaluate())
      ).toBe(true);
    });
    atPrecision(50, (e) => {
      expect(
        e.box(['Max', diff, 0]).evaluate().isSame(e.box(diff).evaluate())
      ).toBe(true);
    });
  });
});

// The error bounds of `approximate` were doubles: the magnitude of `10^400`
// was `Infinity`, and there was no bound.
describe('VALUES OUTSIDE THE RANGE OF A DOUBLE', () => {
  for (const precision of [21, 50]) {
    test(`at ${precision} digits`, () => {
      atPrecision(precision, (e) => {
        const ev = (x: MathJsonExpression) => e.box(x).evaluate();
        const pi400: MathJsonExpression = [
          'Multiply',
          'Pi',
          ['Power', 10, 400],
        ];
        const three400: MathJsonExpression = [
          'Multiply',
          3,
          ['Power', 10, 400],
        ];
        expect(
          ev(['Sort', ['List', pi400, three400]]).isSame(
            ev(['List', three400, pi400])
          )
        ).toBe(true);
        const pi308: MathJsonExpression = [
          'Multiply',
          'Pi',
          ['Power', 10, 308],
        ];
        expect(
          ev(['Max', pi308, ['Multiply', 3, ['Power', 10, 308]]]).isSame(
            ev(pi308)
          )
        ).toBe(true);
        // e^800 = 10^347.4…
        expect(
          ev(['Max', ['Exp', 800], ['Power', 10, 347]]).isSame(ev(['Exp', 800]))
        ).toBe(true);
        expect(
          ev(['Min', ['Exp', 800], ['Power', 10, 347]]).isSame(
            ev(['Power', 10, 347])
          )
        ).toBe(true);
        // π^1000 = 10^497.1…
        expect(
          ev(['Max', ['Power', 'Pi', 1000], ['Power', 10, 497]]).isSame(
            ev(['Power', 'Pi', 1000])
          )
        ).toBe(true);
      });
    });
  }

  test('an independent check of the exponents', () => {
    expect(800 / Math.LN10).toBeGreaterThan(347.4);
    expect(1000 * Math.log10(Math.PI)).toBeGreaterThan(497.1);
  });
});

// `Max`/`Min` refused a constant of type `number` before ordering it, while
// `Sort` and `Clamp` ordered it.
describe('MAX AND MIN OF A CONSTANT OF TYPE NUMBER', () => {
  const t: MathJsonExpression = [
    'Tan',
    ['Subtract', ['Divide', 'Pi', 2], ['Rational', 1, 10]],
  ];
  test('tan(π/2 − 1/10) ≈ 9.97', () => {
    expect(Math.tan(Math.PI / 2 - 0.1)).toBeCloseTo(9.9666444, 6);
    expect(ce.box(t).N().re).toBeCloseTo(9.9666444, 6);
    expect(ce.box(['Max', t, 9]).evaluate().isSame(ce.box(t).evaluate())).toBe(
      true
    );
    expect(ce.box(['Min', t, 9]).evaluate().toString()).toBe('9');
    expect(
      ce
        .box(['Sort', ['List', t, 9]])
        .evaluate()
        .isSame(ce.box(['List', 9, t]).evaluate())
    ).toBe(true);
  });

  test('a complex value stays unevaluated', () => {
    expect(ce.parse('\\max(\\tan(i), 3)').evaluate().operator).toBe('Max');
    expect(ce.parse('\\max(\\pi+i, 3)').evaluate().operator).toBe('Max');
  });
});

describe('A TIE IS PROVED', () => {
  // ln 6 and ln 2 + ln 3 are equal: no approximation separates them, and
  // `ln 6 − (ln 2 + ln 3)` simplifies to 0 (`exactOrder`, step 1). The sort
  // is stable: the tie keeps the order of the input. See also
  // `exact-ordering-ties.test.ts`.
  test('ln 6 and ln 2 + ln 3', () => {
    const sorted = ce
      .box(['Sort', ['List', ['Ln', 6], ['Add', ['Ln', 2], ['Ln', 3]]]])
      .evaluate();
    expect(sorted.operator).toBe('List');
    expect(sorted.ops![0].isSame(ce.box(['Ln', 6]))).toBe(true);
  });
});
