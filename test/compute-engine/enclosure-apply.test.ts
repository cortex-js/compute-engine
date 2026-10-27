// Value kinds, phase 3: the image of a numeric function on an enclosure
// (the `apply` and `power` hooks of `ENCLOSURE_ARITHMETIC`,
// `src/compute-engine/library/enclosure-arithmetic.ts`;
// `docs/plans/2026-10-26-value-kinds.md`, section 4.9.2).
//
// Under `evaluate()` with exact endpoints the image is exact
// (`Sin(Enclosure(0, 1))` is `Enclosure(0, Sin(1))`). Under `.N()` the
// endpoints are converted outward to doubles and the interval library
// computes the image, one kernel for each form: the tests compare the answer
// with the library called directly on the same doubles, and check that it
// contains the exact value.

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { isInexactOperand } from '../../src/compute-engine/boxed-expression/type-guards';
import {
  IntervalArithmetic as IA,
  type Interval,
  type IntervalResult,
} from '../../src/compute-engine/interval';

type Json = MathJsonExpression;

const ce = new ComputeEngine();

const E = (lo: Json, hi?: Json): Json =>
  hi === undefined ? ['Enclosure', lo] : ['Enclosure', lo, hi];

/** `x` built with `ce.function()` from operands boxed one by one. */
function viaFunction(engine: ComputeEngine, x: Json): Expression {
  if (Array.isArray(x) && typeof x[0] === 'string')
    return engine.function(
      x[0],
      (x.slice(1) as Json[]).map((op) => viaFunction(engine, op))
    );
  return engine.box(x);
}

type Route = 'function' | 'box' | 'parse';
const ROUTES: Route[] = ['function', 'box', 'parse'];

function onRoute(
  route: Route,
  x: Json,
  engine: ComputeEngine = ce
): Expression {
  if (route === 'function') return viaFunction(engine, x);
  if (route === 'box') return engine.box(x);
  return engine.parse(engine.box(x, { form: 'raw' }).latex);
}

const INDETERMINATE = 'indeterminate';
const UNEVALUATED = 'unevaluated';

function expectValue(x: Expression, expected: string): void {
  const v = x.evaluate();
  if (expected === INDETERMINATE) expect(v.isNaN).toBe(true);
  else if (expected === UNEVALUATED) {
    expect(v.operator).toBe(x.operator);
    expect(v.operator).not.toBe('Enclosure');
  } else expect(v.symbol ?? v.toString()).toBe(expected);
}

/** The endpoints of the enclosure `x` as doubles. */
function doubles(x: Expression): [number, number] {
  expect(x.operator).toBe('Enclosure');
  return [x.op1.re, x.op2.re];
}

/** The enclosure of a result of the library, by the mapping of the plan:
 * `interval` and `partial` give the value, `singular` its value or the whole
 * line, `entire` the whole line, `empty` nothing. */
function mapped(r: IntervalResult | Interval): [number, number] | 'empty' {
  if (!('kind' in r)) return [r.lo, r.hi];
  switch (r.kind) {
    case 'interval':
    case 'partial':
      return [r.value.lo, r.value.hi];
    case 'singular':
      return r.value ? [r.value.lo, r.value.hi] : [-Infinity, Infinity];
    case 'entire':
      return [-Infinity, Infinity];
    case 'empty':
      return 'empty';
  }
}

describe('THE IMAGE OF A FUNCTION (`apply`) UNDER `evaluate()`', () => {
  const ROWS: [string, Json, string][] = [
    ['Exp(Enclosure(0, 1))', ['Exp', E(0, 1)], 'Enclosure(1, e)'],
    ['Sin(Enclosure(0, 1))', ['Sin', E(0, 1)], 'Enclosure(0, sin(1))'],
    ['Sin(Enclosure(0, Pi))', ['Sin', E(0, 'Pi')], 'Enclosure(0, 1)'],
    [
      'Sin(Enclosure(0, Arcsin(1)))',
      ['Sin', E(0, ['Arcsin', 1])],
      'Enclosure(0, 1)',
    ],
    ['Cos(Enclosure(0, 7))', ['Cos', E(0, 7)], 'Enclosure(-1, 1)'],
    ['Tan(Enclosure(0, Pi))', ['Tan', E(0, 'Pi')], 'Enclosure(-oo, +oo)'],
    [
      'Tan(Enclosure(0, Pi/2))',
      ['Tan', E(0, ['Divide', 'Pi', 2])],
      'Enclosure(0, +oo)',
    ],
    [
      'Sec(Enclosure(0, Pi/2))',
      ['Sec', E(0, ['Divide', 'Pi', 2])],
      'Enclosure(1, +oo)',
    ],
    ['Cot(Enclosure(0, 1))', ['Cot', E(0, 1)], 'Enclosure(cot(1), +oo)'],
    ['Cosh(Enclosure(-1, 2))', ['Cosh', E(-1, 2)], 'Enclosure(1, cosh(2))'],
    ['Gamma(Enclosure(1, 2), 3)', ['Gamma', E(1, 2), 3], UNEVALUATED],
    ['Abs(Enclosure(-1, 2))', ['Abs', E(-1, 2)], 'Enclosure(0, 2)'],
    ['Ln(Enclosure(-2, -1))', ['Ln', E(-2, -1)], INDETERMINATE],
    ['Ln(Enclosure(0, 1))', ['Ln', E(0, 1)], 'Enclosure(-oo, 0)'],
    ['Ln(Enclosure(0, 0))', ['Ln', E(0, 0)], INDETERMINATE],
    ['Log(Enclosure(1, 4), 2)', ['Log', E(1, 4), 2], 'Enclosure(0, 2)'],
    ['Log(Enclosure(1, 100))', ['Log', E(1, 100)], 'Enclosure(0, 2)'],
    [
      'Log(Enclosure(1, 4), Enclosure(2, 3))',
      ['Log', E(1, 4), E(2, 3)],
      UNEVALUATED,
    ],
    ['Lb(Enclosure(1, 4))', ['Lb', E(1, 4)], 'Enclosure(0, 2)'],
    [
      'Log(Enclosure(1, 4), +oo)',
      ['Log', E(1, 4), 'PositiveInfinity'],
      'Enclosure(0, 0)',
    ],
    ['Artanh(Enclosure(0, 1))', ['Artanh', E(0, 1)], 'Enclosure(0, +oo)'],
    ['Artanh(Enclosure(1, 1))', ['Artanh', E(1, 1)], INDETERMINATE],
    [
      'Arccos(Enclosure(-2, 0))',
      ['Arccos', E(-2, 0)],
      'Enclosure(1/2 * pi, pi)',
    ],
    [
      'Arctan2(Enclosure(-1, 1), -1)',
      ['Arctan2', E(-1, 1), -1],
      'Enclosure(-pi, pi)',
    ],
    [
      'Arctan2(Enclosure(-1, 1), +oo)',
      ['Arctan2', E(-1, 1), 'PositiveInfinity'],
      'Enclosure(0, 0)',
    ],
    ['Mod(Enclosure(5, 7), 3)', ['Mod', E(5, 7), 3], 'Enclosure(0, 3)'],
    ['Mod(Enclosure(4, 5), 3)', ['Mod', E(4, 5), 3], 'Enclosure(1, 2)'],
    ['Mod(5, Enclosure(2, 4))', ['Mod', 5, E(2, 4)], UNEVALUATED],
    ['Mod(Enclosure(5, 7), 0)', ['Mod', E(5, 7), 0], INDETERMINATE],
    [
      'Hypot(Enclosure(0, 1), +oo)',
      ['Hypot', E(0, 1), 'PositiveInfinity'],
      INDETERMINATE,
    ],
    ['Hypot(Enclosure(-3, 3), 4)', ['Hypot', E(-3, 3), 4], 'Enclosure(4, 5)'],
    ['Floor(Enclosure(0.5, 2.5))', ['Floor', E(0.5, 2.5)], 'Enclosure(0, 2)'],
    [
      'Floor(Enclosure(1, +oo))',
      ['Floor', E(1, 'PositiveInfinity')],
      'Enclosure(1, +oo)',
    ],
    [
      'Round(Enclosure(0.1, 0.9), 0.25)',
      ['Round', E(0.1, 0.9), 0.25],
      'Enclosure(0, 1)',
    ],
    ['Round(Enclosure(0, 1), 0)', ['Round', E(0, 1), 0], INDETERMINATE],
    [
      'Round(Enclosure(0, 1), Enclosure(1, 2))',
      ['Round', E(0, 1), E(1, 2)],
      UNEVALUATED,
    ],
    [
      'Floor(Enclosure(1/3, 7/3), 1/2)',
      ['Floor', E(['Rational', 1, 3], ['Rational', 7, 3]), ['Rational', 1, 2]],
      'Enclosure(0, 2)',
    ],
    ['Sign(Enclosure(-1, 2))', ['Sign', E(-1, 2)], 'Enclosure(-1, 1)'],
    ['Sign(Enclosure(0, 2))', ['Sign', E(0, 2)], 'Enclosure(0, 1)'],
    ['Heaviside(Enclosure(0, 2))', ['Heaviside', E(0, 2)], 'Enclosure(1/2, 1)'],
    ['Gamma(Enclosure(0, 1))', ['Gamma', E(0, 1)], 'Enclosure(1, +oo)'],
    ['Gamma(Enclosure(0, 0))', ['Gamma', E(0, 0)], INDETERMINATE],
    ['Factorial(Enclosure(1, 2))', ['Factorial', E(1, 2)], UNEVALUATED],
  ];
  for (const route of ROUTES)
    test.each(ROWS)(`${route}: %s`, (_, x, expected) =>
      expectValue(onRoute(route, x), expected)
    );

  test('`Gamma(Enclosure(1, 2))`: the minimum has no closed form, a float', () => {
    for (const route of ROUTES) {
      const v = onRoute(route, ['Gamma', E(1, 2)]).evaluate();
      expect(v.toString()).toBe('Enclosure(0.8856031944108885, 1)');
      expect(isInexactOperand(v)).toBe(true);
    }
  });

  test('`Gamma(Enclosure(-0.9, -0.1))` is the answer of the library', () => {
    const lib = mapped(IA.gamma({ lo: -0.9, hi: -0.1 }));
    for (const route of ROUTES)
      expect(
        doubles(onRoute(route, ['Gamma', E(-0.9, -0.1)]).evaluate())
      ).toEqual(lib);
    expect(lib).toEqual([-10.686287021193804, -3.544643611154795]);
  });

  test('`Sin(Enclosure(0, Sin(10^600)))`: an undecided order gives float endpoints', () => {
    for (const route of ROUTES) {
      const v = onRoute(route, [
        'Sin',
        E(0, ['Sin', ['Power', 10, 600]]),
      ]).evaluate();
      expect(v.operator).toBe('Enclosure');
      expect(isInexactOperand(v)).toBe(true);
    }
  });

  test('`Fract(Enclosure(-1e-20, -1e-20))` contains the true value', () => {
    // The true value is `1 - 1e-20`, below the double `1`.
    for (const route of ROUTES) {
      const [lo, hi] = doubles(
        onRoute(route, ['Fract', E(-1e-20, -1e-20)]).N()
      );
      expect(lo).toBeLessThan(1);
      expect(hi).toBeGreaterThanOrEqual(1 - 1e-16);
    }
  });

  test('a broadcast over a list', () => {
    for (const route of ROUTES)
      expect(
        onRoute(route, ['Sin', ['List', E(0, 1), 2]])
          .evaluate()
          .toString()
      ).toBe('[Enclosure(0, sin(1)),sin(2)]');
  });
});

describe('THE POWERS', () => {
  const ROWS: [string, Json, string][] = [
    ['Enclosure(-2, 3)^2', ['Power', E(-2, 3), 2], 'Enclosure(0, 9)'],
    ['Enclosure(-2, 3)^3', ['Power', E(-2, 3), 3], 'Enclosure(-8, 27)'],
    ['Enclosure(0, 1)^-1', ['Power', E(0, 1), -1], 'Enclosure(1, +oo)'],
    ['Enclosure(-1, 1)^-2', ['Power', E(-1, 1), -2], 'Enclosure(1, +oo)'],
    [
      'Enclosure(-1, 4)^(1/2)',
      ['Power', E(-1, 4), ['Rational', 1, 2]],
      'Enclosure(0, 2)',
    ],
    ['Sqrt(Enclosure(-1, 4))', ['Sqrt', E(-1, 4)], 'Enclosure(0, 2)'],
    [
      'Enclosure(-4, -1)^(1/2)',
      ['Power', E(-4, -1), ['Rational', 1, 2]],
      INDETERMINATE,
    ],
    ['Root(Enclosure(-8, 8), 3)', ['Root', E(-8, 8), 3], 'Enclosure(-2, 2)'],
    [
      'Enclosure(-8, 8)^(1/3)',
      ['Power', E(-8, 8), ['Rational', 1, 3]],
      'Enclosure(-2, 2)',
    ],
    [
      'Enclosure(-8, 8)^(2/3)',
      ['Power', E(-8, 8), ['Rational', 2, 3]],
      'Enclosure(0, 4)',
    ],
    ['Enclosure(-32, 32)^0.2', ['Power', E(-32, 32), 0.2], 'Enclosure(-2, 2)'],
    [
      'Enclosure(-1, 0)^(-2/3)',
      ['Power', E(-1, 0), ['Rational', -2, 3]],
      'Enclosure(1, +oo)',
    ],
    ['2^Enclosure(1, 3)', ['Power', 2, E(1, 3)], 'Enclosure(2, 8)'],
    [
      '(1/2)^Enclosure(1, 3)',
      ['Power', ['Rational', 1, 2], E(1, 3)],
      'Enclosure(1/8, 1/2)',
    ],
    ['(-2)^Enclosure(2, 2)', ['Power', -2, E(2, 2)], 'Enclosure(4, 4)'],
    ['(-2)^Enclosure(1, 2)', ['Power', -2, E(1, 2)], UNEVALUATED],
    [
      'Enclosure(1, 2)^Enclosure(0, 1)',
      ['Power', E(1, 2), E(0, 1)],
      'Enclosure(1, 2)',
    ],
    ['Square(Enclosure(-1, 2))', ['Square', E(-1, 2)], 'Enclosure(0, 4)'],
  ];
  for (const route of ROUTES)
    test.each(ROWS)(`${route}: %s`, (_, x, expected) =>
      expectValue(onRoute(route, x), expected)
    );

  test('`Enclosure(-1, 1)^9007199254740993`: exact parity under `evaluate()`, unevaluated under `.N()`', () => {
    const exponents: Json[] = [{ num: '9007199254740993' }];
    for (const n of exponents) {
      const x: Json = ['Power', E(-1, 1), n];
      for (const route of ['function', 'box'] as Route[]) {
        expect(onRoute(route, x).evaluate().toString()).toBe(
          'Enclosure(-1, 1)'
        );
        expect(onRoute(route, x).N().operator).toBe('Power');
      }
    }
    // The bigint form of the exponent
    const big = ce.function('Power', [
      ce.box(E(-1, 1)),
      ce.number(9007199254740993n),
    ]);
    expect(big.evaluate().toString()).toBe('Enclosure(-1, 1)');
    expect(big.N().operator).toBe('Power');
  });

  test('`Enclosure(-32, -32)^0.6000000000000001` is below `-8`', () => {
    for (const route of ROUTES) {
      const x: Json = ['Power', E(-32, -32), 0.6000000000000001];
      expect(doubles(onRoute(route, x).evaluate())[0]).toBeLessThan(-8);
      expect(doubles(onRoute(route, x).N())[0]).toBeLessThan(-8);
    }
  });
});

describe('`.N()`: THE LIBRARY ON THE SAME DOUBLES', () => {
  // The doubles of the endpoints after the outward conversion: `0.1` is
  // `[0.09999999999999999, 0.1]`, `1/3` is
  // `[0.3333333333333333, 0.33333333333333337]`, `π` is
  // `[3.141592653589793, 3.1415926535897936]`.
  const PI_UP = 3.1415926535897936;
  const THIRD_DOWN = 0.3333333333333333;
  const ROWS: [string, Json, () => IntervalResult | Interval][] = [
    [
      'Enclosure(0, 1) + 2',
      ['Add', E(0, 1), 2],
      () => IA.add({ lo: 0, hi: 1 }, { lo: 2, hi: 2 }),
    ],
    [
      'Enclosure(0, 1) + Enclosure(1/3, 2)',
      ['Add', E(0, 1), E(['Rational', 1, 3], 2)],
      () => IA.add({ lo: 0, hi: 1 }, { lo: THIRD_DOWN, hi: 2 }),
    ],
    [
      'Enclosure(0, 0) + 0.1',
      ['Add', E(0, 0), 0.1],
      () => IA.add({ lo: 0, hi: 0 }, { lo: 0.09999999999999999, hi: 0.1 }),
    ],
    [
      'Enclosure(-1, 2) * Enclosure(3, 4)',
      ['Multiply', E(-1, 2), E(3, 4)],
      () => IA.mul({ lo: -1, hi: 2 }, { lo: 3, hi: 4 }),
    ],
    [
      'Enclosure(1, 2) / Enclosure(4, 8)',
      ['Divide', E(1, 2), E(4, 8)],
      () => IA.div({ lo: 1, hi: 2 }, { lo: 4, hi: 8 }),
    ],
    [
      '1 / Enclosure(-1, 1)',
      ['Divide', 1, E(-1, 1)],
      () => IA.div({ lo: 1, hi: 1 }, { lo: -1, hi: 1 }),
    ],
    [
      'Enclosure(-2, 3)^2',
      ['Power', E(-2, 3), 2],
      () => IA.square({ lo: -2, hi: 3 }),
    ],
    [
      'Enclosure(-2, 3)^3',
      ['Power', E(-2, 3), 3],
      () => IA.pow({ lo: -2, hi: 3 }, 3),
    ],
    [
      'Sqrt(Enclosure(-1, 4))',
      ['Sqrt', E(-1, 4)],
      () => IA.sqrt({ lo: -1, hi: 4 }),
    ],
    [
      'Root(Enclosure(-8, 8), 3)',
      ['Root', E(-8, 8), 3],
      () => IA.powRational({ lo: -8, hi: 8 }, 1, 3),
    ],
    [
      'Enclosure(-8, 8)^(2/3)',
      ['Power', E(-8, 8), ['Rational', 2, 3]],
      () => IA.powRational({ lo: -8, hi: 8 }, 2, 3),
    ],
    [
      'Enclosure(-32, 32)^0.2',
      ['Power', E(-32, 32), 0.2],
      () => IA.powRational({ lo: -32, hi: 32 }, 1, 5),
    ],
    [
      'Enclosure(-32, -32)^0.6000000000000001',
      ['Power', E(-32, -32), 0.6000000000000001],
      () => IA.powRealBranch({ lo: -32, hi: -32 }, 0.6000000000000001, true),
    ],
    [
      '2^Enclosure(1, 3)',
      ['Power', 2, E(1, 3)],
      () => IA.powInterval({ lo: 2, hi: 2 }, { lo: 1, hi: 3 }),
    ],
    ['Exp(Enclosure(0, 1))', ['Exp', E(0, 1)], () => IA.exp({ lo: 0, hi: 1 })],
    ['Sin(Enclosure(0, 1))', ['Sin', E(0, 1)], () => IA.sin({ lo: 0, hi: 1 })],
    [
      'Sin(Enclosure(0, Pi))',
      ['Sin', E(0, 'Pi')],
      () => IA.sin({ lo: 0, hi: PI_UP }),
    ],
    [
      'Tan(Enclosure(0, Pi))',
      ['Tan', E(0, 'Pi')],
      () => IA.tan({ lo: 0, hi: PI_UP }),
    ],
    ['Cos(Enclosure(0, 7))', ['Cos', E(0, 7)], () => IA.cos({ lo: 0, hi: 7 })],
    ['Ln(Enclosure(0, 1))', ['Ln', E(0, 1)], () => IA.ln({ lo: 0, hi: 1 })],
    [
      'Log(Enclosure(1, 4), 2)',
      ['Log', E(1, 4), 2],
      () => IA.log2({ lo: 1, hi: 4 }),
    ],
    [
      'Log(Enclosure(1, 100))',
      ['Log', E(1, 100)],
      () => IA.log10({ lo: 1, hi: 100 }),
    ],
    [
      'Log(Enclosure(1, 4), 3)',
      ['Log', E(1, 4), 3],
      () => IA.div(IA.ln({ lo: 1, hi: 4 }), IA.ln({ lo: 3, hi: 3 })),
    ],
    [
      'Mod(Enclosure(5, 7), 3)',
      ['Mod', E(5, 7), 3],
      () => IA.mod({ lo: 5, hi: 7 }, { lo: 3, hi: 3 }),
    ],
    [
      'Hypot(Enclosure(-3, 3), 4)',
      ['Hypot', E(-3, 3), 4],
      () => IA.hypot({ lo: -3, hi: 3 }, { lo: 4, hi: 4 }),
    ],
    [
      'Arctan2(Enclosure(-1, 1), -1)',
      ['Arctan2', E(-1, 1), -1],
      () => IA.atan2({ lo: -1, hi: 1 }, { lo: -1, hi: -1 }),
    ],
    [
      'Floor(Enclosure(0.5, 2.5))',
      ['Floor', E(0.5, 2.5)],
      () => IA.floor({ lo: 0.5, hi: 2.5 }),
    ],
    [
      'Round(Enclosure(0.1, 0.9), 0.25)',
      ['Round', E(0.1, 0.9), 0.25],
      () =>
        IA.div(
          IA.round(
            IA.mul(
              { lo: 0.09999999999999999, hi: 0.9 },
              IA.point(4)
            ) as Interval
          ),
          IA.point(4)
        ),
    ],
    [
      'Sign(Enclosure(-1, 2))',
      ['Sign', E(-1, 2)],
      () => IA.sign({ lo: -1, hi: 2 }),
    ],
    [
      'Abs(Enclosure(-1, 2))',
      ['Abs', E(-1, 2)],
      () => IA.abs({ lo: -1, hi: 2 }),
    ],
    [
      'Gamma(Enclosure(1, 2))',
      ['Gamma', E(1, 2)],
      () => IA.gamma({ lo: 1, hi: 2 }),
    ],
    [
      'Max(Enclosure(0, 2), Enclosure(1, 3))',
      ['Max', E(0, 2), E(1, 3)],
      () => IA.max({ lo: 0, hi: 2 }, { lo: 1, hi: 3 }),
    ],
    [
      'Artanh(Enclosure(0, 1))',
      ['Artanh', E(0, 1)],
      () => IA.atanh({ lo: 0, hi: 1 }),
    ],
    [
      'Fract(Enclosure(-1e-20, -1e-20))',
      ['Fract', E(-1e-20, -1e-20)],
      () => IA.fract({ lo: -1e-20, hi: -1e-20 }),
    ],
  ];
  for (const route of ROUTES)
    test.each(ROWS)(`${route}: %s`, (_, x, library) =>
      expect(doubles(onRoute(route, x).N())).toEqual(mapped(library()))
    );

  test('the outward conversion: `Enclosure(0, Pi)` and `Enclosure(0.1, 0.2)`', () => {
    expect(doubles(ce.box(E(0, 'Pi')).N())).toEqual([0, PI_UP]);
    expect(doubles(ce.box(E(0.1, 0.2)).N())).toEqual([
      0.09999999999999999, 0.2,
    ]);
    expect(doubles(ce.box(E(['Rational', 1, 3], 1)).N())).toEqual([
      THIRD_DOWN,
      1,
    ]);
  });

  test('`(Enclosure(0, 1) + 2).N()` is `Enclosure(2, 3)`', () => {
    expect(
      ce
        .box(['Add', E(0, 1), 2])
        .N()
        .toString()
    ).toBe('Enclosure(2, 3)');
  });
});

describe('`.N()` CONTAINS THE EXACT VALUE', () => {
  // The exact value of each row (under `evaluate()`) is contained in its
  // value under `.N()`: a guarantee for the rational operations, the
  // best-effort limit of the transcendental kernels otherwise.
  const ROWS: [string, Json][] = [
    [
      'Enclosure(0, 1) + Enclosure(1/3, 2)',
      ['Add', E(0, 1), E(['Rational', 1, 3], 2)],
    ],
    ['Enclosure(1, 2) / Enclosure(4, 8)', ['Divide', E(1, 2), E(4, 8)]],
    [
      'Enclosure(1/3, 2) * Enclosure(1/7, 3)',
      ['Multiply', E(['Rational', 1, 3], 2), E(['Rational', 1, 7], 3)],
    ],
    ['Enclosure(1/3, 2)^-2', ['Power', E(['Rational', 1, 3], 2), -2]],
    ['Enclosure(0, 1)^-1', ['Power', E(0, 1), -1]],
    ['Enclosure(-1, 1)^-2', ['Power', E(-1, 1), -2]],
    ['Enclosure(1/3, 2)^3', ['Power', E(['Rational', 1, 3], 2), 3]],
    [
      'Mean([Enclosure(0, 1), Enclosure(1, 2), 3])',
      ['Mean', ['List', E(0, 1), E(1, 2), 3]],
    ],
    ['Sin(Enclosure(0, 1)) + 1', ['Add', ['Sin', E(0, 1)], 1]],
    ['Sin(Enclosure(0, Pi))', ['Sin', E(0, 'Pi')]],
    ['Exp(Enclosure(0, 1))', ['Exp', E(0, 1)]],
    ['Tan(Enclosure(0, Pi/2))', ['Tan', E(0, ['Divide', 'Pi', 2])]],
    ['Floor(Enclosure(1, +oo))', ['Floor', E(1, 'PositiveInfinity')]],
    ['Artanh(Enclosure(0, 1))', ['Artanh', E(0, 1)]],
    ['Gamma(Enclosure(0, 1))', ['Gamma', E(0, 1)]],
    ['Enclosure(-1, 0)^(-2/3)', ['Power', E(-1, 0), ['Rational', -2, 3]]],
    ['Hypot(Enclosure(-3, 3), 4)', ['Hypot', E(-3, 3), 4]],
  ];
  for (const route of ROUTES)
    test.each(ROWS)(`${route}: %s`, (_, x) => {
      const exact = onRoute(route, x).evaluate();
      const numeric = onRoute(route, x).N();
      const [lo, hi] = doubles(numeric);
      expect(lo).toBeLessThanOrEqual(exact.op1.N().re);
      expect(hi).toBeGreaterThanOrEqual(exact.op2.N().re);
    });
});

describe('THE ANGULAR UNIT', () => {
  test('in degrees, `Sin(Enclosure(0, 90))` is `Enclosure(0, 1)`', () => {
    const ce2 = new ComputeEngine();
    ce2.angularUnit = 'deg';
    for (const route of ROUTES) {
      expect(
        onRoute(route, ['Sin', E(0, 90)], ce2)
          .evaluate()
          .toString()
      ).toBe('Enclosure(0, 1)');
      const [lo, hi] = doubles(onRoute(route, ['Sin', E(0, 90)], ce2).N());
      expect(lo).toBeLessThanOrEqual(0);
      expect(hi).toBeGreaterThanOrEqual(1);
    }
  });

  test('in degrees, `Arcsin(Enclosure(0, 1))` is `Enclosure(0, 90)`', () => {
    const ce2 = new ComputeEngine();
    ce2.angularUnit = 'deg';
    for (const route of ROUTES) {
      expect(
        onRoute(route, ['Arcsin', E(0, 1)], ce2)
          .evaluate()
          .toString()
      ).toBe('Enclosure(0, 90)');
      const [lo, hi] = doubles(onRoute(route, ['Arcsin', E(0, 1)], ce2).N());
      expect(lo).toBeLessThanOrEqual(0);
      expect(hi).toBeGreaterThanOrEqual(90);
      expect(
        onRoute(route, ['Arctan2', E(-1, 1), -1], ce2)
          .evaluate()
          .toString()
      ).toBe('Enclosure(-180, 180)');
    }
  });

  test('in turns, `Cos` at a quarter turn contains `0`', () => {
    const ce2 = new ComputeEngine();
    ce2.angularUnit = 'turn';
    for (const route of ROUTES) {
      const [lo, hi] = doubles(onRoute(route, ['Cos', E(0.25, 0.25)], ce2).N());
      expect(lo).toBeLessThanOrEqual(0);
      expect(hi).toBeGreaterThanOrEqual(0);
      expect(
        onRoute(route, ['Cos', E(['Rational', 1, 4], ['Rational', 1, 4])], ce2)
          .evaluate()
          .toString()
      ).toBe('Enclosure(0, 0)');
    }
  });
});

describe('A LARGE ANGLE', () => {
  // Near `10^20`, the indices of the periods are above
  // `Number.MAX_SAFE_INTEGER`: the exact route does not walk them (`k++`
  // would not change `k`), and the value is the library's on the doubles.
  const BIG: Json = ['Power', 10, 20];
  const ROWS: [string, Json, (x: Interval) => IntervalResult][] = [
    ['Sin(Enclosure(10^20, 10^20))', ['Sin', E(BIG, BIG)], IA.sin],
    [
      'Cos(Enclosure(10^20, 10^20 + 1))',
      ['Cos', E(BIG, ['Add', BIG, 1])],
      IA.cos,
    ],
    ['Tan(Enclosure(10^20, 10^20))', ['Tan', E(BIG, BIG)], IA.tan],
  ];
  test.each(ROWS)('%s', (_, x, kernel) => {
    const start = Date.now();
    const v = viaFunction(ce, x).evaluate();
    expect(Date.now() - start).toBeLessThan(1000);
    const [lo, hi] = doubles(v);
    const arg = viaFunction(ce, (x as Json[])[1]);
    const lib = mapped(kernel({ lo: arg.op1.N().re, hi: arg.op2.N().re }));
    expect(lib).not.toBe('empty');
    if (lib === 'empty') return;
    expect(lo).toBeLessThanOrEqual(lib[0]);
    expect(hi).toBeGreaterThanOrEqual(lib[1]);
  });
});
