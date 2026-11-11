import { ComputeEngine } from '../../src/compute-engine';
import { compile, canCompile } from '../../src/compile';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// A call of a user function (a helper) whose signature the engine inferred
// from its definition (`f(x) := …`, `ce.assign('f', Function(…))`) under the
// `numeric-kernel` profile
// (docs/plans/2026-11-10-js-numeric-kernel-profile-spec.md, "Names with no
// declared type"): a parameter with no declared type is a real number in
// the `strict` mode and a complex number in the `complex` mode, as a
// parameter of the root function is, and the result is the fact of the
// body. An argument of another kind declines.
//
// The values are compared with the existing compiler (`cse: false`,
// `constantFold: false`, the same mode) with `Object.is`, and in the
// `strict` mode with the interpreter, within the caveats of
// docs/COMPILATION-MODEL.md.

const PROFILE = { profile: 'numeric-kernel' } as const;
const EXISTING = { cse: false, constantFold: false } as const;

type Mode = 'strict' | 'complex';

const typed = (name: string, type: string): MathJsonExpression =>
  ['Typed', name, `'${type}'`] as MathJsonExpression;

/** The outcome of `compile()` under the profile with `fallback: false`:
 *  the result, or the message of the decline. */
function profile(
  expr: Expression,
  mode: Mode = 'strict'
): { result: CompilationResult<'javascript'> } | { message: string } {
  try {
    return {
      result: compile(expr, {
        ...PROFILE,
        mode,
        fallback: false,
      } as never) as CompilationResult<'javascript'>,
    };
  } catch (e) {
    return { message: (e as Error).message };
  }
}

function compiled(expr: Expression, mode: Mode = 'strict') {
  const got = profile(expr, mode);
  if (!('result' in got)) throw new Error(got.message);
  return got.result;
}

/** `canCompile()` agrees with `compile()` on `expr` in `mode`. */
function expectAgreement(expr: Expression, mode: Mode): void {
  const got = profile(expr, mode);
  const answer = canCompile(expr, { ...PROFILE, mode } as never);
  if ('result' in got)
    expect(answer).toEqual({
      ok: true,
      pure: got.result.pure,
      shippable: got.result.shippable,
      ...(got.result.defaultedSymbols === undefined
        ? {}
        : { defaultedSymbols: got.result.defaultedSymbols }),
    });
  else expect(answer.ok).toBe(false);
}

function runLambda(result: CompilationResult<'javascript'>, args: unknown[]) {
  return (result.run as unknown as (...a: unknown[]) => unknown)(...args);
}

/** A value of the interpreter as a JavaScript value: a real number, or
 *  `undefined` for a value that is not a real number. */
function unbox(value: Expression): number | undefined {
  const v = value.N();
  if (!v.isNumberLiteral || v.im !== 0) return undefined;
  return v.re;
}

/** The compiled value agrees with the interpreter within the caveats. */
function withinCaveats(compiled: unknown, interpreted: number | undefined): boolean {
  if (typeof compiled !== 'number') return false;
  if (!Number.isFinite(compiled))
    return interpreted === undefined || Number.isNaN(interpreted) || interpreted === compiled;
  if (interpreted === undefined) return false;
  return (
    compiled === interpreted ||
    Math.abs(compiled - interpreted) <= 1e-12 * Math.max(1, Math.abs(compiled), Math.abs(interpreted))
  );
}

/** The same value with `Object.is`, part by part for a complex value. */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const p = a as { re: number; im: number };
    const q = b as { re: number; im: number };
    return Object.keys(p).length === Object.keys(q).length && Object.is(p.re, q.re) && Object.is(p.im, q.im);
  }
  return Object.is(a, b);
}

/** The arguments of the strict mode: reals and integers. */
const XS = [-2.5, -1, -0.5, 0, 0.25, 1, 2, 3, 7];
/** The arguments of the complex mode: numbers and complex values. */
const ZS: unknown[] = [-2, 0, 0.5, 3, { re: 1, im: -2 }, { re: 0.5, im: 1 }];

/** Compile the root function `fn` with the profile and with the existing
 *  compiler in `mode`, and compare the values; in the `strict` mode, also
 *  with the interpreter. Returns the result of the profile. */
function agree(
  ce: ComputeEngine,
  fn: Expression,
  mode: Mode,
  argumentLists: readonly unknown[][]
): CompilationResult<'javascript'> {
  expectAgreement(fn, mode);
  const result = compiled(fn, mode);
  const existing = compile(fn, { ...EXISTING, mode, fallback: false } as never) as CompilationResult<'javascript'>;
  for (const args of argumentLists) {
    const value = runLambda(result, args);
    expect([args, same(value, runLambda(existing, args))]).toEqual([args, true]);
    if (mode !== 'strict') continue;
    const interpreted = unbox(
      ce.function('Apply', [fn, ...args.map((a) => ce.number(a as number))]).evaluate()
    );
    expect([args, value, withinCaveats(value, interpreted)]).toEqual([args, value, true]);
  }
  return result;
}

const one = (xs: readonly unknown[]) => xs.map((x) => [x]);
const two = (xs: readonly unknown[]) => xs.flatMap((x) => xs.slice(0, 4).map((y) => [x, y]));

describe('a helper with an inferred signature, in the strict mode', () => {
  test('an untyped parameter, called with a real argument and an integer argument', () => {
    const ce = new ComputeEngine();
    ce.parse('f(x) := x^2 + \\sin(x)').evaluate();
    const fn = ce.expr([
      'Function',
      ['Block', ['Add', ['f', 'x'], ['f', 3], ['f', ['Multiply', 2, 'x']]]],
      'x',
    ] as MathJsonExpression);
    const result = agree(ce, fn, 'strict', one(XS));
    // One function of the program, called three times, not inlined.
    expect(result.code.match(/function /g)?.length).toBe(1);
    expect(result.defaultedSymbols).toEqual(['x', 'f']);
  });

  test('the code of the helper is the code for a parameter declared real', () => {
    const untyped = new ComputeEngine();
    untyped.assign('h', untyped.expr(['Function', ['Divide', ['Exp', 'u'], ['Add', 1, 'u']], 'u'] as MathJsonExpression));
    const declared = new ComputeEngine();
    declared.declare('h', '(real) -> real');
    declared.assign('h', declared.expr(['Function', ['Divide', ['Exp', 'u'], ['Add', 1, 'u']], typed('u', 'real')] as MathJsonExpression));
    const root = ['Function', ['Block', ['h', 'x']], typed('x', 'real')] as MathJsonExpression;
    expect(compiled(untyped.expr(root)).code).toBe(compiled(declared.expr(root)).code);
    agree(untyped, untyped.expr(root), 'strict', one(XS));
  });

  test('two untyped parameters', () => {
    const ce = new ComputeEngine();
    ce.parse('g(a, b) := a \\cdot b + \\cos(a - b)').evaluate();
    const fn = ce.expr(['Function', ['Block', ['g', 'x', 'y']], 'x', 'y'] as MathJsonExpression);
    agree(ce, fn, 'strict', two(XS));
  });

  test('a helper that calls a helper with an untyped parameter', () => {
    const ce = new ComputeEngine();
    ce.parse('h(t) := t^2 + 1').evaluate();
    ce.parse('g(s) := \\sqrt{h(s)} - s').evaluate();
    const fn = ce.expr(['Function', ['Block', ['Multiply', ['g', 'x'], ['h', 'x']]], typed('x', 'real')] as MathJsonExpression);
    const result = agree(ce, fn, 'strict', one(XS));
    expect(result.code.match(/function /g)?.length).toBe(2);
    // The helpers in the order in which their resolution ends: the callee
    // first.
    expect(result.defaultedSymbols).toEqual(['h', 'g']);
  });

  test('a helper with a statement body: a local, a write, an If statement and a loop', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'p',
      ce.expr([
        'Function',
        [
          'Block',
          ['Declare', 's', "'real'", 0],
          [
            'Loop',
            ['Assign', 's', ['Add', 's', ['Divide', 'u', 'k']]],
            ['Element', 'k', ['Range', 1, 4]],
          ],
          ['If', ['Less', 's', 0], ['Assign', 's', ['Negate', 's']]],
          's',
        ],
        'u',
      ] as MathJsonExpression)
    );
    const fn = ce.expr(['Function', ['Block', ['Add', ['p', 'x'], 1]], 'x'] as MathJsonExpression);
    agree(ce, fn, 'strict', one(XS));
  });

  test('one typed and one untyped parameter', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'm',
      ce.expr(['Function', ['Add', ['Multiply', 'a', 'b'], ['Floor', 'b']], typed('a', 'integer'), 'b'] as MathJsonExpression)
    );
    ce.declare('n', 'integer');
    const fn = ce.expr(['Function', ['Block', ['m', 'n', 'x']], typed('n', 'integer'), 'x'] as MathJsonExpression);
    const result = agree(ce, fn, 'strict', [
      [2, 0.5],
      [-3, 2.25],
      [0, -1.5],
      [7, 3],
    ]);
    expect(result.defaultedSymbols).toEqual(['x', 'm']);
  });

  test('a helper with an untyped result and a typed parameter is not listed in defaultedSymbols', () => {
    const ce = new ComputeEngine();
    ce.assign('q', ce.expr(['Function', ['Multiply', 3, 'v'], typed('v', 'real')] as MathJsonExpression));
    const fn = ce.expr(['Function', ['Block', ['q', 'x']], typed('x', 'real')] as MathJsonExpression);
    const result = agree(ce, fn, 'strict', one(XS));
    expect('defaultedSymbols' in result).toBe(false);
  });

  test('a call from an expression, not a Function literal', () => {
    const ce = new ComputeEngine();
    ce.parse('f(x) := x^2 + 1').evaluate();
    ce.declare('y', 'real');
    const expr = ce.expr(['Add', ['f', 'y'], 1]);
    expectAgreement(expr, 'strict');
    const result = compiled(expr);
    expect(result.defaultedSymbols).toEqual(['f']);
    const existing = compile(expr, { ...EXISTING, fallback: false } as never) as CompilationResult<'javascript'>;
    for (const y of XS)
      expect(Object.is((result.run as (v: object) => number)({ y }), (existing.run as (v: object) => number)({ y }))).toBe(true);
  });

  // The body of a helper is rewritten for the angular unit, as the root is
  // and as the existing compiler rewrites each function body. Before, the
  // body of a helper, declared or not, was compiled in radians.
  test.each(['untyped', 'declared'])('the body of a %s helper is in the angular unit of the engine', (kind) => {
    const ce = new ComputeEngine();
    ce.angularUnit = 'deg';
    if (kind === 'declared') ce.declare('s', '(real) -> real');
    ce.assign(
      's',
      ce.expr(['Function', ['Add', ['Sin', 'u'], ['Cos', 'u']], kind === 'declared' ? typed('u', 'real') : 'u'] as MathJsonExpression)
    );
    const fn = ce.expr(['Function', ['Block', ['s', 'x']], typed('x', 'real')] as MathJsonExpression);
    const result = compiled(fn);
    const existing = compile(fn, { ...EXISTING, fallback: false } as never) as CompilationResult<'javascript'>;
    for (const x of [-45, 0, 30, 90, 200]) {
      const value = runLambda(result, [x]);
      expect([x, same(value, runLambda(existing, [x]))]).toEqual([x, true]);
      const interpreted = unbox(ce.function('Apply', [fn, ce.number(x)]).evaluate());
      expect([x, value, withinCaveats(value, interpreted)]).toEqual([x, value, true]);
    }
  });
});

describe('a helper with an inferred signature, in the complex mode', () => {
  test('an untyped parameter of the root, passed to an untyped parameter of the helper', () => {
    const ce = new ComputeEngine();
    ce.parse('f(x) := x^2 + \\exp(x)').evaluate();
    const fn = ce.expr(['Function', ['Block', ['Add', ['f', 'x'], 1]], 'x'] as MathJsonExpression);
    const result = agree(ce, fn, 'complex', one(ZS));
    expect(result.defaultedSymbols).toEqual(['x', 'f']);
  });

  test('two untyped parameters, and a helper that calls a helper', () => {
    const ce = new ComputeEngine();
    ce.parse('h(t) := t \\cdot t - 1').evaluate();
    ce.parse('g(a, b) := h(a) + \\sqrt{b}').evaluate();
    const fn = ce.expr(['Function', ['Block', ['g', 'x', 'y']], 'x', 'y'] as MathJsonExpression);
    agree(ce, fn, 'complex', two(ZS));
  });

  test('a real argument declines: the parameter is complex', () => {
    const ce = new ComputeEngine();
    ce.parse('f(x) := x^2 + 1').evaluate();
    const fn = ce.expr(['Function', ['Block', ['f', 2]], 'x'] as MathJsonExpression);
    const got = profile(fn, 'complex');
    expect('message' in got && got.message).toMatch(/The argument `2` of `f` has the type `integer`/);
    expectAgreement(fn, 'complex');
  });
});

describe('the arguments of another kind decline', () => {
  test('a real argument in the complex mode: the message names the argument, and the diagnostic the call', () => {
    const ce = new ComputeEngine();
    ce.parse('f(x) := x + 1').evaluate();
    const fn = ce.expr([
      'Function',
      ['Block', ['Add', ['f', 'z'], ['f', 2]]],
      typed('z', 'complex'),
    ] as MathJsonExpression);
    let error: { message: string; diagnostic?: { operator?: string } } | undefined;
    try {
      compile(fn, { ...PROFILE, mode: 'complex', fallback: false } as never);
    } catch (e) {
      error = e as never;
    }
    expect(error?.message).toMatch(
      /The argument `2` of `f` has the type `integer`, and the parameter `x` has no declared type: it is complex in the `complex` mode/
    );
    expect(error?.diagnostic?.operator).toBe('f');
  });

  test('a condition that is a parameter with no declared type', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.expr(['Function', ['If', 'b', 1, 2], 'b'] as MathJsonExpression));
    const fn = ce.expr(['Function', ['Block', ['f', ['Greater', 'x', 0]]], typed('x', 'real')] as MathJsonExpression);
    const got = profile(fn);
    expect('message' in got && got.message).toMatch(
      /the condition of If does not have the type boolean: the parameter b has no declared type, and it is real in the `strict` mode \(in the body of the user function `f`\)/
    );
  });

  test('a list argument', () => {
    const ce = new ComputeEngine();
    ce.parse('f(x) := x^2 + 1').evaluate();
    ce.declare('L', 'list<real>');
    const expr = ce.expr(['f', 'L']);
    const got = profile(expr);
    expect('message' in got && got.message).toMatch(/The argument `L` of `f` has the type `list<real>`/);
    expectAgreement(expr, 'strict');
  });

  test('a boolean argument', () => {
    const ce = new ComputeEngine();
    ce.parse('f(x) := x + 1').evaluate();
    ce.declare('b', 'boolean');
    const expr = ce.expr(['f', 'b']);
    const got = profile(expr);
    expect('message' in got).toBe(true);
    expectAgreement(expr, 'strict');
  });

  test('a complex argument in the strict mode', () => {
    const ce = new ComputeEngine();
    ce.parse('f(x) := x + 1').evaluate();
    ce.declare('z', 'complex');
    const expr = ce.expr(['f', 'z']);
    const got = profile(expr);
    expect('message' in got && got.message).toMatch(/The argument `z` of `f` has the type `complex`/);
    expectAgreement(expr, 'strict');
  });

  test('a body that uses the parameter as a list', () => {
    const ce = new ComputeEngine();
    ce.assign('first', ce.expr(['Function', ['At', 'v', 1], 'v'] as MathJsonExpression));
    const fn = ce.expr(['Function', ['Block', ['first', 'x']], typed('x', 'real')] as MathJsonExpression);
    expect('message' in profile(fn)).toBe(true);
    expectAgreement(fn, 'strict');
  });
});

describe('the other signatures keep their decline, each with its message', () => {
  const root = ['Function', ['Block', ['g', 'x']], typed('x', 'real')] as MathJsonExpression;

  test('a helper declared `function`: no signature of ground types', () => {
    const ce = new ComputeEngine();
    ce.declare('g', 'function');
    ce.assign('g', ce.expr(['Function', ['Multiply', 't', 't'], 't'] as MathJsonExpression));
    const got = profile(ce.expr(root));
    expect('message' in got && got.message).toMatch(/the helper g has no signature of ground types/);
  });

  test('a helper with effects', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.expr(['Function', ['Add', 't', ['Random']], 't'] as MathJsonExpression));
    const got = profile(ce.expr(root));
    expect('message' in got && got.message).toMatch(/the helper g is not pure: its signature has effects/);
  });

  test('a helper with an optional parameter', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.expr(['Function', ['Add', 't', 's'], 't', ['Optional', 's', 1]] as MathJsonExpression));
    const got = profile(ce.expr(root));
    expect('message' in got && got.message).toMatch(/the helper g has an optional parameter/);
  });

  test('a declared signature with an untyped parameter of the literal keeps its decline', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(real) -> real');
    ce.assign('g', ce.expr(['Function', ['Multiply', 't', 2], 't'] as MathJsonExpression));
    const got = profile(ce.expr(root));
    expect('message' in got && got.message).toMatch(
      /the parameter t of the helper g has no type annotation, and the helper has a declared signature/
    );
  });

  test('a declared result type that is not a number', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(real) -> string');
    const got = profile(ce.expr(root));
    expect('message' in got).toBe(true);
  });
});

describe('a redefinition of the helper', () => {
  test('a new compilation reads the new definition; the built code keeps the old one', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.expr(['Function', ['Negate', 'u'], 'u'] as MathJsonExpression));
    const root = () => ce.expr(['Function', ['Block', ['h', 'x']], 'x'] as MathJsonExpression);
    const old = compiled(root());
    ce.assign('h', ce.expr(['Function', ['Add', 'u', 10], 'u'] as MathJsonExpression));
    const next = compiled(root());
    expect(runLambda(old, [3])).toBe(-3);
    expect(runLambda(next, [3])).toBe(13);
  });

  test('a definition of another scope with the same name declines', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.expr(['Function', ['Negate', 'u'], 'u'] as MathJsonExpression));
    const expression = ce.expr(['Function', ['Block', ['h', 'x']], 'x'] as MathJsonExpression);
    ce.pushScope();
    ce.declare('h', 'function');
    ce.assign('h', ce.expr(['Function', ['Add', 'u', 10], 'u'] as MathJsonExpression));
    expect('message' in profile(expression)).toBe(true);
    ce.popScope();
    expect(runLambda(compiled(expression), [3])).toBe(-3);
  });
});
