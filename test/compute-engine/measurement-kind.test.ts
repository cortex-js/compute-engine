// `Measurement` as a VALUE KIND (`docs/plans/2026-10-26-value-kinds.md`,
// section 4.7, and the phase-2 decisions and amendments of section 13): the
// kind type `measurement`, its admission where a number is admitted
// (`admittedAs: 'number'`), its arithmetic hooks (quadrature of the moduli
// of the partial derivatives), its order and its equality by the nominal,
// and the rows of ROADMAP CE-508 that the kind fixes (.4, .7, .11, .14,
// .15).
//
// The expected uncertainties are computed here from the first-order rule
// `σ_f² = Σ |∂f/∂xᵢ|²·σᵢ²`, with the partial derivatives written out by
// hand; the complex power was checked against a finite difference.

import { ComputeEngine, compile } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { isApplySiteCall } from '../../src/compute-engine/boxed-expression/apply-site';

const ce = new ComputeEngine();

const M = (v: unknown, e: unknown) =>
  ce.box(['Measurement', v as never, e as never]);

/** The nominal of a measurement, or the value of a number, as a float. */
function nominal(x: Expression): number {
  return x.operator === 'Measurement' ? x.op1.N().re : x.N().re;
}

/** The imaginary part of the nominal of a measurement, as a float. */
function nominalIm(x: Expression): number {
  return x.operator === 'Measurement' ? x.op1.N().im : x.N().im;
}

/** The uncertainty of a measurement as a float, 0 for a number. */
function sigma(x: Expression): number {
  return x.operator === 'Measurement' ? x.op2.N().re : 0;
}

describe('MEASUREMENT KIND: the type', () => {
  test('a measurement is typed `measurement`', () => {
    expect(M(2.5, 0.1).type.toString()).toBe('measurement');
    expect(M(['Complex', 2, 3], 0.1).type.toString()).toBe('measurement');
    expect(M(['Rational', 1, 3], 0.1).type.toString()).toBe('measurement');
  });

  test('`measurement` is a word of the type language, disjoint from the numbers', () => {
    expect(ce.type('measurement').toString()).toBe('measurement');
    expect(ce.type('list<measurement | integer>').toString()).toBe(
      'list<integer | measurement>'
    );
    expect(M(2.5, 0.1).type.matches('real')).toBe(false);
    expect(M(2.5, 0.1).type.matches('number')).toBe(false);
    expect(M(2.5, 0.1).type.matches('value')).toBe(true);
  });

  test('a zero uncertainty collapses to the nominal (decision 3)', () => {
    expect(M(7, 0).json).toEqual(7);
  });

  // Decision 14 reversed (`docs/plans/2026-10-26-value-kinds.md`, section
  // 13.2): `.re` and `.im` project the nominal (the `numericValue` hook of
  // the measurement kind); the fact queries stay `undefined`.
  test('`.re` and `.im` of a measurement are the parts of its nominal', () => {
    const m = M(2.5, 0.1);
    expect(m.re).toBe(2.5);
    expect(m.im).toBe(0);
    expect(m.isNumber).toBe(false);
    const c = M(['Complex', 2, 3], 0.1);
    expect(c.re).toBe(2);
    expect(c.im).toBe(3);
    expect(Number(m.bignumRe)).toBe(2.5);
    expect(Number(m.valueOf())).toBe(2.5);
  });

  test('the fact queries do not read the nominal', () => {
    const m = M(2.5, 0.1);
    expect(m.sgn).toBeUndefined();
    expect(m.isPositive).toBeUndefined();
    expect(m.isNegative).toBeUndefined();
    expect(m.isFinite).toBeUndefined();
    expect(M(-3, 0.5).sgn).toBeUndefined();
  });

  test('another value of a kind does not project a number', () => {
    expect(ce.box(['Quantity', 2, 'm']).evaluate().re).toBeNaN();
  });
});

describe('MEASUREMENT KIND: admission outside the library (decision B)', () => {
  test('a symbol declared real, number or integer refuses a measurement', () => {
    const e = new ComputeEngine();
    for (const t of ['real', 'number', 'integer']) {
      e.declare(`s_${t}`, t);
      expect(() => e.assign(`s_${t}`, e.box(['Measurement', 2, 0.1]))).toThrow(
        'measurement'
      );
    }
  });

  test('a function with a body over `real` refuses a measurement', () => {
    const e = new ComputeEngine();
    e.declare('f', '(real) -> real');
    e.assign('f', e.parse('x \\mapsto x^2'));
    const r = e.box(['f', ['Measurement', 2, 0.1]]).evaluate();
    expect(r.operator).toBe('Error');
    expect(JSON.stringify(r.json)).toContain('measurement');
  });

  test('an operator over `real` with a handler is an apply site the kind does not know: unevaluated', () => {
    const e = new ComputeEngine();
    let calls = 0;
    e.declare('h', {
      signature: '(real) -> real',
      evaluate: ([x]) => {
        calls += 1;
        return x.mul(e.number(2));
      },
    });
    const call = e.box(['h', ['Measurement', 5, 0.1]]);
    expect(isApplySiteCall(call)).toBe(true);
    expect(call.evaluate().json).toEqual(['h', ['Measurement', 5, 0.1]]);
    expect(calls).toBe(0);
    expect(call.type.toString()).toBe('measurement | number');
  });
});

describe('MEASUREMENT KIND: arithmetic', () => {
  test('CE-508.4: M - M is 0 ± √0.02 on evaluate(), simplify() and .N()', () => {
    const d = ce.box([
      'Subtract',
      ['Measurement', 2, 0.1],
      ['Measurement', 2, 0.1],
    ]);
    for (const r of [d.evaluate(), d.simplify(), d.N()]) {
      expect(r.operator).toBe('Measurement');
      expect(nominal(r)).toBe(0);
      expect(sigma(r)).toBeCloseTo(Math.sqrt(0.02), 12);
    }
  });

  test('CE-508.14: two uncertain complex operands add their moduli in quadrature (A3)', () => {
    // ∂(ab)/∂a = b, ∂(ab)/∂b = a: σ² = |b|²σa² + |a|²σb².
    const p = ce
      .box([
        'Multiply',
        ['Measurement', 1, 0.1],
        ['Measurement', ['Complex', 0, 1], 0.1],
      ])
      .evaluate();
    expect(nominal(p)).toBe(0);
    expect(nominalIm(p)).toBe(1);
    expect(sigma(p)).toBeCloseTo(Math.sqrt(0.02), 12);

    // (1 + i)(2 − i) = 3 + i; σ² = |2 − i|²·0.1² + |1 + i|²·0.2²
    const q = ce
      .box([
        'Multiply',
        ['Measurement', ['Complex', 1, 1], 0.1],
        ['Measurement', ['Complex', 2, -1], 0.2],
      ])
      .evaluate();
    expect(nominal(q)).toBe(3);
    expect(nominalIm(q)).toBe(1);
    expect(sigma(q)).toBeCloseTo(Math.sqrt(5 * 0.01 + 2 * 0.04), 12);

    // (1 + i)/(2 − i) = (1 + 3i)/5; σ² = σa²/|b|² + |a|²σb²/|b|⁴
    const r = ce
      .box([
        'Divide',
        ['Measurement', ['Complex', 1, 1], 0.1],
        ['Measurement', ['Complex', 2, -1], 0.2],
      ])
      .evaluate();
    expect(nominal(r)).toBeCloseTo(0.2, 14);
    expect(nominalIm(r)).toBeCloseTo(0.6, 14);
    expect(sigma(r)).toBeCloseTo(Math.sqrt(0.01 / 5 + (2 * 0.04) / 25), 12);
  });

  test('CE-508.15: an uncertain exponent over a negative base is propagated with the principal logarithm (A4)', () => {
    // f(a) = (−2)^a at a = 2: |f′(2)| = |4·Ln(−2)| = 4·|ln 2 + iπ|.
    const r = ce.box(['Power', -2, ['Measurement', 2, 0.1]]).evaluate();
    expect(r.operator).toBe('Measurement');
    expect(r.op1.json).toEqual(4);
    expect(sigma(r)).toBeCloseTo(4 * Math.hypot(Math.LN2, Math.PI) * 0.1, 12);
    // An uncertain exponent over the base 0 has no derivative: unevaluated.
    expect(
      ce.box(['Power', 0, ['Measurement', 2, 0.1]]).evaluate().operator
    ).toBe('Power');
  });

  test('an infinite slope leaves the power unevaluated (decision 4)', () => {
    const r = ce.box(['Sqrt', ['Measurement', 0, 0.1]]).evaluate();
    expect(r.operator).toBe('Sqrt');
    expect(r.op1.operator).toBe('Measurement');
  });

  test('a power with two uncertain operands', () => {
    // a^b: σ² = |b·a^(b−1)|²σa² + |a^b·ln a|²σb² at a = 2, b = 3.
    const r = ce
      .box(['Power', ['Measurement', 2, 0.1], ['Measurement', 3, 0.2]])
      .evaluate();
    expect(nominal(r)).toBe(8);
    expect(sigma(r)).toBeCloseTo(
      Math.sqrt((3 * 4 * 0.1) ** 2 + (8 * Math.LN2 * 0.2) ** 2),
      12
    );
  });

  test('a zero propagated uncertainty gives a number, and the type says so (decision 3, A1)', () => {
    const zero = ce.box(['Multiply', 0, ['Measurement', 2, 0.1]]);
    expect(zero.type.toString()).toBe('measurement | number');
    expect(zero.evaluate().json).toEqual(0);
    expect(ce.box(['Cos', ['Measurement', 0, 0.1]]).N().json).toEqual(1);
    // A sum keeps an uncertainty: it is typed `measurement`.
    expect(ce.box(['Add', ['Measurement', 2, 0.1], 1]).type.toString()).toBe(
      'measurement'
    );
  });

  test('a free symbol is not folded into the nominal', () => {
    const r = ce.box(['Add', ['Measurement', 2, 0.1], 'x']).evaluate();
    expect(r.operator).toBe('Add');
    expect(r.ops!.some((x) => x.operator === 'Measurement')).toBe(true);
    // A numeric constant is.
    const c = ce.box(['Add', ['Measurement', 2, 0.1], 'Pi']).N();
    expect(nominal(c)).toBeCloseTo(2 + Math.PI, 12);
    expect(sigma(c)).toBeCloseTo(0.1, 12);
  });

  test('an exact nominal stays exact under evaluate() and is numeric under .N()', () => {
    const s = ce.box(['Sin', ['Measurement', ['Rational', 1, 3], 0.1]]);
    const exact = s.evaluate();
    expect(exact.operator).toBe('Measurement');
    expect(exact.op1.json).toEqual(['Sin', ['Rational', 1, 3]]);
    const numeric = s.N();
    expect(numeric.op1.re).toBeCloseTo(Math.sin(1 / 3), 14);
    expect(sigma(numeric)).toBeCloseTo(Math.cos(1 / 3) * 0.1, 14);
  });

  test('a bigint nominal stays exact', () => {
    const m = ce.box(['Measurement', ce.number(12345678901234567890n), 1]);
    expect(ce.function('Add', [m, ce.One]).evaluate().json).toEqual([
      'Measurement',
      { num: '12345678901234567891' },
      1,
    ]);
  });

  test('two lists of measurements and numbers broadcast', () => {
    const r = ce
      .box([
        'Add',
        ['List', ['Measurement', 2, 0.1], 2],
        ['List', 1, ['Measurement', 2, 0.1]],
      ])
      .evaluate();
    expect(r.json).toEqual([
      'List',
      ['Measurement', 3, 0.1],
      ['Measurement', 4, 0.1],
    ]);
  });

  test('the public methods fold measurements, as the evaluation does (A12, A15)', () => {
    const a = M(3, 0.1);
    const b = M(2, 0.1);
    const sum = a.add(b);
    expect(sum.operator).toBe('Measurement');
    expect(nominal(sum)).toBe(5);
    expect(sigma(sum)).toBeCloseTo(Math.sqrt(0.02), 12);
    expect(sum.isSame(ce.function('Add', [a, b]).evaluate())).toBe(true);
    expect(a.mul(b).isSame(ce.function('Multiply', [a, b]).evaluate())).toBe(
      true
    );
    // `.neg()` does not run the `negate` hook: canonicalization calls it for
    // `a - b`, and the `add` hook reads the term as written, `Negate(b)`.
    // The evaluation negates the measurement.
    expect(a.neg().json).toEqual(['Negate', ['Measurement', 3, 0.1]]);
    expect(a.neg().evaluate().json).toEqual(['Measurement', -3, 0.1]);
  });
});

describe('MEASUREMENT KIND: comparisons', () => {
  test('CE-508.7: an undecided comparison keeps the measurement', () => {
    expect(
      ce.box(['Less', ['Measurement', 2, 0.1], 'x']).evaluate().json
    ).toEqual(['Less', ['Measurement', 2, 0.1], 'x']);
    expect(
      ce.box(['Equal', ['Measurement', 2, 0.1], 'x']).evaluate().json
    ).toEqual(['Equal', ['Measurement', 2, 0.1], 'x']);
  });

  test('CE-508.11: the comparison methods decide a measurement', () => {
    const m = M(2, 0.1);
    expect(m.isLess(3)).toBe(true);
    expect(m.isEqual(2)).toBe(true);
    expect(m.is(2)).toBe(true);
    expect(m.isGreater(3)).toBe(false);
  });

  test('the order is the order of the nominals; the uncertainties take no part (A6)', () => {
    expect(
      ce
        .box(['Equal', ['Measurement', 1, 0.1], ['Measurement', 1, 0.5]])
        .evaluate().symbol
    ).toBe('True');
    expect(
      ce
        .box(['Less', ['Measurement', 2, 0.1], ['Measurement', 3, 0.5]])
        .evaluate().symbol
    ).toBe('True');
  });

  test('a complex nominal has no order, and its equality is the equality of the nominal (decision 11, A6)', () => {
    const mc = ['Measurement', ['Complex', 2, 3], 0.1];
    expect(ce.box(['Equal', mc, ['Complex', 2, 3]]).evaluate().symbol).toBe(
      'True'
    );
    expect(ce.box(['NotEqual', mc, ['Complex', 2, 3]]).evaluate().symbol).toBe(
      'False'
    );
    expect(ce.box(['Less', mc, 3]).evaluate().symbol).toBe('False');
    expect(ce.box(['Greater', mc, 3]).evaluate().symbol).toBe('False');
    expect(ce.box(['Max', mc, 2]).evaluate().operator).toBe('Max');
  });

  test('Max and Min keep the first operand of a tie (decision 12)', () => {
    expect(
      ce
        .box(['Max', ['Measurement', 1, 0.1], ['Measurement', 1, 0.5]])
        .evaluate().json
    ).toEqual(['Measurement', 1, 0.1]);
    expect(ce.box(['Max', ['Measurement', 2, 0.1], 2]).evaluate().json).toEqual(
      ['Measurement', 2, 0.1]
    );
    expect(ce.box(['Max', 2, ['Measurement', 2, 0.1]]).evaluate().json).toEqual(
      2
    );
    expect(ce.box(['Max', ['Measurement', 2, 0.1], 2]).type.toString()).toBe(
      'integer<2..2> | measurement'
    );
  });

  test('Clamp gives the operand when it equals a bound (decision 10)', () => {
    const c = ce.box(['Clamp', ['Measurement', 3, 0.1], 0, 3]);
    expect(c.evaluate().json).toEqual(['Measurement', 3, 0.1]);
    expect(c.type.toString()).toBe('integer | measurement');
    expect(
      ce.box(['Clamp', ['Measurement', 5, 0.1], 0, 3]).evaluate().json
    ).toEqual(3);
  });

  test('ElementMax and ElementMin are comparison sites (decision 8)', () => {
    const m = ['Measurement', 2.5, 0.1];
    const max = ce.box(['ElementMax', m, 3]);
    expect(isApplySiteCall(max)).toBe(false);
    expect(max.evaluate().json).toEqual(3);
    expect(ce.box(['ElementMin', m, 3]).evaluate().json).toEqual(m);
    expect(max.type.toString()).toBe('integer | measurement');
  });

  test('a measurement is inexact: Indeterminate beside it becomes NaN (decision 13)', () => {
    const r = ce
      .box([
        'Max',
        ['Measurement', ['Rational', 3, 2], ['Rational', 1, 10]],
        'Indeterminate',
      ])
      .evaluate();
    expect(r.isNaN).toBe(true);
    expect(r.isIndeterminate).toBe(false);
  });

  // A measurement with a `NaN` nominal stands for no value (the `isNaN`
  // hook of the kind): it follows the rule of the number `NaN`.
  test('a NaN nominal follows the rule of NaN', () => {
    const m = ['Measurement', 'NaN', 0.1];
    expect(ce.box(['Max', m, 2]).evaluate().isNaN).toBe(true);
    expect(ce.box(['Min', 2, m]).evaluate().isNaN).toBe(true);
    expect(ce.box(['Max', ['List', m, 2]]).evaluate().isNaN).toBe(true);
    expect(ce.box(['ElementMax', m, 2]).evaluate().isNaN).toBe(true);
    expect(ce.box(['Clamp', m, 0, 3]).evaluate().isNaN).toBe(true);
    expect(ce.box(['Max', m, 2]).N().isNaN).toBe(true);
    // The comparisons answer as for the number `NaN`: no order, equal to
    // nothing, itself included.
    expect(ce.box(['Less', m, 2]).evaluate().symbol).toBe('False');
    expect(ce.box(['Equal', m, 2]).evaluate().symbol).toBe('False');
    expect(ce.box(['Equal', m, m]).evaluate().symbol).toBe('False');
    expect(ce.box(['NotEqual', m, 2]).evaluate().symbol).toBe('True');
  });

  // `.is()` gives its tolerance to the `compare` hook
  // (`ArithmeticContext.tolerance`): the explicit one, else the engine
  // tolerance, also for two exact nominals.
  test('`.is()` compares within its tolerance', () => {
    expect(M(1, 0.1).is(M(1.1, 0.1), 0.2)).toBe(true);
    expect(M(1, 0.1).is(M(1.1, 0.1))).toBe(false);
    expect(M(1, 0.1).is(1.05, 0.1)).toBe(true);
    const tiny = ['Power', 10, -30];
    const a = M(1, 0.1);
    const b = M(['Add', 1, tiny], 0.1);
    expect(a.is(b)).toBe(true);
    // `isEqual()` and `Equal` compare two exact nominals exactly
    expect(a.isEqual(b)).toBe(false);
    expect(ce.box(['Equal', a, b]).evaluate().symbol).toBe('False');
  });

  // An explicit tolerance decides alone: the engine tolerance of
  // `isEqual()` does not make a tie of a difference larger than it.
  test('`.is()` with an explicit tolerance ignores the engine tolerance', () => {
    const ce2 = new ComputeEngine();
    ce2.tolerance = 1e-6;
    const m = ce2.box(['Measurement', 1, 0.1]);
    expect(m.is(1.00000001, 0)).toBe(false);
    expect(m.is(1.00000001)).toBe(true);
    expect(m.is(1.05, 0.1)).toBe(true);
  });
});

describe('MEASUREMENT KIND: the admission gaps of phase 1 (decision 9, A10, A14)', () => {
  const m = ['Measurement', 2.5, 0.1];

  test('a parameter typed by a type variable bounded by `number`', () => {
    const conjugate = ce.box([
      'Conjugate',
      ['Measurement', ['Complex', 2, 3], 0.1],
    ]);
    expect(conjugate.type.toString()).toBe('measurement');
    expect(conjugate.evaluate().json).toEqual([
      'Measurement',
      ['Complex', 2, -3],
      0.1,
    ]);
    for (const head of ['Chop', 'BaseForm'])
      expect(ce.box([head, m]).isValid).toBe(true);
    expect(ce.box(['Remainder', m, 2]).isValid).toBe(true);
  });

  test('the `Rational` overload and the `number` parameters of `Exp2`, `ND`, `NIntegrate`', () => {
    expect(ce.box(['Rational', m]).isValid).toBe(true);
    const exp2 = ce.box(['Exp2', m]).N();
    expect(nominal(exp2)).toBeCloseTo(2 ** 2.5, 12);
    expect(sigma(exp2)).toBeCloseTo(2 ** 2.5 * Math.LN2 * 0.1, 12);
    expect(ce.box(['ND', ['Function', ['Square', 'x'], 'x'], m]).isValid).toBe(
      true
    );
    expect(ce.box(['NIntegrate', ['Function', 'x', 'x'], 0, m]).isValid).toBe(
      true
    );
  });

  test('a literal matrix with measurement cells is typed with its dimensions', () => {
    const rows = ['List', ['List', m, 2], ['List', 3, 4]];
    expect(ce.box(rows).type.toString()).toBe(
      'matrix<integer | measurement^(2x2)>'
    );
    const literal = ce.box(['Determinant', rows]);
    const matrix = ce.box(['Determinant', ['Matrix', rows]]);
    expect(literal.isValid).toBe(true);
    expect(matrix.isValid).toBe(true);
    // A determinant by cofactors uses an entry more than once: it stays
    // unevaluated (decision 7), on both routes.
    expect(literal.evaluate().operator).toBe('Determinant');
    expect(matrix.evaluate().operator).toBe('Determinant');
  });
});

describe('MEASUREMENT KIND: compilation', () => {
  test('a measurement declines, with the message that names `measurement`', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    expect(() =>
      compile(e.box(['Add', 'x', ['Measurement', 2, 0.1]]), { fallback: false })
    ).toThrow("holds a value of the kind type 'measurement'");
  });
});

describe('MEASUREMENT KIND: the isNaN property agrees with the isNaN hook', () => {
  test('a NaN nominal is NaN on the expression too', () => {
    expect(ce.box(['Measurement', 'NaN', 0.1]).isNaN).toBe(true);
    expect(ce.box(['Measurement', 2, 0.1]).isNaN).toBe(false);
    expect(ce.box(['Quantity', 'NaN', 'm']).isNaN).toBe(true);
    expect(ce.box(['ResidueClass', 2, 5]).isNaN).toBe(false);
  });
});
