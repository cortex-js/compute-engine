import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// Scalar forms of the `numeric-kernel` profile (the structured route of the
// JavaScript compiler) added on 2026-11-11
// (docs/plans/2026-11-09-js-pilot-emission-rewrites.md):
//
// - comparison chains (`Less`, `LessEqual`, `Equal`, `NotEqual` of three
//   operands or more): the conjunction of the adjacent pairs, each operand
//   evaluated once, a later operand only when the pairs before it hold;
// - a helper with a declared signature whose `Function` literal has a
//   parameter with no annotation: the parameter has the type of the
//   signature;
// - a local declared `number`, in the `strict` mode;
// - `Factorial`, `Factorial2`, `Arccot`, `Arccsc`, `Arcsec`, `Arcoth`,
//   `Arsech`, `Arcsch`, `Coth`, `Truncate`, `Fract`, `Hypot` of two
//   operands, `Sech` and `Csch` of a complex operand;
// - `Power` with a complex operand and an exponent that is not a number
//   literal (`_SYS.cpow`).
//
// Each program is compiled with the profile and with the existing compiler
// (`cse: false, constantFold: false`), in the `strict` and `complex` modes:
// the same doubles (`Object.is`, each part of a complex value) at every point
// of a grid of inputs (negative, `0`, `-0`, `±∞`, `NaN`, large, tiny,
// integers beyond 2^53), the same draws and the same calls of the host; and
// the value of the interpreter within 1e-9 relative at ordinary points. The
// forms that stay declined are tested with their message.

const EXISTING = { cse: false, constantFold: false } as const;
const MODES = ['strict', 'complex'] as const;
type Mode = (typeof MODES)[number];
type Value = number | boolean | { re: number; im: number };

const DECLARATIONS: [string, string][] = [
  ['x', 'real'],
  ['y', 'real'],
  ['w', 'real'],
  ['k', 'integer'],
  ['z', 'complex'],
  ['p', 'real<0..>'],
  ['u', 'real<1..>'],
];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [name, type] of DECLARATIONS) ce.declare(name, type);
  return ce;
}

/**
 * The inputs of an extreme magnitude where both compilers lose the value of
 * an intermediate double by overflow, underflow or cancellation (the
 * precision of the target, docs/COMPILATION-MODEL.md, "Known limitations"):
 * `Coth(1000)` is `NaN` (`Math.cosh(x) / Math.sinh(x)`), `Arcsch(1e-309)`
 * `Infinity` (`1 / x` overflows), `Arccot(1e17)` `0` and `Haversine(1e-10)`
 * `0` (cancellation), `Tanh(1000 + 0.5i)`, `Sech(1000 + 0.5i)`,
 * `Csch(1000 + 0.5i)`, `Coth(1000 + 0.5i)`, `Cot(0.5 + 1000i)` `NaN`, where
 * the interpreter has a finite value. They are in the grid, so the route
 * gives the doubles of the existing compiler there, and not in `ORDINARY`,
 * the points of the comparison with the interpreter.
 */
const EXTREME: Record<'real' | 'complex', Value[]> = {
  real: [1000, -1000, 710, -711, 1e17, 1e-10, 1e-309, -1e-309, 5e-309],
  complex: [
    { re: 1000, im: 0.5 },
    { re: -1000, im: 0.5 },
    { re: 0.5, im: 1000 },
    { re: 710, im: 1 },
  ],
};

const GRID: Record<string, Value[]> = {
  real: [-2.5, -1, -0.5, -0, 0, 0.3, 1, 2, 7.5, 1e-300, -1e300, 1e300, 2 ** 60, Infinity, -Infinity, NaN, ...EXTREME.real],
  integer: [-3, -1, 0, 1, 2, 5, 25, 171, 2 ** 53 + 2],
  complex: [
    { re: 1, im: 2 },
    { re: -0.5, im: 0 },
    { re: 0, im: -1 },
    { re: 3, im: 0.25 },
    { re: -0, im: -0 },
    ...EXTREME.complex,
  ],
  'real<0..>': [0, -0, 0.5, 2, 1e300, Infinity],
  'real<1..>': [1, 1.5, 4, 1e10],
};

/** The ordinary points of each input for the comparison with the
 *  interpreter. */
const ORDINARY: Record<string, Value[]> = {
  real: [-2.5, -0.5, 0.3, 2, 7.5],
  integer: [-3, 0, 2, 5],
  complex: [{ re: 1, im: 2 }, { re: 0.5, im: -0.25 }],
  'real<0..>': [0.5, 2],
  'real<1..>': [1.5, 4],
};

type Outcome = { result: CompilationResult<'javascript'> } | { message: string };

function compileWith(
  expr: Expression,
  mode: Mode,
  profile: boolean,
  extra: Record<string, unknown> = {}
): Outcome {
  try {
    return {
      result: compile(expr, {
        ...extra,
        fallback: false,
        mode,
        ...(profile ? { profile: 'numeric-kernel' } : EXISTING),
      } as never) as CompilationResult<'javascript'>,
    };
  } catch (e) {
    return { message: (e as Error).message };
  }
}

const same = (a: unknown, b: unknown): boolean => {
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null)
    return (
      Object.is((a as { re: number }).re, (b as { re: number }).re) &&
      Object.is((a as { im: number }).im, (b as { im: number }).im)
    );
  return Object.is(a, b);
};

/** The inputs of `expr` that the declarations name. */
const inputsOf = (expr: Expression): string[] =>
  [...new Set(expr.symbols)].filter((s) => DECLARATIONS.some(([n]) => n === s));

function pointsOf(names: readonly string[], grid: Record<string, Value[]>, limit = 400) {
  const points: Record<string, Value>[] = [];
  const visit = (i: number, acc: Record<string, Value>) => {
    if (points.length >= limit) return;
    if (i === names.length) return void points.push({ ...acc });
    const type = DECLARATIONS.find(([n]) => n === names[i])![1];
    for (const v of grid[type]) visit(i + 1, { ...acc, [names[i]]: v });
  };
  visit(0, {});
  return points;
}

const run = (result: CompilationResult<'javascript'>, point: Record<string, Value>): unknown => {
  try {
    return (result.run as (vars: unknown) => unknown)({ ...point });
  } catch (e) {
    return `throw: ${(e as Error).message}`;
  }
};

/** The profile admits `json` in `mode` and gives the doubles of the
 *  existing compiler at every point of the grid. */
function expectSameDoubles(json: MathJsonExpression, mode: Mode, ce = engine()): void {
  const expr = ce.box(json);
  const profile = compileWith(expr, mode, true);
  if (!('result' in profile)) throw new Error(`${mode}: ${profile.message}`);
  const existing = compileWith(expr, mode, false);
  if (!('result' in existing)) throw new Error(`existing, ${mode}: ${existing.message}`);
  const differences: string[] = [];
  for (const point of pointsOf(inputsOf(expr), GRID)) {
    const a = run(profile.result, point);
    const b = run(existing.result, point);
    if (!same(a, b))
      differences.push(`${JSON.stringify(point)}: ${JSON.stringify(a)} and ${JSON.stringify(b)}`);
  }
  expect(differences).toEqual([]);
}

const boxValue = (ce: ComputeEngine, v: Value): Expression =>
  typeof v === 'boolean'
    ? v
      ? ce.True
      : ce.False
    : typeof v === 'number'
      ? ce.number(v)
      : ce.expr(['Complex', v.re, v.im]);

/** The value of the interpreter, as compiled code gives it. */
function interpret(ce: ComputeEngine, expr: Expression, point: Record<string, Value>): unknown {
  const value = expr
    .subs(Object.fromEntries(Object.entries(point).map(([k, v]) => [k, boxValue(ce, v)])))
    .evaluate()
    .N();
  if (value.symbol === 'True') return true;
  if (value.symbol === 'False') return false;
  if (value.im === 0) return value.re;
  return { re: value.re, im: value.im };
}

const near = (a: unknown, b: unknown): boolean => {
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;
  const pa = typeof a === 'number' ? { re: a, im: 0 } : (a as { re: number; im: number });
  const pb = typeof b === 'number' ? { re: b, im: 0 } : (b as { re: number; im: number });
  const close = (u: number, v: number) =>
    (Number.isNaN(u) && Number.isNaN(v)) ||
    u === v ||
    Math.abs(u - v) <= 1e-9 * Math.max(1, Math.abs(u), Math.abs(v));
  return close(pa.re, pb.re) && close(pa.im, pb.im);
};

/** The value of the profile is the value of the interpreter at the
 *  ordinary points where the interpreter has a finite value. */
function expectInterpreterValue(json: MathJsonExpression, mode: Mode = 'strict'): void {
  const ce = engine();
  const expr = ce.box(json);
  const profile = compileWith(expr, mode, true);
  if (!('result' in profile)) throw new Error(profile.message);
  const differences: string[] = [];
  for (const point of pointsOf(inputsOf(expr), ORDINARY)) {
    const expected = interpret(ce, expr, point);
    if (typeof expected === 'number' && !Number.isFinite(expected)) continue;
    const got = run(profile.result, point);
    if (!near(got, expected))
      differences.push(`${JSON.stringify(point)}: ${JSON.stringify(got)} and ${JSON.stringify(expected)}`);
  }
  expect(differences).toEqual([]);
}

function expectDecline(json: MathJsonExpression, mode: Mode, message: RegExp, ce = engine()): void {
  const outcome = compileWith(ce.box(json), mode, true);
  expect('message' in outcome && outcome.message).toMatch(message);
}

//
// Comparison chains
//

const CHAINS: [string, MathJsonExpression][] = [
  ['x < y < w', ['Less', 'x', 'y', 'w']],
  ['x < y + 1 < w < sin(x)', ['Less', 'x', ['Add', 'y', 1], 'w', ['Sin', 'x']]],
  ['0 <= x <= y <= 1', ['LessEqual', 0, 'x', 'y', 1]],
  ['k <= 2k <= w', ['LessEqual', 'k', ['Multiply', 2, 'k'], 'w']],
  ['x == y == w', ['Equal', 'x', 'y', 'w']],
  ['x == y + 1 == w', ['Equal', 'x', ['Add', 'y', 1], 'w']],
  ['k == 2 == k', ['Equal', 'k', 2, 'k']],
  ['If(0 < x < 1, x, y)', ['If', ['Less', 0, 'x', 1], 'x', 'y']],
  ['Not(-1 < x <= y)', ['Not', ['And', ['Less', -1, 'x'], ['LessEqual', 'x', 'y']]]],
];

describe('comparison chains', () => {
  for (const mode of MODES)
    test.each(CHAINS)(`%s (${mode})`, (_name, json) => expectSameDoubles(json, mode));
  test.each(CHAINS)('%s: the value of the interpreter', (_name, json) =>
    expectInterpreterValue(json)
  );

  test('a chain is a conjunction of adjacent pairs that stops at a false pair', () => {
    const ce = engine();
    const result = compileWith(ce.box(['Less', 'x', ['Add', 'y', 1], 'w']), 'strict', true);
    if (!('result' in result)) throw new Error(result.message);
    expect(result.result.code).toBe(
      '(() => { const _tv1 = _.y + 1; return _.x < _tv1 && _tv1 < _.w; })()'
    );
  });
});

/** Run `f` with `Math.random` replaced by a fixed sequence; the value and
 *  the number of draws. */
function withDraws<T>(f: () => T): { value: T; draws: number } {
  const random = Math.random;
  const sequence = [0.25, 0.75, 0.5, 0.1, 0.9, 0.6];
  let draws = 0;
  Math.random = () => sequence[draws++ % sequence.length];
  try {
    return { value: f(), draws };
  } finally {
    Math.random = random;
  }
}

describe('comparison chains with draws: the same draws, in the same order', () => {
  const PROGRAMS: [string, MathJsonExpression][] = [
    ['x < Random() < Random()', ['Less', 'x', ['Random'], ['Random']]],
    ['x != Random() != w', ['NotEqual', 'x', ['Random'], 'w']],
    // The existing emitter evaluates the temporary of the second operand
    // before the first operand (the form `chain-swap`).
    ['Random() < x + 1 < w', ['Less', ['Random'], ['Add', 'x', 1], 'w']],
    ['0.5 == Random() == Random()', ['Equal', 0.5, ['Random'], ['Random']]],
    ['5 < x < Random(): no draw when the first pair is false', ['Less', 5, 'x', ['Random']]],
    // A middle operand draws: the existing emitter binds every operand
    // that draws, in order, the first one too.
    ['Random() < x + Random() < 1', ['Less', ['Random'], ['Add', 'x', ['Random']], 1]],
    ['Random() <= x + 1 <= Random() <= 0.9', ['LessEqual', ['Random'], ['Add', 'x', 1], ['Random'], 0.9]],
    ['2·Random() < Random() < x', ['Less', ['Multiply', 2, ['Random']], ['Random'], 'x']],
  ];
  for (const mode of MODES)
    test.each(PROGRAMS)(`%s (${mode})`, (_name, json) => {
      const expr = engine().box(json);
      const profile = compileWith(expr, mode, true);
      const existing = compileWith(expr, mode, false);
      if (!('result' in profile)) throw new Error(profile.message);
      if (!('result' in existing)) throw new Error(existing.message);
      for (const x of [-1, 0, 0.3, 2, 7, NaN])
        for (const w of [0.2, 1, 3]) {
          const a = withDraws(() => run(profile.result, { x, w }));
          const b = withDraws(() => run(existing.result, { x, w }));
          expect([x, w, a]).toEqual([x, w, b]);
        }
    });
});

describe('comparison chains with calls of the host', () => {
  const log: string[] = [];
  let vars: Record<string, unknown> | undefined;
  const globals = globalThis as unknown as Record<string, unknown>;
  beforeAll(() => {
    globals.__s2Mutate = (t: number) => {
      log.push(`hm(${t})`);
      if (vars !== undefined) vars.x = 0.25 + log.length;
      return t / 2 + 1;
    };
    globals.__s2Read = () => {
      log.push('read');
      return [0.5, -1.25, 3][log.length % 3];
    };
  });
  afterAll(() => {
    delete globals.__s2Mutate;
    delete globals.__s2Read;
  });
  const HOST = {
    functions: { hm: '__s2Mutate' },
    vars: { vr: '__s2Read()' },
  };
  const hostEngine = () => {
    const ce = engine();
    ce.declare('hm', '(real) -> real');
    ce.declare('vr', 'real');
    return ce;
  };
  const PROGRAMS: [string, MathJsonExpression][] = [
    // `hm` writes `x`, which the second operand reads: the second operand is
    // evaluated first, as the existing emitter evaluates its temporary.
    ['hm(1) < x + 1 < w', ['Less', ['hm', 1], ['Add', 'x', 1], 'w']],
    ['x < vr < w', ['Less', 'x', 'vr', 'w']],
    ['x <= w <= hm(x)', ['LessEqual', 'x', 'w', ['hm', 'x']]],
    ['vr < x + 1 < w', ['Less', 'vr', ['Add', 'x', 1], 'w']],
  ];
  // The profile admits the reads and the calls of the host in the `strict`
  // mode only.
  for (const mode of ['strict'] as const)
    test.each(PROGRAMS)(`%s (${mode})`, (_name, json) => {
      const expr = hostEngine().box(json);
      const profile = compileWith(expr, mode, true, HOST);
      const existing = compileWith(expr, mode, false, HOST);
      if (!('result' in profile)) throw new Error(profile.message);
      if (!('result' in existing)) throw new Error(existing.message);
      const outcome = (result: CompilationResult<'javascript'>, point: Record<string, number>) => {
        log.length = 0;
        vars = { ...point };
        const value = (result.run as (v: unknown) => unknown)(vars);
        return { value, log: [...log] };
      };
      for (const x of [-1, 0.5, 2])
        for (const w of [0.2, 1.5, 4])
          expect([x, w, outcome(profile.result, { x, w })]).toEqual([x, w, outcome(existing.result, { x, w })]);
    });

  test('an equality chain whose middle operand calls the host declines', () => {
    const ce = hostEngine();
    const outcome = compileWith(ce.box(['Equal', 'x', ['hm', 'x'], 'w']), 'strict', true, HOST);
    expect('message' in outcome && outcome.message).toMatch(
      /the middle operand hm\(x\) of the chain .* reads or calls the host or calls a helper/
    );
  });
});

describe('comparison chains with draws and a host function declared pure', () => {
  // One log of the draws and the calls of the host, in their order.
  const log: string[] = [];
  const globals = globalThis as unknown as Record<string, unknown>;
  beforeAll(() => {
    globals.__s2Pure = (t: number) => {
      log.push(`hp(${t})`);
      return t / 2 + 0.25;
    };
  });
  afterAll(() => {
    delete globals.__s2Pure;
  });
  const HOST = { functions: { hp: { source: '__s2Pure', pure: true } } };
  // `hp` declared only, or also assigned a pure function of the engine: the
  // existing compiler then reads `hp(x)` as pure (`isTransitivelyPure()`),
  // does not bind it, and draws before it calls the host.
  const hostEngine = (defined: boolean) => {
    const ce = engine();
    ce.declare('hp', '(real) -> real');
    if (defined)
      ce.assign('hp', ce.expr(['Function', ['Multiply', 't', 2], ['Typed', 't', "'real'"]] as MathJsonExpression));
    return ce;
  };
  const outcome = (result: CompilationResult<'javascript'>, point: Record<string, number>) => {
    log.length = 0;
    const random = Math.random;
    const sequence = [0.25, 0.75, 0.5, 0.1, 0.9, 0.6];
    let draws = 0;
    Math.random = () => {
      log.push('draw');
      return sequence[draws++ % sequence.length];
    };
    try {
      const value = (result.run as (v: unknown) => unknown)({ ...point });
      return { value, log: [...log] };
    } finally {
      Math.random = random;
    }
  };
  const PROGRAMS: [string, MathJsonExpression][] = [
    ['hp(x) == Random() == 1', ['Equal', ['hp', 'x'], ['Random'], 1]],
    ['hp(x) != Random() != w', ['NotEqual', ['hp', 'x'], ['Random'], 'w']],
    ['Random() == hp(x) == w', ['Equal', ['Random'], ['hp', 'x'], 'w']],
    ['Random() == x + 1 == hp(w)', ['Equal', ['Random'], ['Add', 'x', 1], ['hp', 'w']]],
    ['x == Random() == hp(w)', ['Equal', 'x', ['Random'], ['hp', 'w']]],
    ['hp(x) < Random() < 1', ['Less', ['hp', 'x'], ['Random'], 1]],
    ['hp(x) <= x + Random() <= w', ['LessEqual', ['hp', 'x'], ['Add', 'x', ['Random']], 'w']],
    ['Random() < hp(x) < w', ['Less', ['Random'], ['hp', 'x'], 'w']],
    ['Random() < x + 1 < hp(w)', ['Less', ['Random'], ['Add', 'x', 1], ['hp', 'w']]],
    ['x < Random() < hp(w)', ['Less', 'x', ['Random'], ['hp', 'w']]],
    ['hp(x) < x + 1 < Random()', ['Less', ['hp', 'x'], ['Add', 'x', 1], ['Random']]],
  ];
  // The profile admits the calls of the host in the `strict` mode only. A
  // chain is admitted with the order of the existing compiler, or declined.
  for (const defined of [false, true])
  test.each(PROGRAMS)(`%s (hp ${defined ? 'assigned' : 'declared'}): the same draws and calls, in the same order, or a decline`, (_name, json) => {
    const expr = hostEngine(defined).box(json);
    const profile = compileWith(expr, 'strict', true, HOST);
    const existing = compileWith(expr, 'strict', false, HOST);
    if (!('result' in existing)) throw new Error(existing.message);
    if (!('result' in profile)) {
      expect(profile.message).toMatch(/chain .* (has an effect|reads or calls the host)/);
      return;
    }
    for (const x of [-1, 0.5, 2])
      for (const w of [0.2, 0.6, 4])
        expect([x, w, outcome(profile.result, { x, w })]).toEqual([x, w, outcome(existing.result, { x, w })]);
  });
  test('hp(x) == Random() == 1 with hp assigned: the draw comes first', () => {
    const expr = hostEngine(true).box(['Equal', ['hp', 'x'], ['Random'], 1]);
    const profile = compileWith(expr, 'strict', true, HOST);
    if (!('result' in profile)) throw new Error(profile.message);
    expect(outcome(profile.result, { x: 0.5, w: 1 }).log).toEqual(['draw', 'hp(0.5)']);
  });
});

describe('comparison chains that stay declined', () => {
  test('a draw and a call of a helper', () => {
    const ce = engine();
    ce.declare('g', '(real) -> real');
    ce.assign('g', ce.expr(['Function', ['Multiply', 't', 2], ['Typed', 't', "'real'"]] as MathJsonExpression));
    expectDecline(
      ['Less', ['Random'], ['g', 'x'], 1],
      'strict',
      /has an effect and a call of a helper/,
      ce
    );
  });
  test('a complex operand', () =>
    expectDecline(['Less', 'x', 'z', 1], 'strict', /Less with a complex operand/));
  test('an equality chain whose middle operand calls a helper', () => {
    const ce = engine();
    ce.declare('g', '(real) -> real');
    ce.assign('g', ce.expr(['Function', ['Multiply', 't', 2], ['Typed', 't', "'real'"]] as MathJsonExpression));
    expectDecline(
      ['Equal', 'x', ['g', 'x'], 'w'],
      'strict',
      /the middle operand g\(x\) of the chain .* calls a helper/,
      ce
    );
  });
});

//
// Helpers with a declared signature and a parameter with no annotation
//

describe('a helper with a declared signature and a parameter with no annotation', () => {
  const HELPERS: [string, string, MathJsonExpression, string[], MathJsonExpression][] = [
    ['(real) -> real, 2t', '(real) -> real', ['Multiply', 't', 2], ['t'], ['Add', ['g', 'x'], 1]],
    ['(real) -> real, √t', '(real) -> real', ['Sqrt', 't'], ['t'], ['Add', ['g', 'x'], 1]],
    ['(real) -> number, √t', '(real) -> number', ['Sqrt', 't'], ['t'], ['Add', ['g', 'x'], 1]],
    ['(real) -> real, sin t + t²', '(real) -> real', ['Add', ['Sin', 't'], ['Power', 't', 2]], ['t'], ['Multiply', 'y', ['g', 'x']]],
    ['(number) -> number, 2t', '(number) -> number', ['Multiply', 't', 2], ['t'], ['Add', ['g', 'x'], 1]],
    ['(real, integer) -> real, t + n', '(real, integer) -> real', ['Add', 't', 'n'], ['t', 'n'], ['g', 'x', 'k']],
    ['(integer) -> real, n / 3', '(integer) -> real', ['Divide', 'n', 3], ['n'], ['g', 'k']],
  ];
  const make = (signature: string, body: MathJsonExpression, parameters: string[]) => {
    const ce = engine();
    ce.declare('g', signature);
    ce.assign('g', ce.expr(['Function', body, ...parameters] as MathJsonExpression));
    return ce;
  };
  test.each(HELPERS)('%s (strict)', (_name, signature, body, parameters, root) =>
    expectSameDoubles(root, 'strict', make(signature, body, parameters))
  );
  test.each(HELPERS)('%s (complex): the doubles of the existing compiler, or a decline', (_name, signature, body, parameters, root) => {
    const ce = make(signature, body, parameters);
    const outcome = compileWith(ce.box(root), 'complex', true);
    if ('message' in outcome) {
      // A `number` parameter is complex in the `complex` mode, and a real
      // argument is not converted; a `real` result of a complex root
      // declines at its `Typed`.
      expect(outcome.message).toMatch(
        /is complex in the `complex` mode|Typed with the ascribed type|which is not real, in the complex mode/
      );
      return;
    }
    expectSameDoubles(root, 'complex', ce);
  });
  test('a parameter whose signature type is not in the profile keeps its decline', () => {
    const ce = make('(real, string) -> real', ['Multiply', 't', 2], ['t', 's']);
    expectDecline(
      ['Add', ['g', 'x', "'a'"], 1],
      'strict',
      /the parameter s of the helper g has no type annotation, and the type string of its signature is not in the/,
      ce
    );
  });
  // The existing compiler reads the range of the signature in the body:
  // `Abs(t)` is `t` for `(real<0..>) -> real`, `-2.5` at `x = -2.5`.
  test.each(MODES)('a signature type with a range declines (%s)', (mode) => {
    const ce = make('(real<0..>) -> real', ['Abs', 't'], ['t']);
    expectDecline(
      ['g', 'x'],
      mode,
      /the parameter t of the helper g has no type annotation, and the type real<0\.\.> of its signature is not a base kind/,
      ce
    );
  });
});

//
// A local declared `number`
//

describe('a local declared number', () => {
  const LOCALS: [string, MathJsonExpression][] = [
    ['let a: number = 2x; a + 1', ['Block', ['Declare', 'a', 'number', ['Multiply', 2, 'x']], ['Add', 'a', 1]]],
    ['let a: number = √x; a + 1', ['Block', ['Declare', 'a', 'number', ['Sqrt', 'x']], ['Add', 'a', 1]]],
    [
      'let s: number = 0; a loop adds x',
      ['Block', ['Declare', 's', 'number', 0], ['Loop', ['Assign', 's', ['Add', 's', 'x']], ['Element', 'j', ['Range', 1, 3]]], 's'],
    ],
    ['let a: number = sin x; a < 1', ['Block', ['Declare', 'a', 'number', ['Sin', 'x']], ['Less', 'a', 1]]],
    ['let a: number = k; arcsin(a)', ['Block', ['Declare', 'a', 'number', 'k'], ['Arcsin', 'a']]],
  ];
  test.each(LOCALS)('%s (strict)', (_name, json) => expectSameDoubles(json, 'strict'));
  test.each(LOCALS)('%s (complex): declined', (_name, json) =>
    expectDecline(json, 'complex', /unsupported local declaration/)
  );
  test('a complex value of a local declared number declines in the strict mode', () =>
    expectDecline(
      ['Block', ['Declare', 'a', 'number', ['Complex', 1, 2]], ['Add', 'a', 1]],
      'strict',
      /The value of the local `a` has the type `complex`/
    ));
});

//
// Scalar heads
//

const HEADS = [
  'Factorial',
  'Factorial2',
  'Arccot',
  'Arccsc',
  'Arcsec',
  'Arcoth',
  'Arsech',
  'Arcsch',
  'Coth',
  'Truncate',
  'Fract',
] as const;

describe('scalar heads: the doubles of the existing compiler', () => {
  const OPERANDS: MathJsonExpression[] = ['x', 'k', 'p', 'u', ['Add', 'x', 1], ['Divide', 1, 'x']];
  const programs = (head: string): [string, MathJsonExpression][] =>
    OPERANDS.flatMap((a) => [
      [`${head}(${JSON.stringify(a)})`, [head, a]],
      [`2 / ${head}(${JSON.stringify(a)})`, ['Divide', 2, [head, a]]],
      [`y · ${head}(${JSON.stringify(a)})`, ['Multiply', 'y', [head, a]]],
      [`x + ${head}(${JSON.stringify(a)})`, ['Add', 'x', [head, a]]],
    ]);
  for (const head of HEADS)
    for (const mode of MODES)
      test(`${head} (${mode})`, () => {
        let admitted = 0;
        for (const [, json] of programs(head)) {
          const outcome = compileWith(engine().box(json), mode, true);
          if ('message' in outcome) {
            // Declined only for a node whose type is not real in the
            // `complex` mode (the existing compiler wraps the real call).
            expect([json, outcome.message]).toEqual([json, expect.stringMatching(/which is not real, in the complex mode|not in the profile/)]);
            continue;
          }
          admitted++;
          expectSameDoubles(json, mode);
        }
        expect(admitted).toBeGreaterThan(0);
      });

  test.each([
    ['Arccot', ['Arccot', 'z']],
    ['Arccsc', ['Arccsc', 'z']],
    ['Arcsec', ['Arcsec', 'z']],
    ['Arcoth', ['Arcoth', 'z']],
    ['Arsech', ['Arsech', 'z']],
    ['Arcsch', ['Arcsch', 'z']],
    ['Coth', ['Coth', 'z']],
    ['Sech', ['Sech', 'z']],
    ['Csch', ['Csch', 'z']],
    ['Arccsc of a real operand on the complex lane', ['Arccsc', 'x']],
    ['Arcoth of a real operand on the complex lane', ['Add', 'x', ['Arcoth', 'x']]],
  ] as [string, MathJsonExpression][])('%s of a complex operand', (_name, json) => {
    for (const mode of MODES) expectSameDoubles(json, mode);
  });

  test.each([
    ['Hypot(x, y)', ['Hypot', 'x', 'y']],
    ['Hypot(x, k)', ['Hypot', 'x', 'k']],
    ['1 / Hypot(x, 2)', ['Divide', 1, ['Hypot', 'x', 2]]],
    ['Hypot(3, p)', ['Hypot', 3, 'p']],
  ] as [string, MathJsonExpression][])('%s', (_name, json) => {
    for (const mode of MODES) expectSameDoubles(json, mode);
  });
});

describe('scalar heads: the value of the interpreter', () => {
  test.each([
    ['Factorial(x)', ['Factorial', 'x']],
    ['Factorial(k)', ['Factorial', 'k']],
    ['Factorial2(k)', ['Factorial2', 'k']],
    ['Arccot(x)', ['Arccot', 'x']],
    ['Arccsc(u)', ['Arccsc', 'u']],
    ['Arcsec(u)', ['Arcsec', 'u']],
    ['Arcsch(x)', ['Arcsch', 'x']],
    ['Arsech(x)', ['Arsech', 'x']],
    ['Arcoth(x)', ['Arcoth', 'x']],
    ['Coth(x)', ['Coth', 'x']],
    ['Truncate(x)', ['Truncate', 'x']],
    ['Fract(x + 0.5)', ['Fract', ['Add', 'x', 0.5]]],
    ['Hypot(x, y)', ['Hypot', 'x', 'y']],
    ['Arccot(z)', ['Arccot', 'z']],
    ['Coth(z)', ['Coth', 'z']],
    ['Sech(z)', ['Sech', 'z']],
  ] as [string, MathJsonExpression][])('%s', (_name, json) => expectInterpreterValue(json));

  test('Factorial beyond 2^53: the double of the exact value; 171! is infinite', () => {
    const ce = engine();
    const result = compileWith(ce.box(['Factorial', 'k']), 'strict', true);
    if (!('result' in result)) throw new Error(result.message);
    const value = run(result.result, { k: 25 }) as number;
    expect(Math.abs(value - 1.5511210043330986e25) / 1.5511210043330986e25).toBeLessThan(1e-15);
    expect(run(result.result, { k: 170 })).toBe(7.257415615307994e306);
    expect(run(result.result, { k: 171 })).toBe(Infinity);
    expect(run(result.result, { k: -1 })).toBe(Infinity);
  });
});

describe('scalar heads that stay declined', () => {
  test.each([
    ['Sech of a real operand', ['Sech', 'x'], /Sech of a real operand is not in the profile/],
    ['Csch of a real operand', ['Csch', 'x'], /Csch of a real operand is not in the profile/],
    // An operand that the existing emitter writes as a name: `Abs(p)` with
    // `p: real<0..>` is `p` (`2 * p - Math.floor(p)`, 1.5 at p = 1.25).
    ['Fract of Abs of a non-negative operand', ['Function', ['Multiply', 2, ['Fract', ['Abs', 'p']]], ['Typed', 'p', "'real<0..>'"]], /Fract of the operand \|p\| is not in the profile|Fract of the operand abs\(p\)/],
    ['Fract of Conjugate of a real operand', ['Function', ['Multiply', 2, ['Fract', ['Conjugate', 'b']]], ['Typed', 'b', "'real'"]], /Fract of the operand/],
    ['Fract of Floor', ['Function', ['Multiply', 2, ['Fract', ['Floor', 'b']]], ['Typed', 'b', "'real'"]], /Fract of the operand/],
    ['Hypot of a complex operand', ['Hypot', 'x', 'z'], /Hypot with a complex operand/],
    ['Factorial of a complex operand', ['Factorial', 'z'], /Factorial with a complex operand/],
    ['Truncate of a complex operand', ['Truncate', 'z'], /Truncate with a complex operand/],
    ['GCD of a complex operand', ['GCD', 'z', 6], /GCD with a complex operand/],
    // The existing emitter writes `2 * b - Math.floor(b)` for a parameter `b`.
    ['Fract of a name', ['Function', ['Multiply', 2, ['Fract', 'b']], ['Typed', 'b', "'real'"]], /Fract of the operand b is not in the profile/],
    ['Fract of a number literal', ['Add', 'x', ['Fract', 3]], /Fract reads no input|Fract of the operand 3/],
    ['Coth of i·π·x', ['Coth', ['Multiply', 'ImaginaryUnit', 'Pi', 'x']], /reads Pi/],
    ['Power of a declared symbol ExponentialE and a complex exponent', ['Block', ['Declare', 'ExponentialE', "'real'", 2], ['Power', 'ExponentialE', 'z']], /Power of a symbol ExponentialE that a scope declares is not in the profile/],
  ] as [string, MathJsonExpression, RegExp][])('%s', (_name, json, message) =>
    expectDecline(json, 'strict', message)
  );
});

//
// Power with a complex operand and an exponent that is not a number literal
//

describe('a complex power with an exponent that is not a number literal', () => {
  const POWERS: [string, MathJsonExpression][] = [
    ['z^x', ['Power', 'z', 'x']],
    ['x^z', ['Power', 'x', 'z']],
    ['z^k', ['Power', 'z', 'k']],
    ['z^z', ['Power', 'z', 'z']],
    ['(z + 1)^(2x)', ['Power', ['Add', 'z', 1], ['Multiply', 2, 'x']]],
    ['x + z^y', ['Add', 'x', ['Power', 'z', 'y']]],
    ['2^z', ['Power', 2, 'z']],
    ['p^z', ['Power', 'p', 'z']],
    ['y · z^k', ['Multiply', ['Power', 'z', 'k'], 'y']],
  ];
  for (const mode of MODES)
    test.each(POWERS)(`%s (${mode})`, (_name, json) => expectSameDoubles(json, mode));
  test.each(POWERS)('%s: the value of the interpreter', (_name, json) =>
    expectInterpreterValue(json)
  );
  test('an exponent with no unknown declines', () =>
    expectDecline(['Power', 'z', 'Pi'], 'strict', /which has no unknown/));
});

//
// Chains with collections, a complex literal through a value-passing
// wrapper, a read of a list element whose type is not real, and the parent
// positions of the heads
//

/** A `Function` literal of the body `body` and the typed parameters. */
const fn = (body: MathJsonExpression, ...parameters: [string, string][]): MathJsonExpression =>
  ['Function', ['Block', body], ...parameters.map(([n, t]) => ['Typed', n, `'${t}'`])] as MathJsonExpression;

const textOf = (value: unknown): string =>
  JSON.stringify(value, (_k, v) =>
    typeof v === 'number' && !Number.isFinite(v) ? String(v) : Object.is(v, -0) ? '-0' : v
  );

/** The profile admits the function `json` in both modes and gives the
 *  values of the existing compiler (`Object.is`, element by element) for
 *  each list of arguments. */
function expectSameCalls(json: MathJsonExpression, calls: readonly unknown[][]): void {
  for (const mode of MODES) {
    const expr = engine().box(json);
    const profile = compileWith(expr, mode, true);
    if (!('result' in profile)) throw new Error(`${mode}: ${profile.message}`);
    const existing = compileWith(expr, mode, false);
    if (!('result' in existing)) throw new Error(`existing, ${mode}: ${existing.message}`);
    const call = (r: CompilationResult<'javascript'>, args: readonly unknown[]) =>
      textOf(
        (r.run as unknown as (...a: unknown[]) => unknown)(
          ...args.map((a) => (Array.isArray(a) ? [...a] : a))
        )
      );
    for (const args of calls)
      expect([mode, args, call(profile.result, args)]).toEqual([
        mode,
        args,
        call(existing.result, args),
      ]);
  }
}

describe('comparison chains and collections', () => {
  const listEngine = () => {
    const ce = engine();
    ce.declare('L', 'list<real>');
    ce.declare('P', 'tuple<real, real>');
    return ce;
  };
  test.each([
    ['a list operand', ['Less', 0, 'L', 1], /Less with the list operand L is not in the profile/],
    ['a list as the last operand', ['Less', 0, 'x', 'L'], /Less with the list operand L/],
    ['an element-wise sum in the middle', ['LessEqual', 0, ['Add', 'L', 1], 5], /LessEqual with the list operand L \+ 1/],
    ['a list literal', ['Less', 0, ['List', 'x', 1], 3], /Less with the list operand \[x,1\]/],
    ['a tuple operand', ['Less', 'x', 'P', 1], /Less with the tuple operand P/],
    ['an equality chain with a list', ['Equal', 'x', 'L', 1], /Equal with the list operand L/],
  ] as [string, MathJsonExpression, RegExp][])('%s declines', (_name, json, message) => {
    for (const mode of MODES) expectDecline(json, mode, message, listEngine());
  });

  test('a chain in the guard of a comprehension', () =>
    expectSameCalls(
      fn(['Comprehension', 'k', ['Element', 'k', ['Range', 1, 9], ['Less', 'n', 'k', ['Multiply', 2, 'n']]]], ['n', 'integer']),
      [[3], [0], [-2], [5]]
    ));

  test('an equality chain in the guard of a comprehension', () =>
    expectSameCalls(
      fn(
        ['Comprehension', ['Multiply', 2, 'k'], ['Element', 'k', ['Range', 1, 6], ['NotEqual', 'n', 'k', ['Add', 'n', 1]]]],
        ['n', 'integer']
      ),
      [[2], [0], [7]]
    ));

  test('a chain in the body of a fold', () =>
    expectSameCalls(
      fn(
        ['Sum', ['If', ['Less', 0, 'x', ['At', 'L', 'j'], 5], 1, 0], ['Limits', 'j', 1, ['Length', 'L']]],
        ['L', 'list<real>'],
        ['x', 'real']
      ),
      [[[1, 2, 0.5, 7], 0.7], [[], 1], [[3], -1], [[NaN, 2], 1]]
    ));

  test('a chain in an operand of an element-wise sum that a fold reads', () =>
    expectSameCalls(
      fn(['Sum', ['Add', 'L', ['If', ['Less', 0, 'x', 1], 1, 0]]], ['L', 'list<real>'], ['x', 'real']),
      [[[1, 2], 0.5], [[1, 2], 2], [[], 0.5]]
    ));
});

describe('a complex literal through a value-passing wrapper', () => {
  // The existing emitter writes a block operand as a called function: a
  // complex sum reads the parts of its value and drops no term of it, so
  // `-0 + 0` is `0`.
  const WRAPPERS: [string, (l: MathJsonExpression) => MathJsonExpression][] = [
    ['a block operand', (l) => ['Block', ['Declare', 'b0', "'real'", 1], l]],
    ['a nested block operand', (l) => ['Block', ['Declare', 'b0', "'real'", 1], ['Block', ['Declare', 'b1', "'real'", 2], l]]],
    ['a let local', (l) => ['Block', ['Declare', 't', "'complex'", l], ['Add', 't', 0]]],
    ['WithRandomSeed', (l) => ['WithRandomSeed', 3, l]],
  ];
  const PARENTS: [string, (w: MathJsonExpression) => MathJsonExpression][] = [
    ['x + W', (w) => ['Add', 'x', w]],
    ['z + W', (w) => ['Add', 'z', w]],
    ['x + W + y', (w) => ['Add', 'x', w, 'y']],
    ['x · W', (w) => ['Multiply', 'x', w]],
    ['z · W', (w) => ['Multiply', 'z', w]],
    ['W / x', (w) => ['Divide', w, 'x']],
    ['x / W', (w) => ['Divide', 'x', w]],
  ];
  const LITERALS: [string, MathJsonExpression][] = [
    ['i', ['Complex', 0, 1]],
    ['-0.5 + 2i', ['Complex', -0.5, 2]],
  ];
  for (const [literal, json] of LITERALS)
    for (const [wrapper, wrap] of WRAPPERS)
      for (const mode of MODES)
        test.each(PARENTS)(`%s with W ${wrapper} of ${literal} (${mode})`, (_name, parent) =>
          expectSameDoubles(parent(wrap(json)), mode)
        );
  test('the real part of x + { b0 ⩴ 1; i } at x = -0 is 0', () => {
    const r = compileWith(
      engine().box(['Add', 'x', ['Block', ['Declare', 'b0', "'real'", 1], 'ImaginaryUnit']]),
      'strict',
      true
    );
    if (!('result' in r)) throw new Error(r.message);
    expect(textOf(run(r.result, { x: -0 }))).toBe('{"re":0,"im":1}');
  });
});

describe('an element of a list whose type is not real', () => {
  // In the `strict` mode the existing compiler reads such an element with
  // the type tag of the node and its parent as a complex value
  // (`{re: NaN, im: NaN}` for `x · √4`).
  const C = ['Comprehension', ['Sqrt', 'y'], ['Element', 'j', ['Range', 1, 2]]] as MathJsonExpression;
  test.each([
    ['x · At(…)', ['Multiply', 'x', ['At', C, 2]]],
    ['At(…) + 1', ['Add', 1, ['At', C, 2]]],
    ['Arcsch(At(…))', ['Arcsch', ['At', ['Comprehension', ['Log', 'y', 10], ['Element', 'j', ['Range', 1, 2]]], 1]]],
  ] as [string, MathJsonExpression][])('%s declines', (_name, json) => {
    for (const mode of MODES) expectDecline(json, mode, /has the type .*, which is not real/);
  });
  test('an element of the type real is read', () =>
    expectSameDoubles(
      ['Multiply', 'x', ['At', ['Comprehension', ['Add', 'y', 1], ['Element', 'j', ['Range', 1, 2]]], 2]],
      'strict'
    ));
});

describe('the admitted heads in the positions of a parent', () => {
  const HEADS: [string, MathJsonExpression][] = [
    ['Arccot(x)', ['Arccot', 'x']],
    ['Arcsch(x)', ['Arcsch', 'x']],
    ['Coth(x)', ['Coth', 'x']],
    ['Coth(x + 0.5)', ['Coth', ['Add', 'x', 0.5]]],
    ['Fract(x + 0.5)', ['Fract', ['Add', 'x', 0.5]]],
    ['Truncate(x)', ['Truncate', 'x']],
    ['Hypot(x, y)', ['Hypot', 'x', 'y']],
    ['Sech(z)', ['Sech', 'z']],
    ['Csch(z)', ['Csch', 'z']],
    ['z^x', ['Power', 'z', 'x']],
  ];
  const PARENTS: [string, (h: MathJsonExpression) => MathJsonExpression][] = [
    ['2 / h', (h) => ['Divide', 2, h]],
    ['y · h', (h) => ['Multiply', 'y', h]],
    ['h^2', (h) => ['Power', h, 2]],
    ['1 - h', (h) => ['Subtract', 1, h]],
    ['x · h / y', (h) => ['Divide', ['Multiply', 'x', h], 'y']],
  ];
  // `Coth` of a real operand declines in the `complex` mode (the existing
  // compiler wraps the real call).
  for (const [head, h] of HEADS)
    for (const mode of MODES.filter((m) => m === 'strict' || !head.startsWith('Coth')))
      test.each(PARENTS)(`%s with h = ${head} (${mode})`, (_name, parent) =>
        expectSameDoubles(parent(h), mode)
      );
});

describe('arithmetic of a call of a local function', () => {
  // The call has the type `unknown`, which the existing compiler reads as a
  // possible list: it writes each operation of the call with `_SYS.bcast`,
  // an operand of a product as one value.
  const DECLARATIONS_OF: [string, (body: MathJsonExpression) => MathJsonExpression][] = [
    ['declared unknown', (body) => ['Declare', 'lf', "'unknown'", ['Function', body, 'v']]],
    ['declared function', (body) => ['Declare', 'lf', "'function'", ['Function', body, 'v']]],
    ['a let', (body) => ['Assign', 'lf', ['Function', body, 'v']]],
  ];
  const program = (
    declare: (body: MathJsonExpression) => MathJsonExpression,
    body: MathJsonExpression,
    value: (c: MathJsonExpression) => MathJsonExpression
  ): MathJsonExpression => ['Block', declare(body), value(['lf', 'y'])] as MathJsonExpression;

  for (const [declaration, declare] of DECLARATIONS_OF) {
    test.each([
      ['x · (-1/3) / lf(y)', (c: MathJsonExpression) => ['Multiply', 'x', ['Divide', ['Rational', -1, 3], c]]],
      ['x / (y · lf(y))', (c: MathJsonExpression) => ['Divide', 'x', ['Multiply', 'y', c]]],
      ['x^(lf(y) + 1)', (c: MathJsonExpression) => ['Power', 'x', ['Add', c, 1]]],
    ] as [string, (c: MathJsonExpression) => MathJsonExpression][])(
      `%s declines (${declaration})`,
      (_name, value) =>
        expectDecline(program(declare, ['Multiply', 2, 'v'], value), 'strict', /which reads a call of a local function/)
    );
    test.each([
      ['2 · lf(y)', (c: MathJsonExpression) => ['Multiply', 2, c]],
      ['x · lf(y) · y', (c: MathJsonExpression) => ['Multiply', 'x', c, 'y']],
      ['lf(y) / x', (c: MathJsonExpression) => ['Divide', c, 'x']],
      ['x^lf(y)', (c: MathJsonExpression) => ['Power', 'x', c]],
      ['x + lf(y) / 3 + y', (c: MathJsonExpression) => ['Add', 'x', ['Divide', c, 3], 'y']],
      ['tanh(lf(y))', (c: MathJsonExpression) => ['Tanh', c]],
    ] as [string, (c: MathJsonExpression) => MathJsonExpression][])(
      `%s has the doubles of the existing compiler (${declaration})`,
      (_name, value) => expectSameDoubles(program(declare, ['Multiply', 2, 'v'], value), 'strict')
    );
    // The existing compiler reads the value of the call as a real number:
    // `Math.tanh` of the object is `NaN`, `x + lf(y)` a string.
    test.each([
      ['tanh(lf(y))', (c: MathJsonExpression) => ['Tanh', c]],
      ['x + lf(y)', (c: MathJsonExpression) => ['Add', 'x', c]],
      ['-lf(y)', (c: MathJsonExpression) => ['Negate', c]],
    ] as [string, (c: MathJsonExpression) => MathJsonExpression][])(
      `%s of a local function with a complex value declines (${declaration})`,
      (_name, value) =>
        expectDecline(
          program(declare, ['Complex', 0.5, -1], value),
          'strict',
          /the call lf\(y\) of a local function has a complex value/
        )
    );
  }
});
