/**
 * Operators of the compiler `ir` (README of
 * `src/compute-engine/compilation/ir/`): `Pipe` lowered as the call it
 * evaluates, `Boole` and `KroneckerDelta`, the searches `Any`, `All`,
 * `Contains` and `IndexOf`, a named user function as the function of a
 * `Map`, a `Filter`, a `Count` or a quantifier, and `Sort` by a key or by a
 * comparator.
 *
 * JavaScript agrees with the interpreter within 1e-12 at each point,
 * lists of length 0, 1 and several among them; the forms whose shape or
 * order is not settled decline.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isFunction,
  isNumber,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;
type Point = Record<string, number | number[]>;

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('n', 'integer');
ce.declare('m', 'integer');
ce.declare('L', 'list<real>');
ce.declare('I', 'list<integer>');
ce.declare('L3', 'list<real^3>');
// Named user functions: assigned a literal, and defined with `:=`.
ce.declare('f', 'function');
ce.assign('f', ce.parse('t \\mapsto t^2+1'));
ce.declare('h', '(real) -> real');
ce.assign('h', ce.box(['Function', ['Multiply', 3, 'u'], 'u']));
ce.declare('p', '(real) -> boolean');
ce.assign('p', ce.box(['Function', ['Greater', 'a', 0], 'a']));
ce.parse('g(t) := t^2 - 3').evaluate();
ce.parse('k(a, c) := a \\cdot c + 1').evaluate();

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

/** The interpreter's value: a list is an array, a boolean a boolean. */
function read(e: Expression): unknown {
  if (isNumber(e)) return e.re;
  if (e.symbol === 'True' || e.symbol === 'False') return e.symbol === 'True';
  if (isFunction(e, 'List') || isFunction(e, 'Tuple')) return e.ops.map(read);
  // A lazy collection (a `Map`, a `Filter`).
  if (isFunction(e) && e.isCollection && e.isFiniteCollection)
    return read(e.engine.function('ListFrom', [e]).evaluate().N());
  throw new Error(`no value: ${e.toString()}`);
}

function interpreted(json: Json, point: Point): unknown {
  const values = Object.fromEntries(
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
  return ce.withValues(values as never, () => read(box(json).evaluate().N()));
}

/** `v` and `w` have one shape and agree within 1e-12. */
function agree(v: unknown, w: unknown): boolean {
  if (Array.isArray(w))
    return (
      Array.isArray(v) &&
      v.length === w.length &&
      w.every((x, i) => agree(v[i], x))
    );
  if (typeof w === 'boolean') return v === w;
  return (
    typeof v === 'number' &&
    typeof w === 'number' &&
    (Math.abs(v - w) <= 1e-12 * Math.max(1, Math.abs(w)) ||
      (Number.isNaN(v) && Number.isNaN(w)))
  );
}

function check(json: Json, points: Point[] = POINTS, options: object = {}) {
  const r = js(json, options);
  expect(r).toMatchObject({ success: true, profile: 'ir' });
  for (const point of points) {
    const got = r.run!(point as never);
    const want = interpreted(json, point);
    if (!agree(got, want))
      throw new Error(
        `${JSON.stringify(json)} at ${JSON.stringify(point)}: ${JSON.stringify(got)}, the interpreter ${JSON.stringify(want)}`
      );
  }
  return r;
}

// Lists of lengths 0, 1 and several, with repeated elements, ties of
// absolute value, a zero and integers among reals.
// prettier-ignore
const POINTS: Point[] = [
  { x: 0.5, n: 2, m: 2, L: [3, -1, 2, 0.5], I: [4, 2, 4, -1], L3: [1, 2, 3] },
  { x: -2, n: 0, m: 1, L: [], I: [], L3: [0, 0, -1] },
  { x: 2, n: -3, m: 4, L: [2], I: [7], L3: [-2, 2, -2] },
  { x: 0, n: 1, m: 1, L: [-2, 2, 0, -0.5, 0.5, 2, -2], I: [0, 0, 1], L3: [0.25, -0.25, 0] },
];

const lambda = (body: Json, ...params: string[]) => [
  'Function',
  body,
  ...params,
];
const positive = lambda(['Greater', 'a', 0], 'a');

describe('IR: Pipe', () => {
  // prettier-ignore
  test.each([
    ['a function literal', ['Pipe', 'x', lambda(['Multiply', 2, 't'], 't')]],
    ['a shorthand literal (Epsil `x |> _ + 1`)', ['Pipe', 'x', ['Function', ['Add', '_', 1]]]],
    ['a library operator', ['Pipe', 'x', 'Sin']],
    ['a user function assigned a literal', ['Pipe', 'x', 'f']],
    ['a user function of a declared signature', ['Pipe', 'x', 'h']],
    ['a chain (`x |> Sin |> h`)', ['Pipe', ['Pipe', 'x', 'Sin'], 'h']],
    ['a topic that is an expression', ['Pipe', ['Add', 'x', 1], 'Exp']],
    ['a list to a library operator', ['Pipe', 'L', 'Sort']],
    ['a list to a reduction', ['Pipe', 'L', 'Sum']],
    ['a list to a literal (mapped)', ['Pipe', 'L', lambda(['Power', 't', 2], 't')]],
    ['a list to a user function (mapped)', ['Pipe', 'L', 'h']],
    ['a call missing its list (`L |> Take(2)`)', ['Pipe', 'L', ['Take', 2]]],
    ['a callback-first call (`L |> Map(f) |> Sum`)', ['Pipe', ['Pipe', 'L', ['Map', ['Function', ['Multiply', '_', 2]]]], 'Sum']],
    ['a closed topic', ['Pipe', 2, 'Sin']],
    // The literal's signature takes a collection: the interpreter binds the
    // list whole, and so does the code (CE-1909).
    ['a list to a literal that binds it whole', ['Pipe', 'L', lambda(['Length', 't'], 't')]],
  ])('%s', (_, json) => {
    check(json);
  });

  test('is the code of the call it evaluates', () => {
    expect(js(['Pipe', 'x', 'Sin']).code).toBe(js(['Sin', 'x']).code);
  });

  test('compiles on GLSL and in the interval mode as the call', () => {
    expect(js(['Pipe', 'x', 'Sin'], { to: 'glsl' }).code).toBe('sin(x)');
    expect(js(['Pipe', 'x', 'Sin'], { to: 'interval-js' }).success).toBe(true);
  });

  // prettier-ignore
  test.each([
    ['a stage that is not applicable here (a free slot in a call)', ['Pipe', 'L', ['Map', ['Multiply', '_', 2]]], /Pipe of a stage that is not/],
    ['a composition', ['Pipe', 'x', ['Compose', 'Sin', 'Cos']], /Pipe of a stage that is not/],
  ])('declines %s', (_, json, cause) => {
    expect(failure(() => js(json))).toMatch(cause);
  });
});

describe('IR: Boole and KroneckerDelta', () => {
  // prettier-ignore
  test.each([
    ['Boole of a comparison', ['Boole', ['Less', 'x', 1]]],
    ['Boole of an equality of integers', ['Boole', ['Equal', 'n', 2]]],
    ['Boole threads over a list of booleans', ['Boole', ['Greater', 'L', 0]]],
    ['Boole in a sum', ['Add', ['Boole', ['Less', 'x', 1]], ['Boole', ['Less', 'n', 1]]]],
    ['KroneckerDelta of two integers', ['KroneckerDelta', 'n', 'm']],
    ['KroneckerDelta of one integer (n = 0)', ['KroneckerDelta', 'n']],
    ['KroneckerDelta of two reals', ['KroneckerDelta', 'x', 0.5]],
    ['KroneckerDelta of expressions', ['KroneckerDelta', ['Add', 'n', 1], ['Multiply', 2, 'm']]],
  ])('%s', (_, json) => {
    check(json);
  });

  test('compiles on GLSL and in the bigint mode', () => {
    expect(js(['KroneckerDelta', 'x', 1], { to: 'glsl' }).code).toBe(
      '((x == 1.0) ? 1.0 : 0.0)'
    );
    const r = js(
      ['Add', ['KroneckerDelta', 'n', 'm'], ['Boole', ['Less', 'n', 3]]],
      {
        mode: 'bigint',
      }
    );
    expect(r.run!({ n: 2n, m: 2n } as never)).toBe(2n);
    expect(r.run!({ n: 5n, m: 2n } as never)).toBe(0n);
  });

  // prettier-ignore
  test.each([
    ['a list (the interpreter does not thread it)', ['KroneckerDelta', 'L', 1], /a list where a scalar is required/],
    ['three operands', ['KroneckerDelta', 'n', 'm', 'n'], /not supported by the compiler/],
  ])('KroneckerDelta declines %s', (_, json, cause) => {
    expect(failure(() => js(json))).toMatch(cause);
  });

  test('the interval mode declines Boole', () => {
    expect(
      failure(() => js(['Boole', ['Less', 'x', 1]], { to: 'interval-js' }))
    ).toMatch(/boole/);
  });
});

describe('IR: Any, All, Contains and IndexOf', () => {
  // prettier-ignore
  test.each([
    ['Any with a predicate', ['Any', 'L', positive]],
    ['All with a predicate', ['All', 'L', positive]],
    ['Any of a list of booleans', ['Any', ['Greater', 'L', 0]]],
    ['All of a list of booleans', ['All', ['Greater', 'L', 0]]],
    ['All over integers (`x % 2 == 0`)', ['All', 'I', lambda(['Equal', ['Mod', 'a', 2], 0], 'a')]],
    ['Any over a Range', ['Any', ['Range', 1, 'n'], lambda(['Equal', 'a', 'm'], 'a')]],
    ['Any over a list of a stated length', ['Any', 'L3', positive]],
    ['Contains of a real', ['Contains', 'L', 'x']],
    ['Contains of a constant', ['Contains', 'L', 2]],
    ['Contains of a real in integers', ['Contains', 'I', 'x']],
    ['Contains in a Range', ['Contains', ['Range', 1, 'n'], 'm']],
    ['IndexOf, the first of repeated elements', ['IndexOf', 'L', 2]],
    ['IndexOf of a real', ['IndexOf', 'L', 'x']],
    ['IndexOf in integers', ['IndexOf', 'I', 'n']],
    ['IndexOf in a literal list', ['IndexOf', ['List', 1, 2, 'x', 2], 2]],
  ])('%s', (_, json) => {
    check(json);
  });

  test('-0 and 0 are the same element, as for the interpreter', () => {
    check(
      ['IndexOf', 'L', 'x'],
      [
        { x: 0, L: [1, -0, 3] },
        { x: -0, L: [1, 0, 3] },
      ]
    );
  });

  // prettier-ignore
  test.each([
    ['a predicate over a list with an effect', ['Any', ['Map', lambda(['Add', 'a', ['Random']], 'a'), 'L'], positive], /with an effect/],
    ['Any of a list of numbers with no predicate', ['Any', 'L'], /a predicate that is not a boolean|static type error/],
  ])('declines %s', (_, json, cause) => {
    expect(failure(() => js(json))).toMatch(cause);
  });

  test('GLSL and the interval mode decline them', () => {
    expect(failure(() => js(['Contains', 'L3', 'x'], { to: 'glsl' }))).toMatch(
      /the region filter/
    );
    expect(
      failure(() => js(['Any', ['Greater', 'L3', 0]], { to: 'interval-js' }))
    ).toMatch(/Any on interval-js/);
  });
});

describe('IR: a named user function as a callback', () => {
  // prettier-ignore
  test.each([
    ['Map of a function assigned a literal', ['Map', 'f', 'L']],
    ['Map of a function defined with :=', ['Map', 'g', 'L']],
    ['Map over a list of a stated length', ['Map', 'h', 'L3']],
    ['Map of a function of two parameters over two lists', ['Map', 'k', 'L', 'L']],
    ['Sum of a Map', ['Sum', ['Map', 'g', 'L']]],
    ['Filter by a predicate', ['Filter', 'L', 'p']],
    ['Count by a predicate', ['Count', 'L', 'p']],
    ['Any and All by a predicate', ['And', ['Any', 'L', 'p'], ['Not', ['All', 'L', 'p']]]],
  ])('%s', (_, json) => {
    check(json);
  });

  test('a function of another arity is an error of the canonical form', () => {
    expect(failure(() => js(['Map', 'k', 'L']))).toMatch(/static type error/);
  });
});

describe('IR: Sort by a key or a comparator', () => {
  // prettier-ignore
  test.each([
    ['by a key literal', ['Sort', 'L', lambda(['Abs', 't'], 't')]],
    ['by a negated key (descending)', ['Sort', 'L', lambda(['Negate', 't'], 't')]],
    ['by a user function as the key', ['Sort', 'L', 'g']],
    ['by a library operator as the key', ['Sort', 'L', 'Abs']],
    ['a list of a stated length by a key', ['Sort', 'L3', lambda(['Mod', 't', 2], 't')]],
    ['ties of a key keep their order', ['Sort', ['List', 3, -3, 1, -1, 2, -2, 'x'], lambda(['Abs', 't'], 't')]],
    ['by a boolean comparator', ['Sort', 'L', lambda(['Less', 'a', 'b'], 'a', 'b')]],
    ['by a descending comparator', ['Sort', 'L', lambda(['Greater', 'a', 'b'], 'a', 'b')]],
    ['by a numeric comparator', ['Sort', 'L', lambda(['Subtract', 'b', 'a'], 'a', 'b')]],
    ['by a library operator of two operands', ['Sort', 'L', 'Subtract']],
    ['by a user comparator of two parameters', ['Sort', 'L', 'k']],
    ['ties of a comparator keep their order', ['Sort', ['List', 3, -3, 1, -1, 2, -2, 'x'], lambda(['Less', ['Abs', 'a'], ['Abs', 'b']], 'a', 'b')]],
    ['a comparator that is not a strict order (`<=`)', ['Sort', ['List', 3, -3, 1, -1, 2, -2, 'x'], lambda(['LessEqual', ['Abs', 'a'], ['Abs', 'b']], 'a', 'b')]],
    ['a Range by a comparator', ['Sort', ['Range', 1, 'n'], lambda(['Greater', 'a', 'b'], 'a', 'b')]],
    ['integers by a comparator', ['Sort', 'I', lambda(['Greater', 'a', 'b'], 'a', 'b')]],
  ])('%s', (_, json) => {
    check(json);
  });

  // prettier-ignore
  test.each([
    ['a variadic operator (the interpreter reads its signature)', ['Sort', 'L', 'Max'], /Sort by a variadic operator/],
    ['a comparator with an effect', ['Sort', 'L', lambda(['Less', 'a', ['Multiply', 'b', ['Random']]], 'a', 'b')], /Sort by a comparator with an effect/],
  ])('declines %s', (_, json, cause) => {
    expect(failure(() => js(json))).toMatch(cause);
  });

  test('GLSL and the interval mode decline it', () => {
    expect(
      failure(() =>
        js(['Sort', 'L3', lambda(['Abs', 't'], 't')], { to: 'glsl' })
      )
    ).toMatch(/ordering/);
    expect(
      failure(() =>
        js(['Sort', 'L3', lambda(['Less', 'a', 'b'], 'a', 'b')], { to: 'glsl' })
      )
    ).toMatch(/sortby/);
  });
});

describe('the forms the interpreter reads another way decline', () => {
  test('Sort by a name whose type does not require one argument', () => {
    // The interpreter calls `Floor(a, b)` as a comparator: `Floor` has an
    // optional second parameter.
    for (const g of ['Floor', 'Round', 'Ln'])
      expect(failure(() => js(['Sort', 'L', g]))).toMatch(/Sort by a function/);
  });

  test('Contains and IndexOf of a value the interpreter holds exactly', () => {
    for (const json of [
      ['Contains', ['List', ['Rational', 1, 3], 2], 'x'],
      ['IndexOf', 'L', ['Rational', 1, 3]],
      ['Contains', 'L', 'Pi'],
      ['Contains', ['Range', 0, 1, 0.1], 'x'],
      ['Contains', ['Map', ['Function', ['Divide', 't', 3], 't'], 'I'], 'x'],
      ['Block', ['Declare', 'q', 'real', ['Rational', 1, 3]], ['IndexOf', 'L', 'q']],
    ])
      expect(failure(() => js(json))).toMatch(/may hold exactly/);
    // Doubles on both sides compile.
    expect(js(['Contains', 'L', 'x']).run({ L: [0.5, 2], x: 2 })).toBe(true);
    expect(js(['IndexOf', 'I', 'n']).run({ I: [4, 5], n: 5 })).toBe(2);
  });

  test('a user function declared `function` is a key, by its literal', () => {
    // `f` is declared `function` and holds `t ↦ t^2 + 1`.
    const r = js(['Sort', 'L', 'f']);
    const L = [3, -1, 2, 0.5];
    const expected = ce
      .box(['Sort', ['List', ...L], 'f'])
      .evaluate()
      .ops!.map((x) => x.re);
    expect(r.run({ L })).toEqual(expected);
    expect(expected).toEqual([0.5, -1, 2, 3]);
  });

  test('KroneckerDelta of two NaN operands is 1', () => {
    const r = js(['KroneckerDelta', ['Divide', 'x', 'x'], ['Divide', 'x', 'x']]);
    expect(r.run({ x: 0 })).toBe(1);
    expect(r.run({ x: 2 })).toBe(1);
  });
});
