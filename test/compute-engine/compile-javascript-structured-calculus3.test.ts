import { ComputeEngine } from '../../src/compute-engine';
import { compile, canCompile } from '../../src/compile';
import {
  CancellationError,
  withAmbientDeadline,
} from '../../src/common/interruptible';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';
import * as GaussKronrodModule from '../../src/compute-engine/numerics/gauss-kronrod';
import * as MonteCarloModule from '../../src/compute-engine/numerics/monte-carlo';
import * as NumericModule from '../../src/compute-engine/numerics/numeric';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression as BoxedExpression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// Slices 3 and 4 of docs/plans/2026-11-11-structured-numeric-calculus.md on
// the structured route of the JavaScript compiler (the `numeric-kernel`
// profile): a derivative with no closed form is the routine `derivative`
// (`_SYS.nd`), a `Limit` the routine `limit` (`_SYS.limit`), an integrand
// that the existing compiler computes again in log space the alternative of
// an `integrate` (`_SYS.finiteOr`), and `quadrature: 'monte-carlo'` the
// routine `integrate-sampled` (`_SYS.integrateMC`).
//
// Each program is compiled with the profile and with the existing compiler
// (`cse: false, constantFold: false`). At each input the two results must
// be the same double (`Object.is`), and the routines must evaluate the body
// at the same points, in the same order, with the same doubles: the points
// and the values are recorded where the runtime calls
// `centeredDiffHigherOrder()`, `limit()`, `adaptiveQuadrature()` and
// `monteCarloEstimate()`. The interpreter's value (`N()`) agrees within the
// tolerance of the routine where it is a number (it keeps a derivative of a
// function with no derivative rule unevaluated, a caveat).

type Json = MathJsonExpression;
type Vars = Record<string, number | number[] | number[][]>;

const EXISTING = { cse: false, constantFold: false, fallback: false } as const;
const PROFILE = { profile: 'numeric-kernel', fallback: false } as const;

/** The state of the entropy source of the engines of the tests: a linear
 *  congruential sequence, reset before each call (`reseed()`), so that an
 *  integral that does not converge, which samples points from the source,
 *  draws the same points on both compilers. */
let entropyState = 1;
const reseed = () => {
  entropyState = 1;
};

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.effects = {
    entropy: {
      random: () => {
        entropyState = (entropyState * 48271) % 2147483647;
        return entropyState / 2147483647;
      },
    },
  };
  for (const name of ['x', 'y', 'a', 'b']) ce.declare(name, 'real');
  ce.declare('n', 'integer');
  ce.declare('M', 'matrix<2x2>');
  ce.assign('k', 3);
  ce.assign('c', 2);
  ce.parse('z(t) := \\zeta(t) \\cdot t').evaluate();
  ce.parse('p(u) := u^2 + 1').evaluate();
  return ce;
}

function run(result: CompilationResult<'javascript'>, vars: Vars): unknown {
  return (result.run as unknown as (v: Vars) => unknown)(vars);
}

/** Within `tolerance` of `expected`, relative above 1 and absolute below. */
function close(value: unknown, expected: number, tolerance: number): boolean {
  return (
    typeof value === 'number' &&
    (Object.is(value, expected) ||
      Math.abs(value - expected) <=
        tolerance * Math.max(1, Math.abs(expected)))
  );
}

/** The interpreter's value of `expr` at `vars` (`N()`), or `undefined`
 *  when it is not a real number (an unevaluated derivative, a complex
 *  number). */
function interpreted(expr: BoxedExpression, vars: Vars): number | undefined {
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
  // A complex value (a power of a negative abscissa) is not compared: the
  // real lane of the `strict` mode has `NaN` there.
  if (isNumber(value)) return value.im === 0 ? value.re : undefined;
  const parts = value as unknown as { re?: unknown; im?: unknown };
  return typeof parts.re === 'number' && (parts.im ?? 0) === 0
    ? parts.re
    : undefined;
}

/** What the routines saw: the number of evaluations of a body, and a
 *  digest of the points and the values in order (a Monte Carlo estimate
 *  evaluates its integrand 10⁷ times). */
type Samples = { count: number; digest: string };

/**
 * Run `fn` with the stencil, the extrapolation of a limit, the quadrature
 * and the Monte Carlo estimator replaced by the same routines with a body
 * that records each point and the value there, in the order of the calls.
 * The compiled `_SYS.nd`, `_SYS.limit`, `_SYS.integrate` and
 * `_SYS.integrateMC` call them through their module.
 */
function recorded<T>(fn: () => T): { value: T; samples: Samples } {
  const gk = GaussKronrodModule as {
    adaptiveQuadrature: typeof GaussKronrodModule.adaptiveQuadrature;
  };
  const mc = MonteCarloModule as {
    monteCarloEstimate: typeof MonteCarloModule.monteCarloEstimate;
  };
  const nm = NumericModule as {
    centeredDiffHigherOrder: typeof NumericModule.centeredDiffHigherOrder;
    limit: typeof NumericModule.limit;
  };
  const saved = {
    quadrature: gk.adaptiveQuadrature,
    monteCarlo: mc.monteCarloEstimate,
    stencil: nm.centeredDiffHigherOrder,
    limit: nm.limit,
  };
  let count = 0;
  // Two running digests of the points and the values, exact for one
  // sequence of doubles.
  let h1 = 0;
  let h2 = 0;
  const parts: string[] = [];
  const record =
    (f: (x: number) => number) =>
    (x: number): number => {
      const y = f(x);
      count++;
      if (parts.length < 400) parts.push(`${x}:${y}`);
      h1 = (h1 * 1.000003 + x) % 1e9;
      h2 = (h2 * 0.999997 + (Number.isFinite(y) ? y : 7)) % 1e9;
      return y;
    };
  gk.adaptiveQuadrature = (f, ...rest) => saved.quadrature(record(f), ...rest);
  mc.monteCarloEstimate = (f, ...rest) => saved.monteCarlo(record(f), ...rest);
  nm.centeredDiffHigherOrder = (f, ...rest) => saved.stencil(record(f), ...rest);
  nm.limit = (f, ...rest) => saved.limit(record(f), ...rest);
  try {
    const value = fn();
    return {
      value,
      samples: { count, digest: `${h1}|${h2}|${parts.join(',')}` },
    };
  } finally {
    gk.adaptiveQuadrature = saved.quadrature;
    mc.monteCarloEstimate = saved.monteCarlo;
    nm.centeredDiffHigherOrder = saved.stencil;
    nm.limit = saved.limit;
  }
}

const Pow = (base: Json, exponent: Json): Json => ['Power', base, exponent];
const Fn = (body: Json, v = 't'): Json => ['Function', body, v];
const Int = (body: Json, lower: Json, upper: Json, v = 't'): Json => [
  'Integrate',
  body,
  ['Limits', v, lower, upper],
];
const Zeta = (e: Json): Json => ['Zeta', e];

const POINTS: Vars[] = [
  { x: 0.7, y: -1.25, a: 0.5, b: 2, n: 2, M: [[1, 2.5], [3, -4]] },
  { x: -1.3, y: 0.4, a: -2.25, b: 0.1, n: 0, M: [[0.5, -1], [2, 0.25]] },
  { x: 2.5, y: 3, a: 1.75, b: -0.6, n: 4, M: [[-2, 0], [1.5, 7]] },
];

type Program = {
  readonly name: string;
  readonly json: Json;
  /** The tolerance of the comparison with the interpreter. */
  readonly tolerance?: number;
  readonly options?: object;
  /** The text that the code of the profile holds. */
  readonly code?: string;
  /** The runtime routine gives `NaN` at some point where the interpreter
   *  has a value, on both compilers (an issue of the existing compiler). */
  readonly nanOnBoth?: boolean;
};

function differential(programs: readonly Program[], pure: boolean) {
  const ce = engine();
  for (const { name, json, tolerance, options, code, nanOnBoth } of programs)
    test(name, () => {
      const expr = ce.box(json);
      const existing = compile(expr, { ...EXISTING, ...options });
      const profile = compile(expr, { ...PROFILE, ...options });
      expect(profile.success).toBe(true);
      expect(profile.profile).toBe('numeric-kernel');
      if (code !== undefined) {
        expect(existing.code).toContain(code);
        expect(profile.code).toContain(code);
      }
      let samples = 0;
      let compared = 0;
      for (const vars of POINTS) {
        reseed();
        const a = recorded(() => run(existing, vars));
        reseed();
        const b = recorded(() => run(profile, vars));
        expect([name, vars, b.value]).toEqual([name, vars, a.value]);
        expect(Object.is(a.value, b.value)).toBe(true);
        expect([name, vars, b.samples.count]).toEqual([name, vars, a.samples.count]);
        expect([name, vars, b.samples.digest]).toEqual([name, vars, a.samples.digest]);
        samples += b.samples.count;
        const value = interpreted(expr, vars);
        if (
          value !== undefined &&
          Number.isFinite(value) &&
          !(nanOnBoth === true && Number.isNaN(b.value))
        ) {
          compared++;
          expect([name, vars, value, close(b.value, value, tolerance ?? 1e-6)]).toEqual(
            [name, vars, value, true]
          );
        }
      }
      expect(samples).toBeGreaterThan(0);
      expect(compared).toBeGreaterThanOrEqual(0);
      expect(canCompile(expr, { ...PROFILE, ...options })).toMatchObject({ ok: true });
      // A limit and a derivative of a pure body keep no state: the calls
      // are independent. An integral is not (`integrate`, slice 2).
      expect(profile.pure).toBe(pure);
      if (existing.shippable !== undefined)
        expect(profile.shippable).toBe(existing.shippable);
    });
}

// Part (a): derivatives with no closed form.
const DERIVATIVES: Program[] = [
  { name: 'D of a function with no derivative rule', json: ['D', Zeta('x'), 'x'], code: '_SYS.nd(' },
  {
    name: 'D of a sum that reads an assigned constant',
    json: ['D', ['Add', ['Multiply', 'k', Zeta('x')], ['Sin', 'x']], 'x'],
  },
  { name: 'D whose variable is named like an input it does not read', json: ['D', Zeta(['Multiply', 'x', 'y']), 'y'] },
  { name: 'ND of a literal at an input', json: ['ND', Fn(['Multiply', Zeta('t'), 't']), 'x'] },
  { name: 'ND of a literal whose parameter is named like an input', json: ['ND', Fn(['Multiply', Zeta('x'), 'x'], 'x'), 'a'] },
  { name: 'ND of a literal whose parameter is named like an assigned symbol', json: ['ND', Fn(['Add', Zeta('c'), 'c'], 'c'), 'x'] },
  { name: 'ND of a literal whose parameter is named like a parameter of a helper', json: ['ND', Fn(Zeta(['p', 'u']), 'u'), 'x'] },
  { name: 'ND of a user function', json: ['ND', 'z', 'a'] },
  { name: 'ND at an expression', json: ['ND', Fn(Zeta('t')), ['Add', 'a', 'b']] },
  {
    name: 'the second derivative of a literal, applied',
    json: ['Apply', ['Derivative', Fn(Zeta('t')), 2], 'x'],
    code: ", 2, 'scalar')",
  },
  { name: 'the third derivative of a user function, applied', json: ['Apply', ['Derivative', 'z', 3], ['Add', 'a', 1]] },
  { name: 'a derivative as an operand', json: ['Add', ['Divide', 1, ['D', Zeta('x'), 'x']], 'x'] },
  { name: 'a derivative of a derivative', json: ['ND', Fn(['ND', Fn(Zeta(['Multiply', 's', 't']), 's'), 't']), 'x'] },
  { name: 'two derivatives', json: ['Multiply', ['D', Zeta('x'), 'x'], ['D', Zeta('x'), 'x']] },
  {
    name: 'a derivative in the terms of a Sum of 5 terms',
    json: ['Sum', ['D', ['Multiply', 'j', Zeta('x')], 'x'], ['Limits', 'j', 1, 5]],
  },
  { name: 'a derivative in a branch', json: ['If', ['Greater', 'x', 0], ['D', Zeta('x'), 'x'], 'x'] },
  { name: 'a derivative of a body that reads a matrix element', json: ['ND', Fn(['Multiply', ['At', 'M', 1, 2], Zeta('t')]), 'x'] },
];

// Part (b): limits (no symbolic attempt with `constantFold: false`).
const LIMITS: Program[] = [
  { name: 'a limit at an input', json: ['Limit', Fn(['Divide', ['Sin', ['Multiply', 'k', 't']], 't']), 'a'], code: '_SYS.limit(' },
  // `_SYS.limit` starts its ladder at a distance 1 from the point, and
  // crosses the jump at 0 from 0.5: `NaN` on both compilers, 1 on the
  // interpreter.
  { name: 'a limit from below', json: ['Limit', Fn(['Divide', ['Abs', 't'], 't']), 'a', -1], nanOnBoth: true },
  { name: 'a limit from both sides', json: ['Limit', Fn(['Divide', ['Sin', 't'], 't']), 0, 0] },
  { name: 'a limit at infinity', json: ['Limit', Fn(['Divide', ['Add', 'x', 't'], ['Add', 1, 't']]), 'PositiveInfinity'] },
  { name: 'a limit at -∞ from below', json: ['Limit', Fn(['Add', ['Arctan', 't'], 'x']), 'NegativeInfinity', -1] },
  { name: 'a limit at a constant', json: ['Add', 'x', ['Limit', Fn(['Divide', ['Add', ['Exp', 't'], -1], 't']), 0]] },
  { name: 'a limit whose parameter is named like an input', json: ['Limit', Fn(['Divide', ['Sin', ['Multiply', 'x', 'y']], 'x'], 'x'), 'a'] },
  {
    name: 'a nested limit',
    json: ['Limit', Fn(['Add', 't', ['Limit', Fn(['Divide', ['Sin', ['Multiply', 's', 't']], 's'], 's'), 0]]), 'a'],
  },
  { name: 'a limit of a body that reads a matrix element', json: ['Limit', Fn(['Multiply', ['At', 'M', 1, 2], ['Divide', ['Sin', 't'], 't']]), 'x'] },
  { name: 'two limits as operands of Max', json: ['Max', ['Limit', Fn(['Multiply', 't', 'x']), 'a'], ['Limit', Fn(['Multiply', 't', 'y']), 'b']] },
];

// Part (c): integrands that the existing compiler computes again in log
// space where their value is not finite.
const LOG_SPACE: Program[] = [
  {
    name: 'a power of the variable times an exponential',
    json: Int(['Multiply', Pow('t', ['Add', 'b', 3]), ['Exp', ['Negate', 't']]], 0, 'a'),
    code: '_SYS.finiteOr(',
  },
  { name: 'a power of an input', json: Int(['Multiply', Pow('t', 100), ['Exp', ['Negate', Pow('t', 2)]]], 0, 'b'), tolerance: 1e-5 },
  {
    name: 'two clauses, the alternative of the inner one',
    json: [
      'Integrate',
      ['Multiply', Pow('v', ['Add', 'b', 3]), ['Exp', ['Negate', ['Multiply', 'u', 'v']]]],
      ['Limits', 'u', 0, 1],
      ['Limits', 'v', 0, 'a'],
    ],
    tolerance: 1e-5,
  },
  {
    name: 'a log-space integrand that reads a matrix element',
    json: Int(['Multiply', Pow('t', ['At', 'M', 1, 2]), ['Exp', ['Negate', 't']]], 0, 1),
    tolerance: 1e-5,
  },
];

describe('STRUCTURED CALCULUS 3: derivatives, against the existing compiler', () =>
  differential(DERIVATIVES, true));

describe('STRUCTURED CALCULUS 3: limits, against the existing compiler', () =>
  differential(LIMITS, true));

describe('STRUCTURED CALCULUS 3: log space, against the existing compiler', () =>
  differential(LOG_SPACE, false));

describe('STRUCTURED CALCULUS 3: a root Function', () => {
  test('a derivative and a limit that read the parameter', () => {
    const ce = engine();
    for (const json of [
      ['Function', ['ND', Fn(['Add', Zeta('t'), 'u']), 'u'], 'u'],
      ['Function', ['Limit', Fn(['Divide', ['Sin', ['Multiply', 'u', 't']], 't']), 'u'], 'u'],
    ] as Json[]) {
      const expr = ce.box(json);
      const existing = compile(expr, EXISTING);
      const profile = compile(expr, PROFILE);
      const call = (r: CompilationResult<'javascript'>, u: number) =>
        (r.run as unknown as (u: number) => number)(u);
      for (const u of [0.5, 2, 7.25]) {
        const a = recorded(() => call(existing, u));
        const b = recorded(() => call(profile, u));
        expect(Object.is(a.value, b.value)).toBe(true);
        expect(b.samples.count).toBeGreaterThan(0);
        expect(b.samples.digest).toBe(a.samples.digest);
      }
    }
  });
});

describe('STRUCTURED CALCULUS 3: a body that reads a matrix', () => {
  // `M: matrix<2x2>`: a matrix element (`At`) and the value of a matrix
  // function (`Determinant`) in the body of each routine. Each program
  // gives the doubles of the existing compiler, or declines.
  const det: Json = ['Determinant', 'M'];
  const programs: [string, Json][] = [
    ['a derivative, Determinant', ['ND', Fn(['Multiply', det, Zeta('t')]), 'x']],
    ['a derivative, At', ['D', ['Multiply', ['At', 'M', 1, 2], Zeta('x')], 'x']],
    ['a limit, Determinant', ['Limit', Fn(['Multiply', det, ['Divide', ['Sin', 't'], 't']]), 'x']],
    ['a limit, At', ['Limit', Fn(['Add', ['At', 'M', 2, 1], 't']), 'a', -1]],
    ['a log-space integral, Determinant', Int(['Multiply', Pow('t', ['Add', 2, Pow(det, 2)]), ['Exp', ['Negate', 't']]], 0, 1)],
    ['a log-space integral, At', Int(['Multiply', Pow('t', ['Add', 2, Pow(['At', 'M', 1, 1], 2)]), ['Exp', ['Negate', 't']]], 0, 2)],
  ];
  const ce = engine();
  for (const [name, json] of programs)
    test(name, () => {
      const expr = ce.box(json);
      const existing = compile(expr, EXISTING);
      let profile: CompilationResult<'javascript'> | undefined;
      try {
        profile = compile(expr, PROFILE);
      } catch (e) {
        expect(canCompile(expr, PROFILE)).toMatchObject({ ok: false });
        return;
      }
      expect(profile.success).toBe(true);
      for (const vars of POINTS) {
        reseed();
        const a = recorded(() => run(existing, vars));
        reseed();
        const b = recorded(() => run(profile!, vars));
        expect([name, vars, Object.is(a.value, b.value), b.value]).toEqual([name, vars, true, a.value]);
        expect(b.samples.count).toBeGreaterThan(0);
        expect(b.samples.digest).toBe(a.samples.digest);
      }
    });
});

/** `expr` gives the same doubles and the same recorded points on both
 *  compilers at each of `calls` (the arguments of `run`, or of the root
 *  function). Returns the code of the profile. */
function sameOnBoth(
  expr: BoxedExpression,
  calls: readonly unknown[][],
  options: object = {}
): string {
  const existing = compile(expr, { ...EXISTING, ...options });
  const profile = compile(expr, { ...PROFILE, ...options });
  expect(profile.success).toBe(true);
  const call = (r: CompilationResult<'javascript'>, args: unknown[]) =>
    (r.run as unknown as (...a: unknown[]) => unknown)(...args);
  for (const args of calls) {
    reseed();
    const a = recorded(() => call(existing, args));
    reseed();
    const b = recorded(() => call(profile, args));
    expect([args, Object.is(a.value, b.value), b.value]).toEqual([args, true, a.value]);
    expect(b.samples.count).toBe(a.samples.count);
    expect(b.samples.digest).toBe(a.samples.digest);
  }
  return profile.code;
}

describe('STRUCTURED CALCULUS 3: review fixes', () => {
  test('a limit at a point that can be infinite declines; a finite point is admitted', () => {
    const ce = engine();
    ce.declare('ai', 'real | signed_infinity');
    ce.declare('w', 'number');
    const limit = (point: Json): Json => ['Limit', Fn(['Arctan', 't']), point];
    // At `ai = -∞`, `_SYS.limit` takes `+∞`: π/2 there, -π/2 on the
    // interpreter.
    const witness = ce.box(limit('ai'));
    expect(run(compile(witness, EXISTING), { ai: -Infinity })).toBe(Math.PI / 2);
    expect(() => compile(witness, PROFILE)).toThrow('which can be infinite');
    expect(() => compile(ce.box(limit('w')), PROFILE)).toThrow('which can be infinite');
    expect(() => compile(ce.box(limit(['Divide', 1, 'a'])), PROFILE)).toThrow(
      'which can be infinite'
    );
    sameOnBoth(ce.box(limit('a')), [[{ a: -2.5 }], [{ a: 0 }], [{ a: 7 }]]);
    sameOnBoth(ce.box(limit(['Add', 'a', 'n'])), [[{ a: -2.5, n: 3 }], [{ a: 1, n: -4 }]]);
  });

  test('a limit at a local, a helper parameter or a lambda parameter needs a finite type', () => {
    const ce = engine();
    ce.declare('L', 'list<real>');
    const limit = (point: Json): Json => ['Limit', Fn(['Arctan', 't']), point];
    // `pv := -1/a` has the type `infinity | nan | real`: at `a = 0` the
    // existing code takes the limit at `+∞`, π/2, where the interpreter
    // gives -π/2.
    const witness = ce.box(['Block', ['Declare', 'pv', "'unknown'", ['Negate', ['Divide', 1, 'a']]], limit('pv')]);
    expect(run(compile(witness, EXISTING), { a: 0 })).toBe(Math.PI / 2);
    expect(() => compile(witness, PROFILE)).toThrow('which can be infinite');
    // `pv := 2a` has the type `real`.
    sameOnBoth(ce.box(['Block', ['Declare', 'pv', "'unknown'", ['Multiply', 2, 'a']], limit('pv')]), [
      [{ a: -2.5 }],
      [{ a: 0 }],
      [{ a: 1.25 }],
    ]);
    // A parameter with no declared type has the type `unknown`.
    ce.declare('hl', 'function');
    ce.assign('hl', ce.box(['Function', limit('v'), 'v']));
    expect(() => compile(ce.box(['Add', ['hl', 'a'], 1]), PROFILE)).toThrow(
      'which can be infinite'
    );
    // The point `u` in the body of a `Map` lambda has the element type of
    // `L`, `real`.
    const lambda = ce.box(['Map', ['Function', limit('u'), 'u'], 'L']);
    let pointType = '';
    const visit = (e: BoxedExpression): void => {
      if (e.operator === 'Limit') pointType = e.ops![1].type.toString();
      for (const op of e.ops ?? []) visit(op);
    };
    visit(lambda);
    expect(pointType).toBe('real');
    const existing = compile(lambda, EXISTING);
    const profile = compile(lambda, PROFILE);
    for (const L of [[-2.5, 0, 3], []])
      expect(run(profile, { L })).toEqual(run(existing, { L }));
    // A root parameter is an input that the pass does not bind: a real by
    // default, as a free input with no declared type.
    sameOnBoth(ce.box(['Function', limit('u'), 'u']), [[-2.5], [0], [3]]);
  });

  test('one node used twice runs its routine twice, as on the existing compiler', () => {
    const ce = engine();
    const twice = (node: BoxedExpression) =>
      ce.function('Divide', [node, ce.function('Add', [node, ce.One])]);
    for (const json of [
      ['D', Zeta('x'), 'x'],
      ['Limit', Fn(['Divide', ['Sin', ['Multiply', 'x', 't']], 't']), 'a'],
      Int(['Sqrt', ['Add', 1, Pow('t', 4)]], 0, 'a'),
    ] as Json[]) {
      const expr = twice(ce.box(json));
      const code = sameOnBoth(expr, [[{ x: 0.7, a: 0.5 }], [{ x: 2.5, a: 1.75 }]]);
      expect(code.match(/_SYS\.(nd|limit|integrate)\(/g)?.length).toBe(2);
    }
  });

  test('a helper call that runs a routine keeps its place before a branch that runs one', () => {
    // `h(x) / If(y > 0, D(ζ(y), y), 1)`: the existing code runs the points
    // of `h(x)` first, then those of the branch.
    const ce = engine();
    const helpers: [string, Json][] = [
      ['hd', ['D', Zeta('u'), 'u']],
      ['hm', ['Limit', Fn(['Divide', ['Sin', ['Multiply', 'u', 't']], 't']), 0]],
      ['hi', Int(['Sqrt', ['Add', 'u', Pow('t', 4)]], 0, 1)],
    ];
    for (const [name, body] of helpers) {
      ce.declare(name, 'function');
      ce.assign(name, ce.box(['Function', body, 'u']));
      const expr = ce.box([
        'Divide',
        [name, 'x'],
        ['If', ['Greater', 'y', 0], ['D', Zeta('y'), 'y'], 1],
      ]);
      sameOnBoth(expr, [
        [{ x: 0.7, y: 2.5 }],
        [{ x: 1.5, y: 1.25 }],
        [{ x: 0.7, y: -1 }],
        [{ x: 2.5, y: 0 }],
      ]);
    }
  });

  test('the variable of a derivative shadows a name around it', () => {
    const ce = engine();
    ce.declare('m', 'integer');
    ce.declare('hd', 'function');
    ce.assign('hd', ce.box(['Function', ['D', Zeta('u'), 'u'], 'u']));
    const D = (body: Json, v: string): Json => ['D', body, v];
    // In a block with statements, and in a root `Function`.
    sameOnBoth(
      ce.box(['Block', ['Declare', 's', "'unknown'", ['Multiply', 2, 'x']], ['Multiply', 's', D(Zeta('x'), 'x')]]),
      [[{ x: 0.7 }], [{ x: 2.5 }]]
    );
    sameOnBoth(ce.box(['Function', D(Zeta('u'), 'u'), 'u']), [[0.7], [2.5]]);
    // The variable is named like an input that the expression reads
    // elsewhere; like the parameter of a helper; like a loop index.
    sameOnBoth(ce.box(['Add', 'x', D(['Multiply', 'x', Zeta('x')], 'x')]), [[{ x: 0.7 }], [{ x: 2.5 }]]);
    sameOnBoth(ce.box(['Add', ['hd', 'a'], 'a']), [[{ a: 0.7 }], [{ a: 2.5 }]]);
    sameOnBoth(
      ce.box(['Sum', ['Multiply', 'j', ['ND', Fn(Zeta(['Add', 'j', 1]), 'j'), 'x']], ['Limits', 'j', 1, 'n']]),
      [[{ x: 0.7, n: 3 }], [{ x: 2.5, n: 1 }]]
    );
    // A carried local that changes between passes: the point reads its
    // value of the pass.
    sameOnBoth(
      ce.box([
        'Function',
        [
          'Block',
          ['Declare', 's', "'real'", 2],
          [
            'Loop',
            ['Assign', 's', ['Add', 's', ['Multiply', 0.1, D(Zeta(['Add', Pow('s', 2), 2]), 's')]]],
            ['Element', 'j', ['Range', 1, 'm']],
          ],
          's',
        ],
        ['Typed', 'm', "'integer'"],
      ]),
      [[0], [1], [4]]
    );
  });

  test('the variable of a routine named like an assigned symbol, in an exponential', () => {
    const ce = engine();
    ce.assign('t', ce.box(['Rational', 1, 3]));
    for (const json of [
      ['ND', Fn(Zeta(['Exp', 't'])), 'x'],
      ['Limit', Fn(['Divide', ['Add', ['Exp', 't'], -1], 't']), 0],
      ['Apply', ['Derivative', Fn(Zeta(['Exp', 'c']), 'c'), 2], 'x'],
      ['ND', Fn(Zeta(['Add', 2, ['Power', 2, 't']])), 'x'],
    ] as Json[])
      sameOnBoth(ce.box(json), [[{ x: 0.7 }], [{ x: -1.3 }]]);
  });
});

describe('STRUCTURED CALCULUS 3: a search loop or a gather in a routine body', () => {
  // An `exit` of a search loop must not leave the routine body (the rule of
  // the verifier): the body is a closure, and the loop ends in it.
  test('Any and At with a list index give the existing doubles; Find gives them or declines', () => {
    const ce = engine();
    ce.declare('L', 'list<real>');
    const factor = (body: Json): Json =>
      ['ND', Fn(['Multiply', Zeta(['Add', 2, Pow('t', 2)]), body]), 'x'];
    const calls = [
      [{ x: 0.7, L: [0.5, 1.5, 3] }],
      [{ x: 2.5, L: [0.5, 1.5, 3] }],
      [{ x: -1.25, L: [4, -2] }],
    ];
    const anyCode = sameOnBoth(
      ce.box(factor(['If', ['Any', 'L', Fn(['Greater', 'u', 't'], 'u')], 1, 2])),
      calls
    );
    expect(anyCode).toContain('break;');
    sameOnBoth(ce.box(factor(['Sum', ['At', 'L', ['List', 1, 2]]])), calls);
    const find = ce.box(factor(['Find', 'L', Fn(['Greater', 'u', 't'], 'u')]));
    let admitted = true;
    try {
      compile(find, PROFILE);
    } catch {
      admitted = false;
    }
    if (admitted) sameOnBoth(find, calls);
  });
});

describe('STRUCTURED CALCULUS 3: a derivative in degrees', () => {
  test('the body is rewritten for the angular unit', () => {
    const ce = engine();
    ce.angularUnit = 'deg';
    const expr = ce.box(['D', Zeta(['Add', 2, ['Sin', 'x']]), 'x']);
    const existing = compile(expr, EXISTING);
    const profile = compile(expr, PROFILE);
    for (const x of [10, 45, 200]) {
      const a = recorded(() => run(existing, { x }));
      const b = recorded(() => run(profile, { x }));
      expect(Object.is(a.value, b.value)).toBe(true);
      expect(b.samples.digest).toBe(a.samples.digest);
    }
  });
});

describe('STRUCTURED CALCULUS 3: the code and the facts', () => {
  const ce = engine();
  test('the calls of the existing emitter', () => {
    expect(compile(ce.box(['D', Zeta('x'), 'x']), PROFILE).code).toMatch(
      /_SYS\.nd\(\(_tv\d+\) => \{ return _SYS\.zeta\(_tv\d+\); \}, 1, 'scalar'\)\(_\.x\)/
    );
    expect(
      compile(ce.box(['Limit', Fn(['Divide', ['Sin', 't'], 't']), 'a', -1]), PROFILE).code
    ).toMatch(/_SYS\.limit\(\(_tv\d+\) => \{ return .*; \}, _\.a, -1\)/);
    expect(
      compile(ce.box(Int(['Multiply', Pow('t', ['Add', 'b', 3]), ['Exp', ['Negate', 't']]], 0, 'a')), PROFILE).code
    ).toMatch(
      /const (_tv\d+) = \(_tv\d+\) => \{ .*return Math\.exp\(.*\); \}; .*_SYS\.integrate\(\(_tv\d+\) => \{ return _SYS\.finiteOr\(.*, \1, _tv\d+\); \}, 0, _\.a\)/
    );
  });

  test('the dependencies, as on the existing compiler', () => {
    const deps = (json: Json, options: object): string[] => {
      const symbolDeps = new Set<string>();
      compile(ce.box(json), { ...options, symbolDeps });
      return [...symbolDeps].sort();
    };
    for (const json of [
      ['D', ['Multiply', 'k', Zeta('x')], 'x'],
      ['ND', 'z', 'x'],
      ['Limit', Fn(['Multiply', 'k', 't']), 'x'],
    ] as Json[])
      expect([json, deps(json, PROFILE)]).toEqual([json, deps(json, EXISTING)]);
  });

  test('a limit that the ambient deadline stops: the same error on both', () => {
    const expr = ce.box(['Limit', Fn(['Divide', ['Sin', 't'], 't']), 'a']);
    for (const options of [EXISTING, PROFILE]) {
      const result = compile(expr, options);
      let thrown: unknown;
      try {
        withAmbientDeadline(Date.now() - 1, () => run(result, { a: 2 }));
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(CancellationError);
    }
  });

  test('a derivative in an unrolled Sum after a NaN term: the same value', () => {
    // The existing emitter stops a sum of 4 terms or more at its first
    // `NaN` term; `_SYS.nd` does not throw and its body is pure, so the
    // route, which evaluates every term, gives the same value (`NaN`). The
    // stencil runs for the later terms on the route only.
    const expr = ce.box([
      'Sum',
      ['D', ['Multiply', ['Divide', 1, ['Subtract', 'j', 'n']], Zeta('x')], 'x'],
      ['Limits', 'j', 1, 5],
    ]);
    const existing = compile(expr, EXISTING);
    const profile = compile(expr, PROFILE);
    for (const vars of [{ x: 0.5, n: 1 }, { x: 0.5, n: 9 }, { x: 2, n: 3 }]) {
      const a = run(existing, vars);
      const b = run(profile, vars);
      expect([vars, Object.is(a, b)]).toEqual([vars, true]);
    }
    expect(run(profile, { x: 0.5, n: 1 })).toBeNaN();
  });
});

describe('STRUCTURED CALCULUS 3: the Monte Carlo estimator', () => {
  // `_SYS.integrateMC` draws 10⁷ points from the entropy source of the
  // engine: a seeded source, reset before each call, gives both compilers
  // the same stream.
  for (const [name, json] of [
    ['an integral with no closed form', Int(['Sqrt', ['Add', 1, Pow('t', 4)]], 0, 'a')],
    ['an integral in log space', Int(['Multiply', Pow('t', ['Add', 'b', 3]), ['Exp', ['Negate', 't']]], 0, 'a')],
  ] as [string, Json][])
    test(name, () => {
      const ce = engine();
      const expr = ce.box(json);
      const options = { quadrature: 'monte-carlo' } as const;
      const existing = compile(expr, { ...EXISTING, ...options });
      const profile = compile(expr, { ...PROFILE, ...options });
      expect(existing.code).toContain('_SYS.integrateMC(');
      expect(profile.code).toContain('_SYS.integrateMC(');
      for (const a of [0.5, 2]) {
        expect(Number.isFinite(run(existing, { a, b: 1 }))).toBe(true);
        reseed();
        const e = recorded(() => run(existing, { a, b: 1 }));
        reseed();
        const p = recorded(() => run(profile, { a, b: 1 }));
        expect(Object.is(e.value, p.value)).toBe(true);
        expect(p.samples.count).toBe(e.samples.count);
        expect(p.samples.digest).toBe(e.samples.digest);
        const value = interpreted(expr, { a, b: 1 });
        expect(close(p.value, value!, 1e-2)).toBe(true);
      }
      expect(profile.pure).toBe(false);
      expect(profile.shippable).toBe(false);
    }, 60000);
});

describe('STRUCTURED CALCULUS 3: what stays declined', () => {
  const ce = engine();
  const cases: [string, Json, string, object?][] = [
    [
      'a point-valued derivative',
      ['ND', Fn(['Tuple', Zeta('t'), 't']), 'x'],
      'and the result of its function has the type tuple',
    ],
    ['a derivative of a body that draws', ['D', ['Add', Zeta('x'), ['Random']], 'x'], 'is not pure'],
    ['a limit of a body that draws', ['Limit', Fn(['Add', 't', ['Random']]), 0], 'which is not pure, draws'],
    ['a derivative in the complex mode', ['D', Zeta('x'), 'x'], 'D in the complex mode is not in the profile', { mode: 'complex' }],
    ['a limit in the complex mode', ['Limit', Fn(['Sin', 't']), 'a'], 'Limit in the complex mode is not in the profile', { mode: 'complex' }],
    [
      'a limit in the written-out terms of a Sum of 4 terms',
      ['Sum', ['Limit', Fn(['Multiply', 'j', 't']), 'x'], ['Limits', 'j', 1, 4]],
      'has a term that can throw or integrates numerically',
    ],
    // `_SYS.limit` reads an infinite point as the infinity of the sign of
    // the direction: π/2 there, -π/2 on the interpreter.
    ['a limit at -∞ with no direction', ['Limit', Fn(['Arctan', 't']), 'NegativeInfinity'], 'is at an infinity with no direction'],
    ['a limit at +∞ from below', ['Limit', Fn(['Arctan', 't']), 'PositiveInfinity', -1], 'is at an infinity with the direction -1'],
    [
      'a limit of a user function',
      ['Limit', 'z', 'a'],
      'is not the limit of a function literal of one parameter',
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
    });

  test('a derivative of several variables, and a multi-index derivative', () => {
    // No numerical lowering on either compiler.
    for (const json of [
      ['D', Zeta(['Multiply', 'x', 'y']), 'x', 'y'],
      ['Apply', ['Derivative', ['Function', Zeta(['Multiply', 'u', 'v']), 'u', 'v'], 1, 1], 'x', 'y'],
    ] as Json[]) {
      const expr = ce.box(json);
      expect(() => compile(expr, PROFILE)).toThrow();
      expect(() => compile(expr, EXISTING)).toThrow();
    }
  });
});
