/**
 * Compiled arithmetic and comparisons over an element of a list typed
 * `list<unknown>` (ROADMAP CE-360).
 *
 * The case: `g` declared `(unknown) -> list<unknown>` and assigned
 * `t ↦ [t, 2t]`, and `x` declared `any`. The index `g(x)[1]` is typed
 * `missing | unknown`. When `x` is a list, the call maps over it, and the
 * element is a list: `g([1, 2])[1]` is `[1, 2]`. The readers that ask
 * whether an operand may be a collection (`isPossiblyCollectionTyped` in
 * `collection-utils.ts`, its typing twins, and the compiled predicates in
 * `base-compiler.ts` and `javascript-target.ts`) read a union only by its
 * `broadcastable` branches, so they took the element for a scalar. The
 * compiled `g(x)[1] + 1` added `1` to an array with the JavaScript `+`, and
 * gave the string `"1,21"` at `x = [1, 2]`, where the interpreter gives
 * `[2, 3]`. A product gave `NaN` and a comparison gave one `false`. The
 * typing route typed `Sin(g(x)[1])` as `number`, so the compiled
 * `Sin(g(x)[1]) + 1` also concatenated strings.
 *
 * The fix reads an application typed by a top type beside absence markers
 * only (`topTypeBesideAbsence`, `common/type/utils.ts`) as that top type,
 * which the compiled code broadcasts at run time (`_SYS.bcast`), as it
 * already did for the bare `list` signature (whose element is typed `any`).
 * A `Block` local that takes its type from the element is read the same way:
 * it is typed `missing | unknown`, or `any` inferred from the value.
 *
 * Each case compares the compiled value with the interpreted value
 * (`.N()`), at a number `x` and at list values of `x`. The three
 * signatures of `g` are `(unknown) -> list<unknown>`, `(unknown) -> list`
 * and no declaration (the inferred signature, `(unknown) -> vector<2>`).
 *
 * At `x = []` the element is absent, and both routes answer `Missing`: the
 * compiled code gave `NaN` (or `false` for a comparison) there, on every
 * signature, until the run-time broadcast made a result with an absent
 * operand absent (ROADMAP CE-368).
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

/** For each run, the compiled value, the interpreted value, and whether
 * they agree. Throws when the expression does not compile. */
function compiledAndInterpreted(
  ce: ComputeEngine,
  json: unknown,
  runs: ReadonlyArray<Run>
): { compiled: unknown; interpreted: unknown; ok: boolean }[] {
  const expr = ce.box(json as any);
  const run = compile(expr, {
    to: 'javascript',
    fallback: false,
  } as never).run!;
  return runs.map(([js, mathJson, c = true]) => {
    ce.assign('x', ce.box(mathJson as any));
    ce.assign('c', c);
    ce.assign('z', 0);
    ce.assign('a', 0);
    const compiled = run({ x: js, c, z: 0, a: 0 } as never);
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

const X_VALUES: ReadonlyArray<Run> = [
  [3, 3],
  [
    [1, 2],
    ['List', 1, 2],
  ],
  [
    [[1, 2], [3]],
    ['List', ['List', 1, 2], ['List', 3]],
  ],
  [[1, 2], ['List', 1, 2], false],
  // An empty list: the element is absent (ROADMAP CE-368).
  [[], ['List']],
];

describe('CE-360: compiled operators over an element that may be a list', () => {
  for (const signature of SIGNATURES) {
    test.each(CASES)(`${signature}: %s`, (name, json) => {
      expectAgreement(
        compiledAndInterpreted(rowEngine(signature), json, X_VALUES)
      );
    });
  }

  test('the reported case: g(x)[1] + 1 at x = [1, 2] is [2, 3]', () => {
    const ce = rowEngine('(unknown) -> list<unknown>');
    expect(ce.box(ELEMENT as any).type.toString()).toBe('missing | unknown');
    const run = compile(ce.box(['Add', ELEMENT, 1]), {
      to: 'javascript',
      fallback: false,
    } as never).run!;
    expect(run({ x: [1, 2] } as never)).toEqual([2, 3]);
    expect(run({ x: 3 } as never)).toBe(4);
  });

  test('a cell function of the element is typed as a possible list', () => {
    // The typing route reads the element as a possible list too, so the
    // type of `Sin(g(x)[1])` holds the list it evaluates to.
    const ce = rowEngine('(unknown) -> list<unknown>');
    const expr = ce.box(['Sin', ELEMENT]);
    const type = expr.type;
    expect(type.toString()).toBe('broadcastable<number> | missing');
    ce.assign('x', ce.box(['List', 1, 2]));
    expect(expr.evaluate().type.matches(type)).toBe(true);
  });

  // With the bare `list` signature the element is typed `any`, and so is the
  // `Block` local `y` that holds it. The compiled code reads a symbol the
  // user declared `any` as a scalar (the host passes its value). Before, it
  // read the local `y` the same way, and the compiled `y + 1` gave the
  // string "1,21" at `x = [1, 2]`, where the interpreter gives `[2, 3]`.
  for (const signature of SIGNATURES) {
    test.each(BLOCK_CASES)(
      `${signature}: a Block local holding the element, %s`,
      (_name, json) => {
        expectAgreement(
          compiledAndInterpreted(rowEngine(signature), json, X_VALUES)
        );
      }
    );
  }

  test('a cell function of a Block local is typed as a possible list', () => {
    const ce = rowEngine('(unknown) -> list');
    const expr = ce.box(BLOCK_CASES[1][1] as any);
    expect(expr.type.toString()).not.toBe('number');
    ce.assign('x', ce.box(['List', 1, 2]));
    expect(expr.evaluate().type.matches(expr.type)).toBe(true);
  });

  test('a parameter declared any stays scalar code for a number', () => {
    // The value is checked at run time (ROADMAP CE-366, user decision
    // 2026-10-25): a value that is not an array takes the scalar code, and
    // an array takes the broadcast.
    const ce = rowEngine('(unknown) -> list');
    const code = compile(ce.box(['Add', 'z', 1]), {
      to: 'javascript',
      fallback: false,
    } as never).code!;
    expect(
      code.startsWith(
        '(!(Array.isArray(_.z) || ArrayBuffer.isView(_.z)) ? _.z + 1 : '
      )
    ).toBe(true);
  });

  test('a global with an assigned value and a free variable stay scalar code', () => {
    // Neither is a Block local. A use infers the type `value` for `w`,
    // whose value the host passes.
    const ce = rowEngine('(unknown) -> list');
    ce.assign('k', ce.box(ELEMENT as any));
    ce.declare('h', '(value) -> number');
    ce.box(['h', 'w']);
    expect(ce.box('w').type.toString()).toBe('value');
    for (const json of [
      ['Add', 'k', 1],
      ['Add', 'w', 1],
    ]) {
      const code = compile(ce.box(json as any), {
        to: 'javascript',
        fallback: false,
      } as never).code;
      expect(code).not.toMatch(/_SYS\.bcast/);
    }
  });
});

describe('CE-360: a number x keeps compiling to the interpreted value', () => {
  for (const signature of SIGNATURES) {
    for (const xType of ['real', 'number']) {
      test.each([...CASES, ['Block local', BLOCK_LOCAL]])(
        `${signature}, x: ${xType}: %s`,
        (_name, json) => {
          expectAgreement(
            compiledAndInterpreted(rowEngine(signature, xType), json, [
              [3, 3],
              [0.5, 0.5],
              [0.5, 0.5, false],
            ])
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
    const ce = rowEngine('(unknown) -> list<unknown>');
    const expr = ce.box(['Add', ['At', ['g', 'x'], 5], 1]);
    const run = compile(expr, {
      to: 'javascript',
      fallback: false,
    } as never).run!;
    ce.assign('x', ce.number(3));
    expect(expr.evaluate().toString()).toBe('NaN');
    expect(run({ x: 3 } as never)).toBeNaN();
    ce.assign('x', ce.box(['List']));
    expect(expr.evaluate().toString()).toBe('"Missing"');
    expect(run({ x: [] } as never)).toBeUndefined();
  });

  test('a decisive operand of a connective wins over an absent one', () => {
    // `And(g(x)[5] < 1, b)` at `x = []`: the comparison is absent, and
    // `b = false` decides, as `And(Missing, False)` is `False` in the
    // interpreter. The connectives take the broadcast without the absence
    // rule (`_SYS.bcastPlain`), so their closure reads the absent operand:
    // with `b = true` the result is the absent boolean, spelled `NaN` by
    // the compiled connectives.
    const ce = rowEngine('(unknown) -> list<unknown>');
    ce.declare('b', 'boolean');
    const expr = ce.box(['And', ['Less', ['At', ['g', 'x'], 5], 1], 'b']);
    const run = compile(expr, {
      to: 'javascript',
      fallback: false,
    } as never).run!;
    ce.assign('x', ce.box(['List']));
    ce.assign('b', ce.False);
    expect(expr.evaluate().toString()).toBe('"False"');
    expect(run({ x: [], b: false } as never)).toBe(false);
    ce.assign('b', ce.True);
    expect(expr.evaluate().toString()).toBe('"Missing"');
    expect(run({ x: [], b: true } as never)).toBeNaN();
  });

  test('an absent operand beside a rotation view is a NaN cell', () => {
    // `g(x)[5] + RotateLeft(xs)` at `x = []`: the present list gives the
    // shape, and the absent operand is `NaN` in each cell, as in the
    // interpreter. The compiled `RotateLeft` may pass a rotation view, not
    // an array, to the broadcast, which reads it as a collection.
    const ce = rowEngine('(unknown) -> list<unknown>');
    ce.declare('xs', 'list<number>');
    const expr = ce.box(['Add', ['At', ['g', 'x'], 5], ['RotateLeft', 'xs']]);
    const run = compile(expr, {
      to: 'javascript',
      fallback: false,
    } as never).run!;
    ce.assign('x', ce.box(['List']));
    ce.assign('xs', ce.box(['List', 1, 2]));
    expect(expr.evaluate().toString()).toBe('[NaN,NaN]');
    expect(run({ x: [], xs: [1, 2] } as never)).toEqual([NaN, NaN]);
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
  // answer `Missing` (landed 2026-10-23).
  function engine(value: any): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('x', 'any');
    ce.assign(
      'g',
      ce.box(['Function', ['List', 't', ['Multiply', 2, 't']], 't'])
    );
    ce.assign('x', value === 'a' ? ce.string('a') : ce.box(value));
    return ce;
  }
  const run = (ce: ComputeEngine, json: any, x: unknown): unknown =>
    (compile(ce.box(json), { to: 'javascript', fallback: false }) as any).run({
      x,
    });

  test('g(x)[5] = 1 at x = 3 is False on both routes', () => {
    const ce = engine(3);
    const json = ['Equal', ['At', ['g', 'x'], 5], 1];
    expect(ce.box(json).evaluate().symbol).toBe('False');
    expect(run(ce, json, 3)).toBe(false);
  });

  test('g(x)[5] ≠ 1 at x = 3 is True on both routes', () => {
    const ce = engine(3);
    const json = ['NotEqual', ['At', ['g', 'x'], 5], 1];
    expect(ce.box(json).evaluate().symbol).toBe('True');
    expect(run(ce, json, 3)).toBe(true);
  });

  test('g(x)[5] = 1 at x = "a" is Missing on both routes', () => {
    const ce = engine('a');
    const json = ['Equal', ['At', ['g', 'x'], 5], 1];
    expect(ce.box(json).evaluate().symbol).toBe('Missing');
    expect(run(ce, json, 'a')).toBeUndefined();
  });

  test('g(x)[5] = 1 at x = [] is Missing on both routes', () => {
    const ce = engine(['List']);
    const json = ['Equal', ['At', ['g', 'x'], 5], 1];
    expect(ce.box(json).evaluate().symbol).toBe('Missing');
    expect(run(ce, json, [])).toBeUndefined();
  });

  test('an impure operand of the guarded comparison is evaluated once', () => {
    // The guard tests each operand for absence and the comparison reads it
    // again: an element read or a call is bound to a temporary, so
    // `Random()` draws once, and the read of `g(x)[1]` runs once.
    const ce = engine(3);
    const json = ['Equal', ['At', ['g', 'x'], 1], ['Random']];
    const code = String(
      (compile(ce.box(json), { to: 'javascript', fallback: false }) as any).code
    );
    expect(code.match(/drawNextRandomNumber/g)).toHaveLength(1);
    expect(code.match(/atWithValueMarker/g)).toHaveLength(1);
  });
});
