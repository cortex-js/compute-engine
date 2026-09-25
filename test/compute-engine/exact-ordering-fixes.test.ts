import type { MathJsonExpression } from '../../src/math-json/types';
import type { Expression } from '../../src/compute-engine/global-types';
import { ComputeEngine } from '../../src/compute-engine';
import { exactOrder } from '../../src/compute-engine/boxed-expression/compare';

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

// With no tolerance, `orderByValue` answers `undefined` without building
// `a − b` when exactly one canonical operand has unknowns (see the comment
// in `boxed-expression/compare.ts`). A structural operand lists the symbols
// written in it even when its value does not depend on them, so it still
// goes through the subtraction.
describe('ordering an operand with unknowns against one without', () => {
  test('a structural 0·x is ordered by its value', () => {
    const a = ce.function('Multiply', [ce.number(0), ce.symbol('x')], {
      form: 'structural',
    });
    expect(a.isLess(5)).toBe(true);
  });

  test('a canonical expression in x is not ordered against a number', () => {
    expect(ce.parse('x + 1').isLess(5)).toBeUndefined();
  });
});

// `approximate()` had no error bound for Γ, erf, erfc, erfi, ζ, arcosh and
// artanh, so a constant that contained one of them was never ordered:
// `Max(Γ(1/3), 3)` stayed unevaluated. The true values, from mpmath at 30
// digits: Γ(1/3) = 2.67893853470774763365569294097, Γ(−7/2) = 0.27008820585,
// erf(1) = 0.842700792949714869341, erfc(1) = 0.157299207050285130659,
// erfi(1) = 1.65042575879754287603, ζ(3) = 1.20205690315959428540,
// arsinh(1) = 0.881373587019543025232, arcosh(2) = 1.31695789692481670863,
// artanh(1/2) = 0.549306144334054845698.
describe('A CONSTANT WITH A SPECIAL FUNCTION IS ORDERED', () => {
  const G3: MathJsonExpression = ['Gamma', ['Rational', 1, 3]];
  const cases: [MathJsonExpression, string][] = [
    [['Max', G3, 3], '3'],
    [['Max', G3, 2], 'Gamma(1/3)'],
    [['Max', ['Gamma', ['Rational', -7, 2]], 0], 'Gamma(-7/2)'],
    [['Min', ['Erf', 1], ['Rational', 1, 2]], '1/2'],
    [['Max', ['Erfc', 1], 1], '1'],
    [['Max', ['Erfi', 1], 1], 'Erfi(1)'],
    [['Max', ['Zeta', 3], 1], 'Zeta(3)'],
    [['Max', ['Arsinh', 1], 1], '1'],
    [['Max', ['Arcosh', 2], 1], 'arcosh(2)'],
    [['Max', ['Artanh', ['Rational', 1, 2]], 1], '1'],
    [['Max', ['Add', G3, 1], 3], '1 + Gamma(1/3)'],
  ];
  test.each(cases)('%j', (expr, expected) => {
    expect(ce.box(expr).evaluate().toString()).toBe(expected);
  });

  test('also at 50 digits', () => {
    atPrecision(50, (e) => {
      for (const [expr, expected] of cases)
        expect(e.box(expr).evaluate().toString()).toBe(expected);
    });
  });

  test('the relational predicates agree', () => {
    expect(ce.box(G3).isLess(3)).toBe(true);
    expect(ce.box(G3).isGreater(2)).toBe(true);
    expect(ce.box(['Less', G3, 3]).evaluate().symbol).toBe('True');
    expect(
      ce.box(['Less', ['Erf', 1], ['Rational', 1, 2]]).evaluate().symbol
    ).toBe('False');
    expect(ce.box(['Greater', ['Zeta', 3], 1]).evaluate().symbol).toBe('True');
  });

  test('a float closer than the precision of a double is ordered exactly', () => {
    // The double 2.6789385347077476 is 2.678938534707747454…, below Γ(1/3)
    // = 2.678938534707747633…
    const f = ce.number(2.6789385347077476);
    expect(exactOrder(ce.box(G3), f)).toBe(1);
    expect(ce.box(['Max', G3, f]).evaluate().toString()).toBe('Gamma(1/3)');
    atPrecision(50, (e) => {
      // Γ(1/3) is between these two 49-digit values
      const below = e.number(
        '2.678938534707747633655692940974677644128689377957'
      );
      const above = e.number(
        '2.678938534707747633655692940974677644128689377958'
      );
      expect(exactOrder(e.box(G3), below)).toBe(1);
      expect(exactOrder(e.box(G3), above)).toBe(-1);
    });
  });

  test('near a pole of Γ', () => {
    // Γ(−3 + 10⁻¹⁰) ≈ −1/(6·10⁻¹⁰) is negative (Γ < 0 on (−3, −2)).
    const near: MathJsonExpression = ['Gamma', ['Add', -3, ['Power', 10, -10]]];
    expect(exactOrder(ce.box(near), ce.Zero)).toBe(-1);
    // The bound on |Γ′| is computed with doubles, and at 10⁻³⁰ from the
    // pole the interval of the argument, as doubles, contains the pole:
    // there is no bound, and the order is not known (never a wrong order).
    const nearer: MathJsonExpression = [
      'Gamma',
      ['Add', -3, ['Power', 10, -30]],
    ];
    expect(exactOrder(ce.box(nearer), ce.Zero)).toBe(undefined);
  });

  test('artanh of a small value keeps its digits', () => {
    // artanh(x) = x + x³/3 + …: artanh(10⁻³⁰) was 0 at 21 digits
    const a: MathJsonExpression = ['Artanh', ['Power', 10, -30]];
    expect(ce.box(a).N().toString()).toBe('1e-30');
    expect(exactOrder(ce.box(a), ce.box(['Power', 10, -31]).evaluate())).toBe(
      1
    );
    expect(
      exactOrder(
        ce.box(a),
        ce
          .box(['Multiply', ['Rational', 11, 10], ['Power', 10, -30]])
          .evaluate()
      )
    ).toBe(-1);
  });

  test('at machine precision, from the machine values', () => {
    const e = new ComputeEngine({ precision: 'machine' });
    try {
      expect(e.box(['Max', G3, 3]).evaluate().toString()).toBe('3');
      expect(e.box(['Max', G3, 2]).evaluate().toString()).toBe('Gamma(1/3)');
      expect(
        e
          .box(['Min', ['Erf', 1], ['Rational', 1, 2]])
          .evaluate()
          .toString()
      ).toBe('1/2');
      expect(
        e
          .box(['Max', ['Zeta', 3], 1])
          .evaluate()
          .toString()
      ).toBe('Zeta(3)');
      // Closer than 10⁻⁶: not ordered from the machine values, but the
      // raised-precision step (which runs at machine precision since a
      // literal follows the engine's current precision) decides it
      // rigorously: Γ(1/3) = 2.67893853470774763365… is above the double.
      expect(exactOrder(e.box(G3), e.number(2.6789385347077476))).toBe(1);
      // ζ near its pole: the rounding of the argument to a double is
      // amplified by |ζ′| ≈ 10²⁰, so the machine values do not decide it;
      // the raised-precision step does (ζ(1 + 10⁻¹⁰) ≈ 10¹⁰ + 0.577 > 9.9·10⁹).
      expect(
        exactOrder(
          e.box(['Zeta', ['Rational', 10000000001, 10000000000]]),
          e.number(9.9e9)
        )
      ).toBe(1);
    } finally {
      ce.precision = 30;
      ce.precision = 'auto';
    }
  });
});
