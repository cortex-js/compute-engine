// The `apply` hook of the `Measurement` kind (`MEASUREMENT_ARITHMETIC`,
// `library/measurement-arithmetic.ts`): the value of a call at an APPLY SITE
// (an operator that admits a measurement through the carrier `number`), by
// the rules of `docs/plans/2026-10-26-value-kinds.md`, section 13
// (decisions 1, 2, 4, 5, 6, 7 and the amendments A2, A3, A5, A8, A11, A13).
//
// Every propagated uncertainty is checked against a central finite
// difference of the operator on plain numbers, `|f(a + h) − f(a − h)|/(2h)`,
// in quadrature over the uncertain operands, to 4 significant digits: no
// formula here is written from memory.

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

const ce = new ComputeEngine();

/** A real number, or a complex number as `[re, im]`. */
type Num = number | [number, number];

const json = (v: Num) => (typeof v === 'number' ? v : ['Complex', v[0], v[1]]);

const M = (v: Num, s: number) => ['Measurement', json(v), s];

/** The nominal of a measurement, or the value of a number, as `[re, im]`. */
function nominal(x: Expression): [number, number] {
  const v = x.operator === 'Measurement' ? x.op1.N() : x.N();
  return [v.re, v.im];
}

/** The uncertainty of a measurement as a float, 0 for a number. */
function sigma(x: Expression): number {
  return x.operator === 'Measurement' ? x.op2.N().re : 0;
}

/** The value of `op` on plain operands, under `.N()`, as `[re, im]`. */
function plain(op: string, args: ReadonlyArray<unknown>): [number, number] {
  const r = ce.box([op, ...(args as never[])]).N();
  return [r.re, r.im];
}

/**
 * The first-order uncertainty of `op` at the operands `args` with the
 * uncertainties `sigmas` (0 for an exact operand), from central finite
 * differences along the real axis: `√(Σ |∂f/∂aᵢ|²·σᵢ²)`.
 */
function fdSigma(
  op: string,
  args: ReadonlyArray<Num>,
  sigmas: ReadonlyArray<number>,
  h0 = 1e-6
): number {
  let s2 = 0;
  args.forEach((a, i) => {
    if (!sigmas[i]) return;
    const size = typeof a === 'number' ? Math.abs(a) : Math.hypot(...a);
    const h = h0 * Math.max(1, size);
    const re = typeof a === 'number' ? a : a[0];
    // The step actually taken: `re + h` is rounded to a double.
    const dx = re + h - (re - h);
    const shifted = (d: number) =>
      args.map((b, j) =>
        j !== i
          ? json(b)
          : typeof b === 'number'
            ? b + d
            : json([b[0] + d, b[1]])
      );
    const [pr, pi] = plain(op, shifted(h));
    const [mr, mi] = plain(op, shifted(-h));
    s2 += (((pr - mr) / dx) ** 2 + ((pi - mi) / dx) ** 2) * sigmas[i] ** 2;
  });
  return Math.sqrt(s2);
}

/** `actual` agrees with `expected` to 4 significant digits. */
function expectSignificant(actual: number, expected: number): void {
  expect(Number.isFinite(actual)).toBe(true);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
    5e-5 * Math.abs(expected)
  );
}

/**
 * `op` applied to operands (some of them measurements) under `.N()` is a
 * measurement whose nominal is the value of `op` at the nominals and whose
 * uncertainty is the finite-difference uncertainty.
 */
function expectPropagation(
  op: string,
  args: ReadonlyArray<Num>,
  sigmas: ReadonlyArray<number>,
  h0?: number
): Expression {
  const r = ce
    .box([op, ...args.map((a, i) => (sigmas[i] ? M(a, sigmas[i]) : json(a)))])
    .N();
  expect(r.operator).toBe('Measurement');
  const [re, im] = nominal(r);
  const [pre, pim] = plain(op, args.map(json));
  expect(re).toBeCloseTo(pre, 10);
  expect(im).toBeCloseTo(pim, 10);
  expectSignificant(sigma(r), fdSigma(op, args, sigmas, h0));
  return r;
}

/** The call stays unevaluated: the result has the head `op`. */
function expectUnevaluated(e: unknown, op: string): void {
  const x = ce.box(e as never);
  expect(x.evaluate().operator).toBe(op);
  expect(x.N().operator).toBe(op);
}

/** The call is the `incompatible-type` error (decision D, CE-508.8). */
function expectIncompatibleType(e: unknown): void {
  for (const r of [ce.box(e as never).evaluate(), ce.box(e as never).N()]) {
    expect(r.operator).toBe('Error');
    expect(JSON.stringify(r.json)).toContain('incompatible-type');
  }
}

describe('MEASUREMENT APPLY: the general first-order rule (A3, A11)', () => {
  test.each([
    ['Sin', 2.5],
    ['Arccot', 2.5],
    ['Erf', 0.7],
    ['Gamma', 2.5],
    ['Digamma', 2.5],
    ['LambertW', 2.5],
    ['LogIntegral', 2.5],
    ['ExpIntegralEi', 2.5],
    ['AiryAi', 0.5],
    ['Factorial', 5],
    ['Haversine', 2.5],
    ['InverseHaversine', 0.3],
    ['Degrees', 2.5],
  ])('%s(%d ± 0.1)', (op, a) => {
    expectPropagation(op, [a], [0.1]);
    expect(ce.box([op, M(a, 0.1)]).type.toString()).toBe(
      'measurement | number'
    );
  });

  test('PreIncrement and PreDecrement keep the uncertainty: typed `measurement`', () => {
    for (const op of ['PreIncrement', 'PreDecrement']) {
      expectPropagation(op, [2.5], [0.1]);
      expect(ce.box([op, M(2.5, 0.1)]).type.toString()).toBe('measurement');
    }
  });

  test('every uncertain operand of a two-parameter operator propagates', () => {
    expectPropagation('Log', [2.5, 3], [0.1, 0.1]);
    expectPropagation('Log', [2.5, 3], [0, 0.1]);
    expectPropagation('Arctan2', [2.5, 2], [0.1, 0.2]);
    expectPropagation('Hypot', [2.5, 3], [0.1, 0.2]);
    expectPropagation('BesselJ', [2, 2.5], [0, 0.1]);
    expectPropagation('HurwitzZeta', [3, 2.5], [0, 0.1]);
    // The root index: `Root(a, n) = a^(1/n)`, through the `power` hook.
    expectPropagation('Root', [8, 3], [0.1, 0.1]);
  });

  test('an uncertain order of a norm propagates (A11)', () => {
    const r = ce.box(['Norm', ['List', 3, 4], M(3, 0.1)]).N();
    const f = (p: number) => ce.box(['Norm', ['List', 3, 4], p]).N().re;
    const h = 1e-6;
    expectSignificant(
      sigma(r),
      (Math.abs(f(3 + h) - f(3 - h)) / (2 * h)) * 0.1
    );
  });

  test('an uncertain rounding step: the slope is ±round(x/|s|)', () => {
    const r = ce.box(['Round', 2.3, M(1, 0.01)]).N();
    expect(nominal(r)[0]).toBe(2);
    expectSignificant(sigma(r), fdSigma('Round', [2.3, 1], [0, 0.01]));
  });

  test('the values of the inventory: Hypot(2.5 ± 0.1, 3) is 3.905 ± 0.064', () => {
    const r = ce.box(['Hypot', M(2.5, 0.1), 3]).N();
    expect(nominal(r)[0]).toBeCloseTo(3.905125, 6);
    expect(sigma(r)).toBeCloseTo(0.0640184, 6);
  });

  test('an exact nominal stays exact under evaluate()', () => {
    const r = ce.box(['Log', ['Measurement', ['Rational', 1, 3], 0.1], 2]);
    expect(r.evaluate().op1.json).toEqual(['Log', ['Rational', 1, 3], 2]);
    expect(r.N().op1.re).toBeCloseTo(Math.log2(1 / 3), 14);
  });

  test('an operator with no known derivative stays unevaluated (decision 7)', () => {
    for (const e of [
      ['Beta', M(2.5, 0.1), 3],
      ['BesselJ', M(2, 0.1), 2.5],
      ['HurwitzZeta', M(3, 0.1), 2.5],
      ['Zeta', M(2.5, 0.1)],
    ])
      expectUnevaluated(e, e[0] as string);
  });
});

describe('MEASUREMENT APPLY: vectors and matrices (decision 7, A8)', () => {
  /** The finite-difference uncertainty of each cell of `op` applied to
   * `args` (nested arrays of numbers), with the cell `path` of operand
   * `i` uncertain by `s`. */
  function fdCells(
    op: string,
    args: unknown[],
    i: number,
    path: number[],
    s: number
  ): number[] {
    const h = 1e-6;
    const shifted = (d: number) =>
      args.map((a, j) => {
        if (j !== i) return a;
        const copy = JSON.parse(JSON.stringify(a));
        let cell = copy;
        for (const k of path.slice(0, -1)) cell = cell[k + 1];
        cell[path[path.length - 1] + 1] += d;
        return copy;
      });
    const flat = (x: Expression): number[] =>
      x.operator === 'List' ? x.ops!.flatMap(flat) : [x.re];
    const p = flat(ce.box([op, ...(shifted(h) as never[])]).N());
    const m = flat(ce.box([op, ...(shifted(-h) as never[])]).N());
    return p.map((v, k) => (Math.abs(v - m[k]) / (2 * h)) * s);
  }

  function cellSigmas(x: Expression): number[] {
    return x.operator === 'List' ? x.ops!.flatMap(cellSigmas) : [sigma(x)];
  }

  test('Dot([2.5 ± 0.1, 2, 3], [1, 2, 3]) is 15.5 ± 0.1', () => {
    const r = ce
      .box(['Dot', ['List', M(2.5, 0.1), 2, 3], ['List', 1, 2, 3]])
      .evaluate();
    expect(r.json).toEqual(['Measurement', 15.5, 0.1]);
    expect(sigma(r)).toBeCloseTo(
      fdCells(
        'Dot',
        [
          ['List', 2.5, 2, 3],
          ['List', 1, 2, 3],
        ],
        0,
        [0],
        0.1
      )[0],
      6
    );
  });

  test.each([
    [
      'Cross',
      [
        ['List', 2.5, 2, 3],
        ['List', 1, 2, 3],
      ],
    ],
    [
      'HadamardProduct',
      [
        ['List', 2.5, 2, 3],
        ['List', 1, 2, 3],
      ],
    ],
    [
      'MatrixMultiply',
      [
        ['List', ['List', 2.5, 2], ['List', 3, 4]],
        ['List', ['List', 1, 2], ['List', 3, 4]],
      ],
    ],
  ])(
    '%s: each cell gets the uncertainty of its partial derivatives',
    (op, args) => {
      const path = Array.isArray((args[0] as unknown[])[1]) ? [0, 0] : [0];
      const withM = JSON.parse(JSON.stringify(args));
      let cell = withM[0];
      for (const k of path.slice(0, -1)) cell = cell[k + 1];
      cell[path[path.length - 1] + 1] = M(2.5, 0.1);
      const r = ce.box([op, ...withM]).N();
      const expected = fdCells(op, args as unknown[], 0, path, 0.1);
      const actual = cellSigmas(r);
      expect(actual.length).toBe(expected.length);
      actual.forEach((s, k) =>
        expected[k] === 0
          ? expect(s).toBe(0)
          : expectSignificant(s, expected[k])
      );
    }
  );

  test('Trace of a matrix and of a scalar', () => {
    expect(
      ce
        .box(['Trace', ['List', ['List', M(2.5, 0.1), 2], ['List', 3, 4]]])
        .evaluate().json
    ).toEqual(['Measurement', 6.5, 0.1]);
    expect(ce.box(['Trace', M(2.5, 0.1)]).evaluate().json).toEqual(M(2.5, 0.1));
  });

  test('Norm and Distance', () => {
    const v = ['List', M(2.5, 0.1), 2, 3];
    const n = ce.box(['Norm', v]).N();
    expect(nominal(n)[0]).toBeCloseTo(Math.hypot(2.5, 2, 3), 12);
    expectSignificant(
      sigma(n),
      fdCells('Norm', [['List', 2.5, 2, 3]], 0, [0], 0.1)[0]
    );
    const n3 = ce.box(['Norm', v, 3]).N();
    expectSignificant(
      sigma(n3),
      fdCells('Norm', [['List', 2.5, 2, 3], 3], 0, [0], 0.1)[0]
    );
    // The largest modulus: slope 1 in the cell that reaches it.
    expect(
      ce.box(['Norm', ['List', M(5, 0.1), 2], { str: 'Infinity' }]).N().json
    ).toEqual(M(5, 0.1));
    const d = ce
      .box(['Distance', ['List', M(2.5, 0.1), 2], ['List', 1, M(4, 0.2)]])
      .N();
    const fdU = fdCells(
      'Distance',
      [
        ['List', 2.5, 2],
        ['List', 1, 4],
      ],
      0,
      [0],
      0.1
    )[0];
    const fdV = fdCells(
      'Distance',
      [
        ['List', 2.5, 2],
        ['List', 1, 4],
      ],
      1,
      [1],
      0.2
    )[0];
    expectSignificant(sigma(d), Math.hypot(fdU, fdV));
    // The zero vector has no derivative: unevaluated.
    expectUnevaluated(['Norm', ['List', M(0, 0.1), 0]], 'Norm');
  });

  test('an operator that uses a cell more than once stays unevaluated', () => {
    const rows = ['List', ['List', M(2.5, 0.1), 2], ['List', 3, 4]];
    for (const op of ['Determinant', 'Inverse', 'Eigenvalues'])
      expectUnevaluated([op, rows], op);
  });

  test('the operators that decision 7 leaves unevaluated', () => {
    for (const e of [
      ['Binomial', M(2.5, 0.1), 3],
      ['Choose', M(2.5, 0.1), 3],
      ['Pochhammer', M(2.5, 0.1), 3],
      ['ContinuedFraction', M(2.5, 0.1)],
      ['ComplexRoots', M(2.5, 0.1), 3],
      ['Arg', M(2.5, 0.1)],
      ['Argument', M(2.5, 0.1)],
      ['BaseForm', M(2.5, 0.1)],
    ]) {
      const r = ce.box(e as never).evaluate();
      expect(r.operator).not.toBe('Measurement');
      expect(JSON.stringify(r.json)).toContain('Measurement');
    }
  });
});

describe('MEASUREMENT APPLY: step functions (decision 1, A2)', () => {
  test('first order away from a jump: the bare value', () => {
    for (const [op, a, value] of [
      ['Floor', 2.5, 2],
      ['Ceil', 2.5, 3],
      ['Round', 2.3, 2],
      ['Truncate', 2.5, 2],
      // `Truncate` is continuous at 0.
      ['Truncate', 0.05, 0],
      ['Sign', 5, 1],
      ['Heaviside', 1, 1],
      ['PrimePi', 4.5, 2],
    ] as const) {
      const r = ce.box([op, M(a, 0.1)]);
      // The value of the operator at the nominal, as for a plain number.
      expect(r.evaluate().json).toEqual(ce.box([op, a]).evaluate().json);
      expect(r.N().re).toBe(value);
      expect(r.type.toString()).toBe('measurement | number');
    }
    expect(ce.box(['Floor', M(2.6, 0.01), 0.5]).N().re).toBe(2.5);
  });

  test('a jump within one σ of the nominal leaves the call unevaluated', () => {
    for (const [op, a] of [
      ['Floor', 2.95],
      ['Ceil', 2.95],
      ['Round', 2.5],
      ['Truncate', 1.05],
      ['Sign', 0],
      ['Heaviside', 0.05],
      ['PrimePi', 5.05],
    ] as const)
      expectUnevaluated([op, M(a, 0.1)], op);
    // With a step: `2.5/0.5` is the integer 5.
    expectUnevaluated(['Floor', M(2.5, 0.1), 0.5], 'Floor');
  });

  test('the exact nominal decides the jump under .N()', () => {
    const m = [
      'Measurement',
      ['Subtract', 1, ['Power', 10, -30]],
      ['Power', 10, -40],
    ];
    expect(ce.box(['Floor', m]).N().re).toBe(0);
    // With an uncertainty larger than the distance to 1: unevaluated.
    expectUnevaluated(
      ['Floor', ['Measurement', ['Subtract', 1, ['Power', 10, -30]], 0.01]],
      'Floor'
    );
  });

  test('a complex nominal: unevaluated at Sign (A2), refused where the parameter is real', () => {
    expectUnevaluated(['Sign', M([2, 3], 0.1)], 'Sign');
    for (const op of [
      'Floor',
      'Ceil',
      'Round',
      'Truncate',
      'Heaviside',
      'PrimePi',
    ])
      expectIncompatibleType([op, M([2, 3], 0.1)]);
  });
});

describe('MEASUREMENT APPLY: Mod and Fract (decision 2)', () => {
  test('slope 1 in the dividend, −⌊a/b⌋ in the divisor', () => {
    expect(ce.box(['Mod', M(5, 0.1), 3]).evaluate().json).toEqual(M(2, 0.1));
    const r = ce.box(['Mod', 7, M(3, 0.1)]).N();
    expect(nominal(r)[0]).toBe(1);
    expect(sigma(r)).toBeCloseTo(0.2, 12);
    expectPropagation('Mod', [7, 3], [0, 0.1]);
    expectPropagation('Mod', [-7, 3], [0.1, 0.1]);
    expectPropagation('Mod', [5.5, 2.5], [0.1, 0.05]);
    expect(ce.box(['Fract', ['Measurement', 2.5, 0.01]]).N().json).toEqual([
      'Measurement',
      0.5,
      0.01,
    ]);
    expectPropagation('Fract', [2.5], [0.01]);
  });

  test('a jump within one σ leaves the call unevaluated', () => {
    expectUnevaluated(['Mod', M(2.95, 0.1), 1], 'Mod');
    expectUnevaluated(['Fract', M(2.95, 0.1)], 'Fract');
  });

  test('a complex nominal is refused', () => {
    expectIncompatibleType(['Mod', M([2, 3], 0.1), 3]);
    expectIncompatibleType(['Fract', M([2, 3], 0.1)]);
  });
});

describe('MEASUREMENT APPLY: an infinite value or slope (decision 4, A13)', () => {
  test('the call stays unevaluated', () => {
    expectUnevaluated(['Sqrt', M(0, 0.1)], 'Sqrt');
    expectUnevaluated(['Root', M(0, 0.1), 3], 'Root');
    expectUnevaluated(['Arcsin', M(1, 0.1)], 'Arcsin');
    expectUnevaluated(['Ln', M(0, 0.1)], 'Ln');
    expectUnevaluated(['Gamma', M(0, 0.1)], 'Gamma');
    expectUnevaluated(['Factorial', M(-1, 0.1)], 'Factorial');
    expectUnevaluated(
      ['Tan', ['Measurement', ['Divide', 'Pi', 2], 0.1]],
      'Tan'
    );
  });

  test('a float nominal near a pole: the large finite value with its large σ', () => {
    const r = expectPropagation('Tan', [1.5707963], [0.1], 1e-11);
    expect(nominal(r)[0]).toBeGreaterThan(1e7);
  });

  test('a missing numeric kernel keeps a symbolic nominal with a finite σ', () => {
    const r = ce.box(['LogIntegral', M([2, 3], 0.1)]).N();
    expect(r.operator).toBe('Measurement');
    expect(r.op1.operator).toBe('LogIntegral');
    // |d/dz li(z)| = 1/|ln z|.
    const ln = Math.hypot(Math.log(Math.hypot(2, 3)), Math.atan2(3, 2));
    expectSignificant(sigma(r), 0.1 / ln);
  });
});

describe('MEASUREMENT APPLY: a value that is not real, a complex nominal (decisions 5, 6, A5)', () => {
  test('a real nominal whose value is not real', () => {
    const r = expectPropagation('Arccos', [2.5], [0.1]);
    expect(nominal(r)[1]).toBeCloseTo(1.5668, 4);
    expect(sigma(r)).toBeCloseTo(0.0436, 4);
    const ln = ce.box(['Ln', M(-1, 0.1)]).N();
    expect(nominal(ln)[1]).toBeCloseTo(Math.PI, 12);
    expect(sigma(ln)).toBeCloseTo(0.1, 12);
  });

  test.each([
    'Cos',
    'Sin',
    'Arctan',
    'Arcsin',
    'Sinh',
    'Gamma',
    'Digamma',
    'LogGamma',
    'Erf',
    'LambertW',
    'ExpIntegralEi',
    'Sqrt',
    'Ln',
    'Exp',
  ])('%s((2 + 3i) ± 0.1) keeps an uncertainty', (op) => {
    expectPropagation(op, [[2, 3]], [0.1]);
  });

  test('the logarithm aliases give the complex nominal (CE-508.13)', () => {
    for (const op of ['Log', 'Lb', 'Lg', 'Log2', 'Log10']) {
      const r = ce.box([op, M([2, 3], 0.1)]);
      const canonical = ce.box([op, ['Complex', 2, 3]]);
      const expected = canonical.N();
      for (const v of [r.N(), r.evaluate().N()]) {
        expect(v.operator).toBe('Measurement');
        expect(nominal(v)[0]).toBeCloseTo(expected.re, 12);
        expect(nominal(v)[1]).toBeCloseTo(expected.im, 12);
      }
    }
    expectPropagation('Log', [[2, 3], 3], [0.1, 0]);
    // The nominal of the exact logarithm is not 1.
    expect(ce.box(['Log', ['Complex', 2, 3], 2]).evaluate().json).not.toEqual(
      1
    );
  });

  test('a power and a root of a complex base', () => {
    expectPropagation('Power', [[2, 3], 2], [0.1, 0]);
    expectPropagation('Root', [[2, 3], 3], [0.1, 0]);
  });

  test('a complex nominal at a parameter that is real is `incompatible-type` (CE-508.8)', () => {
    for (const e of [
      ['ContinuedFraction', M([2, 3], 0.1)],
      ['Hypot', M([2, 3], 0.1), 3],
      ['Arctan2', M([2, 3], 0.1), 2],
      ['Degrees', M([2, 3], 0.1)],
      ['Haversine', M([2, 3], 0.1)],
    ])
      expectIncompatibleType(e);
  });
});

describe('MEASUREMENT APPLY: the parts of a complex number, Abs, Exp2', () => {
  test('Re, Im, Conjugate and Abs keep the uncertainty', () => {
    const z = M([2, 3], 0.1);
    expect(ce.box(['Real', z]).evaluate().json).toEqual(M(2, 0.1));
    expect(ce.box(['Imaginary', z]).evaluate().json).toEqual(M(3, 0.1));
    expect(ce.box(['Conjugate', z]).evaluate().json).toEqual(M([2, -3], 0.1));
    const abs = ce.box(['Abs', z]).N();
    expect(nominal(abs)[0]).toBeCloseTo(Math.sqrt(13), 12);
    expect(sigma(abs)).toBe(0.1);
    // A real nominal: the imaginary part is exactly 0.
    expect(ce.box(['Imaginary', M(2.5, 0.1)]).N().json).toEqual(0);
    expect(ce.box(['Abs', M(0, 0.1)]).N().json).toEqual(M(0, 0.1));
  });

  test('Exp2(a ± σ) is 2^a ± 2^a·ln 2·σ', () => {
    const r = ce.box(['Exp2', M(2.5, 0.1)]).N();
    expect(nominal(r)[0]).toBeCloseTo(2 ** 2.5, 12);
    expectSignificant(sigma(r), fdSigma('Exp2', [2.5], [0.1]));
  });
});

describe('MEASUREMENT APPLY: statistics', () => {
  /** The finite-difference uncertainty of the statistic `op` of `data`,
   * whose datum `k` is uncertain by `s`. */
  function fdStatistic(op: string, data: number[], k: number, s: number) {
    const h = 1e-6;
    const at = (d: number) =>
      ce.box([op, ['List', ...data.map((x, j) => (j === k ? x + d : x))]]).N()
        .re;
    return (Math.abs(at(h) - at(-h)) / (2 * h)) * s;
  }

  test.each([
    'Mean',
    'Variance',
    'PopulationVariance',
    'StandardDeviation',
    'PopulationStandardDeviation',
  ])('%s', (op) => {
    const data = [2.5, 3, 4.5];
    const r = ce
      .box([op, ['List', M(2.5, 0.1), 3, ['Measurement', 4.5, 0.2]]])
      .N();
    expect(nominal(r)[0]).toBeCloseTo(
      ce.box([op, ['List', ...data]]).N().re,
      12
    );
    expectSignificant(
      sigma(r),
      Math.hypot(fdStatistic(op, data, 0, 0.1), fdStatistic(op, data, 2, 0.2))
    );
    expect(ce.box([op, ['List', M(2.5, 0.1), 3]]).type.toString()).toBe(
      'measurement | number'
    );
  });

  test('Median: the middle datum, or the mean of the two middle data', () => {
    expect(
      ce.box(['Median', ['List', M(3, 0.1), 1, 5]]).evaluate().json
    ).toEqual(M(3, 0.1));
    const even = ce.box(['Median', ['List', M(2.5, 0.1), 1, 3, 5]]).N();
    expect(nominal(even)[0]).toBeCloseTo(2.75, 12);
    expectSignificant(
      sigma(even),
      fdStatistic('Median', [2.5, 1, 3, 5], 0, 0.1)
    );
  });
});

describe('MEASUREMENT APPLY: a measurement that is a value only at evaluation', () => {
  test('the quadrature of an integral under .N() is dispatched to the hook', () => {
    const integral = [
      'Integrate',
      ['Multiply', 'x', 'x'],
      ['Limits', 'x', 0, 1],
    ];
    const r = ce.box(['Sin', integral]).N();
    expect(r.operator).toBe('Measurement');
    expect(nominal(r)[0]).toBeCloseTo(Math.sin(1 / 3), 9);
  });
});
