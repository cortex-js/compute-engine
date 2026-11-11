import { ComputeEngine } from '../../src/compute-engine';
import { compile, canCompile } from '../../src/compile';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// Names with no declared type under the `numeric-kernel` profile
// (docs/plans/2026-11-10-js-numeric-kernel-profile-spec.md, "Names with no
// declared type"): a parameter of a `Function` literal or a free symbol with
// no declared type is a real number in the `strict` mode and a complex
// number in the `complex` mode, whatever type the engine inferred for it. A
// symbol with a value and no declared type is a captured number with the
// type of its value. The result lists the names that took the default type
// (`defaultedSymbols`).
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

/** An engine with the helper `twice: (real) -> real`. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign(
    'twice',
    ce.expr(['Function', ['Multiply', 2, 'u'], typed('u', 'real')])
  );
  return ce;
}

/** The outcome of `compile()` under the profile with `fallback: false`:
 *  the result, or the message of the decline. */
function profile(
  expr: Expression,
  mode: Mode
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

/** The body of each row reads `x`, and `y` when it is in the body. Each
 *  row states the outcome under the profile in the `strict` mode with
 *  untyped parameters, with undeclared free symbols, and in the `complex`
 *  mode with untyped parameters and with undeclared free symbols: `true`
 *  (compiles), or the reason of the decline. */
type Row = {
  name: string;
  body: MathJsonExpression;
  strict: true | RegExp;
  strictFree?: true | RegExp;
  complex: true | RegExp;
  complexFree?: true | RegExp;
};

const COMPLEX_LESS = /Less with a complex operand/;

const ROWS: Row[] = [
  {
    name: 'Sin(x)/x',
    body: ['Divide', ['Sin', 'x'], 'x'],
    strict: true,
    complex: true,
  },
  { name: 'Sqrt(x)', body: ['Sqrt', 'x'], strict: true, complex: true },
  { name: 'x^2', body: ['Power', 'x', 2], strict: true, complex: true },
  { name: 'Ln(x)', body: ['Ln', 'x'], strict: true, complex: true },
  {
    name: 'If(x > 0, x, -x)',
    body: ['If', ['Greater', 'x', 0], 'x', ['Negate', 'x']],
    strict: true,
    complex: COMPLEX_LESS,
  },
  {
    name: 'Floor(x)',
    body: ['Floor', 'x'],
    strict: true,
    complex: /Floor with a complex operand/,
  },
  {
    name: 'Mod(x, 2)',
    body: ['Mod', 'x', 2],
    strict: true,
    complex: /Mod with a complex operand/,
  },
  { name: 'Abs(x)', body: ['Abs', 'x'], strict: true, complex: true },
  { name: 'Exp(x)', body: ['Exp', 'x'], strict: true, complex: true },
  {
    // `Math.pow(x, 1.5)` for a base that the profile does not prove
    // non-negative, in the `strict` mode.
    name: 'x^1.5',
    body: ['Power', 'x', 1.5],
    strict: true,
    complex: true,
  },
  {
    name: 'x^y',
    body: ['Power', 'x', 'y'],
    strict: true,
    complex: /Power with a complex operand and an exponent that is not a number literal/,
  },
  {
    name: 'x^1.6',
    body: ['Power', 'x', 1.6],
    strict: true,
    complex: true,
  },
  {
    name: 'Arctan2(y, x)',
    body: ['Arctan2', 'y', 'x'],
    strict: true,
    complex: /Arctan2 with a complex operand/,
  },
  {
    name: 'Min(x, 1)',
    body: ['Min', 'x', 1],
    strict: true,
    complex: /Min with a complex operand/,
  },
  { name: 'x < 1', body: ['Less', 'x', 1], strict: true, complex: COMPLEX_LESS },
  {
    name: 'If(x < 1 and y < 2, x, y)',
    body: ['If', ['And', ['Less', 'x', 1], ['Less', 'y', 2]], 'x', 'y'],
    strict: true,
    complex: COMPLEX_LESS,
  },
  {
    name: 'x != y',
    body: ['NotEqual', 'x', 'y'],
    strict: true,
    complex: /NotEqual with a complex operand/,
  },
  {
    // A local, a loop and `Break`. A block is the body of a function only.
    name: 'a loop with a local and Break',
    body: [
      'Block',
      ['Declare', 's', "'real'", 0],
      [
        'Loop',
        [
          'Block',
          ['Assign', 's', ['Add', 's', 'k']],
          ['If', ['Less', 'x', 's'], ['Break']],
        ],
        ['Element', 'k', ['Range', 1, 5]],
      ],
      's',
    ],
    strict: true,
    strictFree: /unsupported head Block/,
    complex: COMPLEX_LESS,
    complexFree: /unsupported head Block/,
  },
  {
    name: 'a call of the helper twice: (real) -> real',
    body: ['Add', ['twice', 'x'], 1],
    strict: true,
    complex: /The argument `x` of `twice` has the type `complex`/,
  },
];

const XS = [-2.5, -1, -0.5, -0, 0, 0.25, 1, 3];
const YS = [-1.5, 0, 2];

const parametersOf = (body: MathJsonExpression): string[] =>
  JSON.stringify(body).includes('"y"') ? ['x', 'y'] : ['x'];

/** The argument lists of the grid for `parameters`. */
function grid(parameters: readonly string[]): number[][] {
  return XS.flatMap((x) =>
    parameters.length === 1 ? [[x]] : YS.map((y) => [x, y])
  );
}

function runLambda(result: CompilationResult<'javascript'>, args: unknown[]) {
  return (result.run as unknown as (...a: unknown[]) => unknown)(...args);
}

function runExpression(
  result: CompilationResult<'javascript'>,
  parameters: readonly string[],
  args: unknown[]
) {
  return (result.run as unknown as (v: object) => unknown)(
    Object.fromEntries(parameters.map((p, i) => [p, args[i]]))
  );
}

/** A value of the interpreter as a JavaScript value: a boolean, a real
 *  number, or `undefined` for a value that is not a finite or infinite real
 *  number (a complex number, `NaN`, `ComplexInfinity`). */
function unbox(value: Expression): boolean | number | undefined {
  if (value.symbol === 'True') return true;
  if (value.symbol === 'False') return false;
  const v = value.N();
  if (!v.isNumberLiteral || v.im !== 0) return undefined;
  return v.re;
}

/** The compiled value agrees with the interpreter within the caveats: a
 *  finite real number within 1e-12 relative, `0` equal to `-0`; `NaN` or
 *  an infinity where the interpreter gives no real number (`Ln(-1)` in the
 *  `strict` mode, `0/0`), or the same infinity. */
function withinCaveats(compiled: unknown, interpreted: unknown): boolean {
  if (typeof compiled === 'boolean') return compiled === interpreted;
  if (typeof compiled !== 'number') return false;
  if (!Number.isFinite(compiled))
    return (
      interpreted === undefined ||
      Number.isNaN(interpreted as number) ||
      interpreted === compiled
    );
  if (typeof interpreted !== 'number') return false;
  return (
    compiled === interpreted ||
    Math.abs(compiled - interpreted) <=
      1e-12 * Math.max(1, Math.abs(compiled), Math.abs(interpreted))
  );
}

/** Whether an argument is `-0`: the interpreter reads `ce.number(-0)` as
 *  `0` (`Arctan2(0, -0)` is `0` there, and `Math.atan2(0, -0)` is `π` in
 *  the code of both compilers), so its value is not compared there. */
const hasNegativeZero = (args: readonly number[]) => args.some((a) => Object.is(a, -0));

/** The result of the existing compiler for `expr` in `mode`, or `undefined`
 *  when it declines an input whose engine type is `unknown` or `any`
 *  (`untyped-input`). */
function existingOrUntyped(expr: Expression, mode: Mode): CompilationResult<'javascript'> | undefined {
  try {
    return compile(expr, { ...EXISTING, mode, fallback: false } as never) as CompilationResult<'javascript'>;
  } catch (e) {
    expect((e as { diagnostic?: { code?: string } }).diagnostic?.code).toBe('untyped-input');
    return undefined;
  }
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

describe('the strict mode', () => {
  describe.each(ROWS)('$name', (row) => {
    const parameters = parametersOf(row.body);

    test('untyped parameters, for the rows of the table: the code for real parameters, the values of the existing compiler and of the interpreter', () => {
      const ce = engine();
      const fn = ce.expr(['Function', row.body, ...parameters] as MathJsonExpression);
      expectAgreement(fn, 'strict');
      const got = profile(fn, 'strict');
      if (row.strict !== true) {
        expect('message' in got && got.message).toMatch(row.strict);
        return;
      }
      if (!('result' in got)) throw new Error((got as { message: string }).message);
      const { result } = got;
      expect(result.defaultedSymbols).toEqual(parameters);
      const declared = profile(
        ce.expr(['Function', row.body, ...parameters.map((p) => typed(p, 'real'))] as MathJsonExpression),
        'strict'
      );
      expect('result' in declared && declared.result.code).toBe(result.code);
      const existing = compile(fn, { ...EXISTING, fallback: false }) as CompilationResult<'javascript'>;
      for (const args of grid(parameters)) {
        const value = runLambda(result, args);
        expect([args, same(value, runLambda(existing, args))]).toEqual([args, true]);
        if (hasNegativeZero(args)) continue;
        const interpreted = unbox(
          ce.function('Apply', [fn, ...args.map((a) => ce.number(a))]).evaluate()
        );
        expect([args, value, withinCaveats(value, interpreted)]).toEqual([args, value, true]);
      }
    });

    test('undeclared free symbols, for the rows of the table: the code for symbols declared real, the values of the existing compiler and of the interpreter', () => {
      const ce = engine();
      const expr = ce.expr(row.body);
      const expected = row.strictFree ?? row.strict;
      expectAgreement(expr, 'strict');
      const got = profile(expr, 'strict');
      if (expected !== true) {
        expect('message' in got && got.message).toMatch(expected);
        return;
      }
      if (!('result' in got)) throw new Error((got as { message: string }).message);
      const { result } = got;
      expect([...(result.defaultedSymbols ?? [])].sort()).toEqual(parameters);
      const other = engine();
      for (const p of parameters) other.declare(p, 'real');
      const declared = profile(other.expr(row.body), 'strict');
      expect('result' in declared && declared.result.code).toBe(result.code);
      // The existing compiler declines a free symbol whose engine type is
      // `unknown` (`untyped-input`): `x` is `unknown` after `x < 1`. The
      // profile then has no existing code to agree with.
      const existing = existingOrUntyped(expr, 'strict');
      for (const args of grid(parameters)) {
        const value = runExpression(result, parameters, args);
        if (existing !== undefined)
          expect([args, same(value, runExpression(existing, parameters, args))]).toEqual([args, true]);
        if (hasNegativeZero(args)) continue;
        const interpreted = unbox(
          expr.subs(Object.fromEntries(parameters.map((p, i) => [p, ce.number(args[i])]))).evaluate()
        );
        expect([args, value, withinCaveats(value, interpreted)]).toEqual([args, value, true]);
      }
    });
  });

  test('the order of boxing does not change the kind of the name, the code or the answer', () => {
    const ce = engine();
    const compileIt = (json: MathJsonExpression) => {
      const expr = ce.expr(json);
      const got = profile(expr, 'strict');
      return {
        code: 'result' in got ? got.result.code : got.message,
        answer: canCompile(expr, { ...PROFILE } as never).ok,
      };
    };
    const first = compileIt(['Less', 'x', 1]);
    const floorFirst = [compileIt(['Floor', 'x']), compileIt(['Sqrt', 'x'])];
    const again = compileIt(['Less', 'x', 1]);
    const sqrtFirst = [compileIt(['Sqrt', 'x']), compileIt(['Floor', 'x'])];
    expect(again).toEqual(first);
    expect(first).toEqual({ code: '_.x < 1', answer: true });
    expect(floorFirst).toEqual([
      { code: 'Math.floor(_.x)', answer: true },
      { code: 'Math.sqrt(_.x)', answer: true },
    ]);
    expect(sqrtFirst).toEqual([floorFirst[1], floorFirst[0]]);
    expect(compileIt(['Less', 'x', 1])).toEqual(first);
  });

  test('an earlier use can make a Power form decline, and never changes the code', () => {
    // The rules of `Power` read the type of the node, which the engine
    // computes from the type it inferred for `x`: after `Mod(x, 2)`, `x` is
    // real, `e^(sqrt(x))` has the type complex, and the existing compiler
    // writes a complex power. The profile then declines.
    const fresh = engine();
    const before = profile(fresh.expr(['Exp', ['Sqrt', 'x']]), 'strict');
    expect('result' in before ? before.result.code : before.message).toBe(
      'Math.exp(Math.sqrt(_.x))'
    );
    const narrowed = engine();
    narrowed.expr(['Mod', 'x', 2]);
    const after = profile(narrowed.expr(['Exp', ['Sqrt', 'x']]), 'strict');
    expect('result' in after).toBe(false);
  });

  test('an assumption on an undeclared name does not change its kind', () => {
    // `n` is assumed an integer and has no declared type: the profile
    // computes with a real, as the interpreter does for a value that is not
    // an integer. The existing compiler reads the assumption and writes
    // `_.n` for `Floor(n)`.
    const ce = engine();
    ce.assume(ce.expr(['Element', 'n', 'Integers']));
    const got = profile(ce.expr(['Floor', 'n']), 'strict');
    expect('result' in got ? got.result.code : got.message).toBe(
      'Math.floor(_.n)'
    );
    if ('result' in got) {
      expect(got.result.defaultedSymbols).toEqual(['n']);
      expect(got.result.run!({ n: 2.5 })).toBe(2);
      expect(got.result.run!({ n: 3 })).toBe(3);
    }
  });
});

describe('the complex mode', () => {
  /** The arguments: numbers and complex values. */
  const ARGS: unknown[] = [-2, -0, 0, 0.5, 3, { re: 1, im: -2 }, { re: -0, im: 0 }, { re: 0.5, im: 1 }];

  describe.each(ROWS)('$name', (row) => {
    const parameters = parametersOf(row.body);
    const argumentLists = ARGS.flatMap((x) =>
      parameters.length === 1 ? [[x]] : ARGS.slice(0, 4).map((y) => [x, y])
    );

    test('untyped parameters: the values and the result shape of the existing compiler, or a decline', () => {
      const ce = engine();
      const fn = ce.expr(['Function', row.body, ...parameters] as MathJsonExpression);
      expectAgreement(fn, 'complex');
      const got = profile(fn, 'complex');
      if (row.complex !== true) {
        expect('message' in got && got.message).toMatch(row.complex);
        return;
      }
      if (!('result' in got)) throw new Error((got as { message: string }).message);
      expect(got.result.defaultedSymbols).toEqual(parameters);
      const existing = compile(fn, { ...EXISTING, mode: 'complex', fallback: false } as never) as CompilationResult<'javascript'>;
      for (const args of argumentLists) {
        const value = runLambda(got.result, args);
        expect([args, same(value, runLambda(existing, args))]).toEqual([args, true]);
      }
    });

    test('undeclared free symbols: the values and the result shape of the existing compiler, or a decline', () => {
      const ce = engine();
      const expr = ce.expr(row.body);
      const expected = row.complexFree ?? row.complex;
      expectAgreement(expr, 'complex');
      const got = profile(expr, 'complex');
      if (expected !== true) {
        expect('message' in got && got.message).toMatch(expected);
        return;
      }
      if (!('result' in got)) throw new Error((got as { message: string }).message);
      const existing = existingOrUntyped(expr, 'complex');
      expect(existing).toBeDefined();
      for (const args of argumentLists) {
        const value = runExpression(got.result, parameters, args);
        expect([args, same(value, runExpression(existing!, parameters, args))]).toEqual([args, true]);
      }
    });
  });

  test('a name with no declared type is converted to a complex value at each read', () => {
    const ce = engine();
    const got = profile(ce.expr(['Function', 'x', 'x']), 'complex');
    if (!('result' in got)) throw new Error(got.message);
    expect(got.result.code).toBe('(x) => { return _SYS.cplx(x); }');
    const existing = compile(ce.expr(['Function', 'x', 'x']), { ...EXISTING, mode: 'complex', fallback: false } as never) as CompilationResult<'javascript'>;
    for (const arg of [2, -0, { re: 1, im: 3 }, { re: 2, im: 0 }])
      expect([arg, same(runLambda(got.result, [arg]), runLambda(existing, [arg]))]).toEqual([arg, true]);
    expect(runLambda(got.result, [{ re: 1, im: 3 }])).toEqual({ re: 1, im: 3 });
  });
});

describe('declarations and conflicts', () => {
  test('a name declared with a type that the profile has no kind for declines', () => {
    for (const type of ['number', 'any']) {
      const ce = engine();
      ce.declare('w', type);
      const expr = ce.expr(['Add', 'x', 'w']);
      expect(profile(expr, 'strict')).toEqual({ message: expect.stringMatching(/unsupported binding w/) });
      expectAgreement(expr, 'strict');
      const fn = ce.expr(['Function', ['Sin', 'x'], typed('x', type)]);
      expect(profile(fn, 'strict')).toEqual({
        message: expect.stringMatching(/explicit distinct scalar parameters required/),
      });
    }
  });

  test('a name declared unknown declines (with the engine flag _bindingUnits off)', () => {
    // With `_bindingUnits` on, a definition declared `unknown` counts as one
    // with no declared type (`hasInferredType()`), so this test holds only
    // with the flag off. With the flag off, a use that narrows the type
    // (`Sin(w)`) makes the type of the definition inferred, and the name
    // then takes the default type: the forms here do not narrow it.
    const ce = engine();
    ce._bindingUnits = false;
    ce.declare('w', 'unknown');
    for (const json of ['w', ['Less', 'w', 1]] as MathJsonExpression[])
      expect(profile(ce.expr(json), 'strict')).toEqual({
        message: expect.stringMatching(/unsupported binding w/),
      });
    // A parameter `Typed(x, 'unknown')` is the parameter `x`: the canonical
    // form of the `Function` literal drops the declaration.
    const fn = ce.expr(['Function', ['Sin', 'x'], typed('x', 'unknown')]);
    expect(fn.ops![1].toString()).toBe('x');
    expect(profile(fn, 'strict')).toMatchObject({ result: { defaultedSymbols: ['x'] } });
  });

  test.each<[string, MathJsonExpression, RegExp]>([
    ['a list', ['At', 'L', 1], /At in the profile reads a list input or a list parameter/],
    ['a condition', ['If', 'q', 1, 2], /the condition of If does not have the type boolean/],
    ['an operand of And', ['And', 'p', ['Less', 'x', 1]], /And with an operand that is not a boolean/],
  ])('a name with no declared type used as %s declines', (_name, body, reason) => {
    for (const mode of ['strict', 'complex'] as const) {
      const ce = engine();
      const free = ce.expr(body);
      if (mode === 'strict') expect(profile(free, mode)).toEqual({ message: expect.stringMatching(reason) });
      else expect('message' in profile(free, mode)).toBe(true);
      expectAgreement(free, mode);
      const names = (['L', 'q', 'p', 'x'] as const).filter((n) => JSON.stringify(body).includes(`"${n}"`));
      const fn = ce.expr(['Function', body, ...names] as MathJsonExpression);
      if (mode === 'strict') expect(profile(fn, mode)).toEqual({ message: expect.stringMatching(reason) });
      else expect('message' in profile(fn, mode)).toBe(true);
      expectAgreement(fn, mode);
    }
  });
});

describe('a symbol with a value and no declared type', () => {
  test('an integer value: a captured integer, as a declared integer capture', () => {
    const ce = engine();
    ce.declare('L', 'list<real>');
    ce.assign('a', 3);
    const symbolDeps = new Set<string>();
    const result = compile(ce.expr(['At', 'L', 'a']), { ...PROFILE, fallback: false, symbolDeps } as never) as CompilationResult<'javascript'>;
    const other = engine();
    other.declare('L', 'list<real>');
    other.declare('a', 'integer');
    other.assign('a', 3);
    const declared = compile(other.expr(['At', 'L', 'a']), { ...PROFILE, fallback: false } as never) as CompilationResult<'javascript'>;
    expect(result.code).toBe(declared.code);
    expect(result.code).toBe('_SYS.atNumeric(_.L, 3, "real")');
    expect([...symbolDeps]).toEqual(['a']);
    expect(result.defaultedSymbols).toBeUndefined();
    expect((result.run as unknown as (v: object) => number)({ L: [10, 20, 30] })).toBe(30);
  });

  test('a real value: a captured real, which is not an index', () => {
    const ce = engine();
    ce.assign('b', 2.5);
    const result = compile(ce.expr(['Add', 'x', 'b']), { ...PROFILE, fallback: false } as never) as CompilationResult<'javascript'>;
    expect(result.code).toBe('2.5 + _.x');
    expect(result.defaultedSymbols).toEqual(['x']);
    ce.declare('L', 'list<real>');
    expect(profile(ce.expr(['At', 'L', 'b']), 'strict')).toEqual({
      message: expect.stringMatching(/At with an index of the type `real`/),
    });
  });

  test('a complex value and a string value decline', () => {
    const ce = engine();
    ce.assign('c', ce.complex(1, 2));
    ce.assign('s', ce.string('hi'));
    for (const mode of ['strict', 'complex'] as const) {
      expect(profile(ce.expr(['Add', 'x', 'c']), mode)).toEqual({ message: expect.stringMatching(/unsupported binding c/) });
      expect(profile(ce.expr('s'), mode)).toEqual({ message: expect.stringMatching(/unsupported binding s/) });
    }
  });

  test('a reassignment after the compilation: the code keeps the snapshot, and the dependency is recorded', () => {
    const ce = engine();
    ce.assign('a', 3);
    const symbolDeps = new Set<string>();
    const fn = ce.expr(['Function', ['Add', 'x', 'a'], 'x']);
    const result = compile(fn, { ...PROFILE, fallback: false, symbolDeps } as never) as CompilationResult<'javascript'>;
    expect(result.code).toBe('(x) => { return 3 + x; }');
    expect([...symbolDeps]).toEqual(['a']);
    ce.assign('a', 7);
    expect(runLambda(result, [2])).toBe(5);
    const again = compile(fn, { ...PROFILE, fallback: false } as never) as CompilationResult<'javascript'>;
    expect(runLambda(again, [2])).toBe(9);
  });
});

describe('the field defaultedSymbols', () => {
  test('a Function literal: the untyped parameters, in their order', () => {
    const ce = engine();
    const fn = ce.expr(['Function', ['Add', 'y', ['Multiply', 'x', 'z']], 'x', typed('y', 'real'), 'z']);
    const got = profile(fn, 'strict');
    expect('result' in got && got.result.defaultedSymbols).toEqual(['x', 'z']);
    expect(canCompile(fn, { ...PROFILE } as never)).toMatchObject({ ok: true, defaultedSymbols: ['x', 'z'] });
  });

  test('an expression: the undeclared free symbols, in the order of their first read', () => {
    const ce = engine();
    ce.declare('y', 'real');
    const expr = ce.expr(['Arctan2', 'u', ['Add', 'x', 'y']]);
    const got = profile(expr, 'strict');
    expect('result' in got && got.result.defaultedSymbols).toEqual(['u', 'x']);
    expect(canCompile(expr, { ...PROFILE } as never)).toMatchObject({ ok: true, defaultedSymbols: ['u', 'x'] });
  });

  test('absent when every name is declared', () => {
    const ce = engine();
    ce.declare('x', 'real');
    const expr = ce.expr(['Sin', 'x']);
    const got = profile(expr, 'strict');
    expect('result' in got && 'defaultedSymbols' in got.result).toBe(false);
    expect(canCompile(expr, { ...PROFILE } as never)).toEqual({ ok: true, pure: true, shippable: true });
    const fn = ce.expr(['Function', ['Sin', 'v'], typed('v', 'real')]);
    const literal = profile(fn, 'strict');
    expect('result' in literal && 'defaultedSymbols' in literal.result).toBe(false);
  });
});

describe('the engine flag _bindingUnits', () => {
  test('an undeclared free symbol takes the default type under the profile', () => {
    const ce = engine();
    ce._bindingUnits = true;
    const expr = ce.expr(['Sin', 'x']);
    const got = profile(expr, 'strict');
    if (!('result' in got)) throw new Error(got.message);
    expect(got.result.code).toBe('Math.sin(_.x)');
    expect(got.result.defaultedSymbols).toEqual(['x']);
    expect((got.result.run as unknown as (v: object) => number)({ x: 0.5 })).toBe(Math.sin(0.5));
    expectAgreement(expr, 'strict');
  });
});
