import { ComputeEngine } from '../../src/compute-engine';
import { compile, canCompile } from '../../src/compile';
import { withRandomSeedFrame } from '../../src/compute-engine/boxed-expression/utils';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import {
  lowerStructuredFragment,
  lowerStructuredProgram,
  preparedNodesOf,
} from '../../src/compute-engine/compilation/javascript-structured-lower';
import {
  JAVASCRIPT_POLICY,
  verifyJavaScriptProgram,
} from '../../src/compute-engine/compilation/javascript-structured-policy';
import { verifyProgram } from '../../src/compute-engine/compilation/structured-verify';
import { analyzeExecution } from '../../src/compute-engine/compilation/structured-execution';
import { inPlaceUpdates } from '../../src/compute-engine/compilation/structured-in-place';
import type {
  IROperation,
  IRProgram,
  IRRegion,
} from '../../src/compute-engine/compilation/structured-ir';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// Random draws on the structured route of the JavaScript compiler (the
// `numeric-kernel` profile): the operation `draw`, helpers whose body draws,
// and `WithRandomSeed` as the region `seeded`
// (docs/plans/2026-11-11-structured-random-and-effects.md). For each program
// the profile gives the doubles of the existing compiler with `cse: false,
// constantFold: false`, and the value of the interpreter within the caveats:
// the same draws, in the same order, the same number of times, and only on
// the paths that run. Each program runs (a) inside `WithRandomSeed`, (b) in
// an interpreted seeded frame, with the position of the frame after the
// call, and (c) with `Math.random` replaced by a counter.

const EXISTING = { cse: false, constantFold: false } as const;
const PROFILE = { profile: 'numeric-kernel', fallback: false } as const;
const OPTIONS = { cse: false, constantFold: false } as const;

type Vars = Record<string, number | boolean | { re: number; im: number }>;

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('s', 'real');
  ce.declare('n', 'integer');
  ce.declare('C', 'boolean');
  ce.declare('L', 'list<real>');
  ce.declare('z', 'complex');
  return ce;
}

const VARS: Vars = { x: 0.5, y: -1.25, s: 3, n: 4, C: true };

/** The value of an interpreted result, as compiled code gives it. */
function valueOf(e: Expression): unknown {
  if (e.symbol === 'True') return true;
  if (e.symbol === 'False') return false;
  if (typeof e.re === 'number' && e.im === 0) return e.re;
  return e.json;
}

function boxed(ce: ComputeEngine, vars: Vars): Record<string, Expression> {
  return Object.fromEntries(
    Object.entries(vars).map(([k, v]) => [
      k,
      typeof v === 'boolean'
        ? v
          ? ce.True
          : ce.False
        : typeof v === 'number'
          ? ce.number(v)
          : ce.expr(['Complex', v.re, v.im]),
    ])
  );
}

/** The value of the interpreter for `expr` on `vars`: `expr` is the body
 *  of a function of the names of `vars`, applied to their values, so that
 *  the operands keep the order of the prepared tree (a substitution would
 *  make the canonical form again, which can order the operands otherwise). */
function interpret(ce: ComputeEngine, expr: Expression, vars: Vars): unknown {
  const values = boxed(ce, vars);
  const names = Object.keys(values);
  const lambda = ce.function('Function', [expr, ...names.map((name) => ce.symbol(name))]);
  return valueOf(ce.function('Apply', [lambda, ...names.map((name) => values[name])]).evaluate());
}

/** Whether the interpreter's value `i` agrees with the compiled value `a`
 *  within the caveats: a compiled `NaN` is the value of a real operation
 *  where the interpreter can give a complex number (`Sqrt(-0.3)`). */
function expectInterpreted(i: unknown, a: unknown) {
  if (typeof a === 'number' && Number.isNaN(a)) return;
  if (typeof a === 'number') expect(i as number).toBeCloseTo(a, 12);
  else expect(i).toEqual(a);
}

/** The two compilations of `expr`: the existing compiler and the profile,
 *  which must compile. */
function both(expr: Expression, options: object = {}) {
  const existing = compile(expr, { ...EXISTING, ...options, fallback: false });
  const profile = compile(expr, { ...PROFILE, ...options });
  expect(profile.success).toBe(true);
  expect(existing.success).toBe(true);
  return { existing, profile };
}

const runOf =
  (result: CompilationResult<'javascript'>, vars: Vars | unknown[]) =>
  (): unknown =>
    Array.isArray(vars)
      ? (result.run as unknown as (...a: unknown[]) => unknown)(...vars)
      : result.run!(vars as never);

/** `run()` in an interpreted frame seeded by `seed`, and the next number of
 *  the frame after it: the position of the stream after the call. */
const inFrame = (ce: ComputeEngine, seed: number, run: () => unknown) =>
  withRandomSeedFrame(ce, seed, () => {
    const value = run();
    return { value, next: ce._random() };
  });

/** `run()` with `Math.random` replaced by a counter: the value and the
 *  number of draws. Each draw has its own value, so equal values mean the
 *  same draws in the same places. */
function stubbed(run: () => unknown): { value: unknown; calls: number } {
  let calls = 0;
  const spy = jest
    .spyOn(Math, 'random')
    .mockImplementation(() => ((calls++ * 7919) % 1000) / 1000 + 0.0001);
  try {
    return { value: run(), calls };
  } finally {
    spy.mockRestore();
  }
}

/** The three checks of an expression `json` with inputs `vars`: equal
 *  doubles of the two compilers and the interpreter (within the caveats) in
 *  an interpreted frame, with the frame at the same position after, and
 *  with `Math.random` stubbed, with the same number of draws. */
function checkExpression(
  ce: ComputeEngine,
  json: MathJsonExpression,
  vars: Vars = VARS,
  draws?: number
) {
  const expr = ce.expr(json);
  const { existing, profile } = both(expr);
  for (const seed of [1, 7, 42]) {
    const a = inFrame(ce, seed, runOf(existing, vars));
    const b = inFrame(ce, seed, runOf(profile, vars));
    const i = inFrame(ce, seed, () => interpret(ce, expr, vars));
    expect(b).toEqual(a);
    expect(i.next).toBe(a.next);
    expectInterpreted(i.value, a.value);
  }
  const a = stubbed(runOf(existing, vars));
  const b = stubbed(runOf(profile, vars));
  const i = stubbed(() => interpret(ce, expr, vars));
  expect(b).toEqual(a);
  expect(i.calls).toBe(a.calls);
  expectInterpreted(i.value, a.value);
  if (draws !== undefined) expect(b.calls).toBe(draws);
  return { existing, profile, expr };
}

/** `checkExpression()` inside `WithRandomSeed(seed, json)`: equal doubles
 *  of the two compilers and the interpreter, whatever frame the caller
 *  holds, and twice the same value. */
function checkSeeded(ce: ComputeEngine, json: MathJsonExpression, seed: number | string = 42, vars: Vars = VARS) {
  const expr = ce.expr(['WithRandomSeed', typeof seed === 'string' ? `'${seed}'` : seed, json]);
  const { existing, profile } = both(expr);
  const a = runOf(existing, vars)();
  const b = runOf(profile, vars)();
  expect(b).toEqual(a);
  expect(runOf(profile, vars)()).toEqual(b);
  expect(inFrame(ce, 3, runOf(profile, vars)).value).toEqual(b);
  expectInterpreted(interpret(ce, expr, vars), a);
  expect(profile.pure).toBe(true);
  expect(profile.shippable).toBe(false);
  return { existing, profile, expr };
}

const draws = (code: string) => (code.match(/_SYS\.drawNextRandomNumber\(\)/g) ?? []).length;

const typed = (name: string, type: string): MathJsonExpression => ['Typed', name, `'${type}'`];
const fn = (body: MathJsonExpression[], ...parameters: [string, string][]): MathJsonExpression => [
  'Function',
  ['Block', ...body],
  ...parameters.map(([name, type]) => typed(name, type)),
];

/** The structured program of `expr`, lowered and verified. */
function lower(expr: Expression, testOperations?: ReadonlyMap<string, string>) {
  const preparation = new ScalarFragmentJavaScriptTarget('structured', testOperations).prepareStructured(
    expr,
    OPTIONS
  );
  return { program: lowerStructuredFragment(preparation), preparation };
}

/** Every operation of `region` and of the regions nested in it. */
function allOps(region: IRRegion): IROperation[] {
  const result: IROperation[] = [];
  for (const op of region.operations) {
    result.push(op);
    for (const inner of op.kind === 'if'
      ? [op.then, op.else]
      : op.kind === 'loop' || op.kind === 'build' || op.kind === 'seeded'
        ? [op.body]
        : op.kind === 'and' || op.kind === 'or'
          ? op.rest
          : [])
      result.push(...allOps(inner));
  }
  return result;
}

//
// Slice 1: draw
//

describe('draws, on the two routes', () => {
  test('Random() and the literal domains: one draw each, the arithmetic of the existing emitter', () => {
    const ce = engine();
    for (const [json, count] of [
      [['Random'], 1],
      [['Add', 'x', ['Random']], 1],
      [['Random', ['Interval', 2, 5]], 1],
      [['Random', ['Interval', ['Open', -0.1], 0.7]], 1],
      [['Random', ['Range', 1, 6]], 1],
      [['Random', ['Range', 10, 1]], 1],
      [['Random', ['Range', 1, 10, 3]], 1],
      [['Random', ['Range', 4]], 1],
      [['Floor', ['Multiply', 6, ['Random']]], 1],
      [['Sqrt', ['Random']], 1],
      [['Max', ['Random'], 'x', ['Random']], 2],
      [['Mod', ['Random'], 0.3], 1],
      [['Less', ['Random'], 0.5], 1],
    ] as [MathJsonExpression, number][]) {
      const { profile } = checkExpression(ce, json, VARS, count);
      expect(profile).toMatchObject({ pure: false, shippable: false });
    }
  });

  test('the result type of a Range domain is an integer', () => {
    const ce = engine();
    const { program } = lower(ce.expr(['Random', ['Range', 1, 6]]));
    const ops = program.root.operations;
    expect(ops.map((op) => op.kind)).toEqual([
      'draw',
      'literal',
      'literal',
      'literal',
      'multiply',
      'floor',
      'multiply',
      'add',
      'yield',
    ]);
    expect(ops[7].result?.type).toBe('integer');
    expect(ops[0]).toMatchObject({ effect: 'effectful', touches: ['random'] });
    expect(program.root).toMatchObject({ effect: 'effectful', touches: ['random'] });
  });

  test('order: Random() - 2·Random() draws in the canonical order', () => {
    const ce = engine();
    const json: MathJsonExpression = ['Subtract', ['Random'], ['Multiply', 2, ['Random']]];
    // The canonical form is Add(Multiply(-2, Random()), Random()): the first
    // draw is doubled.
    expect(ce.expr(json).json).toEqual(['Add', ['Multiply', -2, ['Random']], ['Random']]);
    const { profile } = checkExpression(ce, json, VARS, 2);
    const first = stubbed(runOf(profile, VARS));
    // The stub gives 0.0001, then 0.9191.
    expect(first.value).toBeCloseTo(-2 * 0.0001 + 0.9191, 12);
    // The pure twin, with a name in place of each draw, reads no stream.
    const twin = compile(ce.expr(['Subtract', 'x', ['Multiply', 2, 'y']]), PROFILE);
    expect(twin.pure).toBe(true);
    expect(stubbed(runOf(twin, VARS)).calls).toBe(0);
  });

  test('count: Power(Random(), 2) draws once; Sqrt(Random() - 0.5) is lowered with its draw', () => {
    const ce = engine();
    const { profile } = checkExpression(ce, ['Power', ['Random'], 2], VARS, 1);
    expect(draws(profile.code)).toBe(1);
    checkExpression(ce, ['Sqrt', ['Subtract', ['Random'], 0.5]], VARS, 1);
  });

  test('count: one node object at two places gives two draws', () => {
    const ce = engine();
    const r = ce.expr(['Random']);
    const sum = (ce as unknown as { _fn(h: string, ops: Expression[]): Expression })._fn('Max', [r, r]);
    expect(sum.ops[0]).toBe(sum.ops[1]);
    const { existing, profile } = both(sum);
    const a = stubbed(runOf(existing, VARS));
    const b = stubbed(runOf(profile, VARS));
    expect(b).toEqual(a);
    expect(b.calls).toBe(2);
    expect(stubbed(() => interpret(ce, sum, VARS)).calls).toBe(2);
    const { program } = lower(sum);
    expect(allOps(program.root).filter((op) => op.kind === 'draw')).toHaveLength(2);
  });

  test('conditional execution: a draw in each branch of an If is a statement of its branch', () => {
    const ce = engine();
    const json: MathJsonExpression = ['If', ['Less', 0, 'x'], ['Random'], ['Negate', ['Random']]];
    for (const x of [0.5, -0.5]) {
      const { profile } = checkExpression(ce, json, { ...VARS, x }, 1);
      expect(profile.code).toMatch(/if \(/);
    }
    // The pure twin is a conditional expression.
    const twin = compile(ce.expr(['If', ['Less', 0, 'x'], 'y', ['Negate', 'y']]), PROFILE);
    expect(twin.code).toMatch(/\?/);
    expect(twin.code).not.toMatch(/if \(/);
    // A draw in the condition runs once; one branch draws again.
    checkExpression(ce, ['If', ['Less', ['Random'], 0.5], ['Random'], 0], VARS);
  });

  test('conditional execution: a draw in a short-circuit operand of And and Or runs only when it decides', () => {
    const ce = engine();
    for (const C of [true, false]) {
      const and = checkExpression(ce, ['And', 'C', ['Less', ['Random'], 'x']], { ...VARS, C }, C ? 1 : 0);
      expect(and.profile.code).not.toMatch(/&&/);
      checkExpression(ce, ['Or', 'C', ['Less', ['Random'], 'x']], { ...VARS, C }, C ? 0 : 1);
    }
    const twin = compile(ce.expr(['And', 'C', ['Less', 'y', 'x']]), PROFILE);
    expect(twin.code).toMatch(/&&/);
  });

  test('conditional execution: a draw in a Which clause that is not taken does not run', () => {
    const ce = engine();
    const json: MathJsonExpression = [
      'Which',
      ['Less', 'x', 0],
      ['Random'],
      ['Less', 'x', 1],
      ['Multiply', 2, ['Random']],
      'True',
      3,
    ];
    checkExpression(ce, json, { ...VARS, x: -1 }, 1);
    checkExpression(ce, json, { ...VARS, x: 0.5 }, 1);
    checkExpression(ce, json, { ...VARS, x: 5 }, 0);
  });

  test('a Sum whose body draws: once per term in term order, written out (3 terms) or as a loop (200 terms)', () => {
    const ce = engine();
    const three = checkExpression(ce, ['Sum', ['Multiply', 'k', ['Random']], ['Limits', 'k', 1, 3]], VARS, 3);
    expect(draws(three.profile.code)).toBe(3);
    expect(three.profile.code).not.toMatch(/for \(/);
    // Term order: the stub gives 0.0001, 0.9191, 0.8381, so the sum is
    // 1·u1 + 2·u2 + 3·u3.
    expect(stubbed(runOf(three.profile, VARS)).value).toBeCloseTo(0.0001 + 2 * 0.9191 + 3 * 0.8381, 12);
    const many = checkExpression(ce, ['Sum', ['Random'], ['Limits', 'k', 1, 200]], VARS, 200);
    expect(draws(many.profile.code)).toBe(1);
    expect(many.profile.code).toMatch(/for \(/);
    // With a bound that is an input: the guard of the existing emitter.
    checkExpression(ce, ['Sum', ['Random'], ['Limits', 'k', 1, 'n']], VARS, 4);
    checkExpression(ce, ['Product', ['Add', 1, ['Random']], ['Limits', 'k', 1, 'n']], { ...VARS, n: 0 }, 0);
  });

  test('a draw in a loop body: once per iteration, and a Break after a draw stops the draws', () => {
    const ce = engine();
    const loop = (exit: boolean): MathJsonExpression =>
      fn(
        [
          ['Declare', 't', "'real'", 0],
          [
            'Loop',
            exit
              ? ['Block', ['Assign', 't', ['Add', 't', ['Random']]], ['If', ['Less', 1.5, 't'], ['Break']]]
              : ['Assign', 't', ['Add', 't', ['Random']]],
            ['Element', 'k', ['Range', 1, 'm']],
          ],
          't',
        ],
        ['m', 'integer']
      );
    for (const exit of [false, true]) {
      const expr = ce.expr(loop(exit));
      const { existing, profile } = both(expr);
      for (const m of [0, 3, 40]) {
        for (const seed of [1, 7]) {
          const a = inFrame(ce, seed, runOf(existing, [m]));
          const b = inFrame(ce, seed, runOf(profile, [m]));
          const i = inFrame(ce, seed, () => valueOf(ce.function('Apply', [expr, ce.number(m)]).evaluate()));
          expect(b).toEqual(a);
          expect(i.next).toBe(a.next);
          expect(i.value as number).toBeCloseTo(a.value as number, 12);
        }
        const a = stubbed(runOf(existing, [m]));
        const b = stubbed(runOf(profile, [m]));
        expect(b).toEqual(a);
        // `Range(1, 0)` has the two elements 1 and 0.
        if (!exit) expect(b.calls).toBe(Math.abs(m - 1) + 1);
        else if (m === 40) expect(b.calls).toBeLessThan(40);
      }
    }
  });

  test('a local whose value draws is drawn once, where it is declared', () => {
    const ce = engine();
    const expr = ce.expr(
      fn([['Declare', 't', "'real'", ['Random']], ['Add', 't', ['Multiply', 't', 'u']]], ['u', 'real'])
    );
    const { existing, profile } = both(expr);
    const a = stubbed(runOf(existing, [2]));
    expect(stubbed(runOf(profile, [2]))).toEqual(a);
    expect(a.calls).toBe(1);
  });

  test('the public result and canCompile() agree: not pure, not shippable', () => {
    const ce = engine();
    const expr = ce.expr(['Add', 'x', ['Random']]);
    expect(canCompile(expr, { profile: 'numeric-kernel' } as never)).toEqual({
      ok: true,
      pure: false,
      shippable: false,
    });
    expect(compile(expr, PROFILE)).toMatchObject({
      success: true,
      profile: 'numeric-kernel',
      pure: false,
      shippable: false,
    });
  });
});

describe('the analysis of a program that draws', () => {
  test('a draw outside every seeded region: not independent, not portable, with the reason that names the stream', () => {
    const ce = engine();
    const analysis = analyzeExecution(lower(ce.expr(['Add', 'x', ['Random']])).program);
    expect(analysis.independentCalls.holds).toBe(false);
    expect(analysis.independentCalls.blockers.map((b) => [b.kind, b.reason])).toEqual([
      ['draw', expect.stringMatching(/^draws from the random stream of the engine/)],
    ]);
    expect(analysis.workerPortable.holds).toBe(false);
    expect(analysis.workerPortable.blockers.map((b) => [b.kind, b.reason])).toEqual([
      ['draw', expect.stringMatching(/random stream .* worker/)],
    ]);
  });

  test('a loop whose body draws is not a candidate; a loop whose draws are seeded is', () => {
    const ce = engine();
    const body = (element: MathJsonExpression): MathJsonExpression =>
      fn(
        [
          ['Declare', 'A', "'list<real>'", ['Comprehension', ['Multiply', 0.5, 'j'], ['Element', 'j', ['Range', 1, 'm']]]],
          ['Loop', ['Assign', 'A', ['ReplaceAt', 'A', 'k', element]], ['Element', 'k', ['Range', 1, 'm']]],
          'A',
        ],
        ['m', 'integer']
      );
    const [drawing] = analyzeExecution(lower(ce.expr(body(['Random']))).program).parallelLoops;
    expect(drawing.candidate).toBe(false);
    if (!drawing.candidate) {
      expect(drawing.reason.kind).toBe('draw');
      expect(drawing.reason.reason).toMatch(/draws from the random stream of the engine: the values of a pass depend on the passes before it/);
    }
    const seededBody = body(['WithRandomSeed', 'k', ['Random']]);
    const analysis = analyzeExecution(lower(ce.expr(seededBody)).program);
    expect(analysis.parallelLoops[0].candidate).toBe(true);
    expect(analysis.independentCalls.holds).toBe(true);
    expect(analysis.workerPortable.holds).toBe(false);
    expect(analysis.workerPortable.blockers.map((b) => b.kind)).toEqual(['seeded', 'draw']);
    // The values agree on both routes.
    const expr = ce.expr(seededBody);
    const { existing, profile } = both(expr);
    expect(runOf(profile, [3])()).toEqual(runOf(existing, [3])());
    expect(profile).toMatchObject({ pure: true, shippable: false });
  });

  test('a call of a helper declared random whose body does not draw has the reasons of a draw', () => {
    const ce = engine();
    ce.declare('h', '(real) random -> real');
    ce.assign('h', ce.expr(['Function', ['Add', 'u', 1], typed('u', 'real')]));
    const analysis = analyzeExecution(lower(ce.expr(['Add', 'x', ['h', 'x']])).program);
    expect(analysis.independentCalls.blockers.map((b) => [b.kind, b.reason])).toEqual([
      ['call', expect.stringMatching(/^draws from the random stream of the engine: two calls/)],
    ]);
    expect(analysis.workerPortable.blockers.map((b) => [b.kind, b.reason])).toEqual([
      ['call', 'draws from the random stream of the engine, which the runtime of a worker does not share'],
    ]);
    const loop = fn(
      [
        ['Declare', 'A', "'list<real>'", ['Comprehension', ['Multiply', 0.5, 'j'], ['Element', 'j', ['Range', 1, 'm']]]],
        ['Loop', ['Assign', 'A', ['ReplaceAt', 'A', 'k', ['h', 'k']]], ['Element', 'k', ['Range', 1, 'm']]],
        'A',
      ],
      ['m', 'integer']
    );
    const [judgment] = analyzeExecution(lower(ce.expr(loop)).program).parallelLoops;
    expect(judgment.candidate).toBe(false);
    if (!judgment.candidate)
      expect(judgment.reason.reason).toBe(
        'the body draws from the random stream of the engine: the values of a pass depend on the passes before it'
      );
  });

  test('the reason of a seeded region for a worker names no target', () => {
    const ce = engine();
    const analysis = analyzeExecution(lower(ce.expr(['Add', 'x', ['WithRandomSeed', 3, ['Random']]])).program);
    const reasons = analysis.workerPortable.blockers.map((b) => b.reason);
    expect(reasons).toContain(
      'a seeded region of the random stream of the engine, whose frames the runtime of a worker does not have: the stream is not portable'
    );
    for (const reason of reasons) expect(reason).not.toMatch(/isShippableCode|JavaScript|_SYS/);
  });

  test('a call of a helper whose body draws is a blocker in the helper', () => {
    const ce = engine();
    executeEpsil(ce, 'function jitter(x: real) -> real { x + random() }');
    const analysis = analyzeExecution(lower(ce.expr(['Multiply', 2, ['jitter', 'x']])).program);
    expect(analysis.independentCalls.blockers.map((b) => [b.kind, b.function])).toEqual([['draw', 'jitter']]);
  });
});

//
// Slice 2: helpers with the effect random
//

describe('helpers whose body draws', () => {
  function helperEngine() {
    const ce = engine();
    const { diagnostics } = executeEpsil(
      ce,
      `function jitter(x: real) -> real { x + random() }
function walk(n: integer) -> real { let s = 0; for k in 1..n { s = s + random() - 0.5; if s > 2 { break } }; s }`
    );
    expect(diagnostics).toEqual([]);
    // Declared with no effect; the body draws.
    ce.declare('g', '(real) -> real');
    ce.assign('g', ce.expr(['Function', ['Add', 'u', ['Random']], typed('u', 'real')]));
    // Declared with the effect random; the body does not draw.
    ce.declare('h', '(real) random -> real');
    ce.assign('h', ce.expr(['Function', ['Add', 'u', 1], typed('u', 'real')]));
    // An inferred signature: `(t: unknown) random -> number`.
    ce.assign('f7', ce.expr(['Function', ['Add', 't', ['Random']], 't']));
    return ce;
  }

  test('a helper called twice draws at each call, in order', () => {
    const ce = helperEngine();
    expect(String(ce.expr('jitter').type)).toBe('(x: real) random -> real');
    const { profile } = checkExpression(ce, ['Subtract', ['jitter', 'x'], ['Multiply', 2, ['jitter', 'y']]], VARS, 2);
    expect(`${profile.preamble ?? ''}${profile.code}`.match(/function /g)).toHaveLength(1);
    checkSeeded(ce, ['Add', ['jitter', 'x'], ['jitter', 'x']]);
  });

  test('a helper with a loop and a break that draws', () => {
    const ce = helperEngine();
    checkExpression(ce, ['walk', 10]);
    checkExpression(ce, ['Add', ['walk', 3], ['walk', 'n']]);
  });

  test('a helper declared with no effect whose body draws: the call has the effect of its body', () => {
    const ce = helperEngine();
    checkExpression(ce, ['Add', ['g', 'x'], ['g', 'y']], VARS, 2);
    const { program } = lower(ce.expr(['g', 'x']));
    const call = program.root.operations.find((op) => op.kind === 'call')!;
    expect(call).toMatchObject({ effect: 'effectful', touches: ['random'] });
  });

  test('a helper declared random whose body does not draw: the call is ordered and the value is unchanged', () => {
    const ce = helperEngine();
    checkExpression(ce, ['Add', ['h', 'x'], ['h', 'y']], VARS, 0);
    const { program } = lower(ce.expr(['h', 'x']));
    const call = program.root.operations.find((op) => op.kind === 'call')!;
    expect(call).toMatchObject({ effect: 'effectful', touches: ['random'] });
    expect(program.functions[0].body.effect).toBe('pure');
    expect(compile(ce.expr(['h', 'x']), PROFILE)).toMatchObject({ pure: false, shippable: false });
  });

  test('a helper with an inferred signature that draws', () => {
    const ce = helperEngine();
    expect(String(ce.expr('f7').type)).toBe('(t: unknown) random -> number');
    checkExpression(ce, ['f7', 'x'], VARS, 1);
  });

  test('a call of a helper inside an interpreted frame advances the frame of the caller across two calls', () => {
    const ce = helperEngine();
    const expr = ce.expr(['jitter', 'x']);
    const { existing, profile } = both(expr);
    const twice = (result: CompilationResult<'javascript'>) => () => [
      runOf(result, VARS)(),
      runOf(result, VARS)(),
    ];
    expect(inFrame(ce, 11, twice(profile))).toEqual(inFrame(ce, 11, twice(existing)));
  });
});

//
// Slice 3: WithRandomSeed
//

describe('WithRandomSeed', () => {
  test('a seeded region: the doubles of the two compilers and of the interpreter, pure and not shippable', () => {
    const ce = engine();
    checkSeeded(ce, ['Random']);
    checkSeeded(ce, ['Add', ['Random'], ['Multiply', 10, ['Random']]]);
    checkSeeded(ce, ['Random', ['Range', 1, 6]], 5);
    checkSeeded(ce, ['If', ['Less', ['Random'], 0.5], ['Random'], ['Negate', ['Random']]]);
    checkSeeded(ce, ['Sum', ['Random'], ['Limits', 'k', 1, 150]], 9);
    checkSeeded(ce, ['Add', 'x', ['Random']], 'abc');
    expect(canCompile(ce.expr(['WithRandomSeed', 42, ['Random']]), { profile: 'numeric-kernel' } as never)).toEqual({
      ok: true,
      pure: true,
      shippable: false,
    });
  });

  test('the region discharges random: pure, with no state, and its body touches random', () => {
    const ce = engine();
    const { program } = lower(ce.expr(['WithRandomSeed', 42, ['Add', 'x', ['Random']]]));
    const seeded = program.root.operations.find((op) => op.kind === 'seeded')!;
    expect(seeded).toMatchObject({ effect: 'pure', seed: 42, operands: [] });
    expect(seeded.touches).toBeUndefined();
    if (seeded.kind === 'seeded') expect(seeded.body).toMatchObject({ effect: 'effectful', touches: ['random'] });
    expect(program.root.effect).toBe('pure');
    const analysis = analyzeExecution(program);
    expect(analysis.independentCalls.holds).toBe(true);
    expect(analysis.workerPortable.blockers.map((b) => b.kind)).toEqual(['seeded', 'draw']);
  });

  test('a seed that is an input: evaluated before the region, and the region can abort', () => {
    const ce = engine();
    const json: MathJsonExpression = ['WithRandomSeed', 's', ['Add', ['Random'], ['Random']]];
    const expr = ce.expr(json);
    const { existing, profile } = both(expr);
    for (const s of [0, 3, -2.5, 1e9])
      expect(runOf(profile, { s })()).toBe(runOf(existing, { s })());
    expect(runOf(profile, { s: 3 })()).toBeCloseTo(interpret(ce, expr, { s: 3 }) as number, 12);
    const { program } = lower(expr);
    expect(program.root.operations.map((op) => op.kind)).toEqual(['input', 'seeded', 'yield']);
    expect(program.root.canAbort).toBe(true);
    expect(profile).toMatchObject({ pure: true, shippable: false });
  });

  test('a draw in the seed is a draw of the caller', () => {
    const ce = engine();
    const { profile } = checkExpression(ce, ['WithRandomSeed', ['Random'], ['Random']], VARS, 1);
    expect(profile.pure).toBe(false);
  });

  test('an invalid seed throws on both compilers and leaves the frame of the caller in place', () => {
    const ce = engine();
    const { existing, profile } = both(ce.expr(['WithRandomSeed', 's', ['Random']]));
    for (const result of [existing, profile]) {
      const outcome = withRandomSeedFrame(ce, 5, () => {
        let thrown = false;
        try {
          runOf(result, { s: NaN })();
        } catch {
          thrown = true;
        }
        return { thrown, next: ce._random() };
      });
      expect(outcome.thrown).toBe(true);
      expect(outcome.next).toBe(withRandomSeedFrame(ce, 5, () => ce._random()));
    }
  });

  test('nested regions', () => {
    const ce = engine();
    checkSeeded(ce, ['Add', ['Random'], ['WithRandomSeed', 2, ['Random']], ['Random']], 1);
    const { program } = lower(
      ce.expr(['WithRandomSeed', 1, ['Add', ['Random'], ['WithRandomSeed', 2, ['Random']], ['Random']]])
    );
    expect(allOps(program.root).filter((op) => op.kind === 'seeded')).toHaveLength(2);
  });

  test('a region next to a draw of the caller', () => {
    const ce = engine();
    const { profile } = checkExpression(ce, ['Add', ['Random'], ['WithRandomSeed', 3, ['Random']], ['Random']], VARS, 2);
    expect(profile.pure).toBe(false);
  });

  test('a region in a loop body, and a comprehension of seeded draws', () => {
    const ce = engine();
    const expr = ce.expr(
      fn(
        [
          ['Declare', 't', "'real'", 0],
          ['Loop', ['Assign', 't', ['Add', 't', ['WithRandomSeed', 'k', ['Random']]]], ['Element', 'k', ['Range', 1, 'm']]],
          't',
        ],
        ['m', 'integer']
      )
    );
    const { existing, profile } = both(expr);
    expect(runOf(profile, [5])()).toBe(runOf(existing, [5])());
    expect(runOf(profile, [5])()).toBeCloseTo(
      valueOf(ce.function('Apply', [expr, ce.number(5)]).evaluate()) as number,
      12
    );
    expect(profile).toMatchObject({ pure: true, shippable: false });
    const list = ce.expr(['Comprehension', ['WithRandomSeed', 'k', ['Random']], ['Element', 'k', ['Range', 1, 3]]]);
    const lists = both(list);
    expect(runOf(lists.profile, VARS)()).toEqual(runOf(lists.existing, VARS)());
    const interpreted = list.evaluate();
    expect([1, 2, 3].map((i) => ce.function('At', [interpreted, ce.number(i)]).evaluate().re)).toEqual(
      runOf(lists.profile, VARS)()
    );
  });

  test('a constant region runs at each call, with the value of the memo of the existing compiler', () => {
    const ce = engine();
    const expr = ce.expr(['WithRandomSeed', 42, ['Add', ['Random'], ['Random']]]);
    const { existing, profile } = both(expr);
    expect(existing.preamble ?? '').toMatch(/withRandomSeed/);
    const values = [runOf(existing, {})(), runOf(existing, {})(), runOf(profile, {})(), runOf(profile, {})()];
    expect(new Set(values).size).toBe(1);
    expect(draws(profile.code)).toBe(2);
  });

  test('a complex seed in the complex mode is read as its real part', () => {
    const ce = engine();
    const expr = ce.expr(['WithRandomSeed', 'z', ['Random']]);
    const existing = compile(expr, { ...EXISTING, mode: 'complex', fallback: false });
    const profile = compile(expr, { ...PROFILE, mode: 'complex' } as never);
    expect(profile.success).toBe(true);
    const z = { re: 3, im: 0 };
    expect(runOf(profile, { z })()).toBe(runOf(existing, { z })());
    expect(runOf(profile, { z })()).toBe(runOf(both(ce.expr(['WithRandomSeed', 3, ['Random']])).profile, {})());
    expect(() => runOf(profile, { z: { re: 3, im: 1 } })()).toThrow(/finite real number or a string seed/);
    expect(() => runOf(existing, { z: { re: 3, im: 1 } })()).toThrow(/finite real number or a string seed/);
    // In the strict mode a complex seed declines.
    expect(compile(expr, { ...PROFILE, fallback: true } as never).success).toBe(false);
  });

  test('a list updated inside a region and read after it is copied, not updated in place', () => {
    const ce = engine();
    const expr = ce.expr(
      fn(
        [
          ['Declare', 'B', "'list<real>'", ['Comprehension', ['Multiply', 0.5, 'k'], ['Element', 'k', ['Range', 1, 3]]]],
          ['Declare', 't', "'real'", ['WithRandomSeed', 4, ['At', ['ReplaceAt', 'B', 1, ['Random']], 1]]],
          ['Add', 't', ['At', 'B', 1]],
        ],
        ['m', 'integer']
      )
    );
    const { program } = lower(expr);
    const replace = allOps(program.root).find((op) => op.kind === 'replace-at')!;
    expect(inPlaceUpdates(program).has(replace)).toBe(false);
    const { existing, profile } = both(expr);
    expect(runOf(profile, [1])()).toBe(runOf(existing, [1])());
    expect(runOf(profile, [1])()).toBeCloseTo(
      valueOf(ce.function('Apply', [expr, ce.number(1)]).evaluate()) as number,
      12
    );
  });
});

//
// Shared subexpressions: a node object reached twice is lowered once only
// when every operation of its lowering is pure and cannot abort
//

describe('shared node objects and draws', () => {
  const make = (ce: ComputeEngine, head: string, ops: Expression[]) =>
    (ce as unknown as { _fn(h: string, ops: Expression[]): Expression })._fn(head, ops);
  const count = (program: IRProgram, kind: IROperation['kind']) =>
    [...program.functions.map((f) => f.body), program.root]
      .flatMap((region) => allOps(region))
      .filter((op) => op.kind === kind).length;
  /** Equal values and an equal number of draws on the two compilers, in an
   *  interpreted frame and with `Math.random` stubbed. */
  const sameDraws = (ce: ComputeEngine, expr: Expression, vars: Vars = VARS) => {
    const { existing, profile } = both(expr);
    for (const seed of [1, 7])
      expect(inFrame(ce, seed, runOf(profile, vars))).toEqual(inFrame(ce, seed, runOf(existing, vars)));
    const a = stubbed(runOf(existing, vars));
    expect(stubbed(runOf(profile, vars))).toEqual(a);
    return { existing, profile, calls: a.calls };
  };

  test('a node that draws, reached twice, draws twice; so does a pure node above a draw', () => {
    const ce = engine();
    const r = ce.expr(['Random']);
    const twice = make(ce, 'Add', [r, r]);
    expect(twice.ops[0]).toBe(twice.ops[1]);
    expect(sameDraws(ce, twice).calls).toBe(2);
    expect(count(lower(twice).program, 'draw')).toBe(2);
    // `Sqrt(Random())` has a pure fact of its own; its lowering draws.
    const root = ce.expr(['Sqrt', ['Random']]);
    const both2 = make(ce, 'Max', [root, root]);
    expect(sameDraws(ce, both2).calls).toBe(2);
    expect(count(lower(both2).program, 'draw')).toBe(2);
    expect(count(lower(both2).program, 'sqrt')).toBe(2);
  });

  test('a draw-free doubling graph of depth 40 in a comprehension body: the draw tests visit each node object once', () => {
    const ce = engine();
    const comp = ce.expr(['Comprehension', ['Add', 'x', 'j'], ['Element', 'j', ['Range', 1, 2]]]);
    let e = comp.op1;
    for (let i = 0; i < 40; i++) e = make(ce, 'Add', [e, e]);
    const deep = (ce as unknown as { _fn(h: string, ops: Expression[], o?: object): Expression })._fn(
      'Comprehension',
      [e, comp.op2],
      comp.localScope ? { scope: comp.localScope } : undefined
    );
    const expr = make(ce, 'Add', [make(ce, 'At', [deep, ce.number(1)]), ce.expr(['Random'])]);
    const start = Date.now();
    const result = compile(expr, PROFILE);
    expect(Date.now() - start).toBeLessThan(5000);
    expect(result.success).toBe(true);
    expect(draws(result.code)).toBe(1);
  });

  test('a pure node next to a draw is still lowered once', () => {
    const ce = engine();
    const s = ce.expr(['Sin', 'x']);
    const expr = make(ce, 'Add', [s, ce.expr(['Random']), s]);
    expect(sameDraws(ce, expr).calls).toBe(1);
    const { program } = lower(expr);
    expect(program.root.operations.filter((op) => op.kind === 'unary' && op.fn === 'sin')).toHaveLength(1);
  });

  test('a seeded region reached twice: shared with a literal seed, lowered twice with a seed that can abort', () => {
    const ce = engine();
    const literal = ce.expr(['WithRandomSeed', 5, ['Add', 'x', ['Random']]]);
    const shared = make(ce, 'Add', [literal, literal]);
    sameDraws(ce, shared);
    expect(count(lower(shared).program, 'seeded')).toBe(1);
    expect(runOf(both(shared).profile, VARS)()).toBe(2 * (runOf(both(literal).profile, VARS)() as number));
    const input = ce.expr(['WithRandomSeed', 's', ['Add', 'x', ['Random']]]);
    const twice = make(ce, 'Add', [input, input]);
    sameDraws(ce, twice);
    expect(count(lower(twice).program, 'seeded')).toBe(2);
  });

  test('one call node of a helper whose body draws, reached twice, calls twice', () => {
    const ce = engine();
    executeEpsil(ce, 'function jitter(x: real) -> real { x + random() }');
    const call = ce.expr(['jitter', 'x']);
    const expr = make(ce, 'Add', [call, call]);
    expect(sameDraws(ce, expr).calls).toBe(2);
    const { program } = lower(expr);
    expect(count(program, 'call')).toBe(2);
    expect(count(program, 'draw')).toBe(1);
  });
});

describe('the forms of the new base with draws', () => {
  test('a root Block with draws in its statements', () => {
    const ce = engine();
    const json: MathJsonExpression = [
      'Block',
      ['Declare', 't', "'real'", ['Random']],
      ['Declare', 'v', "'real'", ['Add', 't', ['Multiply', 2, ['Random']]]],
      ['Add', 'x', 'v', ['Random']],
    ];
    const expr = ce.expr(json);
    const { existing, profile } = both(expr);
    for (const seed of [1, 7])
      expect(inFrame(ce, seed, runOf(profile, VARS))).toEqual(inFrame(ce, seed, runOf(existing, VARS)));
    const a = stubbed(runOf(existing, VARS));
    expect(stubbed(runOf(profile, VARS))).toEqual(a);
    expect(a.calls).toBe(3);
  });

  test('a product with a quotient factor that draws', () => {
    const ce = engine();
    for (const json of [
      ['Multiply', ['Random'], ['Divide', 1, 'y']],
      ['Multiply', 'x', ['Divide', ['Random'], 'y']],
      ['Multiply', ['Divide', ['Random'], 'y'], ['Random']],
      ['Divide', ['Random'], ['Add', 'y', ['Random']]],
    ] as MathJsonExpression[])
      checkExpression(ce, json);
  });
});

describe('the lane of a seeded region and draws in complex values', () => {
  const COMPLEX = { mode: 'complex' } as const;
  /** The value that the code of `result` makes before `run()` turns
   *  `{re, im: 0}` into a number. */
  const raw = (result: CompilationResult<'javascript'>, vars: Vars) =>
    (result.run as unknown as { rawCall(v: unknown): unknown }).rawCall(vars);

  test('in the complex mode a real body of a wide type is a complex value, as the existing compiler writes it', () => {
    const ce = engine();
    for (const json of [
      ['WithRandomSeed', 42, ['Power', 'x', 1.6]],
      ['Add', ['WithRandomSeed', 42, ['Add', ['Power', 'x', 1.6], ['Random']]], 'x'],
      ['Multiply', ['WithRandomSeed', 's', ['Power', ['Add', 'x', ['Random']], 1.6]], 'z'],
    ] as MathJsonExpression[]) {
      const expr = ce.expr(json);
      const { existing, profile } = both(expr, COMPLEX);
      const vars: Vars = { ...VARS, z: { re: 0.5, im: -2 } };
      expect(raw(profile, vars)).toEqual(raw(existing, vars));
      expect(raw(profile, vars)).toMatchObject({ im: expect.any(Number) });
      expect(runOf(profile, vars)()).toEqual(runOf(existing, vars)());
    }
  });

  test('a boolean body in the complex mode, as in the strict mode', () => {
    const ce = engine();
    for (const options of [{}, COMPLEX])
      for (const json of [
        ['If', ['WithRandomSeed', 3, ['Less', ['Random'], 0.5]], 1, 2],
        ['If', ['WithRandomSeed', 4, ['Greater', ['Random'], 0.5]], 1, ['Random']],
      ] as MathJsonExpression[]) {
        const expr = ce.expr(json);
        const { existing, profile } = both(expr, options);
        for (const seed of [1, 7])
          expect(inFrame(ce, seed, runOf(profile, VARS))).toEqual(inFrame(ce, seed, runOf(existing, VARS)));
        expect(stubbed(runOf(profile, VARS))).toEqual(stubbed(runOf(existing, VARS)));
      }
  });

  test('a real type keeps the real lane in both modes', () => {
    const ce = engine();
    for (const options of [{}, COMPLEX]) {
      const expr = ce.expr(['Add', ['WithRandomSeed', 3, ['Add', 'x', ['Random']]], 'x']);
      const { existing, profile } = both(expr, options);
      expect(raw(profile, VARS)).toBe(raw(existing, VARS));
      expect(typeof raw(profile, VARS)).toBe('number');
    }
  });

  test('one draw in a complex value is admitted, and so are draws in a seeded region beside a complex value with no draw', () => {
    const ce = engine();
    for (const json of [
      ['Add', 'x', ['Sqrt', ['Random', ['Range', -2, 8, 2]]]],
      ['Multiply', ['Random'], ['Complex', 1, 2]],
    ] as MathJsonExpression[]) {
      const expr = ce.expr(json);
      const { existing, profile } = both(expr, COMPLEX);
      expect(stubbed(runOf(profile, VARS))).toEqual(stubbed(runOf(existing, VARS)));
      expect(stubbed(runOf(profile, VARS)).calls).toBe(1);
    }
  });

  test('a draw from a literal domain is one operand of a complex sum, in parentheses as the existing emitter writes it', () => {
    const ce = engine();
    const vars: Vars = { ...VARS, z: { re: 0.5, im: -2 } };
    for (const [json, options] of [
      [['Add', 'z', ['Random', ['Range', -2, 8, 2]]], {}],
      [['Subtract', 'z', ['Random', ['Interval', -1, 2]]], {}],
      [['Add', ['Random', ['Interval', 0.5, 7]], 'x'], COMPLEX],
    ] as [MathJsonExpression, object][]) {
      const expr = ce.expr(json);
      const { existing, profile } = both(expr, options);
      expect(profile.code).toMatch(/\+ -?\(-?[0-9.]+ \+ /);
      expect(stubbed(runOf(profile, vars))).toEqual(stubbed(runOf(existing, vars)));
    }
  });
});

//
// The verifier
//

describe('the verifier of draws and seeded regions', () => {
  const ce = engine();
  // `console` is an impurity label: the definition states an effect.
  ce.declare('Trace', { signature: '(real) -> real', effects: ['console'], evaluate: (ops: readonly Expression[]) => ops[0] } as never);
  // `pure: false` states no effect set: the effects are unknown.
  ce.declare('Mystery', { signature: '(real) -> real', pure: false, evaluate: (ops: readonly Expression[]) => ops[0] } as never);
  const TESTS = new Map([
    ['Trace', 'trace'],
    ['Mystery', 'mystery'],
  ]);

  /** The program of `json`, lowered, and its prepared nodes. */
  const made = (json: MathJsonExpression) => {
    const { program, preparation } = lower(ce.expr(json), TESTS);
    return { program, nodes: preparedNodesOf(preparation) };
  };
  const seededOf = (program: IRProgram) =>
    program.root.operations.find((op) => op.kind === 'seeded') as Extract<IROperation, { kind: 'seeded' }>;
  /** `program` with the seeded operation replaced by `change(seeded)`, and
   *  the root summarized again with the effect `rootEffect`. */
  const withSeeded = (
    program: IRProgram,
    change: Partial<Extract<IROperation, { kind: 'seeded' }>>,
    root: Partial<IRRegion> = {}
  ): IRProgram => ({
    ...program,
    root: {
      ...program.root,
      ...root,
      operations: program.root.operations.map((op) => (op.kind === 'seeded' ? ({ ...op, ...change } as IROperation) : op)),
    },
  });

  test('control: the lowered programs verify', () => {
    for (const json of [
      ['WithRandomSeed', 1, ['Add', ['Mystery', 'x'], ['Random']]],
      ['WithRandomSeed', 1, ['Add', ['Trace', 'x'], ['Random']]],
      ['WithRandomSeed', 'x', ['Random']],
    ] as MathJsonExpression[]) {
      const { program, nodes } = made(json);
      expect(() => verifyJavaScriptProgram(program, nodes)).not.toThrow();
    }
  });

  test('an unknown body is never discharged', () => {
    const { program, nodes } = made(['WithRandomSeed', 1, ['Add', ['Mystery', 'x'], ['Random']]]);
    const seeded = seededOf(program);
    // The body has an unknown operation and a draw: the region stays unknown.
    expect(seeded.body).toMatchObject({ effect: 'unknown', touches: ['random'] });
    expect(seeded.effect).toBe('unknown');
    expect(seeded.touches).toBeUndefined();
    expect(() => verifyJavaScriptProgram(withSeeded(program, { effect: 'pure' }, { effect: 'pure' }), nodes)).toThrow(
      /a seeded has the effect pure and the states none, and its body discharged gives unknown and none/
    );
  });

  test('a seeded discharges random only', () => {
    const { program, nodes } = made(['WithRandomSeed', 1, ['Add', ['Trace', 'x'], ['Random']]]);
    const seeded = seededOf(program);
    expect(seeded).toMatchObject({ effect: 'effectful', touches: ['console'] });
    expect(program.root).toMatchObject({ effect: 'effectful', touches: ['console'] });
    expect(() =>
      verifyJavaScriptProgram(withSeeded(program, { effect: 'pure', touches: undefined }, { effect: 'pure', touches: undefined }), nodes)
    ).toThrow(/a seeded has the effect pure and the states none, and its body discharged gives effectful and console/);
    expect(() => verifyJavaScriptProgram(withSeeded(program, { touches: ['console', 'random'] }), nodes)).toThrow(
      /a seeded has the effect effectful and the states console, random/
    );
  });

  test('the analysis of a seeded body with another effect names that effect, not the draw', () => {
    const { program } = made(['WithRandomSeed', 1, ['Add', ['Trace', 'x'], ['Random']]]);
    const analysis = analyzeExecution(program);
    expect(analysis.independentCalls.blockers.map((b) => [b.kind, b.reason])).toEqual([
      ['trace', 'an operation whose definition states an effect'],
    ]);
    const loop = made(
      fn(
        [
          ['Declare', 't', "'real'", 0],
          ['Loop', ['Assign', 't', ['Add', 't', ['WithRandomSeed', 'k', ['Add', ['Random'], ['Trace', 'x']]]]], ['Element', 'k', ['Range', 1, 'm']]],
          't',
        ],
        ['m', 'integer'],
        ['x', 'real']
      )
    );
    const [judgment] = analyzeExecution(loop.program).parallelLoops;
    expect(judgment.candidate).toBe(false);
    if (!judgment.candidate) expect(judgment.reason.kind).toBe('trace');
  });

  test('a wrong summary of the states of a region', () => {
    const { program, nodes } = made(['Add', 'x', ['Random']]);
    expect(() => verifyJavaScriptProgram({ ...program, root: { ...program.root, touches: undefined } }, nodes)).toThrow(
      /the states of a region \(none\) do not agree with its operations \(random\)/
    );
    expect(() =>
      verifyJavaScriptProgram({ ...program, root: { ...program.root, touches: ['console', 'random'] } }, nodes)
    ).toThrow(/the states of a region \(console, random\) do not agree with its operations \(random\)/);
  });

  test('a draw that names another state, a pure draw, an effectful operation with no state, a pure one with a state', () => {
    const { program, nodes } = made(['Add', 'x', ['Random']]);
    const change = (f: (op: IROperation) => IROperation | undefined) => ({
      ...program,
      root: { ...program.root, operations: program.root.operations.map((op) => f(op) ?? op) },
    });
    expect(() =>
      verifyJavaScriptProgram(change((op) => (op.kind === 'draw' ? { ...op, touches: ['console'] } : undefined)), nodes)
    ).toThrow(/a draw has the effect effectful and the states console, not effectful and random/);
    expect(() =>
      verifyJavaScriptProgram(change((op) => (op.kind === 'draw' ? { ...op, touches: undefined } : undefined)), nodes)
    ).toThrow(/the effectful operation draw names no state that it touches/);
    expect(() =>
      verifyJavaScriptProgram(change((op) => (op.kind === 'add' ? { ...op, touches: ['random'] } : undefined)), nodes)
    ).toThrow(/the pure operation add touches the states random/);
  });

  test('an if that omits the state of its region', () => {
    const { program, nodes } = made(['If', 'C', ['Random'], 0]);
    const broken = {
      ...program,
      root: {
        ...program.root,
        operations: program.root.operations.map((op) =>
          op.kind === 'if' ? ({ ...op, touches: ['console'] } as IROperation) : op
        ),
        touches: ['console'],
      },
    };
    expect(() => verifyJavaScriptProgram(broken, nodes)).toThrow(
      /the states of the operation if \(console\) omit the state random of its region/
    );
  });

  test('a seeded with a malformed seed', () => {
    const { program, nodes } = made(['WithRandomSeed', 1, ['Random']]);
    expect(() => verifyJavaScriptProgram(withSeeded(program, { seed: undefined }), nodes)).toThrow(
      /a seeded with no seed operand has the literal seed undefined/
    );
    expect(() => verifyJavaScriptProgram(withSeeded(program, { seed: Infinity }), nodes)).toThrow(
      /the literal seed Infinity, not a finite number or a string/
    );
  });

  test('a target with no draw refuses it', () => {
    const { program, nodes } = made(['Add', 'x', ['Random']]);
    const { draw: _draw, seeded: _seeded, ...operations } = JAVASCRIPT_POLICY.operations;
    const policy = { ...JAVASCRIPT_POLICY, name: 'NODRAW', operations };
    expect(() => verifyProgram(program, nodes, policy)).toThrow(/NODRAW structured representation: the target has no draw operation/);
    const seeded = made(['WithRandomSeed', 1, 'x']);
    expect(() => verifyProgram(seeded.program, seeded.nodes, policy)).toThrow(/the target has no seeded operation/);
  });

  test('an exit in a seeded region does not leave the loop outside it', () => {
    // Made: the body of a seeded region with an exit, in the body of a loop.
    const expr = ce.expr(
      fn(
        [
          ['Declare', 't', "'real'", 0],
          ['Loop', ['Block', ['Assign', 't', ['Add', 't', ['WithRandomSeed', 'k', ['Random']]]], ['If', ['Less', 2, 't'], ['Break']]], ['Element', 'k', ['Range', 1, 'm']]],
          't',
        ],
        ['m', 'integer']
      )
    );
    const preparation = new ScalarFragmentJavaScriptTarget('structured').prepareStructured(expr, OPTIONS);
    const program = lowerStructuredProgram(preparation);
    const nodes = preparedNodesOf(preparation);
    expect(() => verifyJavaScriptProgram(program, nodes)).not.toThrow();
    const loop = program.root.operations.find((op) => op.kind === 'loop') as Extract<IROperation, { kind: 'loop' }>;
    const exitIf = loop.body.operations.find((op) => op.kind === 'if') as Extract<IROperation, { kind: 'if' }>;
    const seededIndex = loop.body.operations.findIndex((op) => op.kind === 'seeded');
    const seeded = loop.body.operations[seededIndex] as Extract<IROperation, { kind: 'seeded' }>;
    // Move the exit into the body of the seeded region.
    const exit = exitIf.then.operations[exitIf.then.operations.length - 1];
    const body = { ...seeded.body, operations: [exit] };
    const bodyOps = [...loop.body.operations];
    bodyOps[seededIndex] = { ...seeded, body };
    const root = program.root.operations.map((op) => (op === loop ? { ...loop, body: { ...loop.body, operations: bodyOps } } : op));
    expect(() => verifyJavaScriptProgram({ ...program, root: { ...program.root, operations: root } }, nodes)).toThrow(
      /a region that is not a branch of an if is closed \(seeded\)/
    );
  });
});

//
// What stays declined
//

describe('the declines that stay, each with the cause in its message', () => {
  const ce = engine();
  ce.assign('r', ce.expr(['Hold', ['Random']]));
  const declines: [string, MathJsonExpression, RegExp, object?][] = [
    [
      'a draw in a comprehension (the interpreter draws when an element is read)',
      ['At', ['Comprehension', ['Random'], ['Element', 'k', ['Range', 1, 3]]], 1],
      /draws from the random stream: the interpreter's comprehension is a lazy view/,
    ],
    [
      'a draw in a comprehension inside a seeded region',
      ['WithRandomSeed', 7, ['At', ['Comprehension', ['Random'], ['Element', 'k', ['Range', 1, 3]]], 1]],
      /the interpreter's comprehension is a lazy view/,
    ],
    ['RandomChoice', ['RandomChoice', 'L', 2], /unsupported head RandomChoice/],
    ['RandomSample', ['RandomSample', 'L', 2], /unsupported head RandomSample/],
    ['RandomShuffle', ['RandomShuffle', 'L'], /unsupported head RandomShuffle/],
    ['a run-time Range domain', ['Random', ['Range', 1, 'n']], /drawn from at run time/],
    ['a run-time Interval domain', ['Random', ['Interval', 0, 'x']], /drawn from at run time/],
    ['a list domain', ['Random', 'L'], /drawn from at run time/],
    ['a Range with a step that is not an integer', ['Random', ['Range', 1, 2, 0.5]], /drawn from at run time/],
    ['an empty Interval', ['Random', ['Interval', 2, 2]], /Random\(Interval\(2, 2\)\) is not in the profile/],
    ['a seed that is a string expression', ['WithRandomSeed', ['String', "'a'", "'b'"], ['Random']], /String/],
    ['a boolean seed', ['WithRandomSeed', 'C', ['Random']], /the seed C of the type boolean/],
    ['a region whose value is a list', ['WithRandomSeed', 1, 'L'], /list operand L/],
    ['a binding whose value draws', ['Add', 'r', 1], /unsupported binding r/],
    ['a lambda that draws', ['Map', ['Function', ['Add', 'u', ['Random']], 'u'], 'L'], /Map whose function has the node Random\(\), which is not pure, draws/],
    [
      'a draw in the domain of a comprehension (the interpreter evaluates it when the list is read)',
      fn(
        [
          ['Declare', 'A', "'list<integer>'", ['Comprehension', 'j', ['Element', 'j', ['Range', 1, ['Add', 2, ['Random', ['Range', 1, 3]]]]]]],
          ['Declare', 'r', "'real'", ['Random']],
          ['Add', ['Multiply', 1000, 'r'], ['Length', 'A']],
        ],
        ['u', 'real']
      ),
      /the comprehension .* draws from the random stream/,
    ],
    [
      'two draws, one in a complex value (the existing emitter binds a complex operand first)',
      ['Add', ['Random'], ['Sqrt', ['Random', ['Range', -2, 8, 2]]]],
      /draws more than once, and a draw is in a complex value/,
      { mode: 'complex' },
    ],
    [
      'two draws, one in a complex product, in the strict mode',
      ['Add', ['Multiply', ['Random'], ['Complex', 1, 2]], ['Multiply', 'x', ['Random']]],
      /draws more than once, and a draw is in a complex value/,
    ],
    [
      'a seeded region of a type that is not real with a real body, in the strict mode',
      ['Add', ['WithRandomSeed', 3, ['Ln', 'x']], 'x'],
      /WithRandomSeed of the type complex \| signed_infinity with a real body/,
    ],
    [
      'a seeded region of the type integer | missing, in the complex mode',
      ['WithRandomSeed', 1, ['Which', ['Equal', 'x', 0.001], 2]],
      /in the complex mode: the profile does not read the lane that the existing compiler gives it/,
      { mode: 'complex' },
    ],
  ];
  test.each(declines)('%s', (_name, json, reason, options = {}) => {
    const expr = ce.expr(json);
    expect(() => compile(expr, { ...PROFILE, ...options })).toThrow(reason);
    const answer = canCompile(expr, { profile: 'numeric-kernel', ...options } as never);
    expect(answer.ok).toBe(false);
  });

  test('an expression statement that draws, before the last statement', () => {
    const expr = ce.expr(fn([['Declare', 's', "'real'", 0], ['Random'], 's'], ['m', 'integer']));
    expect(() => compile(expr, PROFILE)).toThrow(/admits no statement Random/);
  });

  test('a helper with an effect other than random', () => {
    const local = engine();
    local.declare('Say', { signature: '(real) -> real', effects: ['console'], evaluate: (ops: readonly Expression[]) => ops[0] } as never);
    local.assign('q', local.expr(['Function', ['Add', 'u', ['Say', 'u']], typed('u', 'real')]));
    expect(() => compile(local.expr(['q', 'x']), PROFILE)).toThrow(
      /the helper q is not pure: its signature has effects other than random \(console\)/
    );
  });
});
