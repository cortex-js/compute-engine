import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import {
  populationStandardDeviation,
  populationVariance,
  standardDeviation,
  variance,
} from '../../src/compute-engine/numerics/statistics';
import type { MathJsonExpression } from '../../src/math-json/types';

/**
 * The `complex` compile mode over the CELLS of a list or tensor input.
 *
 * In the `complex` mode a scalar input declared `number` is read on the
 * complex lane: a `{re, im}` value is accepted and lifted at its use. A list
 * input declared `list<number>` (or `tensor<number>`, `matrix<number>`,
 * `list<unknown>`) has cells of the same type, so a cell can hold a
 * `{re, im}` object too. Before the fix, the element-wise lowering read the
 * cells on the real lane in every mode: `Add(p, 1)` compiled to
 * `_SYS.bcast((_tv1, _tv2) => (_tv1 + _tv2), _.p, 1)`, and a cell `1 + i`
 * gave the string `"[object Object]1"`. Now, in the `complex` mode, the
 * element-wise lowering of such a list uses the complex-aware kernels
 * (`_SYS.sadd`, `_SYS.smul`, `_SYS.csqrt`, …), as it already did for
 * `list<complex>`.
 *
 * The `strict` mode and the default mode keep the real lane, and their
 * emitted code is unchanged: a complex value at a cell of a list read on the
 * real lane computes as plain JavaScript (`docs/COMPILATION-MODEL.md`, the
 * input contract). Cells typed `real` or `integer` keep the real lane in
 * every mode.
 */

type Cell = number | { re: number; im: number };
type Value = Cell | Value[];

const ONE_PLUS_I = { re: 1, im: 1 };

/** A JavaScript value as MathJSON, to assign it in the interpreter. */
function toMathJson(v: Value): MathJsonExpression {
  if (Array.isArray(v)) return ['List', ...v.map(toMathJson)];
  if (typeof v === 'number') return v;
  return ['Complex', v.re, v.im];
}

/** An interpreter result as nested arrays of `{re, im}` pairs. */
function fromExpression(x: Expression): unknown {
  if (x.operator === 'List') return x.ops!.map(fromExpression);
  return { re: x.re, im: x.im };
}

/** A compiled result as nested arrays of `{re, im}` pairs. */
function normalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalize);
  if (typeof v === 'number') return { re: v, im: 0 };
  return v;
}

function expectClose(actual: unknown, expected: unknown): void {
  const a = normalize(actual);
  const check = (x: unknown, y: unknown): void => {
    if (Array.isArray(y)) {
      expect(Array.isArray(x)).toBe(true);
      expect((x as unknown[]).length).toBe(y.length);
      y.forEach((e, i) => check((x as unknown[])[i], e));
      return;
    }
    const xc = x as { re: number; im: number };
    const yc = y as { re: number; im: number };
    expect(typeof xc.re).toBe('number');
    expect(typeof xc.im).toBe('number');
    expect(xc.re).toBeCloseTo(yc.re, 9);
    expect(xc.im).toBeCloseTo(yc.im, 9);
  };
  check(a, expected);
}

/** Whether every cell of a compiled result is a plain number. */
function allPlainNumbers(v: unknown): boolean {
  if (Array.isArray(v)) return v.every(allPlainNumbers);
  return typeof v === 'number';
}

/**
 * Compile `expr` with `p` declared `type` (and `q` declared `number`) in
 * `mode`, run it at `values`, and compare the result with the interpreter's
 * `.N()` value with the same values assigned.
 */
function check(
  type: string,
  expr: MathJsonExpression,
  values: Record<string, Value>,
  mode: 'complex' | 'strict' | undefined = 'complex'
): { code: string; result: unknown } {
  const ce = new ComputeEngine();
  ce.declare('p', type);
  ce.declare('q', 'number');
  const r = compile(ce.box(expr), {
    to: 'javascript',
    fallback: false,
    ...(mode === undefined ? {} : { mode }),
  });
  expect(r.success).toBe(true);
  const result = r.run!(values as never);

  const ref = new ComputeEngine();
  ref.declare('p', type);
  ref.declare('q', 'number');
  for (const [k, v] of Object.entries(values))
    ref.assign(k, ref.box(toMathJson(v)));
  expectClose(result, fromExpression(ref.box(expr).N()));
  return { code: r.code!, result };
}

const LIST: Value = [0.5, ONE_PLUS_I, 2, -3];
const REAL_LIST: Value = [0.5, 1, 2, -3];
const MATRIX: Value = [
  [0.5, ONE_PLUS_I],
  [2, -3],
];
const REAL_MATRIX: Value = [
  [0.5, 1],
  [2, -3],
];

/** The element-wise heads under test, each applied to the list input `p`. */
const ELEMENTWISE: [string, MathJsonExpression][] = [
  ['Add', ['Add', 'p', 1]],
  ['Subtract', ['Subtract', 'p', 1]],
  ['Multiply', ['Multiply', 'p', 2]],
  ['Multiply (list by list)', ['Multiply', 'p', 'p']],
  ['Divide', ['Divide', 'p', 2]],
  ['Divide (scalar by list)', ['Divide', 1, 'p']],
  ['Negate', ['Negate', 'p']],
  ['Power', ['Power', 'p', 3]],
  ['Sqrt', ['Sqrt', 'p']],
  ['Exp', ['Exp', 'p']],
  ['Ln', ['Ln', 'p']],
  ['Sin', ['Sin', 'p']],
  ['Cos', ['Cos', 'p']],
  ['Abs', ['Abs', 'p']],
];

describe('complex mode: element-wise heads over a list input with wide cells', () => {
  for (const type of ['list<number>', 'list<unknown>', 'tensor<number>']) {
    describe(type, () => {
      for (const [name, expr] of ELEMENTWISE) {
        it(`${name}: a complex cell gives the interpreter's value`, () => {
          check(type, expr, { p: LIST });
        });
        it(`${name}: all-real cells give the interpreter's value`, () => {
          check(type, expr, { p: REAL_LIST });
        });
      }
    });
  }

  describe('matrix<number>', () => {
    // `Power` of a matrix is the matrix power, not an element-wise head.
    for (const [name, expr] of ELEMENTWISE.filter(
      ([n]) => n !== 'Power' && n !== 'Multiply (list by list)'
    )) {
      it(`${name}: a complex cell gives the interpreter's value`, () => {
        check('matrix<number>', expr, { p: MATRIX });
      });
      it(`${name}: all-real cells give the interpreter's value`, () => {
        check('matrix<number>', expr, { p: REAL_MATRIX });
      });
    }
  });
});

describe('complex mode: the emitted closure', () => {
  it('Add over list<number> uses the complex-aware combiner', () => {
    const { code, result } = check('list<number>', ['Add', 'p', 1], {
      p: [0, ONE_PLUS_I, 2],
    });
    expect(code).toBe(
      '_SYS.bcast((_tv1, _tv2) => _SYS.sadd(_tv1, _tv2), _.p, 1)'
    );
    expect(result).toEqual([1, { re: 2, im: 1 }, 3]);
  });

  it('a result whose cells are all real is an array of plain numbers', () => {
    for (const [, expr] of ELEMENTWISE.filter(
      ([n]) => !['Sqrt', 'Ln'].includes(n)
    )) {
      const { result } = check('list<number>', expr, { p: REAL_LIST });
      expect(allPlainNumbers(result)).toBe(true);
    }
    const { result } = check('tensor<number>', ['Multiply', 'p', 2], {
      p: REAL_MATRIX,
    });
    expect(allPlainNumbers(result)).toBe(true);
  });

  it('cells typed real or integer keep the real lane', () => {
    for (const type of ['list<real>', 'list<integer>', 'list<finite_real>']) {
      const ce = new ComputeEngine();
      ce.declare('p', type);
      const r = compile(ce.box(['Add', 'p', 1]), {
        to: 'javascript',
        fallback: false,
        mode: 'complex',
      });
      expect(r.code).toBe('_SYS.bcast((_tv1, _tv2) => (_tv1 + _tv2), _.p, 1)');
      expect(r.run!({ p: [1, 2] } as never)).toEqual([2, 3]);
    }
  });
});

describe('complex mode: a scalar operand beside a list input', () => {
  it('p + q with a complex scalar q', () => {
    check('list<number>', ['Add', 'p', 'q'], {
      p: LIST,
      q: { re: 0, im: 1 },
    });
  });

  it('q·p with a complex scalar q', () => {
    check('list<number>', ['Multiply', 'q', 'p'], {
      p: LIST,
      q: { re: 2, im: -1 },
    });
  });

  it('p + q² with a real scalar q', () => {
    check('tensor<number>', ['Add', 'p', ['Square', 'q']], {
      p: MATRIX,
      q: 3,
    });
  });

  it('sin(p) + 1 nests element-wise heads', () => {
    check('list<number>', ['Add', ['Sin', 'p'], 1], { p: LIST });
  });
});

describe('complex mode: an ordering of an entry read out of a list', () => {
  // `At(p, 1)` may be a number or a row; in the complex mode a number cell is
  // lifted to `{re, im}`, and a raw `<` on that object answered `false`.
  for (const type of ['tensor<number>', 'list<unknown>']) {
    it(`p[1] < 1 over ${type}`, () => {
      const ce = new ComputeEngine();
      ce.declare('p', type);
      const r = compile(ce.box(['Less', ['At', 'p', 1], 1]), {
        to: 'javascript',
        fallback: false,
        mode: 'complex',
      });
      expect(r.run!({ p: [0.5, 2] } as never)).toBe(true);
      expect(r.run!({ p: [1.5, 2] } as never)).toBe(false);
      expect(r.run!({ p: [{ re: 0.5, im: 1 }, 2] } as never)).toBe(false);
      // An absent cell compares false, as `Less(Missing, 1)` is `False`.
      const second = compile(ce.box(['Less', ['At', 'p', 2], 1]), {
        to: 'javascript',
        fallback: false,
        mode: 'complex',
      });
      expect(second.run!({ p: [0.5, undefined, 2] } as never)).toBe(false);
      expect(
        r.run!({
          p: [
            [0.5, 2],
            [3, 4],
          ],
        } as never)
      ).toEqual([true, false]);
    });
  }
});

describe('an ordering of an absent cell', () => {
  // `_SYS.cisreal(undefined)` read `.im` of `undefined` and threw; the
  // interpreter answers `Less(Missing, 1)` with `False`.
  for (const type of ['tensor<number>', 'list<unknown>', 'list<number>'])
    for (const mode of [undefined, 'complex'] as const)
      it(`p[2] < 1 over ${type} in the ${mode ?? 'default'} mode`, () => {
        const ce = new ComputeEngine();
        ce.declare('p', type);
        const r = compile(ce.box(['Less', ['At', 'p', 2], 1]), {
          to: 'javascript',
          fallback: false,
          ...(mode === undefined ? {} : { mode }),
        });
        expect(r.run!({ p: [0.5, undefined, 2] } as never)).toBe(false);
      });
});

describe('complex mode: reductions of a list input', () => {
  for (const head of ['Sum', 'Product']) {
    it(`${head} of a list with a complex cell`, () => {
      check('list<number>', [head, 'p'], { p: LIST });
    });
    it(`${head} of a list with real cells is a plain number`, () => {
      const { result } = check('list<number>', [head, 'p'], {
        p: REAL_LIST,
      });
      expect(typeof result).toBe('number');
    });
  }

  it('Mean of a list with real cells is a plain number', () => {
    const { result } = check('list<number>', ['Mean', 'p'], {
      p: REAL_LIST,
    });
    expect(typeof result).toBe('number');
  });
});

/**
 * `Mean` and the variance family over complex data. The interpreter gives
 * the mean of complex data (`Mean([3, 4i, 1])` is `4/3 + 4/3 i`) and a real
 * variance (the sum of `|x − mean|²` over `n − 1`: `23/3`). The real
 * lowerings (`_SYS.mean`, …) sum plain numbers, and the run-time realness
 * rule gave NaN for such data, also for `list<complex>` in the default mode.
 */
describe('statistics of complex data', () => {
  const STATISTICS = [
    'Mean',
    'Variance',
    'StandardDeviation',
    'PopulationVariance',
    'PopulationStandardDeviation',
  ];
  const DATA: Value = [3, { re: 0, im: 4 }, 1];
  for (const head of STATISTICS) {
    for (const [type, mode] of [
      ['list<number>', 'complex'],
      ['list<complex>', 'complex'],
      ['list<complex>', undefined],
    ] as const) {
      it(`${head} over ${type} in the ${mode ?? 'default'} mode`, () => {
        const { code, result } = check(type, [head, 'p'], { p: DATA }, mode);
        expect(code).toContain('_SYS.c');
        if (head !== 'Mean') expect(typeof result).toBe('number');
      });
    }
  }

  it('the mean is complex in an enclosing sum, the variance is real', () => {
    check('list<number>', ['Add', ['Mean', 'p'], 1], { p: DATA });
    check('list<number>', ['Multiply', 2, ['Variance', 'p']], { p: DATA });
  });

  it('the mean of several scalar operands', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'number');
    ce.declare('b', 'number');
    const r = compile(ce.box(['Mean', 'a', 'b']), {
      to: 'javascript',
      fallback: false,
      mode: 'complex',
    });
    expect(r.run!({ a: 1, b: { re: 0, im: 2 } } as never)).toEqual({
      re: 0.5,
      im: 1,
    });
  });

  it('real data keeps the real lowering in every mode', () => {
    for (const mode of ['strict', 'complex', undefined] as const) {
      const ce = new ComputeEngine();
      ce.declare('p', mode === 'complex' ? 'list<real>' : 'list<number>');
      const r = compile(ce.box(['Mean', 'p']), {
        to: 'javascript',
        fallback: false,
        ...(mode === undefined ? {} : { mode }),
      });
      expect(r.code).toBe('_SYS.mean(_.p)');
    }
  });

  it('the variance of large data does not overflow', () => {
    // A running mean, as the real reducer: the sum `1e308 + 1e308` is `∞`.
    const ce = new ComputeEngine();
    ce.declare('p', 'list<number>');
    const r = compile(ce.box(['Variance', 'p']), {
      to: 'javascript',
      fallback: false,
      mode: 'complex',
    });
    expect(r.code).toContain('_SYS.cvariance(');
    expect(r.run!({ p: [1e308, 1e308] } as never)).toBe(0);
  });

  it('a part that does not overflow keeps its own scale', () => {
    // One scale for both parts underflowed the imaginary part `1e-100`
    // beside the real part `1e308`.
    const ce = new ComputeEngine();
    ce.declare('p', 'list<number>');
    const run = (head: string, p: unknown[]) =>
      compile(ce.box([head, 'p']), {
        to: 'javascript',
        fallback: false,
        mode: 'complex',
      }).run!({ p } as never);
    const big = { re: 1e308, im: 1e-100 };
    expect(run('Mean', [big, big])).toEqual({ re: 1e308, im: 1e-100 });
    const spread = [
      { re: 1e154, im: 1e-100 },
      { re: -1e154, im: 3e-100 },
    ];
    expect(run('PopulationVariance', spread)).toBe(1e308);
    expect(run('StandardDeviation', spread)).toBeCloseTo(
      Math.SQRT2 * 1e154,
      -144
    );
  });

  it('the mean of large data of opposite signs does not overflow', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'list<number>');
    const opts = {
      to: 'javascript',
      fallback: false,
      mode: 'complex',
    } as const;
    const mean = compile(ce.box(['Mean', 'p']), opts);
    expect(mean.run!({ p: [1e308, -1e308] } as never)).toBe(0);
    expect(
      mean.run!({
        p: [
          { re: 0, im: 1e308 },
          { re: 0, im: -1e308 },
        ],
      } as never)
    ).toBe(0);
    // The variance itself is past the largest number (the interpreter
    // gives 2e616).
    const variance = compile(ce.box(['Variance', 'p']), opts);
    expect(variance.run!({ p: [1e308, -1e308] } as never)).toBe(Infinity);
  });

  it('a large spread gives a positive variance on both lanes', () => {
    // The deviation `1e308 − (−1e308)` overflowed in Welford's update, and
    // the real reducer, shared with the interpreter, gave the variance −∞.
    // The update now runs on scaled data from that point on.
    expect(variance([1e308, -1e308])).toBe(Infinity);
    expect(populationVariance([1e154, -1e154])).toBe(1e308);
    expect(standardDeviation([1e200, -1e200])).toBeCloseTo(
      Math.SQRT2 * 1e200,
      -190
    );
    expect(populationStandardDeviation([1e308, -1e308])).toBe(1e308);
    // Ordinary data is not affected.
    expect(variance([1e8 + 1, 1e8 + 2, 1e8 + 3])).toBe(1);
    const ce = new ComputeEngine();
    ce.declare('p', 'list<number>');
    for (const mode of [undefined, 'complex'] as const) {
      const run = (head: string, p: number[]) =>
        compile(ce.box([head, 'p']), {
          to: 'javascript',
          fallback: false,
          ...(mode === undefined ? {} : { mode }),
        }).run!({ p } as never);
      expect(run('Variance', [1e308, -1e308])).toBe(Infinity);
      expect(run('PopulationVariance', [1e154, -1e154])).toBe(1e308);
      expect(run('PopulationStandardDeviation', [1e200, -1e200])).toBe(1e200);
    }
  });

  it('the mean of data with an infinite datum follows the interpreter', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'list<number>');
    const r = compile(ce.box(['Mean', 'p']), {
      to: 'javascript',
      fallback: false,
      mode: 'complex',
    });
    const mean = (p: unknown[]) => r.run!({ p } as never);
    // A complex datum beside a real infinity: the real infinity, as `Add`.
    expect(mean([ONE_PLUS_I, Infinity])).toBe(Infinity);
    expect(mean([ONE_PLUS_I, -Infinity])).toBe(-Infinity);
    // `+∞` beside `−∞`, and an infinity that is not real: NaN.
    expect(mean([Infinity, -Infinity])).toBeNaN();
    expect(mean([{ re: Infinity, im: 1 }, 2])).toBeNaN();
    const ref = new ComputeEngine();
    expect(
      ref.box(['Mean', ['List', ['Complex', 1, 1], 'PositiveInfinity']]).N().re
    ).toBe(Infinity);
    expect(
      ref.box(['Mean', ['List', 'PositiveInfinity', 'NegativeInfinity']]).N()
        .isNaN
    ).toBe(true);
  });

  it("a caller's own statistics lowering is not bypassed", () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'list<complex>');
    const r = compile(ce.box(['Mean', 'p']), {
      to: 'javascript',
      fallback: false,
      functions: { Mean: '_.customMean' },
    });
    expect(r.code).not.toContain('_SYS.cmean');
    expect(r.code).toContain('_.customMean');
  });

  it('real data gives the same bits in the complex and default modes', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'list<number>');
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const head of STATISTICS) {
      const real = compile(ce.box([head, 'p']), {
        to: 'javascript',
        fallback: false,
      });
      const complex = compile(ce.box([head, 'p']), {
        to: 'javascript',
        fallback: false,
        mode: 'complex',
      });
      for (let t = 0; t < 200; t++) {
        const p = Array.from(
          { length: 1 + Math.floor(random() * 12) },
          () => (random() - 0.5) * 10 ** (Math.floor(random() * 40) - 20)
        );
        expect(
          Object.is(real.run!({ p } as never), complex.run!({ p } as never))
        ).toBe(true);
      }
    }
  });

  it('the machine-precision interpreter computes the standard deviation scaled', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    expect(
      ce.box(['StandardDeviation', ['List', 1e200, -1e200]]).N().re
    ).toBeCloseTo(Math.SQRT2 * 1e200, -190);
    expect(
      ce.box(['PopulationStandardDeviation', ['List', 1e200, -1e200]]).N().re
    ).toBe(1e200);
  });

  it('the strict mode still declines complex data', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'list<complex>');
    expect(() =>
      compile(ce.box(['Variance', 'p']), {
        to: 'javascript',
        fallback: false,
        mode: 'strict',
      })
    ).toThrow(/real-only/);
  });
});

/**
 * `Power` of a base whose type does not give its rank. The interpreter reads
 * the value of the base: an integer power of a square matrix is the matrix
 * power, also for each matrix of a tensor of rank 3, and any other shape
 * (a vector, a non-integer exponent) is the power of each entry. The
 * compiled code squared each entry of a `tensor<number>` matrix in every
 * mode: `[[1, 2], [3, -4]]^2` gave `[[1, 4], [9, 16]]` where the
 * interpreter gives `[[7, -6], [-9, 22]]`.
 */
describe('Power of a base whose rank is not known', () => {
  const M: Value = [
    [1, 2],
    [3, -4],
  ];
  const RANK3: Value = [
    M,
    [
      [0, 1],
      [1, 0],
    ],
  ];
  const POSITIVE: Value = [
    [1, 2],
    [3, 4],
  ];

  /** Compile `expr` with `p: type`, `n: integer`, `x: real`, run it at
   * `values` and compare with the interpreter. */
  function checkPower(
    type: string,
    expr: MathJsonExpression,
    values: Record<string, Value>,
    mode: 'complex' | 'strict' | undefined
  ): string {
    const declare = (ce: ComputeEngine) => {
      ce.declare('p', type);
      ce.declare('n', 'integer');
      ce.declare('x', 'real');
    };
    const ce = new ComputeEngine();
    declare(ce);
    const r = compile(ce.box(expr), {
      to: 'javascript',
      fallback: false,
      ...(mode === undefined ? {} : { mode }),
    });
    const result = r.run!(values as never);
    const ref = new ComputeEngine();
    declare(ref);
    for (const [k, v] of Object.entries(values))
      ref.assign(k, ref.box(toMathJson(v)));
    expectClose(result, fromExpression(ref.box(expr).N()));
    return r.code!;
  }

  // The types whose values cannot hold a point: their values are read by
  // their shape at run time.
  const TYPES = ['tensor<number>', 'tensor', 'list<list<number>>'];
  for (const mode of ['strict', undefined, 'complex'] as const) {
    for (const type of TYPES) {
      describe(`${type}, ${mode ?? 'default'} mode`, () => {
        for (const exponent of [2, 3, 0, -1, 'n', 'x'] as const) {
          it(`p^${exponent} of a square matrix is the matrix power`, () => {
            checkPower(
              type,
              ['Power', 'p', exponent],
              { p: M, n: 2, x: 2 },
              mode
            );
          });
        }
        // A `list<list<number>>` cannot hold a vector.
        if (!type.startsWith('list<list'))
          it('p^2 of a vector is the power of each entry', () => {
            checkPower(type, ['Power', 'p', 2], { p: [1, 2, -3] }, mode);
          });
        it('p^x of a matrix at a non-integer x is the power of each entry', () => {
          checkPower(type, ['Power', 'p', 'x'], { p: POSITIVE, x: 2.5 }, mode);
        });
        it('p^0.5 keeps the element-wise code', () => {
          const code = checkPower(
            type,
            ['Power', 'p', 0.5],
            { p: POSITIVE },
            mode
          );
          expect(code).not.toContain('matrixPowerShape');
        });
        if (!type.startsWith('list<list'))
          it('p^2 of a rank-3 tensor is the matrix power of each matrix', () => {
            checkPower(type, ['Power', 'p', 2], { p: RANK3 }, mode);
          });
        it('(p + 1)^2 binds the computed base once and dispatches on it', () => {
          const code = checkPower(
            type,
            ['Power', ['Add', 'p', 1], 2],
            { p: M },
            mode
          );
          expect(code).toMatch(
            /^\(\(_tv\d+\) => \(_SYS\.matrixPowerShape\(_tv\d+, 2\)/
          );
          expect(code.split('_.p').length - 1).toBe(1);
        });
      });
    }
  }

  it('a complex entry takes the complex matrix power in the complex mode', () => {
    checkPower(
      'tensor<number>',
      ['Power', 'p', 2],
      {
        p: [
          [1, ONE_PLUS_I],
          [2, 3],
        ],
      },
      'complex'
    );
  });

  describe('a list exponent', () => {
    // The interpreter pairs the exponent with the base level by level, and a
    // matrix that meets an integer entry takes the matrix power.
    it('pairs the rows of a matrix with its entries', () => {
      checkPower(
        'tensor<number>',
        ['Power', 'p', ['List', 1, 2]],
        { p: M },
        undefined
      );
    });
    it('pairs the rows of each matrix with a nested exponent', () => {
      checkPower(
        'tensor<number>',
        ['Power', 'p', ['List', ['List', 1, 2], ['List', 3, 4]]],
        { p: RANK3 },
        undefined
      );
    });
    it('throws when an integer entry meets a matrix of a rank-3 tensor', () => {
      // `p^[1, 2]` is the first matrix and the matrix square of the second
      // one; the element-wise code would square each entry of the second.
      for (const mode of [undefined, 'complex'] as const) {
        const ce = new ComputeEngine();
        ce.declare('p', 'tensor<number>');
        const r = compile(ce.box(['Power', 'p', ['List', 1, 2]]), {
          to: 'javascript',
          fallback: false,
          ...(mode === undefined ? {} : { mode }),
        });
        expect(() => r.run!({ p: RANK3 } as never)).toThrow(/matrix power/);
      }
    });
  });

  it('an integer power of a matrix that is not square throws', () => {
    // The interpreter answers the `expected-square-matrix` error.
    const ce = new ComputeEngine();
    ce.declare('p', 'tensor<number>');
    const r = compile(ce.box(['Power', 'p', 2]), {
      to: 'javascript',
      fallback: false,
    });
    const nonSquare = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    expect(() => r.run!({ p: nonSquare } as never)).toThrow(
      /expected-square-matrix/
    );
    // The exponent 1 gives the matrix itself.
    const one = compile(ce.box(['Power', 'p', 'n']), {
      to: 'javascript',
      fallback: false,
    });
    expect(one.run!({ p: nonSquare, n: 1 } as never)).toEqual(nonSquare);
  });

  it('the inverse of a matrix<number> that is not square throws', () => {
    for (const mode of [undefined, 'complex'] as const)
      for (const expr of [
        ['Power', 'q', -1],
        ['Inverse', 'q'],
      ] as MathJsonExpression[]) {
        const ce = new ComputeEngine();
        ce.declare('q', 'matrix<number>');
        const r = compile(ce.box(expr), {
          to: 'javascript',
          fallback: false,
          ...(mode === undefined ? {} : { mode }),
        });
        expect(() =>
          r.run!({
            q: [
              [1, 2, 3],
              [4, 5, 6],
            ],
          } as never)
        ).toThrow(/^Inverse: expected a square matrix.*expected-square-matrix/);
      }
  });

  it('the power of a matrix<number> that is not square throws too', () => {
    for (const mode of [undefined, 'complex'] as const) {
      const ce = new ComputeEngine();
      ce.declare('m', 'matrix<number>');
      ce.declare('n', 'integer');
      const r = compile(ce.box(['Power', 'm', 2]), {
        to: 'javascript',
        fallback: false,
        ...(mode === undefined ? {} : { mode }),
      });
      const nonSquare = [
        [1, 2, 3],
        [4, 5, 6],
      ];
      expect(() => r.run!({ m: nonSquare } as never)).toThrow(
        /expected-square-matrix/
      );
      const one = compile(ce.box(['MatrixPower', 'm', 'n']), {
        to: 'javascript',
        fallback: false,
        ...(mode === undefined ? {} : { mode }),
      });
      expect(one.run!({ m: nonSquare, n: 1 } as never)).toEqual(nonSquare);
    }
  });

  it('a value whose first entry is a number still reaches its matrices', () => {
    // The interpreter broadcasts `[1, M]^2` and squares the matrix `M`.
    const ce = new ComputeEngine();
    ce.declare('p', 'tensor<number>');
    const r = compile(ce.box(['Power', 'p', 2]), {
      to: 'javascript',
      fallback: false,
    });
    const value: Value = [1, POSITIVE];
    const ref = new ComputeEngine();
    expectClose(
      r.run!({ p: value } as never),
      fromExpression(ref.box(['Power', toMathJson(value), 2]).N())
    );
  });

  it('an exponent lifted to {re, im: 0} in the complex mode is an integer', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'tensor<number>');
    ce.declare('q', 'number');
    const r = compile(ce.box(['Power', 'p', 'q']), {
      to: 'javascript',
      fallback: false,
      mode: 'complex',
    });
    expect(r.run!({ p: M, q: 2 } as never)).toEqual([
      [7, -6],
      [-9, 22],
    ]);
    const list = compile(ce.box(['Power', 'p', ['List', 'q', 1]]), {
      to: 'javascript',
      fallback: false,
      mode: 'complex',
    });
    expect(() => list.run!({ p: RANK3, q: 2 } as never)).toThrow(
      /matrix power/
    );
  });

  it('an auto-mode escalation inside the exponent leaves no binding behind', () => {
    // The strict attempt declines with a lane mismatch while it compiles the
    // exponent, after the base was bound to a parameter; the complex retry
    // must bind it again. (`Floor` makes the exponent an integer, so the
    // matrix power is computed rather than refused.)
    const ce = new ComputeEngine();
    ce.declare('p', 'tensor<number>');
    ce.declare('k', 'real');
    ce.assign('Cwide', ce.parse('u \\mapsto u + 1'));
    const expr = ce.box([
      'Power',
      ['Add', 'p', 1],
      ['Floor', ['Cwide', ['Sqrt', 'k']]],
    ]);
    const r = compile(expr, { to: 'javascript', fallback: false });
    expect(r.escalation?.code).toBe('lane-mismatch');
    expect(r.run!({ p: M, k: 4 } as never)).toEqual([
      [20, 57],
      [76, -75],
    ]);
    // A second compilation of the same node is not affected either.
    const again = compile(expr, { to: 'javascript', fallback: false });
    expect(again.run!({ p: M, k: 4 } as never)).toEqual([
      [20, 57],
      [76, -75],
    ]);
  });

  /**
   * The interpreter takes the matrix power for an EXACT integer exponent only:
   * a float with an integer value (`1.5x` at `x = 2` is the float `3`) takes
   * the power of each entry. Compiled code holds both as the same number, so
   * the compiler reads the exponent expression.
   */
  describe('the exactness of the exponent', () => {
    const declare = (ce: ComputeEngine) => {
      ce.declare('p', 'tensor<number>');
      ce.declare('x', 'real');
      ce.declare('k', 'integer');
      ce.declare('n', 'integer');
      ce.declare('L', 'list<number>');
      ce.assign('f', ce.parse('t \\mapsto t + 1'));
    };
    /** The compiled value at `values` (with `p` the matrix `POSITIVE`), or
     * the error it throws, and the interpreter's value. */
    function both(
      exponent: MathJsonExpression,
      values: Record<string, Value>
    ): { code: string; run: () => unknown; expected: unknown } {
      const ce = new ComputeEngine();
      declare(ce);
      const expr: MathJsonExpression = ['Power', 'p', exponent];
      const r = compile(ce.box(expr), { to: 'javascript', fallback: false });
      const ref = new ComputeEngine();
      declare(ref);
      for (const [k, v] of Object.entries({ p: POSITIVE, ...values }))
        ref.assign(k, ref.box(toMathJson(v)));
      return {
        code: r.code!,
        run: () => r.run!({ p: POSITIVE, ...values } as never),
        expected: fromExpression(ref.box(expr).N()),
      };
    }

    it('a float in the exponent keeps the element-wise code', () => {
      for (const [exponent, values] of [
        [['Multiply', 1.5, 'x'], { x: 2 }],
        [['Add', 'x', 0.5], { x: 1.5 }],
      ] as const) {
        const { code, run, expected } = both(
          exponent as MathJsonExpression,
          values
        );
        expect(code).not.toContain('matrixPowerShape');
        expectClose(run(), expected);
      }
    });

    it('an exact exponent takes the matrix power at an integer value', () => {
      for (const [exponent, values] of [
        ['x', { x: 2 }],
        ['x', { x: 2.5 }],
        [['Divide', 'n', 2], { n: 4 }],
        [['Power', 2, 'k'], { k: 1 }],
        [['Floor', 'x'], { x: 2.5 }],
        [['Round', 'x'], { x: 2.4 }],
        [['Length', 'L'], { L: [1, 2] }],
        [['Sqrt', 4], {}],
      ] as const) {
        const { code, run, expected } = both(
          exponent as MathJsonExpression,
          values as Record<string, Value>
        );
        expect(code).toContain('_SYS.matrixPowerShape(');
        expect(code).not.toContain(', true)');
        expectClose(run(), expected);
      }
    });

    it('an exponent whose exactness is not known throws at a matrix', () => {
      // `2x` at the host float `x = 2.5` is the float `5` in the interpreter
      // (the power of each entry), and at `x = 1` the exact `2` (the matrix
      // power); a user function and a transcendental function are not read.
      for (const [exponent, values] of [
        [['Multiply', 2, 'x'], { x: 2.5 }],
        [['Multiply', 2, 'x'], { x: 1 }],
        [['f', 'x'], { x: 1 }],
        [['Sin', 'x'], { x: 0 }],
      ] as const) {
        const { code, run } = both(exponent as MathJsonExpression, values);
        expect(code).toContain(', true)');
        expect(run).toThrow(/is not known to compiled code/);
      }
      // A vector takes the power of each entry under both readings.
      const ce = new ComputeEngine();
      declare(ce);
      const r = compile(ce.box(['Power', 'p', ['Multiply', 2, 'x']]), {
        to: 'javascript',
        fallback: false,
      });
      expect(r.run!({ p: [1, 2, 3], x: 1 } as never)).toEqual([1, 4, 9]);
    });

    it('a power inside the exponent of a power of the same base dispatches', () => {
      // The two powers share the node `p`: the inner square must take its own
      // dispatch, not the element-wise code of the outer power.
      const ce = new ComputeEngine();
      ce.declare('p', 'tensor<number>');
      const inner = ce.box(['Power', 'p', 2]);
      const outer = ce.function('Power', [
        inner.op1,
        ce.function('At', [
          ce.function('At', [inner, ce.number(1)]),
          ce.number(1),
        ]),
      ]);
      const code = compile(outer, { to: 'javascript', fallback: false }).code!;
      expect(code).toContain('_SYS.matrixPowerShape(_.p, 2)');
    });
  });

  it('an exponent within 1e-12 of an integer throws at a matrix', () => {
    // `√n·√n` at `n = 2` is `2.0000000000000004` in floating point and the
    // exact `2` in the interpreter, whose power of a matrix is the matrix
    // power: the code throws rather than take the power of each entry.
    const ce = new ComputeEngine();
    ce.declare('p', 'tensor<number>');
    ce.declare('n', 'integer');
    ce.declare('m', 'integer');
    for (const [exponent, values] of [
      [['Multiply', ['Sqrt', 'n'], ['Sqrt', 'n']], { n: 2 }],
      [['Power', ['Sqrt', 'n'], 4], { n: 2 }],
      [['Square', ['Sqrt', ['Add', 'n', 1]]], { n: 2 }],
      [['Multiply', ['Sqrt', 2], ['Sqrt', 'n']], { n: 8 }],
      [
        ['Multiply', 'm', ['Add', ['Rational', 1, 10], ['Divide', 'n', 10]]],
        { m: 10, n: 2 },
      ],
    ] as const) {
      const r = compile(
        ce.box(['Power', 'p', exponent] as MathJsonExpression),
        {
          to: 'javascript',
          fallback: false,
        }
      );
      expect(() => r.run!({ p: POSITIVE, ...values } as never)).toThrow(
        /within 1e-12 of an integer/
      );
      // A vector takes the power of each entry under both readings.
      expect(() => r.run!({ p: [1, 2], ...values } as never)).not.toThrow();
    }
  });

  it('a base shared with its exponent is evaluated once, with CSE off', () => {
    // The exponent `Length(b)` reads the same computed base `b`: its code is
    // an argument of the arrow function that binds `b`, so it must not read
    // that binding.
    const ce = new ComputeEngine();
    ce.declare('p', 'tensor<number>');
    const base = ce.box(['Add', 'p', 1]);
    const expr = ce.function('Power', [base, ce.function('Length', [base])]);
    const ref = new ComputeEngine();
    ref.declare('p', 'tensor<number>');
    ref.assign('p', ref.box(toMathJson(POSITIVE)));
    const refBase = ref.box(['Add', 'p', 1]);
    const expected = fromExpression(
      ref.function('Power', [refBase, ref.function('Length', [refBase])]).N()
    );
    for (const cse of [false, true]) {
      const r = compile(expr, { to: 'javascript', fallback: false, cse });
      expectClose(r.run!({ p: POSITIVE } as never), expected);
    }
  });

  it('one node in both positions is read once per position', () => {
    // `f()^f()` with an impure `f`: each position evaluates `f` once, and
    // the element-wise power pairs the two different values. The compiled
    // code embeds the source of `f`, so its counter is a global.
    const ce = new ComputeEngine();
    ce.declare('f', '() -> tensor<number>');
    const call = ce.box(['f']);
    const expr = ce.function('Power', [call, call]);
    const counter = globalThis as unknown as { __powerCalls: number };
    const f = () =>
      ++(globalThis as unknown as { __powerCalls: number }).__powerCalls === 1
        ? [
            [2, 3],
            [4, 5],
          ]
        : [
            [1, 2],
            [3, 0],
          ];
    for (const cse of [false, true]) {
      counter.__powerCalls = 0;
      const r = compile(expr, {
        to: 'javascript',
        fallback: false,
        cse,
        functions: { f },
      });
      expect(r.run!({} as never)).toEqual([
        [2, 9],
        [64, 1],
      ]);
      expect(counter.__powerCalls).toBe(2);
    }
  });

  it('the exponent 1 gives the matrix itself', () => {
    // The product by the identity turned an infinite entry into NaN.
    const P = [
      [Infinity, 1],
      [0, 1],
    ];
    for (const mode of [undefined, 'complex'] as const)
      for (const [type, expr] of [
        ['tensor<number>', ['Power', 'p', 'n']],
        ['matrix<number>', ['MatrixPower', 'p', 'n']],
      ] as const) {
        const ce = new ComputeEngine();
        ce.declare('p', type);
        ce.declare('n', 'integer');
        const r = compile(ce.box(expr as MathJsonExpression), {
          to: 'javascript',
          fallback: false,
          ...(mode === undefined ? {} : { mode }),
        });
        expect(r.run!({ p: P, n: 1 } as never)).toEqual(P);
      }
  });

  it("a caller's own Power lowering is not bypassed", () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'tensor<number>');
    const r = compile(ce.box(['Power', 'p', 2]), {
      to: 'javascript',
      fallback: false,
      functions: { Power: '_.myPow' },
    });
    expect(r.code).not.toContain('matrixPowerShape');
    expect(r.code).toContain('_.myPow');
  });

  it('broadcastable<number> dispatches on the shape too', () => {
    checkPower('broadcastable<number>', ['Power', 'p', 2], { p: M }, undefined);
    checkPower('broadcastable<number>', ['Power', 'p', 2], { p: 3 }, undefined);
  });

  it('a base that may hold points keeps the element-wise power', () => {
    // Compiled code holds a point as an array, so `[(1, 2), (3, 4)]` and
    // `[[1, 2], [3, 4]]` are the same value, and hosts pass lists of points:
    // such a base keeps the power of each coordinate, and its code.
    for (const type of [
      'list',
      'list<unknown>',
      'list<any>',
      'list<tuple<number, number>>',
    ]) {
      for (const mode of ['strict', undefined, 'complex'] as const) {
        const ce = new ComputeEngine();
        ce.declare('p', type);
        const r = compile(ce.box(['Power', 'p', 2]), {
          to: 'javascript',
          fallback: false,
          ...(mode === undefined ? {} : { mode }),
        });
        expect(r.code).not.toContain('matrixPowerShape');
        expect(
          r.run!({
            p: [
              [1, 2],
              [3, 4],
              [5, 6],
            ],
          } as never)
        ).toEqual([
          [1, 4],
          [9, 16],
          [25, 36],
        ]);
      }
      // A point plus a number is an error, so `p + 1` is not a computed
      // base for a list of points.
      if (type.includes('tuple')) continue;
      const ce = new ComputeEngine();
      ce.declare('p', type);
      const computed = compile(ce.box(['Power', ['Add', 'p', 1], 2]), {
        to: 'javascript',
        fallback: false,
      });
      expect(computed.code).not.toContain('matrixPowerShape');
    }
  });

  it('a base whose rank is known keeps its code', () => {
    const codes = (type: string): string => {
      const ce = new ComputeEngine();
      ce.declare('p', type);
      return compile(ce.box(['Power', 'p', 2]), {
        to: 'javascript',
        fallback: false,
      }).code!;
    };
    expect(codes('list<number>')).toBe(
      '_SYS.bcast((_tv1, _tv2) => _SYS.pow(_tv1, _tv2), _.p, 2)'
    );
    expect(codes('vector<number>')).toBe(
      '_SYS.bcast((_tv1, _tv2) => _SYS.pow(_tv1, _tv2), _.p, 2)'
    );
    expect(codes('matrix<number>')).toBe('_SYS.matpow(_.p, 2)');
    expect(codes('real')).toBe('(_.p * _.p)');
  });
});

describe('complex mode: the auto mode after it escalates', () => {
  it('a lane mismatch escalates, and the list cells take the complex lane', () => {
    const ce = new ComputeEngine();
    // `√k` is promoted (k has an unknown sign) and reaches the wide
    // parameter `u` of `Cwide`, which the strict attempt reads as real: a
    // lane mismatch, so `auto` compiles again in the `complex` mode.
    ce.assign('Cwide', ce.parse('u \\mapsto u + 1'));
    ce.declare('p', 'list<number>');
    const r = compile(ce.box(['Add', ['Cwide', ['Sqrt', 'k']], 'p']), {
      fallback: false,
    });
    expect(r.mode).toBe('complex');
    expect(r.escalation?.code).toBe('lane-mismatch');
    expect(r.code).toContain('_SYS.sadd(');
    // √4 + 1 = 3, plus each cell.
    expect(r.run!({ k: 4, p: [1, ONE_PLUS_I] } as never)).toEqual([
      4,
      { re: 4, im: 1 },
    ]);
  });
});

describe('the strict and default modes keep the real lane', () => {
  // The emitted code of these modes is pinned byte for byte: the per-cell
  // cost of a plot kernel must not change.
  const cases: [string, MathJsonExpression, string][] = [
    [
      'list<number>',
      ['Add', 'p', 1],
      '_SYS.bcast((_tv1, _tv2) => (_tv1 + _tv2), _.p, 1)',
    ],
    [
      'tensor<number>',
      ['Multiply', 'p', 2],
      '_SYS.bcast((_tv1, _tv2) => (_tv1 * _tv2), 2, _.p)',
    ],
    [
      'list<unknown>',
      ['Sin', 'p'],
      '_SYS.bcast((_tv1) => Math.sin(_tv1), _.p)',
    ],
    ['matrix<number>', ['Negate', 'p'], '_SYS.bcast((_tv1) => (-(_tv1)), _.p)'],
  ];
  for (const mode of ['strict', undefined] as const) {
    for (const [type, expr, code] of cases) {
      it(`${mode ?? 'default'}: ${JSON.stringify(expr)} over ${type}`, () => {
        const ce = new ComputeEngine();
        ce.declare('p', type);
        const r = compile(ce.box(expr), {
          to: 'javascript',
          fallback: false,
          ...(mode === undefined ? {} : { mode }),
        });
        expect(r.code).toBe(code);
      });
    }
  }
});
