import { ComputeEngine } from '../../src/compute-engine';
import { compile, canCompile } from '../../src/compile';
import {
  CancellationError,
  withAmbientDeadline,
} from '../../src/common/interruptible';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';
import * as GaussKronrodModule from '../../src/compute-engine/numerics/gauss-kronrod';
import * as MonteCarloModule from '../../src/compute-engine/numerics/monte-carlo';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression as BoxedExpression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// Slice 2 of docs/plans/2026-11-11-structured-numeric-calculus.md on the
// structured route of the JavaScript compiler (the `numeric-kernel`
// profile): a definite `Integrate` with no closed form is the operation
// `routine` `integrate`, written as the call `_SYS.integrate` of the
// existing compiler with the integrand as a closure of its variable.
//
// Each program is compiled with the profile and with the existing compiler
// (`cse: false, constantFold: false`). At each input the two results must
// be the same double (`Object.is`), and the quadrature must evaluate the
// integrand at the same abscissas, in the same order, with the same
// doubles: the abscissas and the values are recorded where the runtime
// calls `adaptiveQuadrature()` and `monteCarloEstimate()`, which the
// compiled code reaches through `_SYS.integrate`. The interpreter's value
// (`N()`) agrees within the tolerance of a quadrature.

type Json = MathJsonExpression;
type Vars = Record<string, number | number[] | number[][]>;

const EXISTING = { cse: false, constantFold: false, fallback: false } as const;
const PROFILE = { profile: 'numeric-kernel', fallback: false } as const;

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  for (const name of ['x', 'y', 'a', 'b']) ce.declare(name, 'real');
  ce.declare('n', 'integer');
  ce.declare('L', 'list<real>');
  ce.declare('w', 'number');
  ce.declare('M', 'matrix<2x2>');
  ce.assign('k', 3);
  ce.assign('C', ce.box(['List', 1.5, 2, 3]));
  ce.parse('h(u) := \\sqrt{1 + u^4}').evaluate();
  ce.parse('q(y) := \\int_0^y \\sqrt{1 + t^4} dt').evaluate();
  return ce;
}

function run(result: CompilationResult<'javascript'>, vars: Vars): unknown {
  return (result.run as unknown as (v: Vars) => unknown)(vars);
}

/** Within `tolerance` of `expected`, relative above 1 and absolute below. */
function close(value: unknown, expected: number, tolerance = 1e-7): boolean {
  return (
    typeof value === 'number' &&
    (Object.is(value, expected) ||
      Math.abs(value - expected) <=
        tolerance * Math.max(1, Math.abs(expected)))
  );
}

/** The interpreter's value of `expr` at `vars`: `N()` gives a number, or a
 *  `Measurement` of the integral and its error, whose real part is read. */
function interpreted(expr: BoxedExpression, vars: Vars): number {
  const ce = expr.engine;
  const value = expr
    .subs(
      Object.fromEntries(
        Object.entries(vars).map(([k, v]) => [
          k,
          Array.isArray(v)
            ? ce.box([
                'List',
                ...v.map((e): Json => (Array.isArray(e) ? ['List', ...e] : e)),
              ])
            : ce.number(v),
        ])
      )
    )
    .N();
  if (isNumber(value)) return value.re;
  const re = (value as unknown as { re?: unknown }).re;
  return typeof re === 'number' ? re : NaN;
}

/**
 * Run `fn` with `adaptiveQuadrature()` and `monteCarloEstimate()` replaced
 * by the same routines with an integrand that records each abscissa and
 * the value there, in the order of the calls. The compiled `_SYS.integrate`
 * calls them through their module, so the replacement reaches it
 * (`countIntegrandEvals()` in `compile-integrate.test.ts`).
 */
function recorded<T>(fn: () => T): { value: T; samples: number[] } {
  const gk = GaussKronrodModule as {
    adaptiveQuadrature: typeof GaussKronrodModule.adaptiveQuadrature;
  };
  const mc = MonteCarloModule as {
    monteCarloEstimate: typeof MonteCarloModule.monteCarloEstimate;
  };
  const quadrature = gk.adaptiveQuadrature;
  const monteCarlo = mc.monteCarloEstimate;
  const samples: number[] = [];
  const record =
    (f: (x: number) => number) =>
    (x: number): number => {
      const y = f(x);
      samples.push(x, y);
      return y;
    };
  gk.adaptiveQuadrature = (f, ...rest) => quadrature(record(f), ...rest);
  mc.monteCarloEstimate = (f, ...rest) => monteCarlo(record(f), ...rest);
  try {
    return { value: fn(), samples };
  } finally {
    gk.adaptiveQuadrature = quadrature;
    mc.monteCarloEstimate = monteCarlo;
  }
}

const Pow = (base: Json, exponent: Json): Json => ['Power', base, exponent];
const Int = (body: Json, lower: Json, upper: Json, v = 't'): Json => [
  'Integrate',
  body,
  ['Limits', v, lower, upper],
];
/** `√(c + v⁴)`, an integrand with no closed form. */
const F = (v = 't', c: Json = 1): Json => ['Sqrt', ['Add', c, Pow(v, 4)]];

const POINTS: Vars[] = [
  { x: 0.7, y: -1.25, a: 0.5, b: 2, n: 2, w: 3, L: [0.5, 1.5], M: [[1, 2.5], [3, -4]] },
  { x: -1.3, y: 0.4, a: -2.25, b: 0.1, n: 0, w: -0.5, L: [], M: [[0.5, -1], [2, 0.25]] },
  { x: 2, y: 3, a: 1.75, b: -0.6, n: 4, w: 1.25, L: [-1, 2, 0.25], M: [[-2, 0], [1.5, 7]] },
];

type Program = {
  readonly name: string;
  readonly json: Json;
  /** The integrand alone, as a program of its variable `t`: its doubles
   *  must be the same on both compilers at many points. */
  readonly integrand?: Json;
  /** A tolerance of the comparison with the interpreter. */
  readonly tolerance?: number;
};

const PROGRAMS: Program[] = [
  {
    name: 'constant bounds',
    json: Int(F(), 0, 1),
    integrand: F(),
  },
  { name: 'input bounds', json: Int(F(), 'a', 'b') },
  {
    name: 'bounds that are expressions',
    json: Int(F(), ['Sin', 'a'], ['Add', 'b', 1]),
  },
  {
    name: 'an infinite upper bound',
    json: Int(['Exp', ['Negate', Pow('t', 4)]], 0, 'PositiveInfinity'),
  },
  {
    name: 'two infinite bounds',
    json: Int(
      ['Exp', ['Negate', Pow('t', 4)]],
      'NegativeInfinity',
      'PositiveInfinity'
    ),
  },
  { name: 'reversed bounds', json: Int(F(), 'b', 'a') },
  {
    name: 'two limits, the inner bound reads the outer variable',
    json: [
      'Integrate',
      ['Sin', ['Multiply', 'u', Pow('v', 3)]],
      ['Limits', 'u', 0, 1],
      ['Limits', 'v', 0, 'u'],
    ],
  },
  {
    name: 'two limits whose variables have the names of inputs',
    json: [
      'Integrate',
      ['Sin', ['Multiply', 'x', Pow('y', 3)]],
      ['Limits', 'x', 0, 1],
      ['Limits', 'y', 0, 'x'],
    ],
  },
  {
    name: 'three limits',
    json: [
      'Integrate',
      ['Sin', ['Multiply', 'u', 'v', Pow('w', 3)]],
      ['Limits', 'u', 0, 1],
      ['Limits', 'v', 0, 'u'],
      ['Limits', 'w', 0, 1],
    ],
  },
  {
    name: 'a nested integral with no closed form',
    json: Int(Int(['Sqrt', ['Add', 1, Pow('s', 4), Pow('t', 2)]], 0, 't', 's'), 0, 1),
  },
  {
    name: 'a nested integral with a closed form: the panels of the tree',
    json: Int(Int(['Sin', ['Multiply', 's', Pow('t', 3)]], 0, 't', 's'), 0, 1),
  },
  {
    name: 'an integral in a bound of an integral',
    json: Int(F(), 0, Int(['Exp', ['Negate', Pow('s', 4)]], 0, 'a', 's')),
  },
  {
    name: 'an integrand that reads an input and a captured value',
    json: Int(['Sin', ['Multiply', 'k', 'x', Pow('t', 3)]], 0, 1),
  },
  {
    name: 'an integrand that calls a helper',
    json: Int(['h', 't'], 0, 'a'),
    integrand: ['h', 't'],
  },
  {
    // `C` is a constant of the program, declared once outside the closure.
    name: 'an integrand that reads a captured list',
    json: Int(['Add', F(), ['Multiply', ['At', 'C', 2], 't']], 0, 'x'),
  },
  {
    // An element of a matrix, with two indexes and with a row read.
    name: 'an integrand that reads an element of a matrix',
    json: Int(['Multiply', ['At', 'M', 1, 2], F()], 0, 'x'),
  },
  {
    name: 'an integrand that reads an element of a row of a matrix',
    json: Int(['Add', F(), ['Multiply', ['At', ['At', 'M', 2], 1], 't']], 0, 'x'),
  },
  {
    // A name declared `number` is a real in the strict mode.
    name: 'an integrand that reads a name declared number',
    json: Int(['Multiply', 'w', F()], 0, 'x'),
  },
  {
    // A node that reads no input is folded; it is not the integrand.
    name: 'an integrand with a node that reads no input',
    json: Int(['Add', ['Floor', ['Sqrt', 10]], F()], 0, 'x'),
  },
  {
    // Fewer than 4 written-out terms: the existing emitter writes one chain
    // with no exit, and evaluates every term, as the route does.
    name: 'an integral in the three written-out terms of a Sum',
    json: ['Sum', Int(F('t', 'j'), 0, 1), ['Limits', 'j', 1, 3]],
  },
  // A rounding of an integral: the rule of the rounding does not read the
  // integrand, a function literal, as a constant.
  { name: 'Floor of an integral', json: ['Floor', Int(F(), 0, 'a')] },
  { name: 'Ceil of an integral', json: ['Ceil', Int(F(), 0, 'b')] },
  { name: 'Round of an integral', json: ['Round', Int(F(), 0, 'a')] },
  { name: 'Truncate of an integral', json: ['Truncate', Int(F(), 'y', 0)] },
  {
    name: 'Floor of a product with an integral',
    json: ['Floor', ['Multiply', 'x', Int(F(), 0, 'a')]],
  },
  {
    name: 'a helper whose body integrates',
    json: ['Add', ['q', 'x'], ['q', 'a']],
  },
  {
    name: 'an integral in a branch of an If',
    json: ['If', ['Less', 'x', 0], Int(F(), 0, 'x'), 0],
  },
  {
    name: 'an integral as an operand',
    json: ['Add', ['Divide', 'x', Int(F(), 0, 1)], ['Multiply', 'y', Int(F(), 0, 'a')]],
  },
  {
    name: 'a Function integrand',
    json: Int(['Function', F(), 't'], 0, 1),
  },
  {
    name: 'an integrand that reads a local of a block',
    json: [
      'Block',
      ['Assign', 'c', Pow('x', 2)],
      Int(F('t', 'c'), 0, 1),
    ],
  },
  {
    name: 'an integral in the function of a Map',
    json: ['Reduce', ['Map', ['Function', Int(F(), 0, 's'), 's'], 'L'], 'Add'],
  },
  {
    name: 'an integral in a function literal that is applied',
    json: ['Apply', ['Function', Int(F(), 0, 's'), 's'], 'a'],
  },
  {
    name: 'two integrals as operands of Max',
    json: ['Max', Int(F(), 0, 'a'), Int(F(), 0, 'b')],
  },
];

describe('STRUCTURED CALCULUS: quadrature, against the existing compiler', () => {
  const ce = engine();
  for (const { name, json, integrand, tolerance } of PROGRAMS)
    test(name, () => {
      const expr = ce.box(json);
      const existing = compile(expr, EXISTING);
      const profile = compile(expr, PROFILE);
      expect(profile.success).toBe(true);
      expect(profile.profile).toBe('numeric-kernel');
      let samples = 0;
      for (const vars of POINTS) {
        const a = recorded(() => run(existing, vars));
        const b = recorded(() => run(profile, vars));
        expect([name, vars, b.value]).toEqual([name, vars, a.value]);
        expect(Object.is(a.value, b.value)).toBe(true);
        expect(b.samples.length).toBe(a.samples.length);
        expect(b.samples).toEqual(a.samples);
        samples += b.samples.length;
        const value = interpreted(expr, vars);
        expect([name, vars, value, close(b.value, value, tolerance)]).toEqual(
          [name, vars, value, true]
        );
      }
      expect(samples).toBeGreaterThan(0);
      expect(canCompile(expr, PROFILE)).toMatchObject({ ok: true });
      // The routine keeps state between calls and can sample the entropy
      // source: the calls are not independent, and the code is not
      // portable (`isShippableCode()` refuses `_SYS.integrate`).
      expect(profile.pure).toBe(false);
      expect(profile.shippable).toBe(false);
      expect(existing.shippable).toBe(false);
      if (integrand !== undefined) {
        const c = engine();
        c.declare('t', 'real');
        const e = compile(c.box(integrand), EXISTING);
        const p = compile(c.box(integrand), PROFILE);
        for (let i = -500; i <= 500; i++) {
          const t = i / 97 + 1e-9 * Math.sin(i);
          expect(Object.is(run(p, { t }), run(e, { t }))).toBe(true);
        }
      }
    });
});

describe('STRUCTURED CALCULUS: the code of the routine', () => {
  const ce = engine();
  test('the closure, the bounds and the panels', () => {
    const code = compile(ce.box(Int(F(), 0, 'a')), PROFILE).code;
    expect(code).toMatch(
      /_SYS\.integrate\(\(_tv\d+\) => \{ .*return .*; \}, 0, _\.a\)/
    );
    // Two levels: four panels on each, as the existing compiler writes.
    const nested = compile(
      ce.box([
        'Integrate',
        ['Sin', ['Multiply', 'u', Pow('v', 3)]],
        ['Limits', 'u', 0, 1],
        ['Limits', 'v', 0, 'u'],
      ]),
      PROFILE
    ).code;
    expect(nested.match(/, 4\)/g)?.length).toBe(2);
  });

  test('a root Function: the integrand reads a parameter', () => {
    const expr = ce.box([
      'Function',
      Int(F('t', 'u'), 0, 1),
      'u',
    ]);
    const existing = compile(expr, EXISTING);
    const profile = compile(expr, PROFILE);
    for (const u of [0.5, 2, 7.25]) {
      const call = (r: CompilationResult<'javascript'>) =>
        (r.run as unknown as (u: number) => number)(u);
      const a = recorded(() => call(existing));
      const b = recorded(() => call(profile));
      expect(Object.is(a.value, b.value)).toBe(true);
      expect(b.samples).toEqual(a.samples);
    }
  });

  test('a root Function: the integrand reads the index of a Loop', () => {
    const expr = ce.box([
      'Function',
      [
        'Block',
        ['Declare', 's', "'real'", 0],
        [
          'Loop',
          ['Assign', 's', ['Add', 's', Int(F('t', 'j'), 0, 1)]],
          ['Element', 'j', ['Range', 1, 'm']],
        ],
        's',
      ],
      ['Typed', 'm', "'integer'"],
    ]);
    const existing = compile(expr, EXISTING);
    const profile = compile(expr, PROFILE);
    expect(profile.code).toContain('_SYS.integrate(');
    for (const m of [0, 1, 3]) {
      const call = (r: CompilationResult<'javascript'>) =>
        (r.run as unknown as (m: number) => number)(m);
      const a = recorded(() => call(existing));
      const b = recorded(() => call(profile));
      expect(Object.is(a.value, b.value)).toBe(true);
      expect(b.samples).toEqual(a.samples);
    }
  });

  test('the dependencies: the helpers and the captured values of the integrand', () => {
    const deps = (options: object): string[] => {
      const symbolDeps = new Set<string>();
      compile(ce.box(Int(['Multiply', 'k', ['h', 't']], 0, 'x')), {
        ...options,
        symbolDeps,
      });
      return [...symbolDeps].sort();
    };
    expect(deps(PROFILE)).toEqual(['h', 'k']);
    expect(deps(EXISTING)).toEqual(['h', 'k']);
  });
});

describe('STRUCTURED CALCULUS: an integral that does not converge, a deadline', () => {
  test('the Monte Carlo fallback with the same entropy source: the same doubles', () => {
    const ce = engine();
    // `∫₀¹ sin(1/t)/t dt` does not converge to the tolerance: the outermost
    // integral samples 10⁷ points from the entropy source of the engine.
    let state = 1;
    const reset = () => {
      state = 1;
    };
    ce.effects = {
      entropy: {
        random: () => {
          // A linear congruential sequence, the same for both calls.
          state = (state * 48271) % 2147483647;
          return state / 2147483647;
        },
      },
    };
    const expr = ce.parse('\\int_0^1 \\frac{\\sin(1/t)}{t} dt');
    const existing = compile(expr, EXISTING);
    const profile = compile(expr, PROFILE);
    reset();
    const a = recorded(() => run(existing, {}));
    reset();
    const b = recorded(() => run(profile, {}));
    expect(Object.is(a.value, b.value)).toBe(true);
    expect(b.samples.length).toBe(a.samples.length);
    expect(b.samples).toEqual(a.samples);
  }, 60000);

  test('an expired ambient deadline: the same error on both', () => {
    // A compiled function called by a numeric routine that has a deadline
    // (an interpreted Monte Carlo quadrature, a Richardson extrapolation)
    // inherits it as the ambient deadline (`withAmbientDeadline()`).
    const ce = engine();
    const expr = ce.box(Int(F(), 0, 'a'));
    for (const options of [EXISTING, PROFILE]) {
      const result = compile(expr, options);
      let thrown: unknown;
      try {
        withAmbientDeadline(Date.now() - 1, () => run(result, { a: 2 }));
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(CancellationError);
      expect((thrown as CancellationError).cause).toBe('timeout');
    }
  });
});

describe('STRUCTURED CALCULUS: what quadrature declines', () => {
  const ce = engine();
  const cases: [string, Json, string, object?][] = [
    [
      'the Monte Carlo estimator (quadrature: monte-carlo)',
      Int(F(), 0, 1),
      "the option quadrature is 'monte-carlo'",
      { quadrature: 'monte-carlo' },
    ],
    [
      'an integrand that the existing compiler computes again in log space',
      Int(['Multiply', Pow('t', 100), ['Exp', ['Negate', Pow('t', 2)]]], 0, 1),
      'is computed again in log space',
    ],
    [
      'a bound that reads the variable of its clause',
      Int(F('x'), 0, 'x', 'x'),
      'reads the name x of a variable of that clause or of a later one',
    ],
    [
      'an integrand with a head that the profile does not have',
      Int(['LambertW', Pow('t', 4)], 0, 1),
      'unsupported head LambertW',
    ],
    [
      'an integrand that draws',
      Int(['Add', F(), ['Random']], 0, 1),
      'is not pure',
    ],
    [
      'the complex mode',
      Int(F(), 0, 'a'),
      'Integrate in the complex mode is not in the profile',
      { mode: 'complex' },
    ],
    // The existing compiler stops a sum at its first NaN term, and does not
    // sample the integrands of the later terms.
    [
      'an integral in the written-out terms of a Sum of 4 terms',
      ['Sum', Int(F('t', 'j'), 0, 1), ['Limits', 'j', 1, 4]],
      'has a term that can throw or integrates numerically',
    ],
    [
      'an integral in the loop of a Product',
      ['Product', Int(F('t', 'j'), 0, 1), ['Limits', 'j', 1, 'n']],
      'has a term that can throw or integrates numerically',
    ],
    [
      'a Sum of 4 terms of a helper whose body integrates',
      ['Sum', ['q', 'j'], ['Limits', 'j', 1, 4]],
      'has a term that can throw or integrates numerically',
    ],
    [
      // A named callback: `Map(q, …)` calls the helper `q` once per element.
      'a Sum whose term maps a helper that integrates',
      [
        'Sum',
        ['Add', ['Sqrt', 'x'], ['Sum', ['Map', 'q', ['Range', 1, 'j']]]],
        ['Limits', 'j', 1, 'n'],
      ],
      'has a term that can throw or integrates numerically',
    ],
  ];
  for (const [name, json, message, options] of cases)
    test(name, () => {
      const expr = ce.box(json);
      expect(() => compile(expr, { ...PROFILE, ...options })).toThrow(message);
      expect(canCompile(expr, { ...PROFILE, ...options })).toMatchObject({
        ok: false,
        diagnostic: { code: 'outside-profile' },
      });
      // The existing compiler compiles each one.
      expect(compile(expr, { ...EXISTING, ...options }).success).toBe(true);
    });

  test('an integrand that reads a value of the host', () => {
    // `vars: { u: … }` with a source that is not the read of an input: the
    // existing code reads it at each sample. A host call has the same
    // refusal (slice 5 of the design note).
    const c = engine();
    c.declare('u', 'real');
    const expr = c.box(Int(['Add', F(), 'u'], 0, 1));
    const vars = { u: '__calc2Read()' };
    expect(compile(expr, { ...EXISTING, vars }).code).toContain(
      '_SYS.integrate('
    );
    expect(() => compile(expr, { ...PROFILE, vars })).toThrow(
      'runs code of the host'
    );
    // An integrand that calls a function of the host: the engine does not
    // know that it is pure, and the search for a closed form refuses it.
    const g = c.box(Int(['Add', ['g', 't'], 1], 0, 1));
    expect(() =>
      compile(g, { ...PROFILE, functions: { g: (t: number) => t * t } })
    ).toThrow('is not pure');
  });

  test('a Sum whose term can throw', () => {
    // At `m = 0` the first term is `Mod(1, 0/0)`, `NaN`, and the existing
    // compiler stops the sum there; the second, `Mod(1, 1/0)`, throws a
    // `RangeError` in `_SYS.floorMod`.
    const c = engine();
    c.declare('m', 'integer');
    const expr = c.box(['Sum', ['Mod', 1, ['Divide', 'j', 'm']], ['Limits', 'j', 0, 'n']]);
    expect(run(compile(expr, EXISTING), { n: 3, m: 0 })).toBeNaN();
    expect(() => compile(expr, PROFILE)).toThrow(
      'has a term that can throw or integrates numerically (mod(1, j / m))'
    );
    expect(canCompile(expr, PROFILE)).toMatchObject({
      ok: false,
      diagnostic: { code: 'outside-profile' },
    });
  });

  test('a Sum or a Product of a Mod that cannot throw, or throws in every term', () => {
    // `_SYS.floorMod` throws only for an operand beyond ±(2^53 − 1): an
    // index of the aggregate and an integer literal are safe, and an input
    // is the same in every term, so the first term throws on both compilers
    // or none does. `m = 0` gives `NaN`, `m = 2^60` and `m = ∞` throw.
    const c = engine();
    c.declare('m', 'integer');
    const call = (f: () => unknown): unknown => {
      try {
        return f();
      } catch (e) {
        return (e as Error).name;
      }
    };
    for (const [json, points] of [
      [['Sum', ['Mod', 'k', 3], ['Limits', 'k', 1, 'n']], [{ n: 10 }, { n: 0 }, { n: 1000 }]],
      [['Sum', ['Multiply', 'x', ['Mod', 'k', 2]], ['Limits', 'k', 1, 'n']], [{ n: 7, x: 0.3 }, { n: 200, x: -1.7 }]],
      [['Product', ['Add', 1, ['Mod', 'k', 2]], ['Limits', 'k', 1, 'n']], [{ n: 9 }, { n: 40 }]],
      [
        ['Sum', ['Mod', 'k', 'm'], ['Limits', 'k', 1, 'n']],
        [{ n: 5, m: 0 }, { n: 5, m: -3 }, { n: 5, m: 2 ** 60 }, { n: 5, m: Infinity }, { n: 5, m: 3 }],
      ],
      [['Sum', ['Mod', 'k', 'm'], ['Limits', 'k', 1, 5]], [{ m: 0 }, { m: -3 }, { m: 2 ** 60 }]],
    ] as [Json, Vars[]][]) {
      const expr = c.box(json);
      const existing = compile(expr, EXISTING);
      const profile = compile(expr, PROFILE);
      for (const vars of points) {
        const a = call(() => run(existing, vars));
        const b = call(() => run(profile, vars));
        expect([json, vars, Object.is(a, b), b]).toEqual([json, vars, true, a]);
      }
    }
  });

  test('the witness unrolled: a flat chain below 4 terms, a refusal from 4', () => {
    // The existing emitter writes an unrolled sum of fewer than
    // `UNROLL_STATEMENT_MIN_TERMS` (4) terms as one chain with no exit, so
    // both compilers evaluate every term; from 4 terms, and in a loop, it
    // stops at the first `NaN` term. The index of an unrolled term is a
    // literal that varies across the terms.
    const c = engine();
    c.declare('m', 'real');
    c.declare('r', '(real) -> real');
    c.assign('r', c.box(['Function', ['Mod', 'u', 3], 'u']));
    const call = (f: () => unknown): unknown => {
      try {
        return f();
      } catch (e) {
        return (e as Error).name;
      }
    };
    const witness = (upper: Json): Json => [
      'Sum',
      ['Mod', 1, ['Divide', 'j', 'm']],
      ['Limits', 'j', 0, upper],
    ];
    for (const [json, points] of [
      [witness(1), [{ m: 0 }, { m: 2 }]],
      [witness(2), [{ m: 0 }, { m: 2 }]],
      [['Sum', ['r', 'k'], ['Limits', 'k', 1, 3]], [{}]],
    ] as [Json, Vars[]][]) {
      const expr = c.box(json);
      const existing = compile(expr, EXISTING);
      const profile = compile(expr, PROFILE);
      for (const vars of points) {
        const a = call(() => run(existing, vars));
        const b = call(() => run(profile, vars));
        expect([json, vars, Object.is(a, b), b]).toEqual([json, vars, true, a]);
      }
    }
    for (const json of [
      witness(3),
      witness(9),
      witness('n'),
      ['Sum', ['r', 'k'], ['Limits', 'k', 1, 10]],
      ['Sum', ['r', 'k'], ['Limits', 'k', 1, 'n']],
    ] as Json[]) {
      const expr = c.box(json);
      expect(() => compile(expr, PROFILE)).toThrow(
        'has a term that can throw or integrates numerically'
      );
      expect(compile(expr, EXISTING).success).toBe(true);
    }
    // The existing compiler stops after the first term (`0/0`) of 4 terms.
    expect(run(compile(c.box(witness(3)), EXISTING), { m: 0 })).toBeNaN();
  });

  test('a rounding of the variable, when the variable has a value', () => {
    // With `t := 1/3`, `t` is still the variable of the integral (the
    // canonical form takes a symbol with a value as the variable): the rule
    // of `Floor` reads it as the bound name, not as the constant 1/3, and
    // the code floors the abscissa, as the existing compiler does.
    for (const [value, json] of [
      [['Rational', 1, 3], Int(['Add', ['Floor', 't'], F()], 0, 'x')],
      [0.5, Int(['Multiply', ['Floor', ['Multiply', 2, 't']], F()], 0, 'x')],
    ] as [Json, Json][]) {
      const c = engine();
      c.assign('t', c.box(value));
      const expr = c.box(json);
      const existing = compile(expr, EXISTING);
      const profile = compile(expr, PROFILE);
      expect(profile.code).toContain('Math.floor(');
      for (const x of [0.5, 1.7, 2.5, -1.2])
        expect(Object.is(run(profile, { x }), run(existing, { x }))).toBe(true);
    }
  });

  test('the bigint mode: the lane analysis declines on both', () => {
    const expr = ce.box(Int(F(), 0, 'n'));
    expect(() => compile(expr, { ...EXISTING, mode: 'bigint' })).toThrow();
    expect(() => compile(expr, { ...PROFILE, mode: 'bigint' })).toThrow();
  });
});
