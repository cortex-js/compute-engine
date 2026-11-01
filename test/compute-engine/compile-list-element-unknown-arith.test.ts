/**
 * Compiled arithmetic and comparisons over an element of a list typed
 * `list<unknown>` (ROADMAP CE-360).
 *
 * The case: `g` declared `(unknown) -> list<unknown>` and assigned
 * `t ↦ [t, 2t]`. The index `g(x)[1]` is typed `missing | unknown`. When `x`
 * is a list, the call maps over it, and the element is a list:
 * `g([1, 2])[1]` is `[1, 2]`. The element of such a call may be a list, so
 * the operators around it (`+`, `Sin`, `<`, ...) must broadcast over it
 * (`topTypeBesideAbsence`, `common/type/utils.ts`, reads a type that is a
 * top type beside absence markers as that top type). The typing route
 * types `Sin(g(x)[1])` so that it holds the list too.
 *
 * The compiler settles the shape of every call argument at compile time.
 * So the cases are of two kinds:
 *
 * - `x` declared `any`: the shape of the argument of `g(x)` is not settled,
 *   and the compilation declines with the code `unsettled-shape` and the
 *   name `x` in `unsupported`.
 * - `x` declared with a settled shape (`real`, `list<real>`,
 *   `list<list<real>>`): the compilation maps `g` over the argument with a
 *   static map, and the compiled value equals the interpreted value (`.N()`)
 *   at a number, at a list, at a nested list and at an empty list.
 *
 * The three signatures of `g` are `(unknown) -> list<unknown>`,
 * `(unknown) -> list` and no declaration (the inferred signature,
 * `(unknown) -> vector<2>`).
 *
 * At `x = []` the element is absent, and both routes answer `Missing`: the
 * compiled code gave `NaN` (or `false` for a comparison) there, on every
 * signature, until the broadcast made a result with an absent operand
 * absent (ROADMAP CE-368).
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import {
  isFunction,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';

const SIGNATURES = [
  '(unknown) -> list<unknown>',
  '(unknown) -> list',
  'inferred',
] as const;

/** `g := t ↦ [t, 2t]`, `x` of type `xType`, `z: any` and `c: boolean`.
 * The symbol `a` is left undeclared. */
function rowEngine(signature: string, xType = 'any'): ComputeEngine {
  const ce = new ComputeEngine();
  if (signature !== 'inferred') ce.declare('g', signature);
  ce.assign('g', ce.parse('t \\mapsto [t, 2t]'));
  ce.declare('x', { type: xType });
  ce.declare('z', { type: 'any' });
  ce.declare('c', 'boolean');
  return ce;
}

/** The interpreted value as a JavaScript value: a list is an array, a
 * boolean symbol is a boolean, any other value is its numeric value. */
function toJS(e: Expression): unknown {
  if (isFunction(e) && e.operator === 'List') return e.ops.map(toJS);
  if (isSymbol(e) && e.symbol === 'True') return true;
  if (isSymbol(e) && e.symbol === 'False') return false;
  // The absent value is `undefined` in compiled code (`e.re` of `Missing`
  // is `NaN`, which would hide the divergence of ROADMAP CE-368).
  if (isSymbol(e) && e.symbol === 'Missing') return undefined;
  return e.re;
}

/** Are `a` and `b` the same value, numbers compared within `1e-12`? */
function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  if (typeof a === 'number' && typeof b === 'number')
    return Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b));
  return a === b;
}

/** One run: the JavaScript value of `x` and its MathJSON spelling. The
 * other variables are `c = True`, `z = 0` and `a = 0`, unless `c` is given. */
type Run = readonly [unknown, unknown, boolean?];

/** The compiled function of `json`, called with the values of the
 * parameters `names` (by default `x`, `c` and `z`; `c` is `true` and `z` is
 * `0` when the call leaves them out). With `fallback`, a compilation that
 * declines gives the interpreter fallback.
 *
 * A compiled input whose type is `any` (`x`, `z`) is refused. So `json` is
 * compiled as the body of the function `(x, c, z) ↦ json`, whose parameters
 * have the types that `ce` declares for the symbols. The symbol `a`, when
 * `json` reads it, stays a free input with no type. */
function compiledFunction(
  ce: ComputeEngine,
  json: unknown,
  names: string[] = ['x', 'c', 'z'],
  fallback = false
): (vars: Record<string, unknown>) => unknown {
  const typed = (name: string): unknown => [
    'Typed',
    name,
    { str: ce.box(name).type.toString() },
  ];
  const result = compile(
    ce.box(['Function', json, ...names.map(typed)] as never),
    { to: 'javascript', fallback } as never
  );
  const run = result.run as unknown as (...args: unknown[]) => unknown;
  const defaults: Record<string, unknown> = { c: true, z: 0 };
  return (vars) => run(...names.map((n) => vars[n] ?? defaults[n]));
}

/** Expect the compilation of `json` to be refused because the inputs
 * `names` have no type. */
function expectUntypedRefusal(
  ce: ComputeEngine,
  json: unknown,
  names: string[]
): void {
  const r = compile(ce.box(json as any), { to: 'javascript' } as never);
  expect(r.success).toBe(false);
  expect(r.diagnostic?.code).toBe('untyped-input');
  for (const name of names) expect(r.unsupported).toContain(name);
}

/** Expect the compilation of `json` to decline because the argument of the
 * call of `g` has a type that does not settle its shape (`x` is `any`). */
function expectUnsettledDecline(ce: ComputeEngine, json: unknown): void {
  const r = compile(ce.box(json as any), { to: 'javascript' } as never);
  expect(r.success).toBe(false);
  expect(r.diagnostic?.code).toBe('unsettled-shape');
  expect(r.unsupported).toContain('x');
}

/** Expect the compilation of `(x, c, z) ↦ json` to decline because the
 * parameter `z` is declared `any`: its value can be a number or a list, and
 * compiled code does not test the shape of a value at run time. The
 * interpreter fallback gives the interpreted value for each run. */
function expectAnyParameterDecline(
  ce: ComputeEngine,
  json: unknown,
  runs: ReadonlyArray<Run>
): void {
  const typed = (name: string): unknown => [
    'Typed',
    name,
    { str: ce.box(name).type.toString() },
  ];
  const r = compile(
    ce.box(['Function', json, ...['x', 'c', 'z'].map(typed)] as never),
    { to: 'javascript' } as never
  );
  expect(r.success).toBe(false);
  expect(r.diagnostic?.code).toBe('unsettled-shape');
  expect(r.unsupported).toContain('z');
  expectAgreement(compiledAndInterpreted(ce, json, runs, true));
}

/** For each run, the compiled value, the interpreted value, and whether
 * they agree. Throws when the expression does not compile, unless
 * `fallback` is set. */
function compiledAndInterpreted(
  ce: ComputeEngine,
  json: unknown,
  runs: ReadonlyArray<Run>,
  fallback = false
): { compiled: unknown; interpreted: unknown; ok: boolean }[] {
  const expr = ce.box(json as any);
  const run = compiledFunction(ce, json, undefined, fallback);
  return runs.map(([js, mathJson, c = true]) => {
    ce.assign('x', ce.box(mathJson as any));
    ce.assign('c', c);
    ce.assign('z', 0);
    ce.assign('a', 0);
    const compiled = run({ x: js, c, z: 0 });
    const interpreted = toJS(expr.N());
    return { compiled, interpreted, ok: sameValue(compiled, interpreted) };
  });
}

function expectAgreement(
  results: { compiled: unknown; interpreted: unknown; ok: boolean }[]
): void {
  for (const r of results)
    expect(r).toEqual({
      compiled: r.compiled,
      interpreted: r.interpreted,
      ok: true,
    });
}

const ELEMENT = ['At', ['g', 'x'], 1];

const BLOCK_LOCAL = ['Block', ['Assign', 'y', ELEMENT], ['Add', 'y', 1]];

/** A Block local `y` that holds the element, used inside a cell function
 * or a comparison. The type of `Sin(y)` must hold a list too, or the
 * enclosing `+` compiles to the JavaScript `+`. */
const BLOCK_CASES: [string, unknown][] = [
  ['y + 1', ['Add', 'y', 1]],
  ['Sin(y) + 1', ['Add', ['Sin', 'y'], 1]],
  ['2 · Sin(y)', ['Multiply', 2, ['Sin', 'y']]],
  ['Sqrt(y) + Abs(y)', ['Add', ['Sqrt', 'y'], ['Abs', 'y']]],
  ['Sin(y) < 1', ['Less', ['Sin', 'y'], 1]],
].map(([name, body]) => [
  name as string,
  ['Block', ['Assign', 'y', ELEMENT], body],
]);

const CASES: [string, unknown][] = [
  ['g(x)[1] + 1', ['Add', ELEMENT, 1]],
  ['g(x)[1] - 1', ['Subtract', ELEMENT, 1]],
  ['g(x)[1] · 2', ['Multiply', ELEMENT, 2]],
  ['2 · g(x)[1]', ['Multiply', 2, ELEMENT]],
  ['g(x)[1] / 2', ['Divide', ELEMENT, 2]],
  ['-g(x)[1]', ['Negate', ELEMENT]],
  ['g(x)[1] + g(x)[1]', ['Add', ELEMENT, ELEMENT]],
  ['Sin(g(x)[1])', ['Sin', ELEMENT]],
  ['Sin(g(x)[1]) + 1', ['Add', ['Sin', ELEMENT], 1]],
  ['2 · Sin(g(x)[1])', ['Multiply', 2, ['Sin', ELEMENT]]],
  ['Sqrt(g(x)[1])', ['Sqrt', ELEMENT]],
  ['Abs(g(x)[1])', ['Abs', ELEMENT]],
  ['Floor(g(x)[1])', ['Floor', ELEMENT]],
  ['g(x)[1] < 1', ['Less', ELEMENT, 1]],
  ['g(x)[1] >= 1', ['GreaterEqual', ELEMENT, 1]],
  ['g(x)[1] = 1', ['Equal', ELEMENT, 1]],
  ['If(c, g(x)[1], z) + 1, z: any', ['Add', ['If', 'c', ELEMENT, 'z'], 1]],
  [
    'If(c, g(x)[1], a) + 1, a undeclared',
    ['Add', ['If', 'c', ELEMENT, 'a'], 1],
  ],
];

/** The values of `x`, by its declared type. An empty list: the element is
 * absent (ROADMAP CE-368). */
const X_RUNS: Record<string, ReadonlyArray<Run>> = {
  real: [
    [3, 3],
    [0.5, 0.5],
    [0.5, 0.5, false],
  ],
  'list<real>': [
    [
      [1, 2],
      ['List', 1, 2],
    ],
    [[1, 2], ['List', 1, 2], false],
    [[], ['List']],
  ],
  'list<list<real>>': [
    [
      [[1, 2], [3]],
      ['List', ['List', 1, 2], ['List', 3]],
    ],
    [[], ['List']],
  ],
};
const X_TYPES = Object.keys(X_RUNS);

describe('CE-360: compiled operators over an element that may be a list', () => {
  // `x` is declared `any`: the shape of the argument of `g(x)` is not
  // settled, so the compilation declines.
  for (const signature of SIGNATURES) {
    test.each(CASES)(`${signature}, x: any declines: %s`, (_name, json) => {
      expectUnsettledDecline(rowEngine(signature), json);
    });
  }

  // `x` is declared with a settled shape: the compiled value is the
  // interpreted value.
  for (const signature of SIGNATURES) {
    for (const xType of X_TYPES) {
      test.each(CASES)(`${signature}, x: ${xType}: %s`, (name, json) => {
        // The input `a` has no type, so the compilation is refused.
        if (name.endsWith('a undeclared'))
          return expectUntypedRefusal(
            rowEngine(signature, xType),
            json,
            ['a']
          );
        // With `x: real`, the arm `z` reaches the `+` of a number, and the
        // compilation declines (`expectAnyParameterDecline`). With a list
        // `x`, the `+` broadcasts over the arms, and compiles.
        if (name.endsWith('z: any') && xType === 'real')
          return expectAnyParameterDecline(
            rowEngine(signature, xType),
            json,
            X_RUNS[xType]
          );
        expectAgreement(
          compiledAndInterpreted(
            rowEngine(signature, xType),
            json,
            X_RUNS[xType]
          )
        );
      });
    }
  }

  test('the reported case: g(x)[1] + 1 at x = [1, 2] is [2, 3]', () => {
    const ce = rowEngine('(unknown) -> list<unknown>');
    expect(ce.box(ELEMENT as any).type.toString()).toBe('missing | unknown');
    // `x` is a list in one compilation and a number in the other.
    const list = rowEngine('(unknown) -> list<unknown>', 'list<real>');
    expect(compiledFunction(list, ['Add', ELEMENT, 1])({ x: [1, 2] })).toEqual(
      [2, 3]
    );
    const scalar = rowEngine('(unknown) -> list<unknown>', 'real');
    expect(compiledFunction(scalar, ['Add', ELEMENT, 1])({ x: 3 })).toBe(4);
  });

  test('a cell function of the element is typed as a possible list', () => {
    // The typing route reads the element as a possible list too, so the
    // type of `Sin(g(x)[1])` holds the list it evaluates to.
    const ce = rowEngine('(unknown) -> list<unknown>');
    const expr = ce.box(['Sin', ELEMENT]);
    const type = expr.type;
    expect(type.toString()).toBe(
      'list<list<any> | number | tuple> | missing | number | tuple'
    );
    ce.assign('x', ce.box(['List', 1, 2]));
    expect(expr.evaluate().type.matches(type)).toBe(true);
  });

  // With the bare `list` signature the element is typed `any`, and so is the
  // `Block` local `y` that holds it. The local `y` is read as a possible
  // list: the compiled `y + 1` gave the string "1,21" at `x = [1, 2]` when it
  // was read as a scalar, where the interpreter gives `[2, 3]`.
  for (const signature of SIGNATURES) {
    test.each(BLOCK_CASES)(
      `${signature}, x: any declines: a Block local holding the element, %s`,
      (_name, json) => {
        expectUnsettledDecline(rowEngine(signature), json);
      }
    );
    for (const xType of X_TYPES) {
      test.each(BLOCK_CASES)(
        `${signature}, x: ${xType}: a Block local holding the element, %s`,
        (_name, json) => {
          expectAgreement(
            compiledAndInterpreted(
              rowEngine(signature, xType),
              json,
              X_RUNS[xType]
            )
          );
        }
      );
    }
  }

  test('a cell function of a Block local is typed as a possible list', () => {
    const ce = rowEngine('(unknown) -> list');
    const expr = ce.box(BLOCK_CASES[1][1] as any);
    expect(expr.type.toString()).not.toBe('number');
    ce.assign('x', ce.box(['List', 1, 2]));
    expect(expr.evaluate().type.matches(expr.type)).toBe(true);
  });

  test('arithmetic over a parameter declared any declines', () => {
    // The value of `z` can be a number or a list, and compiled code does not
    // test the shape of a value at run time (ROADMAP CE-366). A free input
    // declared `any` is refused, so `z` is a parameter of the root function.
    const ce = rowEngine('(unknown) -> list');
    expect(() =>
      compile(
        ce.box(['Function', ['Add', 'z', 1], ['Typed', 'z', { str: 'any' }]]),
        { to: 'javascript', fallback: false } as never
      )
    ).toThrow(/"z": it is declared `any` or `value`/);
  });

  test('a global with an assigned value and a free variable stay scalar code', () => {
    // Neither is a Block local. A use infers the type `value` for `w`,
    // whose value the host passes.
    const ce = rowEngine('(unknown) -> list');
    ce.assign('k', ce.box(ELEMENT as any));
    ce.declare('h', '(value) -> number');
    ce.box(['h', 'w']);
    expect(ce.box('w').type.toString()).toBe('value');
    const code = compile(ce.box(['Add', 'w', 1]), {
      to: 'javascript',
      fallback: false,
    } as never).code;
    expect(code).not.toMatch(/_SYS\.bcast/);
    // The compiled code reads the value of `k`, `g(x)[1]`, so it calls `g`
    // on the input `x`, declared `any`: the compilation declines.
    expectUnsettledDecline(ce, ['Add', 'k', 1]);
    // With `x` declared `real`, the value of `k` is compiled in place.
    const real = rowEngine('(unknown) -> list', 'real');
    real.assign('k', real.box(ELEMENT as any));
    const result = compile(real.box(['Add', 'k', 1]), {
      to: 'javascript',
      fallback: false,
    } as never);
    for (const x of [3, 0.5]) {
      real.assign('x', real.number(x));
      expect((result.run as any)({ x })).toBe(real.box(['Add', 'k', 1]).N().re);
    }
  });
});

describe('CE-360: a number x keeps compiling to the interpreted value', () => {
  for (const signature of SIGNATURES) {
    for (const xType of ['real', 'number']) {
      test.each([...CASES, ['Block local', BLOCK_LOCAL]])(
        `${signature}, x: ${xType}: %s`,
        (name, json) => {
          // The input `a` has no type, so the compilation is refused.
          if (name.endsWith('a undeclared'))
            return expectUntypedRefusal(
              rowEngine(signature, xType),
              json,
              ['a']
            );
          const runs: ReadonlyArray<Run> = [
            [3, 3],
            [0.5, 0.5],
            [0.5, 0.5, false],
          ];
          if (name.endsWith('z: any'))
            return expectAnyParameterDecline(
              rowEngine(signature, xType),
              json,
              runs
            );
          expectAgreement(
            compiledAndInterpreted(rowEngine(signature, xType), json, runs)
          );
        }
      );
    }
  }
});

describe('CE-368: the absence marker of an element follows its value', () => {
  // The compiled `At` picks the marker of an index past the end from the
  // value, as the interpreter does: `NaN` for a list of numbers, the absent
  // object (`undefined`, the interpreter's `Missing`) for a list of lists
  // or an empty list. The run-time broadcast keeps a `NaN` operand a `NaN`
  // (a numeric slot) and makes the result absent for an absent operand.
  test('g(x)[5] + 1 is NaN at x = 3 and Missing at x = [] on both routes', () => {
    // One compilation per declared shape of `x`: a number, and a list.
    const json = ['Add', ['At', ['g', 'x'], 5], 1];
    const scalar = rowEngine('(unknown) -> list<unknown>', 'real');
    scalar.assign('x', scalar.number(3));
    expect(scalar.box(json as any).evaluate().toString()).toBe('NaN');
    expect(compiledFunction(scalar, json, ['x'])({ x: 3 })).toBeNaN();

    const list = rowEngine('(unknown) -> list<unknown>', 'list<real>');
    list.assign('x', list.box(['List']));
    expect(list.box(json as any).evaluate().toString()).toBe('"Missing"');
    expect(compiledFunction(list, json, ['x'])({ x: [] })).toBeUndefined();
  });

  test('a decisive operand of a connective wins over an absent one', () => {
    // `And(g(x)[5] < 1, b)` at `x = []`: the comparison is absent, and
    // `b = false` decides, as `And(Missing, False)` is `False` in the
    // interpreter. The connectives take the broadcast without the absence
    // rule (`_SYS.bcastPlain`), so their closure reads the absent operand:
    // with `b = true` the result is the absent boolean, spelled `NaN` by
    // the compiled connectives.
    const ce = rowEngine('(unknown) -> list<unknown>', 'list<real>');
    ce.declare('b', 'boolean');
    const json = ['And', ['Less', ['At', ['g', 'x'], 5], 1], 'b'];
    const expr = ce.box(json as any);
    const run = compiledFunction(ce, json, ['x', 'b']);
    ce.assign('x', ce.box(['List']));
    ce.assign('b', ce.False);
    expect(expr.evaluate().toString()).toBe('"False"');
    expect(run({ x: [], b: false })).toBe(false);
    ce.assign('b', ce.True);
    expect(expr.evaluate().toString()).toBe('"Missing"');
    expect(run({ x: [], b: true })).toBeNaN();
  });

  test('an absent operand beside a rotation view is a NaN cell', () => {
    // `g(x)[5] + RotateLeft(xs)` at `x = []`: the present list gives the
    // shape, and the absent operand is `NaN` in each cell, as in the
    // interpreter. The compiled `RotateLeft` may pass a rotation view, not
    // an array, to the broadcast, which reads it as a collection.
    const ce = rowEngine('(unknown) -> list<unknown>', 'list<real>');
    ce.declare('xs', 'list<number>');
    const json = ['Add', ['At', ['g', 'x'], 5], ['RotateLeft', 'xs']];
    const expr = ce.box(json as any);
    const run = compiledFunction(ce, json, ['x', 'xs']);
    ce.assign('x', ce.box(['List']));
    ce.assign('xs', ce.box(['List', 1, 2]));
    expect(expr.evaluate().toString()).toBe('[NaN,NaN]');
    expect(run({ x: [], xs: [1, 2] })).toEqual([NaN, NaN]);
  });
});

describe('CE-360: an element typed as a number stays scalar code', () => {
  test('L: list<number>, L[i] + 1 and L[i] < y emit no broadcast', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    ce.declare('i', 'integer');
    ce.declare('y', 'real');
    for (const json of [
      ['Add', ['At', 'L', 'i'], 1],
      ['Less', ['At', 'L', 'i'], 'y'],
    ]) {
      const code = compile(ce.box(json as any), {
        to: 'javascript',
        fallback: false,
      } as never).code;
      expect(code).not.toMatch(/_SYS\.bcast/);
    }
  });
});

describe('CE-386: a NaN operand of a compiled Equal is a number, not an absence', () => {
  // With `g := t ↦ [t, 2t]` and `x: any`, the operand `g(x)[5]` is typed
  // `missing | number | vector<2>`. At `x = 3` its value is `NaN` (an index
  // past the end of a list of numbers), which compares as IEEE says on both
  // routes: `False` for `Equal`, `True` for `NotEqual`. The Kleene guard of
  // the compiled equality read `NaN` as absent and answered `Missing`. At
  // `x = "a"` the value is the object absence `undefined`, and both routes
  // answer `Missing` (landed 2026-10-23). `x` is declared with the shape
  // of its value: `real`, `string` or `list<real>`.
  //
  // The interpreter reads the value assigned to `x`. The compiler folds an
  // assigned value into the code, so `compiled` builds its own engine with
  // `x` declared and not assigned: `x` is then an input of the code.
  function engine(value: any, xType: string, assigned = true): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('x', xType);
    ce.assign(
      'g',
      ce.box(['Function', ['List', 't', ['Multiply', 2, 't']], 't'])
    );
    if (assigned)
      ce.assign('x', value === 'a' ? ce.string('a') : ce.box(value));
    return ce;
  }
  const compiled = (json: any, xType: string): any =>
    compile(engine(undefined, xType, false).box(json), {
      to: 'javascript',
      fallback: false,
    });
  const run = (xType: string, json: any, x: unknown): unknown =>
    compiled(json, xType).run({ x });

  test('g(x)[5] = 1 at x = 3 is False on both routes', () => {
    const ce = engine(3, 'real');
    const json = ['Equal', ['At', ['g', 'x'], 5], 1];
    expect(ce.box(json).evaluate().symbol).toBe('False');
    expect(run('real', json, 3)).toBe(false);
  });

  test('g(x)[5] ≠ 1 at x = 3 is True on both routes', () => {
    const ce = engine(3, 'real');
    const json = ['NotEqual', ['At', ['g', 'x'], 5], 1];
    expect(ce.box(json).evaluate().symbol).toBe('True');
    expect(run('real', json, 3)).toBe(true);
  });

  test('g(x)[5] = 1 declines for x: any and for x: string', () => {
    // An `any` input does not settle the shape of the argument of `g`. For a
    // `string` input the shape is settled, and the element read finds no
    // `string`: the compiled equality cannot tell the absent `string` from
    // a number, so it declines and the interpreter answers `Missing`.
    const json = ['Equal', ['At', ['g', 'x'], 5], 1];
    const any = engine('a', 'any');
    const unsettled = compile(any.box(json), { to: 'javascript' } as never);
    expect(unsettled.success).toBe(false);
    expect(unsettled.diagnostic?.code).toBe('unsettled-shape');
    expect(unsettled.unsupported).toContain('x');
    const ce = engine('a', 'string');
    expect(ce.box(json).evaluate().symbol).toBe('Missing');
    expect(compile(ce.box(json), { to: 'javascript' } as never).success).toBe(
      false
    );
  });

  test('g(x)[5] = 1 at x = [] is Missing on both routes', () => {
    const ce = engine(['List'], 'list<real>');
    const json = ['Equal', ['At', ['g', 'x'], 5], 1];
    expect(ce.box(json).evaluate().symbol).toBe('Missing');
    expect(run('list<real>', json, [])).toBeUndefined();
  });

  test('an impure operand of the guarded comparison is evaluated once', () => {
    // The guard tests each operand for absence and the comparison reads it
    // again: an element read or a call is bound to a temporary, so
    // `Random()` draws once, and the read of `g(x)[1]` runs once.
    const json = ['Equal', ['At', ['g', 'x'], 1], ['Random']];
    const code = String(compiled(json, 'real').code);
    expect(code.match(/drawNextRandomNumber/g)).toHaveLength(1);
    expect(code.match(/atNumeric/g)).toHaveLength(1);
    // The same holds for a list `x`, where the element read maps `g`.
    const listCode = String(compiled(json, 'list<real>').code);
    expect(listCode.match(/drawNextRandomNumber/g)).toHaveLength(1);
    expect(listCode.match(/_SYS\.at\(/g)).toHaveLength(1);
  });
});
