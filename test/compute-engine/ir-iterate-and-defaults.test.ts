/**
 * Operators of the compiler `ir` (README of
 * `src/compute-engine/compilation/ir/`): `Iterate` read through `Take`,
 * `At`, `First`, `Second` and `Third` (the region `iterate`), and the
 * default values of the parameters of user functions.
 *
 * JavaScript agrees with the interpreter (`ce.withValues()` and
 * `subs().evaluate()`) within 1e-12 at each point, with no iteration, one
 * and several among them; the forms whose value is not settled decline.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isFunction,
  isNumber,
} from '../../src/compute-engine/boxed-expression/type-guards';
import { parseEpsil } from '../../src/epsil/parse-epsil';

type Json = unknown;
type Point = Record<string, number | number[]>;

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('n', 'integer');
ce.declare('m', 'integer');
ce.declare('L', 'list<real>');
// Callbacks of `Iterate`: by a definition (`g`, `h`), a name declared
// `function` that holds a literal (`q`), a declared signature with a
// default and a literal of two parameters (`s`, called with two
// arguments by `Iterate`).
ce.parse('g(t) := 2t+1').evaluate();
ce.parse('h(i, a) := a + i').evaluate();
ce.declare('q', 'function');
ce.assign('q', ce.parse('t \\mapsto t/2'));
ce.declare('s', '(real, real = 2) -> real');
ce.assign('s', ce.box(['Function', ['Add', ['Negate', 'u'], 'v'], 'u', 'v']));
// User functions with defaults: in the literal (`d`, `p`, a constant
// default `Pi`), in a declared signature (`gm`), and an argument that is a
// sort key (`c`).
ce.assign(
  'd',
  ce.box([
    'Function',
    ['Add', ['Negate', 'a'], ['Multiply', 10, 'b']],
    'a',
    ['Optional', 'b', 3],
  ])
);
ce.assign(
  'p',
  ce.box([
    'Function',
    ['Add', 'a', 'b', 'c'],
    'a',
    ['Optional', 'b', 1],
    ['Optional', 'c', 'Pi'],
  ])
);
ce.declare('gm', '(integer, integer = 3) -> integer');
ce.assign('gm', ce.box(['Function', ['Mod', 'u', 'k'], 'u', 'k']));
ce.assign(
  'gt',
  ce.box([
    'Function',
    ['Mod', 'u', 'k'],
    ['Typed', 'u', "'integer'"],
    ['Optional', ['Typed', 'k', "'integer'"], 4],
  ])
);
ce.assign(
  'c',
  ce.box(['Function', ['Multiply', 'a', 'b'], 'a', ['Optional', 'b', -1]])
);
ce.declare('fact', '(integer, integer = 1) -> integer');
ce.assign(
  'fact',
  ce.box([
    'Function',
    [
      'If',
      ['LessEqual', 'u', 1],
      'acc',
      ['fact', ['Subtract', 'u', 1], ['Multiply', 'acc', 'u']],
    ],
    'u',
    'acc',
  ])
);

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

/** The interpreter's value: a list is an array, `Missing` is NaN. */
function read(e: Expression): unknown {
  if (isNumber(e)) return e.re;
  if (e.symbol === 'Missing') return NaN;
  if (isFunction(e, 'List') || isFunction(e, 'Tuple')) return e.ops.map(read);
  if (isFunction(e) && e.isCollection && e.isFiniteCollection)
    return read(e.engine.function('ListFrom', [e]).evaluate().N());
  throw new Error(`no value: ${e.toString()}`);
}

const boxed = (point: Point) =>
  Object.fromEntries(
    Object.entries(point).map(([k, v]) => [
      k,
      Array.isArray(v)
        ? ce.function(
            'List',
            v.map((t) => ce.number(t))
          )
        : ce.number(v),
    ])
  );

/** The interpreter's values at `point`: by `withValues()`, and by
 *  `subs()` then `evaluate()`. */
function interpreted(e: Expression, point: Point): [unknown, unknown] {
  const values = boxed(point);
  return [
    ce.withValues(values as never, () => read(e.evaluate().N())),
    read(e.subs(values).evaluate().N()),
  ];
}

/** `v` and `w` have one shape and agree within 1e-12. */
function agree(v: unknown, w: unknown): boolean {
  if (Array.isArray(w))
    return (
      Array.isArray(v) &&
      v.length === w.length &&
      w.every((x, i) => agree(v[i], x))
    );
  return (
    typeof v === 'number' &&
    typeof w === 'number' &&
    (Math.abs(v - w) <= 1e-12 * Math.max(1, Math.abs(w)) ||
      (Number.isNaN(v) && Number.isNaN(w)))
  );
}

function checkExpr(e: Expression, points: Point[] = POINTS) {
  const r = compile(e, IR);
  expect(r).toMatchObject({ success: true, profile: 'ir' });
  for (const point of points) {
    const got = r.run!(point as never);
    for (const want of interpreted(e, point))
      if (!agree(got, want))
        throw new Error(
          `${JSON.stringify(e.json)} at ${JSON.stringify(point)}: ${JSON.stringify(got)}, the interpreter ${JSON.stringify(want)}`
        );
  }
  return r;
}
const check = (json: Json, points?: Point[]) => checkExpr(box(json), points);

// No iteration, one and several; an index out of range below.
// prettier-ignore
const POINTS: Point[] = [
  { x: 0.5, n: 0, m: 2, L: [3, -1, 2, 0.5] },
  { x: -2, n: 1, m: 0, L: [] },
  { x: 0.25, n: 5, m: -1, L: [2] },
  { x: 1.5, n: 3, m: 7, L: [-2, 2, 0, -0.5, 0.5, 2, -2] },
];

const lambda = (body: Json, ...params: Json[]) => ['Function', body, ...params];
const double = lambda(['Multiply', 2, 'a'], 'a');

describe('IR: Iterate', () => {
  // prettier-ignore
  test.each([
    ['a unary literal', ['Take', ['Iterate', double, 'x'], 'n']],
    ['a literal of the index and the accumulator', ['Take', ['Iterate', lambda(['Add', 'a', 'i'], 'i', 'a'), 1], 'n']],
    ['an integer accumulator (integer lane)', ['Take', ['Iterate', lambda(['Mod', ['Add', 'a', 'i'], 7], 'i', 'a'), 1], 'n']],
    ['an integer start whose next element is real', ['Take', ['Iterate', lambda(['Divide', 'a', 3], 'a'), 1], 'n']],
    ['a map with an input', ['Take', ['Iterate', lambda(['Add', ['Power', 'a', 2], 'x'], 'a'), 0], 'n']],
    ['a library operator', ['Take', ['Iterate', 'Sin', 'x'], 'n']],
    ['a defined function of one parameter', ['Take', ['Iterate', 'g', 1], 'n']],
    ['a defined function of two parameters', ['Take', ['Iterate', 'h', 'x'], 'n']],
    ['a name declared function holding a unary literal', ['Take', ['Iterate', 'q', 'x'], 'n']],
    ['a declared signature with a default, a literal of two parameters', ['Take', ['Iterate', 's', 'x'], 'n']],
    ['a function whose second parameter has a default (unary)', ['Take', ['Iterate', 'd', 'x'], 'n']],
    ['no initial value, a function of the index alone', ['Take', ['Iterate', lambda(['Multiply', 'i', 'i'], 'i', 'a')], 'n']],
    ['a constant count', ['Take', ['Iterate', double, 'x'], 4]],
    ['a count of 0', ['Take', ['Iterate', double, 'x'], 0]],
    ['a sum of the elements', ['Sum', ['Take', ['Iterate', double, 'x'], 'n']]],
    ['At of a run-time index (0 and below are Missing)', ['At', ['Iterate', double, 'x'], 'm']],
    ['At of a constant index', ['At', ['Iterate', lambda(['Add', 'a', 'i'], 'i', 'a'), 'x'], 3]],
    ['First', ['First', ['Iterate', 'Cos', 'x']]],
    ['Second', ['Second', ['Iterate', double, 'x']]],
    ['Third', ['Third', ['Iterate', 'g', 'n']]],
  ])('%s', (_, json) => {
    check(json);
  });

  test('is one loop that carries the accumulator', () => {
    const code = js(['Take', ['Iterate', double, 'x'], 'n']).code;
    expect(code).toContain('let ');
    expect(code).toContain('new Array(');
  });

  test('throws for a negative count at run time', () => {
    const r = js(['Take', ['Iterate', double, 'x'], 'n']);
    expect(() => r.run!({ x: 1, n: -2 } as never)).toThrow();
  });

  // prettier-ignore
  test.each([
    ['a negative constant count', ['Take', ['Iterate', double, 1], -2], /negative count/],
    ['a real count', ['Take', ['Iterate', double, 1], 2.5], /count that is not an integer/],
    ['a real index', ['At', ['Iterate', double, 1], 'x'], /index of Iterate that is not an integer/],
    ['Last (Missing)', ['Last', ['Iterate', double, 1]], /Iterate/],
    ['a draw in the function', ['Take', ['Iterate', lambda(['Add', 'a', ['Random']], 'a'), 0], 3], /Iterate with an effect/],
    ['no initial value read by the function', ['Take', ['Iterate', lambda(['Add', 'a', 'i'], 'i', 'a')], 3], /no initial value/],
    ['no initial value of a unary function', ['Take', ['Iterate', double], 3], /no initial value/],
    ['a list accumulator', ['Take', ['Iterate', lambda(['Reverse', 'a'], 'a'), ['List', 0, 1]], 3], /scalar/],
    ['another consumer (Drop)', ['Take', ['Drop', ['Iterate', double, 1], 2], 3], /Iterate/],
    ['a literal with a defaulted parameter (unary by its required parameters)', ['Take', ['Iterate', lambda(['Add', 'a', 'b'], 'a', ['Optional', 'b', 1]), 1], 3], /Iterate of a function that is not a literal of 1 parameters/],
  ])('declines %s', (_, json, cause) => {
    expect(failure(() => js(json))).toMatch(cause);
  });

  test('declines on GLSL and in the interval mode', () => {
    const json = ['Take', ['Iterate', double, 'x'], 4];
    expect(failure(() => js(json, { to: 'glsl' }))).toMatch(/iterate/);
    expect(failure(() => js(json, { to: 'interval-js' }))).toMatch(
      /Iterate on interval-js/
    );
  });
});

describe('IR: default values of parameters', () => {
  // prettier-ignore
  test.each([
    ['a default omitted', ['d', 'x']],
    ['a default given', ['d', 'x', 2]],
    ['two defaults, a constant (Pi)', ['p', 'x']],
    ['two defaults, one given', ['p', 'x', 2]],
    ['two defaults, both given', ['p', 'x', 2, 'm']],
    ['a declared integer default', ['Add', ['gm', 'm'], ['gm', 'm', 2]]],
    ['a typed parameter with a default', ['Add', ['gt', 'm'], ['gt', 'm', 5]]],
    ['a list argument mapped, the default beside it', ['d', 'L']],
    ['the callback of a Map', ['Map', 'd', 'L']],
    ['the key of a Sort (one required parameter)', ['Sort', 'L', 'c']],
    ['a recursion that passes the parameter with a default', ['fact', 'n']],
  ])('%s', (_, json) => {
    check(json);
  });

  test('the canonical call holds the default', () => {
    expect(js(['d', 'x']).code).toBe(js(['d', 'x', 3]).code);
  });

  // prettier-ignore
  test.each([
    ['function scaled(t: number, factor: number = 2) -> number { t * factor }\nscaled(x) + scaled(x, 5)'],
    ['scaled2(t, factor = 2) = t * factor\nscaled2(x) - scaled2(x, -1)'],
    ['function md(k: integer, base: integer = 3) -> integer { Mod(k, base) }\nmd(n) + md(n, 4)'],
  ])('an Epsil program: %s', (src) => {
    const [program] = parseEpsil(src);
    checkExpr(box(program));
  });

  test('declines a root function literal with a default (run() takes every argument)', () => {
    expect(
      failure(() => js(lambda(['Add', 'a', 'b'], 'a', ['Optional', 'b', 3])))
    ).toMatch(/the parameter b with a default value/);
  });
});
