/**
 * CE-1471: a recursive call of a user function whose signature states a
 * list or a point result (README of `src/compute-engine/compilation/ir/`,
 * "User functions"). The call made while the body is lowered has the
 * stated type: a list of a run-time length has two results, the length and
 * the list. GLSL has no recursion and declines.
 *
 * The values are compared with the interpreter's. A `Join` of `Range`s and
 * a `Comprehension` are lazy there, read through `ListFrom`.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isFunction,
  isNumber,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;
type Value = number | boolean | Value[];

/** A fresh engine with the declarations `decl` (a type with `->` is a
 *  signature) and the functions `fns`. */
function engine(decl: Record<string, string>, fns: Record<string, Json>) {
  const ce = new ComputeEngine();
  for (const [k, t] of Object.entries(decl))
    ce.declare(k, (t.includes('->') ? { signature: t } : t) as never);
  for (const [k, f] of Object.entries(fns)) ce.assign(k, ce.box(f as never));
  return ce;
}

/** The interpreter's value: a tuple or a list is an array. */
function read(e: Expression): Value {
  if (isNumber(e)) return e.re;
  if (e.symbol === 'True' || e.symbol === 'False') return e.symbol === 'True';
  if (isFunction(e, 'List') || isFunction(e, 'Tuple')) return e.ops.map(read);
  if (isFunction(e) && e.isCollection && e.isFiniteCollection)
    return read(e.engine.function('ListFrom', [e]).evaluate().N());
  throw new Error(`no value: ${e.toString()}`);
}

/** The message of a compilation that throws, or `undefined`. */
function failure(f: () => unknown): string | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { message: string } }).diagnostic?.message;
  }
  return undefined;
}

type Case = {
  decl?: Record<string, string>;
  fns: Record<string, Json>;
  json: Json;
  options?: object;
  /** The inputs, numbers. */
  at: Record<string, number>;
};

const compileTo = (c: Case, to: string) => {
  const ce = engine(c.decl ?? {}, c.fns);
  return compile(ce.box(c.json as never), {
    to,
    fallback: false,
    ...c.options,
  } as never);
};

/** The interpreter's value of the case. */
function interpreted(c: Case): Value {
  const ce = engine(c.decl ?? {}, c.fns);
  for (const [k, v] of Object.entries(c.at)) ce.assign(k, v);
  return read(
    ce
      .box(c.json as never)
      .evaluate()
      .N()
  );
}

/** Compiles on JavaScript with no fallback, and gives the interpreter's
 *  value; declines on GLSL. */
function check(c: Case, close = false) {
  const r = compileTo(c, 'javascript');
  expect(r).toMatchObject({ success: true });
  const got = r.run!(c.at as never) as Value;
  const want = interpreted(c);
  if (close) {
    const [g, w] = [got as number[], want as number[]];
    expect(g.length).toBe(w.length);
    g.forEach((x, i) => expect(x).toBeCloseTo(w[i], 12));
  } else expect(got).toEqual(want);
  expect(failure(() => compileTo(c, 'glsl'))).toBeDefined();
  return r;
}

const fn = (body: Json, ...params: string[]) => ['Function', body, ...params];
const which = (c: Json, a: Json, b: Json) => ['Which', c, a, 'True', b];

/** `F(k) = Which(k = N - 1, [k], True, ListJoin([k], F(k + 1)))`. */
const witness1: Case = {
  decl: { N: 'real', F: '(real) -> list<real>' },
  fns: {
    F: fn(
      which(
        ['Equal', 'k', ['Add', 'N', -1]],
        ['List', 'k'],
        ['ListJoin', ['List', 'k'], ['F', ['Add', 'k', 1]]]
      ),
      'k'
    ),
  },
  json: ['F', 0],
  options: { symbolic: ['N'] },
  at: { N: 4 },
};

/** `F(k, p) = Which(k = 0, p, True, F(k - 1, p) + (1, 0))`. */
const witness2: Case = {
  decl: { N: 'real', F: '(real, tuple<real, real>) -> tuple<real, real>' },
  fns: {
    F: fn(
      which(['Equal', 'k', 0], 'p', [
        'Add',
        ['F', ['Add', 'k', -1], 'p'],
        ['Tuple', 1, 0],
      ]),
      'k',
      'p'
    ),
  },
  json: ['F', 'N', ['Tuple', 1, 2]],
  options: { symbolic: ['N'] },
  at: { N: 3 },
};

/** Tycho's `F(n, K) = {n = K: [n], join([n], F(n + 1, K))}` of
 *  `F(0, K - 1)`, with the base list `base`. */
const argument = (base: Json, K: number, decl = {}): Case => ({
  decl,
  fns: {
    F: fn(
      which(['Equal', 'n', 'K'], base, [
        'Join',
        base,
        ['F', ['Add', 'n', 1], 'K'],
      ]),
      'n',
      'K'
    ),
  },
  json: ['F', 0, ['Subtract', 'K', 1]],
  options: { inputs: { K: 'real' } },
  at: { K },
});

describe('CE-1471: a recursive call of a declared list or point result', () => {
  test('a list of a run-time length (witness 1)', () => {
    check(witness1);
    expect(compileTo(witness1, 'javascript').run!({ N: 4 } as never)).toEqual([
      0, 1, 2, 3,
    ]);
  });

  test('the base case only', () => {
    check({ ...witness1, at: { N: 1 } });
  });

  test('a point (witness 2)', () => {
    check(witness2);
    expect(compileTo(witness2, 'javascript').run!({ N: 3 } as never)).toEqual([
      4, 2,
    ]);
    expect(failure(() => compileTo(witness2, 'glsl'))).toMatch(
      /a recursive function/
    );
  });

  test('a list of a stated length', () => {
    check({
      decl: { k: 'real', F: '(real) -> list<real^2>' },
      fns: {
        F: fn(
          which(
            ['LessEqual', 'j', 0],
            ['List', 0, 0],
            ['Add', ['F', ['Subtract', 'j', 1]], ['List', 1, 'j']]
          ),
          'j'
        ),
      },
      json: ['F', 'k'],
      options: { inputs: { k: 'real' } },
      at: { k: 3 },
    });
  });

  test('an integer body of a list of reals', () => {
    check({
      decl: { k: 'integer', F: '(integer) -> list<real>' },
      fns: {
        F: fn(
          which(
            ['LessEqual', 'j', 0],
            ['List', 1],
            // Integer in both arms: the result takes the declared lane.
            ['Range', 1, ['Add', ['Length', ['F', ['Subtract', 'j', 1]]], 1]]
          ),
          'j'
        ),
      },
      json: ['F', 'k'],
      options: { inputs: { k: 'integer' } },
      at: { k: 3 },
    });
  });

  test('the recursive list read twice', () => {
    const prev = ['F', ['Subtract', 'j', 1]];
    check({
      decl: { k: 'real', F: '(real) -> list<real>' },
      fns: {
        F: fn(
          which(
            ['LessEqual', 'j', 0],
            ['List', 1],
            ['Join', ['List', ['Sum', prev]], prev]
          ),
          'j'
        ),
      },
      json: ['F', 'k'],
      options: { inputs: { k: 'real' } },
      at: { k: 4 },
    });
  });

  test('mutual recursion', () => {
    const c: Case = {
      decl: { k: 'real', A: '(real) -> list<real>', B: '(real) -> list<real>' },
      fns: {
        A: fn(
          which(
            ['LessEqual', 'j', 0],
            ['List', 0],
            ['Join', ['List', 'j'], ['B', ['Subtract', 'j', 1]]]
          ),
          'j'
        ),
        B: fn(
          which(
            ['LessEqual', 'j', 0],
            ['List', 1],
            ['Join', ['List', ['Negate', 'j']], ['A', ['Subtract', 'j', 1]]]
          ),
          'j'
        ),
      },
      json: ['A', 'k'],
      options: { inputs: { k: 'real' } },
      at: { k: 4 },
    };
    check(c);
    expect(compileTo(c, 'javascript').run!({ k: 4 } as never)).toEqual([
      4, -3, 2, -1, 0,
    ]);
  });

  test("CE-1466's rf: Join, with the result inferred or declared", () => {
    const rf = fn(
      which(
        ['Equal', 'u', ['Subtract', 'N', 1]],
        ['List', 'u'],
        ['Join', ['List', 'u'], ['rf', ['Add', 'u', 1]]]
      ),
      'u'
    );
    const c: Case = {
      decl: { N: 'real' },
      fns: { rf },
      json: ['rf', 0],
      options: { symbolic: ['N'] },
      at: { N: 4 },
    };
    // The engine infers `(u: unknown) -> list<number>` from the body.
    expect(engine({ N: 'real' }, { rf }).box('rf').type.toString()).toBe(
      '(u: unknown) -> list<number>'
    );
    check(c);
    check({ ...c, decl: { N: 'real', rf: '(real) -> list<real>' } });
  });

  test("Tycho's list recursion of an argument bound", () => {
    check(argument(['List', 'n'], 50));
    check(argument(['List', 'n'], 50, { F: '(real, real) -> list<real>' }));
    // Lists of 200 elements at each level.
    check(argument(['Range', 'n', ['Add', 'n', 199]], 5));
  });

  test('a depth past the iteration limit of the interpreter is a value', () => {
    const c = argument(['List', 'n'], 3000);
    // The interpreter cancels the evaluation.
    expect(() => interpreted(c)).toThrow(/Iteration limit/);
    const r = compileTo(c, 'javascript');
    expect(r.run!({ K: 3000 } as never)).toEqual(
      Array.from({ length: 3000 }, (_, i) => i)
    );
    // Past the JavaScript stack, a throw.
    expect(() => r.run!({ K: 1e6 } as never)).toThrow(RangeError);
  });

  test("Tycho's gradient recursion of a point", () => {
    // `P(k, Q) = P(k - 1, Q) - e0·G1(P(k - 1, Q))·d(P(k - 1, Q))`,
    // `P(0, Q) = Q`, with untyped helpers that take a point.
    const pt = (a: Json, b: Json) => ['PointList', a, b];
    const d = fn(
      [
        'Subtract',
        [
          'Power',
          [
            'Add',
            ['Power', ['Abs', ['PointX', 'P']], 'm'],
            ['Power', ['Abs', ['PointY', 'P']], 'm'],
          ],
          ['Divide', 1, 'm'],
        ],
        1,
      ],
      'P'
    );
    const diff = (h: Json) => [
      'Subtract',
      ['d', ['Add', 'P', h]],
      ['d', ['Subtract', 'P', h]],
    ];
    const G = fn(
      ['Divide', pt(diff(pt('e', 0)), diff(pt(0, 'e'))), ['Multiply', 2, 'e']],
      'P'
    );
    const G1 = fn(['Divide', ['G', 'P'], ['Abs', ['G', 'P']]], 'P');
    const prev = ['Pt', ['Subtract', 'k', 1], 'Q'];
    const Pt = fn(
      which(['Equal', 'k', 0], 'Q', [
        'Subtract',
        prev,
        ['Multiply', 'e0', ['G1', prev], ['d', prev]],
      ]),
      'k',
      'Q'
    );
    // The point type that Tycho declares.
    const POINT =
      'tuple<nan | real | signed_infinity, nan | real | signed_infinity>';
    const real = { e: 'real', e0: 'real', m: 'real', k: 'real' };
    check(
      {
        decl: { ...real, Pt: `(real, ${POINT}) -> ${POINT}` },
        fns: { d, G, G1, Pt },
        json: ['Pt', 'k', pt(-3.43, 5.75)],
        options: { inputs: real },
        at: { e: 0.01, e0: 0.1, m: 4, k: 5 },
      },
      true
    );
  });

  test('declines', () => {
    const F = (body: Json): Record<string, Json> => ({ F: fn(body, 'j') });
    const prev = ['F', ['Subtract', 'j', 1]];
    const at = { k: 3 };
    const options = { inputs: { k: 'real' } };
    // A body of a constant length where the recursive call takes a list
    // of a run-time length.
    expect(
      failure(() =>
        compileTo(
          {
            decl: { k: 'real', F: '(real) -> list<real>' },
            fns: F(
              which(
                ['LessEqual', 'j', 0],
                ['List', 0, 0],
                ['Add', prev, ['List', 1, 'j']]
              )
            ),
            json: ['F', 'k'],
            options,
            at,
          },
          'javascript'
        )
      )
    ).toMatch(/of a constant length, where its recursive call/);
    // A tuple of elements of no stated type.
    expect(
      failure(() =>
        compileTo(
          {
            decl: { k: 'real', F: '(real) -> tuple<unknown, unknown>' },
            fns: F(
              which(
                ['LessEqual', 'j', 0],
                ['Tuple', 0, 0],
                ['Add', prev, ['Tuple', 1, 'j']]
              )
            ),
            json: ['F', 'k'],
            options,
            at,
          },
          'javascript'
        )
      )
    ).toMatch(/a list or tuple result of no stated type/);
    // A list of points of two lengths in the arms of a `Which`.
    expect(
      failure(() =>
        compileTo(
          {
            decl: { k: 'real', F: '(real) -> list<tuple<real, real>>' },
            fns: F(
              which(
                ['LessEqual', 'j', 0],
                ['List', ['Tuple', 0, 0]],
                ['Join', ['List', ['Tuple', 'j', 'j']], prev]
              )
            ),
            json: ['F', 'k'],
            options,
            at,
          },
          'javascript'
        )
      )
    ).toMatch(/arms of two types/);
  });
});
