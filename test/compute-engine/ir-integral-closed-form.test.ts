/**
 * The closed form of a definite integral in the profile `ir` on JavaScript
 * (batch G20; README of `src/compute-engine/compilation/ir/`, "Integrate").
 *
 * When the engine finds the closed form of `Integrate(f, Limits(t, a, b))`
 * at compile time and it lowers, the value is the closed form, as on the
 * existing JavaScript compiler; otherwise the quadrature stays. The
 * witnesses are five programs of Tycho's corpus that integrated
 * numerically at each call: `neyret/gdej6ro5yn` #3 and `neyret/7mo1pzvuqb`
 * #1 (a Gaussian), `art/nsnfqcmsxc` #2, `neyret/3mssd5t0lj` #1 (a user
 * function as the integrand) and `neyret/hmjyvcbxqa` #5.
 *
 * Each value agrees with the interpreter: within 1e-12 for a closed form,
 * within the quadrature's tolerance where the quadrature stays.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';
import { CompilerState } from '../../src/compute-engine/compilation/compiler-state';
import { resetSharedCompilationBudgets } from '../../src/compute-engine/compilation/compile-integrals';
import { withIntegralClosedFormBudgets } from '../../src/compute-engine/compilation/interval-quadrature';

type Json = unknown;
type Point = Record<string, number>;

const ce = new ComputeEngine();
for (const name of ['x', 'y', 'a', 'b', 's']) ce.declare(name, 'real');
const define = (name: string, json: Json) => {
  ce.declare(name, 'function');
  ce.assign(name, ce.box(json as never));
};
// A user function that reads the free input `y`.
define('f', ['Function', ['Multiply', 'y', ['Sin', 't']], 't']);
// A user function whose parameter is a bound.
define('F', [
  'Function',
  ['Integrate', ['Power', 't', 2], ['Limits', 't', 0, 'u']],
  'u',
]);
// A user function whose body reads the free input `a`.
define('w', ['Function', ['Multiply', 'a', 't'], 't']);
// A user function that draws.
define('fr', ['Function', ['Multiply', 't', ['Random']], 't']);

const IR = { profile: 'ir', fallback: false } as const;
const box = (json: Json): Expression => ce.box(json as never);
const js = (json: Json, options: object = {}) =>
  compile(box(json), { ...IR, ...options });

/** The message of a compilation that throws, or `undefined`. */
function failure(f: () => unknown): string | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { message: string } }).diagnostic?.message;
  }
  return undefined;
}

function interpreted(json: Json, point: Point): number {
  const values = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [k, ce.number(v)])
  );
  return ce.withValues(values as never, () => {
    const v = box(json).evaluate().N();
    if (!isNumber(v)) throw new Error(`no value: ${v.toString()}`);
    return v.re;
  });
}

function agree(v: unknown, w: number, tolerance: number): boolean {
  if (typeof v !== 'number') return false;
  if (!Number.isFinite(w)) return Object.is(v, w) || (isNaN(v) && isNaN(w));
  return Math.abs(v - w) <= tolerance * Math.max(1, Math.abs(w));
}

// prettier-ignore
const POINTS: Point[] = [
  { x: 0.7, y: 0.4, a: -1.2, b: 2.5, s: 0.8 },
  { x: 1.9, y: -0.9, a: 0.5, b: -0.75, s: 1.6 },
  { x: 3.2, y: 1.3, a: 2, b: 2, s: 0.3 },
];

/** The program compiles; `closed`: with no quadrature (or with one); its
 *  value agrees with the interpreter's at each point. */
function check(
  json: Json,
  closed: boolean,
  points: Point[] = POINTS,
  options: object = {}
) {
  const r = js(json, options);
  expect(r).toMatchObject({ success: true, profile: 'ir' });
  expect(/_SYS\.irIntegrate\(/.test(r.code!)).toBe(!closed);
  for (const p of points) {
    const got = r.run!(p as never);
    const want = interpreted(json, p);
    if (!agree(got, want, closed ? 1e-12 : 1e-9))
      throw new Error(
        `${JSON.stringify(json)} at ${JSON.stringify(p)}: ${String(got)}, the interpreter ${want}`
      );
  }
  return r;
}

const gaussian = [
  'Multiply',
  ['Divide', 1, ['Multiply', 's', ['Sqrt', ['Multiply', 2, 'Pi']]]],
  [
    'Integrate',
    [
      'Function',
      [
        'Block',
        [
          'Power',
          'ExponentialE',
          [
            'Multiply',
            ['Rational', -1, 2],
            ['Divide', ['Power', 'Z', 2], ['Power', 's', 2]],
          ],
        ],
      ],
      'Z',
    ],
    ['Limits', 'Z', 'NegativeInfinity', 'x'],
  ],
];

describe('IR integrals: the closed form', () => {
  test('the five witnesses, reduced', () => {
    check(gaussian, true);
    check(
      [
        'Add',
        'y',
        [
          'Negate',
          [
            'Integrate',
            ['Function', ['Block', ['Cos', 'x']], 'n'],
            ['Limits', 'n', ['Negate', 'x'], 'x'],
          ],
        ],
      ],
      true
    );
    check(
      [
        'Integrate',
        ['Function', ['Block', ['f', 't']], 't'],
        ['Limits', 't', 0, 'x'],
      ],
      true
    );
    check(
      [
        'Integrate',
        [
          'Function',
          ['Multiply', 0.1, ['Sqrt', ['Add', ['Power', 't', 2], 1]]],
          't',
        ],
        ['Limits', 't', 0, 'x'],
      ],
      true
    );
  });

  test('symbolic bounds, a bound that is the variable of another integral, an index, a parameter', () => {
    check(['Integrate', ['Power', 't', 2], ['Limits', 't', 'a', 'b']], true);
    // The inner integral closes; the outer one keeps its quadrature (an
    // integrand that holds an integral is not pure for the engine).
    check(
      [
        'Integrate',
        ['Integrate', 'r', ['Limits', 'r', 0, 't']],
        ['Limits', 't', 0, 'x'],
      ],
      false
    );
    const sum = check(
      [
        'Sum',
        ['Integrate', ['Multiply', 'k', 't'], ['Limits', 't', 0, 'k']],
        ['Limits', 'k', 1, 3],
      ],
      true
    );
    expect(sum.run!({} as never)).toBe(18);
    const r = check(['Add', ['F', 'x'], ['F', 2]], true);
    expect(r.preamble).not.toMatch(/irIntegrate/);
  });

  test('bounds in the reverse order, equal bounds, an infinite bound', () => {
    check(['Integrate', ['Power', 't', 2], ['Limits', 't', 'x', 1]], true);
    check(['Integrate', ['Power', 't', 2], ['Limits', 't', 'x', 'x']], true);
    check(
      [
        'Integrate',
        ['Exp', ['Negate', 't']],
        ['Limits', 't', 'x', 'PositiveInfinity'],
      ],
      true
    );
  });

  test('an integration variable that holds a value', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    engine.declare('q', 'real');
    engine.assign('q', 7);
    const r = compile(
      engine.box([
        'Integrate',
        ['Power', 'q', 2],
        ['Limits', 'q', 0, 'x'],
      ] as never),
      IR
    );
    expect(r.code).not.toMatch(/irIntegrate/);
    expect(r.run!({ x: 1.5 } as never)).toBeCloseTo(1.125, 14);
  });
});

describe('IR integrals: the quadrature stays', () => {
  test('a pole between the bounds: the interpreter’s value', () => {
    // No closed form: the engine gives NaN, and so does the quadrature.
    check(['Integrate', ['Divide', 1, 't'], ['Limits', 't', -1, 2]], false, [
      {},
    ]);
    check(['Integrate', ['Tan', 't'], ['Limits', 't', 1, 2]], false, [{}]);
    // The engine's value is +∞, which is the closed form.
    const r = check(
      ['Integrate', ['Power', 't', -2], ['Limits', 't', -1, 1]],
      true,
      [{}]
    );
    expect(r.run!({} as never)).toBe(Infinity);
    // With symbolic bounds the engine finds no closed form of `1/t`.
    expect(
      js(['Integrate', ['Divide', 1, 't'], ['Limits', 't', 'a', 'b']]).code
    ).toMatch(/irIntegrate/);
  });

  test('a closed form outside the slice, NIntegrate', () => {
    // `SinIntegral` has no row.
    check(
      ['Integrate', ['Divide', ['Sin', 't'], 't'], ['Limits', 't', 1, 'x']],
      false
    );
    check(['NIntegrate', ['Function', ['Power', 't', 2], 't'], 0, 'x'], false);
  });

  test('an indefinite integral: a decline, also over a variable of a list type', () => {
    // Its closed form is a function of its variable: `g^3/3` read a list
    // `g` as a number.
    const engine = new ComputeEngine();
    engine.declare('g', 'list<real>');
    for (const json of [
      ['Integrate', ['Power', 'g', 2], 'g'],
      ['Integrate', ['Power', 'x', 2], 'x'],
    ])
      expect(failure(() => compile(engine.box(json as never), IR))).toMatch(
        /Nothing as a value/
      );
    // A definite integral over it does not read it.
    const r = compile(
      engine.box(['Integrate', ['Power', 'g', 2], ['Limits', 'g', 0, 1]]),
      IR
    );
    expect(r.code).not.toMatch(/irIntegrate/);
    expect(r.run!({} as never)).toBeCloseTo(1 / 3, 15);
  });

  test('an angular unit other than radians', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    engine.angularUnit = 'deg';
    const json = ['Integrate', ['Cos', 't'], ['Limits', 't', 0, 'x']];
    const r = compile(engine.box(json as never), IR);
    expect(r.code).toMatch(/irIntegrate/);
    const want = engine
      .box(json as never)
      .subs({ x: 30 })
      .evaluate()
      .N().re;
    expect(r.run!({ x: 30 } as never)).toBeCloseTo(want, 9);
  });

  test('an integrand above the size limit of a closed form', () => {
    // 2^14 nodes counted on every path.
    let body: Json = 't';
    for (let i = 0; i < 14; i++) body = ['Add', ['Sin', body], ['Cos', body]];
    const r = js(['Integrate', body, ['Limits', 't', 0, 'x']]);
    expect(r.code).toMatch(/irIntegrate/);
  });

  test('a draw: in the integrand a decline, in a bound the quadrature', () => {
    expect(
      failure(() =>
        js(['Integrate', ['Multiply', 't', ['Random']], ['Limits', 't', 0, 1]])
      )
    ).toMatch(/an integrand with an effect/);
    expect(
      failure(() => js(['Integrate', ['fr', 't'], ['Limits', 't', 0, 1]]))
    ).toMatch(/an integrand with an effect/);
    const r = js(['Integrate', 't', ['Limits', 't', 0, ['Random']]]);
    expect(r.code).toMatch(/drawNextRandomNumber\(\)[^]*irIntegrate/);
  });

  test('a name of the integrand’s function that the site binds otherwise: a decline, as with the quadrature', () => {
    const w = ['Integrate', ['w', 't'], ['Limits', 't', 0, 1]];
    for (const json of [
      ['Sum', w, ['Limits', 'a', 1, 3]],
      ['Apply', ['Function', w, 'a'], 2],
    ])
      expect(failure(() => js(json))).toMatch(
        /a call of w, which reads the input a, where a is a local or a parameter/
      );
  });
});

describe('IR integrals: vars', () => {
  test('a vars name with a value: the value at the call, not the stored one', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    engine.declare('T', 'real');
    engine.assign('T', 2);
    const vars = { vars: { T: '_.T' } };
    const integrand = compile(
      engine.box([
        'Integrate',
        ['Multiply', 'T', 't'],
        ['Limits', 't', 0, 'x'],
      ] as never),
      { ...IR, ...vars }
    );
    expect(integrand.code).not.toMatch(/irIntegrate/);
    expect(integrand.run!({ x: 1.5, T: 3 } as never)).toBeCloseTo(3.375, 14);
    const bound = compile(
      engine.box(['Integrate', 't', ['Limits', 't', 0, 'T']] as never),
      { ...IR, ...vars }
    );
    expect(bound.code).not.toMatch(/irIntegrate/);
    expect(bound.run!({ T: 3 } as never)).toBeCloseTo(4.5, 14);
  });

  test('a vars name of an inferred type: the quadrature, or a decline', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    engine.assign('U', 2);
    const vars = { ...IR, vars: { U: '_.U' } };
    const bound = compile(
      engine.box(['Integrate', 't', ['Limits', 't', 0, 'U']] as never),
      vars
    );
    expect(bound.code).toMatch(/irIntegrate/);
    expect(bound.run!({ U: 3 } as never)).toBeCloseTo(4.5, 10);
    expect(
      failure(() =>
        compile(
          engine.box([
            'Integrate',
            ['Multiply', 'U', 't'],
            ['Limits', 't', 0, 'x'],
          ] as never),
          vars
        )
      )
    ).toMatch(/an integrand with an effect/);
  });
});

const I = (f: Json, lo: Json, hi: Json, t = 't'): Json => [
  'Integrate',
  f,
  ['Limits', t, lo, hi],
];

describe('IR integrals: a closed form that divides by a name that no divisor of the integral reads', () => {
  // The quadrature's value, where the closed form is NaN (a divisor 0) or
  // loses its digits (a divisor near 0): `∫₀ˣ cos(a·t) dt` is `sin(a·x)/a`.
  // prettier-ignore
  const cases: [string, Json, Point, number][] = [
    ['cos(a·t), a = 0', I(['Cos', ['Multiply', 'a', 't']], 0, 'x'), { x: 2, a: 0 }, 2],
    ['cos(a·t), a = 1e-9', I(['Cos', ['Multiply', 'a', 't']], 0, 'x'), { x: 2, a: 1e-9 }, 2],
    ['t·cos(a·t), a = 1e-12', I(['Multiply', 't', ['Cos', ['Multiply', 'a', 't']]], 0, 'x'), { x: 2, a: 1e-12 }, 2],
    ['t·cos(a·t), a = 1e-9', I(['Multiply', 't', ['Cos', ['Multiply', 'a', 't']]], 0, 'x'), { x: 2, a: 1e-9 }, 2],
    ['sin(a·t), a = 1e-7', I(['Sin', ['Multiply', 'a', 't']], 0, 'x'), { x: 2, a: 1e-7 }, 2e-7],
    ['t·exp(a·t), a = 1e-7', I(['Multiply', 't', ['Exp', ['Multiply', 'a', 't']]], 0, 'x'), { x: 2, a: 1e-7 }, 2 + 8e-7 / 3],
    ['t²·sin(a·t), a = 1e-7', I(['Multiply', ['Power', 't', 2], ['Sin', ['Multiply', 'a', 't']]], 0, 'x'), { x: 2, a: 1e-7 }, 4e-7],
    ['x^t, x = 1', I(['Power', 'x', 't'], 0, 1), { x: 1 }, 1],
    ['x^t, x = 1 + 1e-9', I(['Power', 'x', 't'], 0, 1), { x: 1 + 1e-9 }, 1 + 5e-10],
    ['t^a, a = −1', I(['Power', 't', 'a'], 1, 2), { a: -1 }, Math.LN2],
    ['t^a, a = −1 + 1e-9', I(['Power', 't', 'a'], 1, 2), { a: -1 + 1e-9 }, Math.LN2 + (1e-9 * Math.LN2 ** 2) / 2],
  ];
  test.each(cases)('%s', (_, json, point, want) => {
    const r = js(json);
    expect(r.code).toMatch(/_SYS\.irIntegrate\(/);
    const got = r.run!(point as never) as number;
    expect(Math.abs(got - want)).toBeLessThanOrEqual(1e-9 * Math.abs(want));
  });

  test('a divisor that the integrand has already: the closed form', () => {
    // `s` divides the integrand of the Gaussian.
    expect(js(gaussian).code).not.toMatch(/irIntegrate/);
    check(I(['Divide', 't', 's'], 0, 'x'), true);
  });

  describe('a divisor in the body of a user function, or in a held value', () => {
    const engine = new ComputeEngine();
    for (const n of ['x', 'a', 's', 'r', 'c']) engine.declare(n, 'real');
    const fn = (name: string, json: Json) => {
      engine.declare(name, 'function');
      engine.assign(name, engine.box(json as never));
    };
    // `neyret/xto4f58izy` #2: `G` divides by `s`.
    fn('G', [
      'Function',
      [
        'Multiply',
        ['Divide', 1, ['Multiply', 's', ['Sqrt', ['Multiply', 2, 'Pi']]]],
        [
          'Exp',
          ['Multiply', ['Rational', -1, 2], ['Power', ['Divide', 'u', 's'], 2]],
        ],
      ],
      'u',
    ]);
    // `h` does not divide by `a`; its closed form does.
    fn('h', ['Function', ['Cos', ['Multiply', 'a', 'u']], 'u']);
    // `q` holds an expression of `s`.
    engine.declare('q', 'real');
    engine.assign('q', engine.box(['Multiply', 2, 's']));
    const run = (json: Json, point: Point) => {
      const r = compile(engine.box(json as never), IR);
      const values = Object.fromEntries(
        Object.entries(point).map(([k, v]) => [k, engine.number(v)])
      );
      const want = engine.withValues(values as never, () =>
        engine
          .box(json as never)
          .evaluate()
          .N()
      ).re;
      return { r, got: r.run!(point as never) as number, want };
    };

    test('the body of the integrand’s function divides by s: the closed form', () => {
      const json = [
        'Multiply',
        ['Divide', 1, ['Multiply', 2, 'r']],
        I(['G', 't'], ['Subtract', 'c', 'r'], ['Add', 'c', 'r']),
      ];
      expect(compile(engine.box(json as never), IR).code).not.toMatch(
        /irIntegrate/
      );
      for (let k = 0; k < 20; k++) {
        const point = {
          c: -3 + 0.31 * k,
          r: 0.1 + 0.04 * k,
          s: k === 0 ? 1e-3 : k === 1 ? 0.01 : 0.2 + 0.1 * k,
        };
        const { got, want } = run(json, point);
        expect(Math.abs(got - want)).toBeLessThanOrEqual(
          1e-12 * Math.max(1, Math.abs(want))
        );
      }
    });

    test('a function whose body does not divide by a: the quadrature', () => {
      for (const a of [0, 1e-9]) {
        const { r, got } = run(I(['h', 't'], 0, 'x'), { x: 2, a });
        expect(r.code).toMatch(/irIntegrate/);
        expect(Math.abs(got - 2)).toBeLessThanOrEqual(1e-9);
      }
    });

    test('a divisor that reads a name through its held value: allowed', () => {
      // `∫₀ˣ cos(t)/q dt` is `sin(x)/(2s)`; `q` holds `2s`.
      const json = I(['Divide', ['Cos', 't'], 'q'], 0, 'x');
      const { r, got, want } = run(json, { x: 0.7, s: 0.25 });
      expect(r.code).not.toMatch(/irIntegrate/);
      expect(got).toBeCloseTo(Math.sin(0.7) / 0.5, 14);
      expect(got).toBeCloseTo(want, 14);
    });
  });
});

describe('IR integrals: the antiderivative budget of one outermost compilation', () => {
  const steps = () => CompilerState.antiderivativeStepsLeft;
  resetSharedCompilationBudgets();
  const FULL = steps();
  const program = I(['Multiply', 't', ['Sin', 't']], 0, 'x');
  // A closed-form search that starts an existing compilation.
  const nested = I(
    ['Multiply', 't', I(['Sin', ['Sin', 'r']], 0, 1, 'r')],
    0,
    'x'
  );

  test('each outermost compilation starts with a full pool', () => {
    for (const to of ['javascript', 'interval-js', 'javascript']) {
      CompilerState.antiderivativeStepsLeft = 1;
      compile(box(program), { ...IR, to } as never);
      expect(steps()).toBeGreaterThan(1);
    }
  });

  test('a compilation inside another one consumes its pool', () => {
    const outer = 10 * FULL;
    const within = (f: () => void) => {
      CompilerState.antiderivativeStepsLeft = outer;
      f();
      // A reset would leave at most a full pool.
      expect(steps()).toBeGreaterThan(FULL);
      expect(steps()).toBeLessThanOrEqual(outer);
    };
    // The profile in the profile, and an existing compilation in the
    // profile (the closed-form search of `nested`).
    for (const json of [program, nested])
      for (const to of ['javascript', 'interval-js'])
        withIntegralClosedFormBudgets(() =>
          within(() => compile(box(json), { ...IR, to } as never))
        );
    // The profile in an existing compilation.
    const depth = CompilerState._compileDepth;
    CompilerState._compileDepth = depth + 1;
    try {
      within(() => js(program));
    } finally {
      CompilerState._compileDepth = depth;
    }
  });
});

describe('IR integrals and derivatives: the names that a closed form absorbs are dependencies', () => {
  const engine = new ComputeEngine();
  engine.declare('x', 'real');
  engine.declare('u', 'real');
  engine.declare('a', 'real');
  engine.assign('a', 2);
  engine.declare('T', 'real');
  engine.assign('T', 2);
  engine.declare('g', 'function');
  engine.assign(
    'g',
    engine.box(['Function', ['Multiply', 3, ['Power', 's', 2]], 's'])
  );
  const deps = (json: Json, options: object = {}) => {
    const out = new Set<string>();
    const r = compile(engine.box(json as never), {
      ...IR,
      symbolDeps: out,
      ...options,
    });
    expect(r.success).toBe(true);
    return [...out].sort();
  };
  test('a stored value and a user function', () => {
    expect(deps(I(['Multiply', 'a', 't'], 0, 'x'))).toEqual(['a']);
    expect(deps(I(['g', 't'], 0, 'x'))).toEqual(['g']);
    expect(deps(['D', ['Multiply', 'a', ['Power', 'x', 2]], 'x'])).toEqual([
      'a',
    ]);
    expect(deps(['D', ['g', 'x'], 'x'])).toEqual(['g']);
    expect(deps(['Apply', ['Derivative', 'g'], 'x'])).toEqual(['g']);
  });
  test('not a vars name; a discarded closed form adds nothing', () => {
    expect(
      deps(I(['Multiply', 'T', 't'], 0, 'x'), { vars: { T: '_.T' } })
    ).toEqual([]);
    // `∫ g(t)·cos(u·t) dt` divides by `u`: the quadrature, which calls `g`.
    expect(
      deps(I(['Multiply', ['g', 't'], ['Cos', ['Multiply', 'u', 't']]], 0, 'x'))
    ).toEqual(['g']);
    expect(deps(I(['Cos', ['Multiply', 'u', 't']], 0, 'x'))).toEqual([]);
  });
});

describe('IR integrals: the variable of an outer integral, a literal of another parameter', () => {
  test('a closed form that reads the variable that no bound reads: the quadrature', () => {
    // `w` reads the input `a`, which the outer integral binds.
    for (const json of [
      I(I(['w', 't'], 0, 'x'), 0, 1, 'a'),
      I(I(['Multiply', 'a', ['w', 't']], 0, 'x'), 0, 1, 'a'),
    ])
      expect(failure(() => js(json))).toMatch(
        /a call of w, which reads the input a, where a is a local or a parameter/
      );
  });

  test('a function literal whose parameter is not the name of the Limits declines', () => {
    const json = I(['Function', ['Multiply', 'u', 'x'], 'u'], 0, 'x');
    for (const unit of ['rad', 'deg'] as const) {
      const engine = new ComputeEngine();
      engine.declare('x', 'real');
      engine.declare('u', 'real');
      engine.angularUnit = unit;
      for (const to of ['javascript', 'interval-js'])
        expect(
          failure(() =>
            compile(engine.box(json as never), { ...IR, to } as never)
          )
        ).toMatch(/an integrand whose parameter is not the variable/);
    }
    // `NIntegrate(f, a, b)` has no `Limits`.
    check(['NIntegrate', ['Function', ['Power', 'u', 2], 'u'], 0, 'x'], false);
  });
});

describe('IR integrals: effects and calls in a closed form', () => {
  const engine = new ComputeEngine();
  for (const n of ['x', 'T', 'r']) engine.declare(n, 'real');
  engine.declare('n', 'integer');
  engine.declare('fT', 'function');
  engine.assign(
    'fT',
    engine.box([
      'Function',
      ['If', ['Greater', 'u', 1], ['Multiply', 'u', 'T'], 'T'],
      'u',
    ])
  );
  engine.declare('fact', '(integer) -> integer');
  engine.assign(
    'fact',
    engine.box([
      'Function',
      [
        'If',
        ['LessEqual', 'k', 1],
        1,
        ['Multiply', 'k', ['fact', ['Subtract', 'k', 1]]],
      ],
      'k',
    ])
  );
  const V = { ...IR, vars: { T: '_.T' } };
  const inner = I(['Multiply', ['fT', 'x'], 't'], 0, 'x');

  test('a vars read in an arm of the closed form', () => {
    const r = compile(engine.box(inner as never), V);
    expect(r.code).not.toMatch(/irIntegrate/);
    expect(r.code).toMatch(/if \(/);
    // fT(1.5) = 4.5 at T = 3, times 1.5²/2.
    expect(r.run!({ x: 1.5, T: 3 } as never)).toBeCloseTo(5.0625, 14);
    expect(r.run!({ x: 0.5, T: 3 } as never)).toBeCloseTo(0.375, 14);
    // In the integrand of a quadrature, the read is an effect.
    expect(
      failure(() =>
        compile(
          engine.box(
            I(['Multiply', ['Sin', ['Sin', 'r']], inner], 0, 1, 'r') as never
          ),
          V
        )
      )
    ).toMatch(/an integrand with an effect/);
  });

  test('a closed form that holds a call: the quadrature', () => {
    const out = new Set<string>();
    const r = compile(
      engine.box(I(['Multiply', ['fact', 3], 't'], 0, 'x') as never),
      { ...IR, symbolDeps: out }
    );
    // The engine computes `fact(3)`: the closed form holds no call.
    expect(r.run!({ x: 1.5 } as never)).toBeCloseTo(6.75, 14);
    expect([...out]).toEqual(['fact']);
    expect(
      failure(() =>
        compile(
          engine.box(I(['Multiply', ['fact', 'n'], 't'], 0, 'x') as never),
          IR
        )
      )
    ).toMatch(/an integrand with an effect/);
  });

  test('an input that the closed form cancels is not a free symbol', () => {
    expect(js(I(['Power', 't', 2], 'x', 'x')).freeSymbols).toEqual([]);
  });
});

describe('IR integrals: the factors of a divisor, a NaN, a library constant', () => {
  const engine = new ComputeEngine();
  for (const n of ['x', 'a', 's']) engine.declare(n, 'real');
  const fn = (name: string, json: Json) => {
    engine.declare(name, 'function');
    engine.assign(name, engine.box(json as never));
  };
  fn('W', ['Function', ['Divide', 'u', ['Add', 1, ['Power', 'a', 2]]], 'u']);
  fn('F', [
    'Function',
    ['Divide', ['Cos', ['Multiply', 'a', 'u']], ['Add', 1, ['Power', 'a', 2]]],
    'u',
  ]);
  engine.declare('c', 'real');
  engine.assign('c', engine.box(['Divide', 'Pi', 2]));
  const run = (json: Json, point: Point, closed: boolean) => {
    const r = compile(engine.box(json as never), IR);
    expect(/irIntegrate/.test(r.code!)).toBe(!closed);
    return r.run!(point as never) as number;
  };
  const near = (got: number, want: number) =>
    expect(Math.abs(got - want)).toBeLessThanOrEqual(
      1e-9 * Math.max(Math.abs(want), 1e-300)
    );

  test('a closed form that holds a NaN: the quadrature', () => {
    // The engine's closed form is `If(0 < a, NaN)`.
    const e = (f: Json, lo: Json, hi: Json) => I(f, lo, hi);
    const ta = ['Multiply', 't', ['Exp', ['Negate', ['Multiply', 'a', 't']]]];
    for (const [a, want] of [
      [0.5, 4],
      [1, 1],
      [2, 0.25],
      [10, 0.01],
    ])
      near(run(e(ta, 0, 'PositiveInfinity'), { a }, false), want);
    near(
      run(
        e(
          [
            'Multiply',
            ['Power', 't', 2],
            ['Exp', ['Negate', ['Multiply', 'a', 't']]],
          ],
          0,
          'PositiveInfinity'
        ),
        { a: 2 },
        false
      ),
      0.25
    );
    near(
      run(
        e(
          ['Multiply', 't', ['Exp', ['Multiply', 'a', 't']]],
          'NegativeInfinity',
          0
        ),
        { a: 2 },
        false
      ),
      -0.25
    );
    // With no parameter the closed form is a number.
    expect(
      run(
        e(['Multiply', 't', ['Exp', ['Negate', 't']]], 0, 'PositiveInfinity'),
        {},
        true
      )
    ).toBe(1);
  });

  test('a divisor with a new factor: the quadrature', () => {
    // prettier-ignore
    const cases: [Json, Point, number][] = [
      [I(['Divide', ['Sin', ['Multiply', 'a', 't']], ['Sqrt', ['Add', 1, ['Power', 'a', 2]]]], 0, 'x'), { x: 2, a: 1e-9 }, 2e-9],
      [I(['Divide', ['Sin', ['Multiply', 'a', 't']], ['Sqrt', ['Add', 1, ['Power', 'a', 2]]]], 0, 'x'), { x: 2, a: 0 }, 0],
      [I(['Divide', ['Exp', ['Multiply', 'a', 't']], ['Add', 2, 'a']], 0, 'x'), { x: 2, a: 1e-9 }, 1.0000000005],
      [I(['Divide', ['Cos', ['Multiply', 'a', 't']], ['Add', 1, ['Power', 'a', 2]]], 0, 'x'), { x: 2, a: 0 }, 2],
      [I(['Divide', ['Power', 't', 'a'], 'a'], 1, 2), { a: -1 }, -Math.LN2],
      [I(['Divide', ['Power', 'a', 't'], 'a'], 0, 'x'), { x: 2, a: 1 }, 2],
      [I(['Multiply', ['W', 1], ['Cos', ['Multiply', 'a', 't']]], 0, 'x'), { x: 2, a: 0 }, 2],
      [I(['F', 't'], 0, 'x'), { x: 2, a: 0 }, 2],
    ];
    for (const [json, point, want] of cases)
      near(run(json, point, false), want);
  });

  test('a divisor of the integrand in an arm, or under an exponent that is not a number, allows none: the quadrature', () => {
    engine.declare('y', 'real');
    engine.declare('b', 'real');
    const cos: Json = ['Cos', ['Multiply', 'a', 't']];
    const inv: Json = ['Divide', 1, 'a'];
    // prettier-ignore
    const cases: [Json, Point, number][] = [
      // The integrand is Cos(a·t) at y = −1: 2 at a = 0; the closed form
      // divides by a.
      [I(['Multiply', ['If', ['Greater', 'y', 0], inv, 1], cos], 0, 'x'), { x: 2, a: 0, y: -1 }, 2],
      [I(['Add', cos, ['If', ['Greater', 'y', 0], inv, 0]], 0, 'x'), { x: 2, a: 0, y: -1 }, 2],
      [I(['Multiply', ['Which', ['Greater', 'y', 0], inv, 'True', 1], cos], 0, 'x'), { x: 2, a: 0, y: -1 }, 2],
      // a^(−b) at b = −2 is a², not a divisor.
      [I(['Multiply', ['Power', 'a', ['Negate', 'b']], cos], 0, 'x'), { x: 2, a: 0, b: -2 }, 0],
    ];
    for (const [json, point, want] of cases)
      near(run(json, point, false), want);
  });

  test('a factor of library constants needs no match: the closed form', () => {
    // prettier-ignore
    const cases: Json[] = [
      I(['Sin', ['Multiply', 'Pi', 't']], 0, 'x'),
      I(['Cos', ['Multiply', 2, 'Pi', 't']], 0, 'x'),
      I(['Exp', ['Multiply', 'Pi', 't']], 0, 'x'),
      I(['Cos', ['Multiply', 'ExponentialE', 't']], 0, 'x'),
      I(['Power', ['Add', ['Multiply', 'Pi', 't'], 1], 2], 0, 'x'),
      I(['Multiply', 't', ['Sin', ['Multiply', 'Pi', 't']]], 0, 'x'),
      I(['Cos', ['Multiply', 'c', 't']], 0, 'x'),
      I(['Divide', ['Exp', ['Divide', 1, 't']], ['Power', 't', 2]], -2, -1),
    ];
    for (const json of cases) {
      const got = run(json, { x: 0.7 }, true);
      const want = engine
        .box(json as never)
        .subs({ x: 0.7 })
        .evaluate()
        .N().re;
      expect(Math.abs(got - want)).toBeLessThanOrEqual(1e-12);
    }
  });

  test('the error of a closed form is absolute', () => {
    // Each value is that of the existing compiler; the relative errors are
    // 5.2e-9, 2.8e-7 and 0.14.
    const gaussian = [
      'Multiply',
      ['Divide', 1, ['Multiply', 's', ['Sqrt', ['Multiply', 2, 'Pi']]]],
      I(
        [
          'Exp',
          [
            'Multiply',
            ['Rational', -1, 2],
            ['Divide', ['Power', 'Z', 2], ['Power', 's', 2]],
          ],
        ],
        'NegativeInfinity',
        'x',
        'Z'
      ),
    ];
    // prettier-ignore
    const cases: [Json, Point, number][] = [
      [I(['Sin', 't'], 0, 'x'), { x: 1e-4 }, 4.999999995833333e-9],
      [I(['Multiply', ['Power', 't', 2], ['Exp', ['Negate', 't']]], 0, 'x'), { x: 1e-3 }, 3.330834333055615e-10],
      [gaussian, { x: -8, s: 1 }, 6.220960574271784e-16],
    ];
    for (const [json, point, want] of cases)
      expect(Math.abs(run(json, point, true) - want)).toBeLessThanOrEqual(
        1e-15
      );
  });
});

describe('IR integrals and derivatives: the dependencies of a closed form, again', () => {
  const engine = new ComputeEngine();
  engine.declare('x', 'real');
  engine.declare('a', 'real');
  engine.assign('a', 2);
  engine.declare('t', 'real');
  engine.assign('t', 5);
  engine.declare('w', 'function');
  engine.assign('w', engine.box(['Function', ['Multiply', 'a', 'u'], 'u']));
  const deps = (json: Json) => {
    const out = new Set<string>();
    compile(engine.box(json as never), { ...IR, symbolDeps: out });
    return [...out].sort();
  };
  test('a name that a function body reads, bound at the site: kept', () => {
    // `w` reads the global `a` (2); the code holds 2.
    expect(
      deps(['Sum', I(['w', 's'], 0, 'x', 's'), ['Limits', 'a', 1, 3]])
    ).toEqual(['a', 'w']);
    expect(
      deps(['Sum', ['D', ['w', 'x'], 'x'], ['Limits', 'a', 1, 3]])
    ).toEqual(['a', 'w']);
  });
  test('the variable of the integral: not a dependency', () => {
    expect(deps(I(['Power', 't', 2], 0, 'x'))).toEqual([]);
  });
});
